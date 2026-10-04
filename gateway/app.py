import asyncio
import json as _json
import os
import re
from contextlib import asynccontextmanager

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, StreamingResponse

from gateway import chat as chat_mod
from gateway import mcp_weknora, weknora, weknora_proxy
from gateway.auth import require_token
from gateway.config import settings
from gateway.enterprise import router as enterprise_router
from gateway.marketplace import router as marketplace_router
from gateway.merge import merge_deep_results
from gateway.model_proxy import router as model_proxy_router
from gateway.openai_compat import router as openai_compat_router

FANOUT_CONCURRENCY = 8
DEEP_PER_KB = 15
# 单库深度检索预算：超时该库记为失败但其余库结果照常返回（partial 语义）
DEEP_PER_KB_TIMEOUT = 6.0

OLLAMA_BASE = os.environ.get("OLLAMA_BASE_URL", "http://192.168.66.25:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:14b")
# 选库：部门库按命名规范（^\d{3}- 前缀，如 101-/103-）识别。实测 54 库中 52 个符合该
# 规范（仅 TJAD共建/既有数据源 2 个除外），且 list_kbs 返回序把 101 排在第 47 位——
# 按返回序截前 N 会漏掉总部部门库，故匹配库全量扇出；防雪崩由 FANOUT_CONCURRENCY
# 并发信号量 + DEEP_PER_KB_TIMEOUT 单库 6s 预算兜底（与 /api/deep 全库最坏情况等同）。
_DEPT_KB_RE = re.compile(r"^\d{3}-")
CHAT_TOP_KB = 12  # 无部门库可匹配时回退：全部库前 12
# ollama 阶段硬顶：首 token 180s；收到首个非空 delta 后改按"从流开始计总量 300s"重排
OLLAMA_FIRST_TOKEN_TIMEOUT = 180.0
OLLAMA_TOTAL_TIMEOUT = 300.0

@asynccontextmanager
async def lifespan(_app: FastAPI) -> None:
    # FastMCP v1 streamable-http 要求 session manager 常驻 task；mount 子应用自身的
    # lifespan 不会被 FastAPI 执行，故在此显式启停（见 mcp_weknora.lifespan_session）
    # 注意：mcp session_manager.run() 每进程仅允许一次——全进程只此一处进入 lifespan，
    # 测试里勿对同一 app 再用 with TestClient(app)（会二次 run 直接 RuntimeError）
    async with mcp_weknora.lifespan_session():
        yield


app = FastAPI(title="TJADKnows Gateway", lifespan=lifespan)
app.include_router(openai_compat_router)
# /v1/chat/completions 归模型路由代理（RAG 编排在 openai_compat 的 /v1/kb/chat/completions）
app.include_router(model_proxy_router)
app.include_router(enterprise_router)
app.include_router(marketplace_router)
app.include_router(weknora_proxy.router)
# MCP 挂 /mcp 前缀（子应用内路由 /weknora）→ 客户端 URL http://<gateway>/mcp/weknora
app.mount("/mcp", mcp_weknora.asgi_app)
app.add_middleware(CORSMiddleware, allow_origins=["tauri://localhost", "http://tauri.localhost", "http://localhost:1420"], allow_methods=["*"], allow_headers=["*"])


@app.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    # 根路径无内容，浏览器直开时落到管理页
    return RedirectResponse(url="/admin")


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/api/kbs", dependencies=[Depends(require_token)])
async def kbs() -> dict:
    async with httpx.AsyncClient(timeout=weknora.TIMEOUT) as client:
        return {"kbs": await weknora.list_kbs(client)}


@app.get("/api/instant", dependencies=[Depends(require_token)])
async def instant(q: str = Query(min_length=1), limit: int = 20) -> dict:
    async with httpx.AsyncClient(timeout=weknora.TIMEOUT) as client:
        try:
            return {"results": await weknora.instant_search(client, q, limit)}
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"weknora unreachable: {e}")


