"""模型路由代理：/v1/chat/completions 按 model="{upstream_id}/{model_id}"（首个 "/" 分隔，
model_id 本身可含 "/"）路由到注册上游。openai 协议原样透传（SSE 流式 / JSON）；ollama 协议
把 /api/chat 的 NDJSON 转为 OpenAI chunk 流（复用 chat.extract_ollama_delta），非 stream 聚合
为一份 completion。未知模型/上游返回 OpenAI 错误格式 404。每次调用（含上游错误与路由失败）
写一条 usage_log。RAG 编排在 openai_compat 的 /v1/kb/chat/completions，不走本模块。
"""
import json
import time
import uuid

import httpx
from fastapi import APIRouter, Depends, Response
from fastapi.responses import JSONResponse, StreamingResponse

from gateway.auth import require_token
from gateway.chat import extract_ollama_delta
from gateway.enterprise import list_upstreams, record_usage

router = APIRouter()

# 首包 10s / 生成读 300s，与 RAG 编排的 ollama 预算一致
UPSTREAM_TIMEOUT = httpx.Timeout(10.0, read=300.0)


def _error(status: int, message: str, err_type: str = "invalid_request_error") -> JSONResponse:
    """OpenAI 错误格式。"""
    return JSONResponse(status_code=status, content={"error": {"message": message, "type": err_type}})


def _resolve(model: str) -> tuple[dict | None, str, JSONResponse | None]:
    """解析路由 → (upstream, model_id, 404响应)。仅 enabled 上游可路由；模型须在其清单内
    （visible 只影响 /v1/models 展示，不限制直接调用）。"""
    upstream_id, sep, model_id = model.partition("/")
    if not sep or not upstream_id or not model_id:
        return None, "", _error(404, f"model not found: {model}")
    for up in list_upstreams():
        if up["id"] == upstream_id:
            if up["enabled"] and any(m["id"] == model_id for m in up["models"]):
                return up, model_id, None
            break
    return None, "", _error(404, f"model not found: {model}")


def _record(model: str, upstream_id: str | None, t0: float, usage: dict | None, status: str) -> None:
    """一次调用结束记 usage_log：tokens 抽不到记 0，duration 恒记。"""
    u = usage or {}
    record_usage(model, upstream_id, int(u.get("prompt_tokens") or 0), int(u.get("completion_tokens") or 0),
                 int(u.get("total_tokens") or 0), int((time.monotonic() - t0) * 1000), status)


def _ollama_counts(d: dict) -> dict:
    """ollama 末行/单对象计数 → OpenAI usage 形状。"""
    p, c = int(d.get("prompt_eval_count") or 0), int(d.get("eval_count") or 0)
    return {"prompt_tokens": p, "completion_tokens": c, "total_tokens": p + c}


def _passthrough(resp: httpx.Response) -> Response:
    """上游响应原样回传（状态码与 content-type 保留）；非流式与上游 4xx/5xx 共用。"""
    return Response(content=resp.content, status_code=resp.status_code,
                    media_type=resp.headers.get("content-type", "application/json"))


def _chunk(compl_id: str, model: str, delta: dict, finish: str | None = None,
           usage: dict | None = None) -> str:
    """ollama NDJSON → OpenAI chunk 单帧。"""
    body: dict = {
        "id": compl_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }
    if usage is not None:
        body["usage"] = usage
    return f"data: {json.dumps(body, ensure_ascii=False)}\n\n"


async def _send_stream(url: str, payload: dict, headers: dict) -> tuple[httpx.AsyncClient, httpx.Response]:
    """打开上游流；连接失败向上抛（调用方记 error），由调用方负责关闭。"""
    client = httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT)
    try:
        resp = await client.send(client.build_request("POST", url, json=payload, headers=headers), stream=True)
    except httpx.HTTPError:
        await client.aclose()
        raise
    return client, resp


async def _close_stream(client: httpx.AsyncClient, resp: httpx.Response) -> None:
    await resp.aclose()
    await client.aclose()


