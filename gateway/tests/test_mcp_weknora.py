"""WeKnora MCP server + 反向代理测试。

MCP：uvicorn 随机端口起网关真服务（lifespan 运行 FastMCP session manager），mcp 客户端
经 streamable-http 连 /mcp/weknora；WeKnora 上游用同进程内第二个 uvicorn 仿真服务
（不用 respx——respx 类级补丁会同时拦下 MCP 客户端自身的 SSE 连接致其挂起）。
代理：进程内 TestClient + respx 模拟上游，验证帧头剥离与方法/query/body 透传。
"""
import os
import socket
import threading
import time
from contextlib import asynccontextmanager

import httpx
import pytest
import respx
import uvicorn
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from gateway import enterprise
from gateway.app import app
from gateway.config import settings

settings.gateway_token = "test-token"
client = TestClient(app)

# 仿真 WeKnora 的可变状态（同进程，测试先播种再调用）
_STATE: dict = {}


def _fake_weknora() -> FastAPI:
    """按 _STATE 返回库列表/hybrid 命中/最近文档，并记录调用供断言。"""
    fake = FastAPI()

    @fake.get("/api/v1/knowledge-bases")
    async def kbs() -> dict:
        return {"data": _STATE.get("kbs", [])}

    @fake.post("/api/v1/knowledge-bases/{kb_id}/hybrid-search")
    async def hybrid(kb_id: str) -> dict:
        _STATE.setdefault("hits", []).append(kb_id)
        return {"data": (_STATE.get("hybrid") or {}).get(kb_id, [])}

    @fake.get("/api/v1/knowledge/search")
    async def search(request: Request) -> dict:
        _STATE.setdefault("searches", []).append(str(request.url.query))
        return {"data": _STATE.get("recent", [])}

    return fake


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _spawn(application, port: int) -> tuple[uvicorn.Server, threading.Thread]:
    config = uvicorn.Config(application, host="127.0.0.1", port=port, log_level="warning",
                            timeout_graceful_shutdown=3)
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    assert server.started, "uvicorn 未能在时限内启动"
    return server, thread


def _stop(server: uvicorn.Server, thread: threading.Thread) -> None:
    server.should_exit = True
    thread.join(timeout=10)


@pytest.fixture(scope="module")
def mcp_url(tmp_path_factory):
    """网关真服务 + 仿真 WeKnora：返回 MCP 客户端 URL（模块级复用，进程内各起一个 uvicorn）。"""
    fake_port = _free_port()
    fake_srv, fake_th = _spawn(_fake_weknora(), fake_port)
    old_url, old_db = settings.weknora_base_url, os.environ.get("ENTERPRISE_DB_PATH")
    settings.weknora_base_url = f"http://127.0.0.1:{fake_port}"
    # 模块级独立临时库；默认范围用例先显式清空 kb_entries，避免用例顺序耦合
    os.environ["ENTERPRISE_DB_PATH"] = str(tmp_path_factory.mktemp("mcp") / "enterprise.sqlite3")
    srv, th = _spawn(app, (port := _free_port()))
    yield f"http://127.0.0.1:{port}/mcp/weknora"
    _stop(srv, th)
    _stop(fake_srv, fake_th)
    settings.weknora_base_url = old_url
    if old_db is None:
        os.environ.pop("ENTERPRISE_DB_PATH", None)
    else:
        os.environ["ENTERPRISE_DB_PATH"] = old_db


def _seed(kbs: list[dict], hybrid: dict | None = None, recent: list[dict] | None = None) -> None:
    _STATE.clear()
    _STATE.update(kbs=kbs, hybrid=hybrid or {}, recent=recent or [])


@asynccontextmanager
async def _session(url: str, token: str = "test-token"):
    async with streamablehttp_client(url, headers={"X-Client-Token": token}) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session


def test_mcp_requires_token(mcp_url):
    body = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}
    assert httpx.post(mcp_url, json=body).status_code == 401
    assert httpx.post(mcp_url, json=body, headers={"X-Client-Token": "wrong"}).status_code == 401
    # 正确 token（含 Bearer 回退）放行进入 MCP 路由
    ok_headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
    ok = httpx.post(mcp_url, json=body, headers={"X-Client-Token": "test-token", **ok_headers})
    assert ok.status_code == 200
    bearer = httpx.post(mcp_url, json=body, headers={"Authorization": "Bearer test-token", **ok_headers})
    assert bearer.status_code == 200


