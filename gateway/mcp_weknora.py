"""WeKnora MCP server（streamable-http）：把网关的知识库检索能力以 MCP 工具暴露给客户端
托管助手（"知识助手"预置引导模型先检索后回答）。

挂载方式：app.py 以 `app.mount("/mcp", asgi_app)` 暴露，客户端 URL 为
`http://<gateway>/mcp/weknora`。鉴权在进入 MCP 路由前完成（ClientTokenMiddleware），
语义与网关其余 client 端点一致：GATEWAY_TOKEN 未配置时放行。

FastMCP v1 的 streamable-http 传输要求 session manager 以常驻 task 运行；mount 进来的
子应用自身的 lifespan 不会被 FastAPI 执行，故 app.py 的 lifespan 须显式
`async with mcp_weknora.lifespan_session()`。
"""
from contextlib import asynccontextmanager

import httpx
from mcp.server.fastmcp import FastMCP
from starlette.types import ASGIApp, Receive, Scope, Send

from gateway import kb_search, weknora
from gateway.chat import select_kb_ids
from gateway.enterprise import _token_matches, get_settings

# host 显式非 127.0.0.1：避开 FastMCP 默认开启的 DNS rebinding 防护（其仅允许 localhost
# Host 头，会拦掉经内网地址访问的客户端）；网关侧防护由下方令牌中间件承担
mcp = FastMCP("weknora", host="0.0.0.0", streamable_http_path="/weknora")

# 检索片段截断长度（hybrid-search 平铺结果无正文，通常退化为文件名，过长无意义）
_SNIPPET_LEN = 120


async def _scoped_kb_ids(client: httpx.AsyncClient, kb_ids: list[str] | None) -> list[str]:
    """检索范围：显式 kb_ids → 管理端 kb_entries.kb_ids → 全部部门库（^\\d{3}-，见 select_kb_ids）。"""
    if kb_ids:
        return kb_ids
    entries = (get_settings().get("kb_entries") or {}).get("kb_ids") or []
    if entries:
        return [str(k) for k in entries]
    try:
        all_kbs = await weknora.list_kbs(client)
    except httpx.HTTPError:
        return []
    return select_kb_ids(all_kbs, [])


def _format_results(mode: str, sources: list[dict]) -> str:
    """首行为结果模式（模型据此决定换说法重试或如实告知不可达），其后每行 `N. 标题（库名）：片段`。"""
    if mode == "unavailable":
        return "unavailable\n知识库暂时无法访问，请稍后重试。"
    if not sources:
        return "no_result\n没有检索到相关内容，请换个关键词或缩小范围重试。"
    lines = [f"ok（命中 {len(sources)} 条）"]
    for i, s in enumerate(sources, 1):
        snippet = str(s.get("content") or s.get("file_name") or "").strip()[:_SNIPPET_LEN]
        line = f"{i}. {s.get('title') or '（无标题）'}（{s.get('kb_name') or '知识库'}）"
        if snippet:
            line += f"：{snippet}"
        lines.append(line)
    return "\n".join(lines)


@mcp.tool()
async def weknora_search(query: str | None = None, kb_ids: list[str] | None = None, recent: bool = False) -> str:
    """检索所里 WeKnora 企业知识库。回答企业内部问题（制度、规范、通知、项目资料等）前应先调用本工具。

    用法：
    - query 用 2~4 个关键词效果最好（如 "资质 动态核查"），不必写完整句子；
    - kb_ids 省略时检索管理员配置的默认范围；需要精确限定某几个库时传入
      weknora_list_kbs 返回的 id；
    - recent=True 时忽略 query/kb_ids，返回全库最近更新的文档（用户问"最近/最新"
      发布了什么时使用）；
    - 输出首行为结果模式：ok 可直接引用；no_result 表示换个说法或拆分关键词重试；
      unavailable 表示知识库暂不可达，应如实告知用户，不要编造内容。
    """
    if not recent and not (query and query.strip()):
        return "no_result\n请提供检索关键词（query），或用 recent=True 查看最近更新的文档。"
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=60.0)) as client:
        ids = await _scoped_kb_ids(client, kb_ids)
        mode, chunks, _sources = await kb_search.retrieve(client, query or "", ids, recent=recent)
    # 片段从 chunks 取（sources 仅 id/kb_id/kb_name/title，无 file_name）
    return _format_results(mode, chunks)


@mcp.tool()
async def weknora_list_kbs() -> str:
    """列出可检索的 WeKnora 知识库，每行 `id 名称`。

    用户询问"有哪些知识库/能查什么资料"时调用；id 可作为 weknora_search 的 kb_ids
    参数精确指定检索范围。首行 unavailable 表示知识库暂不可达。
    """
    async with httpx.AsyncClient(timeout=weknora.TIMEOUT) as client:
        try:
            kbs = await weknora.list_kbs(client)
        except httpx.HTTPError:
            return "unavailable\n知识库暂时无法访问，请稍后重试。"
    return "\n".join(f"{k['id']} {k['name']}".strip() for k in kbs) or "no_result\n没有可用的知识库。"


def _supplied_token(scope: Scope) -> str:
    """取 X-Client-Token，缺省回退 Authorization: Bearer。"""
    token = auth = ""
    for name, value in scope.get("headers") or []:
        if name == b"x-client-token":
            token = value.decode("latin-1")
        elif name == b"authorization":
            auth = value.decode("latin-1")
    if token:
        return token
    return auth[7:].strip() if auth.lower().startswith("bearer ") else ""


class ClientTokenMiddleware:
    """裸 ASGI 包装：进入 MCP 路由前校验客户端令牌（X-Client-Token，回退 Authorization:
    Bearer），语义同 enterprise._token_matches（GATEWAY_TOKEN 未配置时放行）。"""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        # 仅放行 http；websocket 等其他 scope 一律拒绝（MCP streamable 无 ws 路由，防未来绕过）
        if scope["type"] != "http":
            await send({"type": "http.response.start", "status": 403,
                        "headers": [(b"content-type", b"application/json")]})
            await send({"type": "http.response.body", "body": b'{"detail":"forbidden"}'})
            return
        if not _token_matches(_supplied_token(scope)):
            await send({"type": "http.response.start", "status": 401,
                        "headers": [(b"content-type", b"application/json")]})
            await send({"type": "http.response.body", "body": b'{"detail":"unauthorized"}'})
            return
        await self.app(scope, receive, send)


# app.py 以 app.mount("/mcp", asgi_app) 挂载；子应用内 MCP 路由为 /weknora
asgi_app = ClientTokenMiddleware(mcp.streamable_http_app())


@asynccontextmanager
async def lifespan_session():
    """供 FastAPI lifespan 启停 streamable-http 会话管理器（FastMCP v1 要求，见模块 docstring）。"""
    async with mcp.session_manager.run():
        yield
