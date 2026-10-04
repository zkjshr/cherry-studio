"""WeKnora Web 反向代理：/proxy/weknora/{path} 全方法透传到 WEKNORA_BASE_URL。

存在原因（硬需求）：WeKnora 实例响应带 X-Frame-Options: SAMEORIGIN（实测），客户端
小程序以 iframe 直连必被浏览器拦截；本代理剥离 x-frame-options 与含 frame-ancestors
的 CSP、改写指向 WeKnora 源站的 3xx Location 后流式回传，使 WeKnora UI 可嵌入。
管理端小程序地址应填 `{public_base_url}/proxy/weknora/`（不做自动改写，由管理员显式填写）。

安全边界（有意决策）：代理自身不做鉴权——iframe 场景浏览器不会为页面子资源带上自定义
请求头，GATEWAY_TOKEN 无法生效；访问控制由 WeKnora 自身登录承担，代理只面向局域网。
附带约束：代理与网关其余端点共享同一浏览器 cookie jar——WeKnora 会话 cookie 会落在
网关域上（当前网关鉴权只用 header token、无视 cookie，无冲突；未来若引入 cookie 鉴权
须避开此共享）。
"""
import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from urllib.parse import quote

from gateway.config import settings

router = APIRouter()

_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]

# 逐跳头不转发（RFC 7230）；host/content-length 由 httpx 按上游 URL 与实际 body 重算
_DROP_REQUEST_HEADERS = frozenset({
    "host", "content-length", "connection", "keep-alive", "transfer-encoding",
    "te", "trailers", "upgrade", "proxy-authorization", "proxy-authenticate",
    "proxy-connection",
})
# 响应侧逐跳头同样剥离；Location 单独改写（见 _rewrite_location）
_DROP_RESPONSE_HEADERS = frozenset({"connection", "keep-alive", "proxy-connection"})


def _upstream() -> str:
    return settings.weknora_base_url.rstrip("/")


def _forward_headers(headers) -> dict[str, str]:
    return {k: v for k, v in headers.items() if k.lower() not in _DROP_REQUEST_HEADERS}


def _rewrite_location(value: str) -> str:
    """上游 3xx 的 Location 若指向 WeKnora 源站，改写回代理前缀——否则 iframe 会跳出代理、
    直连源站被 X-Frame-Options 拦截（嵌入静默白屏）。相对路径原样保留。"""
    origin = _upstream()
    if value == origin:
        return "/proxy/weknora/"
    if value.startswith(f"{origin}/"):
        return f"/proxy/weknora/{value[len(origin) + 1:]}"
    return value


def _response_headers(headers) -> list[tuple[str, str]]:
    """透传响应头，剥离嵌入拦截头：x-frame-options 与含 frame-ancestors 的 CSP（大小写不敏感）、
    响应侧逐跳头；Location 改写；content-length/transfer-encoding 交给响应框架按实际流重算。"""
    out: list[tuple[str, str]] = []
    for k, v in headers.multi_items():
        low = k.lower()
        if low in ("x-frame-options", "content-length", "transfer-encoding"):
            continue
        if low in _DROP_RESPONSE_HEADERS:
            continue
        if low.startswith("content-security-policy") and "frame-ancestors" in v.lower():
            continue
        if low == "location":
            v = _rewrite_location(v)
        out.append((k, v))
    return out


@router.api_route("/proxy/weknora/{path:path}", methods=_METHODS)
async def proxy(path: str, request: Request) -> StreamingResponse:
    query = f"?{request.url.query}" if request.url.query else ""
    # path 已被路由解码，重编码防止 %3F/%23/%2F 等在拼 URL 时被二次解释（?/#/路径穿越）
    url = f"{_upstream()}/{quote(path, safe='/')}{query}"
    headers = _forward_headers(request.headers)
    client = httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=300.0))
    # 流式转发请求体，不做整体缓冲（上传体可能很大，避免内存放大）
    req = client.build_request(request.method, url, headers=headers, content=request.stream())
    try:
        resp = await client.send(req, stream=True)
    except httpx.HTTPError:
        await client.aclose()
        raise HTTPException(status_code=502, detail="weknora unreachable")

    async def gen():
        try:
            async for chunk in resp.aiter_raw():
                yield chunk
        finally:
            await resp.aclose()
            await client.aclose()

    response = StreamingResponse(gen(), status_code=resp.status_code)
    # raw_headers 直填以保留重复头（如多个 Set-Cookie）；StreamingResponse 构造器只收 Mapping
    response.raw_headers.extend(
        (k.encode("latin-1"), v.encode("latin-1")) for k, v in _response_headers(resp.headers))
    return response