async def test_list_tools_with_descriptions(mcp_url):
    async with _session(mcp_url) as s:
        tools = (await s.list_tools()).tools
    by_name = {t.name: t for t in tools}
    assert {"weknora_search", "weknora_list_kbs"} <= set(by_name)
    assert "知识库" in (by_name["weknora_search"].description or "")
    assert "weknora_search" in (by_name["weknora_list_kbs"].description or "")


async def test_list_kbs(mcp_url):
    _seed([{"id": "kb1", "name": "101-市场运营部"}, {"id": "kb2", "name": "103-建筑设计院"}])
    async with _session(mcp_url) as s:
        out = (await s.call_tool("weknora_list_kbs", {})).content[0].text
    assert out == "kb1 101-市场运营部\nkb2 103-建筑设计院"


async def test_search_default_scope_is_dept_kbs(mcp_url):
    enterprise.save_settings({"kb_entries": {"recent_enabled": False, "kb_ids": []}})
    _seed([{"id": "kb1", "name": "101-市场运营部"}, {"id": "kbx", "name": "TJAD共建"}],
          {"kb1": [{"knowledge_id": "d1", "knowledge_title": "关于资质的通知",
                    "knowledge_filename": "zizhi.md", "score": 0.8}]})
    async with _session(mcp_url) as s:
        out = (await s.call_tool("weknora_search", {"query": "资质 通知"})).content[0].text
    assert _STATE["hits"] == ["kb1"]  # 默认范围 = ^\\d{3}- 部门库，不含 TJAD共建
    assert out.startswith("ok（命中 1 条）")
    assert "1. 关于资质的通知（101-市场运营部）：zizhi.md" in out


async def test_search_explicit_kb_ids(mcp_url):
    enterprise.save_settings({"kb_entries": {"recent_enabled": False, "kb_ids": []}})
    _seed([{"id": "kb1", "name": "101-市场运营部"}],
          {"kb9": [{"knowledge_id": "d9", "knowledge_title": "项建书模板",
                    "knowledge_filename": "t.md", "score": 0.5}]})
    async with _session(mcp_url) as s:
        out = (await s.call_tool("weknora_search", {"query": "项建书", "kb_ids": ["kb9"]})).content[0].text
    assert _STATE["hits"] == ["kb9"]  # 显式指定优先于默认范围
    assert "项建书模板" in out


async def test_search_scope_falls_back_to_admin_settings(mcp_url):
    enterprise.save_settings({"kb_entries": {"recent_enabled": False, "kb_ids": ["kb7"]}})
    _seed([{"id": "kb1", "name": "101-市场运营部"}, {"id": "kb7", "name": "107-人力资源部"}],
          {"kb7": [{"knowledge_id": "d7", "knowledge_title": "薪酬制度",
                    "knowledge_filename": "hr.md", "score": 0.9}]})
    async with _session(mcp_url) as s:
        out = (await s.call_tool("weknora_search", {"query": "薪酬"})).content[0].text
    assert _STATE["hits"] == ["kb7"]  # 无显式 kb_ids 时用 kb_entries.kb_ids
    assert "1. 薪酬制度（107-人力资源部）：hr.md" in out


async def test_search_no_result_and_unavailable(mcp_url):
    enterprise.save_settings({"kb_entries": {"recent_enabled": False, "kb_ids": []}})
    _seed([{"id": "kb1", "name": "101-市场运营部"}])
    async with _session(mcp_url) as s:
        out = (await s.call_tool("weknora_search", {"query": "不存在的东西"})).content[0].text
    assert out.startswith("no_result")
    _STATE["kbs"] = []  # 无部门库可匹配 → select_kb_ids 回退全库前 12 = 空列表 → unavailable
    async with _session(mcp_url) as s:
        out = (await s.call_tool("weknora_search", {"query": "不存在的东西"})).content[0].text
    assert out.startswith("unavailable")


async def test_search_recent_uses_global_search(mcp_url):
    _seed([{"id": "kb1", "name": "101-市场运营部"}], recent=[
        {"id": "r1", "knowledge_base_id": "kb1", "knowledge_base_name": "101-市场运营部",
         "title": "本周简报", "file_name": "w.md", "updated_at": "2026-10-01"}])
    async with _session(mcp_url) as s:
        out = (await s.call_tool("weknora_search", {"query": "随便", "recent": True})).content[0].text
    assert _STATE.get("hits", []) == []  # recent 走全局最近检索，不做按库扇出
    assert _STATE["searches"] and all("recent=true" in q for q in _STATE["searches"])
    assert out.startswith("ok（命中 1 条）")
    assert "1. 本周简报（101-市场运营部）：w.md" in out


