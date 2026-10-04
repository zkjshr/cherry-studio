"""模型路由代理测试：respx 模拟 openai/ollama 上游，验证透传、NDJSON→SSE 转换、usage 记录与 404。"""
import json
import sqlite3

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from gateway.app import app
from gateway.config import settings

client = TestClient(app)
AUTH = {"Authorization": "Bearer test-token"}
ADMIN = {"X-Admin-Token": "test-token"}
settings.gateway_token = "test-token"


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    """用例间隔离；yield 出库路径供 usage 断言直读。"""
    path = str(tmp_path / "enterprise.sqlite3")
    monkeypatch.setenv("ENTERPRISE_DB_PATH", path)
    yield path


def _put_upstream(uid: str, **over) -> None:
    body = {"name": uid, "protocol": "openai", "base_url": "http://up.test", "api_key": "sk-up",
            "enabled": True, "models": [{"id": "m1", "name": "模型一"}]}
    body.update(over)
    resp = client.put(f"/admin/api/upstreams/{uid}", headers=ADMIN, json=body)
    assert resp.status_code == 200, resp.text


def _usage_rows(path: str) -> list[tuple]:
    conn = sqlite3.connect(path)
    try:
        return conn.execute(
            "SELECT model, upstream_id, prompt_tokens, completion_tokens, total_tokens, duration_ms, status"
            " FROM usage_log").fetchall()
    finally:
        conn.close()


def _chat(model: str, stream: bool = False) -> httpx.Response:
    return client.post("/v1/chat/completions", headers=AUTH,
                       json={"model": model, "stream": stream, "messages": [{"role": "user", "content": "hi"}]})


@respx.mock
def test_openai_non_stream_passthrough_and_usage(_isolated_db):
    _put_upstream("gw")
    respx.post("http://up.test/chat/completions").mock(return_value=httpx.Response(200, json={
        "id": "cmpl-1", "object": "chat.completion",
        "choices": [{"message": {"role": "assistant", "content": "你好"}}],
        "usage": {"prompt_tokens": 5, "completion_tokens": 7, "total_tokens": 12}}))
    resp = _chat("gw/m1")
    assert resp.status_code == 200
    assert resp.json()["id"] == "cmpl-1"  # 原样透传
    (row,) = _usage_rows(_isolated_db)
    assert row[0] == "gw/m1" and row[1] == "gw"
    assert row[2:5] == (5, 7, 12) and row[5] >= 0 and row[6] == "ok"


@respx.mock
def test_openai_stream_passthrough_and_usage(_isolated_db):
    _put_upstream("gw")
    sse = ('data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"你"}}]}\n\n'
           'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],'
           '"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\n'
           'data: [DONE]\n\n')
    respx.post("http://up.test/chat/completions").mock(return_value=httpx.Response(
        200, content=sse.encode(), headers={"content-type": "text/event-stream"}))
    resp = _chat("gw/m1", stream=True)
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    assert resp.text.rstrip("\n").endswith("data: [DONE]")
    assert resp.text.count("data: ") == 3  # 逐行原样透传，不增删帧
    (row,) = _usage_rows(_isolated_db)
    assert row[2:5] == (2, 3, 5) and row[6] == "ok"  # usage 取自流中末个非空 usage 块


@respx.mock
def test_openai_upstream_error_passthrough(_isolated_db):
    _put_upstream("gw")
    respx.post("http://up.test/chat/completions").mock(return_value=httpx.Response(
        500, json={"error": {"message": "boom", "type": "server_error"}}))
    resp = _chat("gw/m1")
    assert resp.status_code == 500
    assert resp.json()["error"] == {"message": "boom", "type": "server_error"}
    (row,) = _usage_rows(_isolated_db)
    assert row[6] == "error"


@respx.mock
def test_openai_upstream_unreachable_is_502(_isolated_db):
    _put_upstream("gw")
    respx.post("http://up.test/chat/completions").mock(side_effect=httpx.ConnectError("refused"))
    resp = _chat("gw/m1")
    assert resp.status_code == 502
    assert resp.json()["error"]["type"] == "api_error"
    assert "upstream unreachable" in resp.json()["error"]["message"]
    (row,) = _usage_rows(_isolated_db)
    assert row[6] == "error"