@app.get("/api/recent", dependencies=[Depends(require_token)])
async def recent(limit: int = Query(default=30, le=50)) -> dict:
    async with httpx.AsyncClient(timeout=weknora.TIMEOUT) as client:
        try:
            return {"results": await weknora.recent_knowledge(client, limit), "partial": False}
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"weknora unreachable: {e}")


@app.get("/api/deep", dependencies=[Depends(require_token)])
async def deep(q: str = Query(min_length=1), kb_ids: str = Query(default=""), limit: int = 20) -> dict:
    ids = [s for s in kb_ids.split(",") if s]
    if not ids:
        return {"results": [], "partial": False}
    sem = asyncio.Semaphore(FANOUT_CONCURRENCY)

    async def one(client: httpx.AsyncClient, kb_id: str) -> tuple[str, list[dict] | None]:
        async with sem:
            try:
                return kb_id, await asyncio.wait_for(
                    weknora.kb_hybrid_search(client, kb_id, q, DEEP_PER_KB),
                    timeout=DEEP_PER_KB_TIMEOUT,
                )
            except (httpx.HTTPError, asyncio.TimeoutError):
                return kb_id, None

    async with httpx.AsyncClient(timeout=httpx.Timeout(5.0, read=10.0)) as client:
        pairs = await asyncio.gather(*(one(client, kb_id) for kb_id in ids))
        # hybrid-search 返回平铺 chunk 字段不带 kb_name，用库列表补齐（取不到就留空）
        try:
            kb_names = {k["id"]: k["name"] for k in await weknora.list_kbs(client)}
        except httpx.HTTPError:
            kb_names = {}
    by_kb = {kb: r for kb, r in pairs if r is not None}
    merged = merge_deep_results(by_kb, limit)
    for r in merged:
        r["kb_name"] = kb_names.get(r["kb_id"], r["kb_name"])
    return {"results": merged, "partial": len(by_kb) < len(ids)}