# ---------- 反向代理 ----------

@respx.mock
def test_proxy_strips_frame_headers_and_passes_query():
    settings.weknora_base_url = "http://wk.test"
    respx.get("http://wk.test/app/some/path").mock(return_value=httpx.Response(
        200, content=b"<html>ok</html>", headers={
            "Content-Type": "text/html; charset=utf-8",
            "X-Frame-Options": "SAMEORIGIN",
            "Content-Security-Policy": "default-src 'self'; frame-ancestors 'self'",
            "X-Custom": "keep-me",
        }))
    resp = client.get("/proxy/weknora/app/some/path?tab=1&q=%E8%B5%84%E8%B4%A8")
    assert resp.status_code == 200
    assert resp.content == b"<html>ok</html>"
    assert "x-frame-options" not in resp.headers
    assert "content-security-policy" not in resp.headers  # 含 frame-ancestors 的 CSP 剥离
    assert resp.headers["x-custom"] == "keep-me"
    assert str(respx.calls.last.request.url) == "http://wk.test/app/some/path?tab=1&q=%E8%B5%84%E8%B4%A8"


@respx.mock
def test_proxy_keeps_csp_without_frame_ancestors():
    settings.weknora_base_url = "http://wk.test"
    respx.get("http://wk.test/x").mock(return_value=httpx.Response(200, headers={
        "Content-Security-Policy": "default-src 'self'"}))
    resp = client.get("/proxy/weknora/x")
    assert resp.headers["content-security-policy"] == "default-src 'self'"


@respx.mock
def test_proxy_post_passthrough():
    settings.weknora_base_url = "http://wk.test"
    respx.post("http://wk.test/api/login").mock(return_value=httpx.Response(200, json={"ok": True}))
    resp = client.post("/proxy/weknora/api/login", json={"user": "a"},
                       headers={"Authorization": "Bearer x", "Content-Type": "application/json"})
    assert resp.status_code == 200 and resp.json() == {"ok": True}
    req = respx.calls.last.request
    assert req.read() == b'{"user":"a"}'
    assert req.headers["authorization"] == "Bearer x"
    assert req.headers["content-type"] == "application/json"
    assert req.headers["host"] == "wk.test"  # 入站 host 剥离，由 httpx 按上游 URL 重设


@respx.mock
def test_proxy_upstream_unreachable():
    settings.weknora_base_url = "http://wk.test"
    respx.route(host="wk.test").mock(side_effect=httpx.ConnectError("refused"))
    assert client.get("/proxy/weknora/").status_code == 502

@respx.mock
def test_proxy_rewrites_absolute_location_to_proxy_prefix():
    """上游 3xx 指向 WeKnora 源站的 Location 必须改写回代理前缀，否则 iframe 跳出代理被
    X-Frame-Options 拦截（评审 Major 回归）；相对 Location 与他源 Location 原样保留。"""
    settings.weknora_base_url = "http://wk.test:8091"
    respx.get("http://wk.test:8091/login").mock(return_value=httpx.Response(
        302, headers={"Location": "http://wk.test:8091/home?next=/x"}))
    resp = client.get("/proxy/weknora/login", follow_redirects=False)
    assert resp.headers["location"] == "/proxy/weknora/home?next=/x"

    respx.get("http://wk.test:8091/rel").mock(return_value=httpx.Response(
        301, headers={"Location": "/relative/path"}))
    assert client.get("/proxy/weknora/rel", follow_redirects=False).headers["location"] == "/relative/path"

    respx.get("http://wk.test:8091/ext").mock(return_value=httpx.Response(
        302, headers={"Location": "http://other.test/a"}))
    assert client.get("/proxy/weknora/ext", follow_redirects=False).headers["location"] == "http://other.test/a"


@respx.mock
def test_proxy_strips_hop_by_hop_and_reencodes_special_chars():
    settings.weknora_base_url = "http://wk.test"
    respx.get("http://wk.test/a%3Fb/x").mock(return_value=httpx.Response(
        200, content=b"ok", headers={"Connection": "keep-alive", "Keep-Alive": "timeout=5"}))
    resp = client.get("/proxy/weknora/a%3Fb/x", headers={"Proxy-Connection": "keep-alive"})
    assert resp.status_code == 200
    assert "connection" not in resp.headers and "keep-alive" not in resp.headers
    # %3F 重编码为字面量拼路径，不注入查询分隔符
    assert str(respx.calls.last.request.url).startswith("http://wk.test/a%3Fb/x")