async def _proxy_openai(upstream: dict, model_id: str, model: str, body: dict, t0: float):
    """openai 协议：POST {base}/chat/completions（model 换裸 model_id）；SSE 逐行透传，
    流中末个非空 usage 记账；非 stream/上游错误 JSON 透传。"""
    headers = {"Authorization": f"Bearer {upstream['api_key']}"} if upstream["api_key"] else {}
    url = f"{upstream['base_url']}/chat/completions"
    payload = {**body, "model": model_id}
    if "messages" in payload:
        # 同 ollama 路径：纯文本数组形 content 压平为字符串（字符串形是所有
        # OpenAI 兼容服务的基线格式，链式网关/严格上游都更稳妥）。
        payload["messages"] = _flatten_text_content(payload["messages"])
    if not body.get("stream"):
        async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT) as client:
            resp = await client.post(url, json=payload, headers=headers)
        if resp.status_code >= 400:
            _record(model, upstream["id"], t0, None, "error")
            return _passthrough(resp)
        try:
            usage = resp.json().get("usage")
        except ValueError:  # 非 JSON 响应体：token 记 0，正文仍透传
            usage = None
        _record(model, upstream["id"], t0, usage, "ok")
        return _passthrough(resp)

    client, resp = await _send_stream(url, payload, headers)
    if resp.status_code >= 400:
        await resp.aread()  # 缓存 body 供 passthrough
        out = _passthrough(resp)
        await _close_stream(client, resp)
        _record(model, upstream["id"], t0, None, "error")
        return out

    async def gen():
        usage = None
        ok = True
        try:
            async for line in resp.aiter_lines():
                if line.startswith("data:") and "[DONE]" not in line:
                    try:
                        chunk_usage = json.loads(line[5:]).get("usage")
                    except ValueError:
                        chunk_usage = None
                    if chunk_usage:
                        usage = chunk_usage
                yield f"{line}\n"  # aiter_lines 已去换行，逐行补回还原原始 SSE 分帧
        except httpx.HTTPError:
            ok = False
            raise
        except BaseException:  # 客户端断流(GatewayExit/CancelledError)等也按失败记账
            ok = False
            raise
        finally:
            await _close_stream(client, resp)
            _record(model, upstream["id"], t0, usage, "ok" if ok else "error")

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _flatten_text_content(messages):
    """OpenAI 数组形 content（全部为 text 部件时）压平为字符串。

    ollama 的 Go 结构体只收 string content，而智能体/多段文本消息常以
    `[{"type":"text","text":...}]` 数组下发，直接透传会被 400 拒绝
    （cannot unmarshal array into ... messages.content of type string）。
    含非 text 部件（图片等）的消息原样保留，交由上游自行取舍。
    """
    out = []
    for m in messages:
        content = m.get("content")
        if isinstance(content, list):
            texts = [p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"]
            if len(texts) == len(content):
                m = {**m, "content": "\n\n".join(t for t in texts if t)}
        out.append(m)
    return out


async def _proxy_ollama(upstream: dict, model_id: str, model: str, body: dict, t0: float):
    """ollama 协议：POST {base}/api/chat（{model, messages, stream}）；NDJSON→OpenAI chunk 流
    （首块带 role，done 行抽 prompt_eval_count/eval_count 记账），非 stream 聚合为一份 completion。
    messages 先过 `_flatten_text_content`（数组形 content → 字符串）再转发。"""
    headers = {"Authorization": f"Bearer {upstream['api_key']}"} if upstream["api_key"] else {}
    url = f"{upstream['base_url']}/api/chat"
    payload = {
        "model": model_id,
        "messages": _flatten_text_content(body.get("messages") or []),
        "stream": bool(body.get("stream")),
    }
    compl_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"

    if payload["stream"]:
        client, resp = await _send_stream(url, payload, headers)
        if resp.status_code >= 400:
            await resp.aread()
            out = _passthrough(resp)
            await _close_stream(client, resp)
            _record(model, upstream["id"], t0, None, "error")
            return out

        async def gen():
            usage = None
            ok = True
            first = True
            try:
                async for line in resp.aiter_lines():
                    delta = extract_ollama_delta(line)
                    if delta:
                        if first:
                            first = False
                            yield _chunk(compl_id, model, {"role": "assistant", "content": ""})
                        yield _chunk(compl_id, model, {"content": delta})
                        continue
                    try:
                        d = json.loads(line)
                    except ValueError:
                        continue
                    if d.get("done"):
                        usage = _ollama_counts(d)
            except httpx.HTTPError:
                ok = False
                raise
            except BaseException:  # 客户端断流等非 HTTP 异常同样按失败记账
                ok = False
                raise
            finally:
                await _close_stream(client, resp)
                _record(model, upstream["id"], t0, usage, "ok" if ok else "error")
            yield _chunk(compl_id, model, {}, "stop", usage)
            yield "data: [DONE]\n\n"

        return StreamingResponse(gen(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT) as client:
        resp = await client.post(url, json=payload, headers=headers)
    if resp.status_code >= 400:
        _record(model, upstream["id"], t0, None, "error")
        return _passthrough(resp)
    try:
        d = resp.json()
    except ValueError:
        _record(model, upstream["id"], t0, None, "error")
        return _passthrough(resp)
    usage = _ollama_counts(d)
    _record(model, upstream["id"], t0, usage, "ok")
    return {
        "id": compl_id,
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": (d.get("message") or {}).get("content") or ""},
            "finish_reason": "stop",
        }],
        "usage": usage,
    }


@router.post("/v1/chat/completions")
async def chat_completions(body: dict, _token: None = Depends(require_token)):
    """模型路由代理入口；上游不可达回 502（OpenAI 错误格式），上游 4xx/5xx 原样透传。"""
    model = str(body.get("model") or "")
    upstream, model_id, miss = _resolve(model)
    t0 = time.monotonic()
    if miss is not None:
        _record(model, None, t0, None, "error")
        return miss
    try:
        if upstream["protocol"] == "ollama":
            return await _proxy_ollama(upstream, model_id, model, body, t0)
        return await _proxy_openai(upstream, model_id, model, body, t0)
    except httpx.HTTPError as e:
        _record(model, upstream["id"], t0, None, "error")
        return _error(502, f"upstream unreachable: {e}", "api_error")


@router.get("/v1/models")
def list_models(_token: None = Depends(require_token)) -> dict:
    """可见模型清单：enabled 上游的 visible 模型，id 为路由格式 "{upstream_id}/{model_id}"。"""
    data = [{"id": f'{up["id"]}/{m["id"]}', "object": "model"}
            for up in list_upstreams() if up["enabled"]
            for m in up["models"] if m.get("visible", True)]
    return {"object": "list", "data": data}