@respx.mock
def test_ollama_non_stream_aggregated_with_usage(_isolated_db):
    _put_upstream("oll", protocol="ollama", base_url="http://o.test", api_key="",
                  models=[{"id": "qwen"}])
    respx.post("http://o.test/api/chat").mock(return_value=httpx.Response(200, json={
        "model": "qwen", "message": {"role": "assistant", "content": "答案"}, "done": True,
        "prompt_eval_count": 4, "eval_count": 9}))
    resp = _chat("oll/qwen")
    assert resp.status_code == 200
    body = resp.json()
    assert body["object"] == "chat.completion" and body["model"] == "oll/qwen"
    assert body["choices"][0]["message"]["content"] == "答案"
    assert body["usage"] == {"prompt_tokens": 4, "completion_tokens": 9, "total_tokens": 13}
    (row,) = _usage_rows(_isolated_db)
    assert row[2:5] == (4, 9, 13) and row[6] == "ok"


@respx.mock
def test_ollama_stream_ndjson_to_openai_sse(_isolated_db):
    _put_upstream("oll", protocol="ollama", base_url="http://o.test", api_key="",
                  models=[{"id": "qwen"}])
    nd = ('{"message":{"content":"你"},"done":false}\n'
          '{"message":{"content":"好"},"done":false}\n'
          '{"message":{"content":""},"done":true,"prompt_eval_count":3,"eval_count":5}\n')
    respx.post("http://o.test/api/chat").mock(return_value=httpx.Response(
        200, content=nd.encode(), headers={"content-type": "application/x-ndjson"}))
    resp = _chat("oll/qwen", stream=True)
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    events = [ln[6:] for ln in resp.text.splitlines() if ln.startswith("data: ")]
    assert events[-1] == "[DONE]"
    chunks = [json.loads(e) for e in events[:-1]]
    assert all(c["object"] == "chat.completion.chunk" and c["model"] == "oll/qwen" for c in chunks)
    assert chunks[0]["choices"][0]["delta"]["role"] == "assistant"  # 首块带 role
    assert "".join(c["choices"][0]["delta"].get("content") or "" for c in chunks) == "你好"
    finish = chunks[-1]
    assert finish["choices"][0]["finish_reason"] == "stop"
    assert finish["usage"] == {"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8}
    (row,) = _usage_rows(_isolated_db)
    assert row[2:5] == (3, 5, 8) and row[6] == "ok"


def test_unknown_model_returns_openai_404(_isolated_db):
    _put_upstream("gw")
    for model in ("gw/nope", "nope/m1", "nodelimiter", ""):
        resp = _chat(model)
        assert resp.status_code == 404, model
        err = resp.json()["error"]
        assert err["type"] == "invalid_request_error"
        assert err["message"] == f"model not found: {model}"
    rows = _usage_rows(_isolated_db)
    assert len(rows) == 4 and all(r[1] is None and r[6] == "error" for r in rows)


def test_disabled_upstream_not_routable():
    _put_upstream("off", enabled=False)
    assert _chat("off/m1").status_code == 404


@respx.mock
def test_models_lists_visible_enabled_only(_isolated_db):
    _put_upstream("gw", models=[{"id": "pub"}, {"id": "hid", "visible": False}])
    _put_upstream("off", enabled=False, models=[{"id": "m"}])
    assert client.get("/v1/models").status_code == 401
    resp = client.get("/v1/models", headers=AUTH)
    assert resp.status_code == 200
    assert resp.json() == {"object": "list", "data": [{"id": "gw/pub", "object": "model"}]}
    # 隐藏模型不上清单但可直接路由调用
    respx.post("http://up.test/chat/completions").mock(return_value=httpx.Response(
        200, json={"id": "x", "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}}))
    assert _chat("gw/hid").status_code == 200


def test_chat_requires_token():
    assert client.post("/v1/chat/completions",
                       json={"model": "gw/m1", "messages": []}).status_code == 401