@app.get("/api/chat/stream", dependencies=[Depends(require_token)])
async def chat_stream(q: str = Query(min_length=1), history: str = Query(default=""), kb_ids: str = Query(default="")) -> StreamingResponse:
    try:
        hist = _json.loads(history) if history else []
    except ValueError:
        hist = []
    # 形状校验：非 list 或元素缺 role/content 字符串键则整体置空，防 build_prompt 抛错中断已 200 的流
    if not (isinstance(hist, list) and all(
            isinstance(h, dict) and isinstance(h.get("role"), str) and isinstance(h.get("content"), str)
            for h in hist)):
        hist = []

    async def gen():
        sse = lambda event, payload: f"event: {event}\ndata: {_json.dumps(payload, ensure_ascii=False)}\n\n"
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=300.0)) as client:
            # 1) 确定库列表
            try:
                all_kbs = await weknora.list_kbs(client)
            except httpx.HTTPError:
                all_kbs = []
            ids = chat_mod.select_kb_ids(all_kbs, [s for s in kb_ids.split(",") if s])
            kb_names = {k["id"]: k["name"] for k in all_kbs}
            yield sse("status", {"text": f"正在检索 {len(ids)} 个部门知识库…"})
            # 2) 检索（复用 deep 的并发/预算语义，简化为顺序 gather+wait_for）
            sem = asyncio.Semaphore(FANOUT_CONCURRENCY)

            async def one(kb_id: str) -> tuple[bool, list[dict]]:
                async with sem:
                    try:
                        rs = await asyncio.wait_for(weknora.kb_hybrid_search(client, kb_id, q, 3), timeout=DEEP_PER_KB_TIMEOUT)
                        for r in rs:
                            r["kb_name"] = kb_names.get(kb_id, r.get("kb_name") or "")
                        return True, rs
                    except (httpx.HTTPError, asyncio.TimeoutError):
                        # 失败与空结果必须可区分（ok 标志），供下方全败判定
                        return False, []

            pairs = await asyncio.gather(*(one(k) for k in ids))
            # 检索全败 ≠ 0 命中：全部库都不可达/超时则如实告知（spec §4），不发 sources，
            # 避免用户误读为"库内没有相关内容"；部分失败维持既有 partial 语义不动
            if ids and all(not ok for ok, _ in pairs):
                yield sse("status", {"text": "知识库暂时无法访问，请稍后重试"})
                yield sse("delta", {"text": "知识库暂时无法访问，请稍后重试。"})
                yield sse("done", {"partial": True})
                return
            results = [rs for _, rs in pairs]
            # 跨库 score 不可比（实测同查询下小库噪声 0.48 vs 101/103 相关文档 0.016），
            # 全局按分排序会让小库高分淹没相关部门库命中。改为按库轮转取优：各库先
            # 贡献库内最优 1 条，再按库内分数补足至 8；单库时退化为原库内排序。
            by_kb: dict[str, list[dict]] = {}
            for rs in results:
                for r in rs:
                    by_kb.setdefault(r["kb_id"], []).append(r)
            q_terms = [t for t in q.split() if len(t) >= 2] or [q]
            pools = sorted(
                (sorted(pool, key=lambda c: c.get("score") or 0, reverse=True) for pool in by_kb.values()),
                key=lambda pool: (
                    # 标题含查询词的库优先（hybrid-search 平铺结果无正文，title 是唯一
                    # 可解释的相关性信号；跨库 score 不可比，纯按分会排到噪声库之后）
                    any(any(t in (c.get("title") or "") for t in q_terms) for c in pool),
                    pool[0].get("score") or 0,
                ),
                reverse=True,
            )
            chunks = []
            while len(chunks) < 8:
                before = len(chunks)
                for pool in pools:
                    if pool and len(chunks) < 8:
                        chunks.append(pool.pop(0))
                if len(chunks) == before:
                    break
            # 去重来源（同 knowledge_id 取最高分）
            seen: set[str] = set()
            sources = []
            for c in chunks:
                if c["id"] not in seen:
                    seen.add(c["id"])
                    sources.append({"id": c["id"], "kb_id": c["kb_id"], "kb_name": c.get("kb_name") or "", "title": c.get("title") or ""})
            yield sse("status", {"text": f"命中 {len(sources)} 篇相关文档，正在阅读…"})
            if sources:
                yield sse("sources", {"sources": sources[:8]})
            if not chunks:
                yield sse("delta", {"text": "知识库暂时没有检索到相关内容。"})
                yield sse("done", {"partial": True})
                return
            # 3) ollama 流式（首 token 180s / 整体 300s 硬顶，超时降级 partial）
            messages = chat_mod.build_prompt(q, chunks, hist)
            partial = False
            first_delta = True
            loop = asyncio.get_running_loop()
            stream_t0 = loop.time()
            try:
                async with asyncio.timeout(OLLAMA_FIRST_TOKEN_TIMEOUT) as first_tok:
                    async with client.stream(
                        "POST", f"{OLLAMA_BASE}/api/chat",
                        json={"model": OLLAMA_MODEL, "stream": True, "messages": messages},
                    ) as resp:
                        resp.raise_for_status()
                        async for line in resp.aiter_lines():
                            delta = chat_mod.extract_ollama_delta(line)
                            if delta:
                                if first_delta:
                                    first_delta = False
                                    # 收到首 delta 后切换为总量 300s（从流开始计）的剩余额度
                                    first_tok.reschedule(loop.time() + max(OLLAMA_TOTAL_TIMEOUT - (loop.time() - stream_t0), 0.1))
                                yield sse("delta", {"text": delta})
            except (httpx.HTTPError, asyncio.TimeoutError) as e:
                partial = True
                yield sse("delta", {"text": f"\n（生成服务暂不可用：{type(e).__name__}，以上为检索到的相关文档，可点击下方来源查看）"})
            yield sse("done", {"partial": partial})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
