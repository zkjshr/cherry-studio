r"""共享知识库目录端点测试：^\d{3}- 部门库命名约定分类、X-Client-Token 鉴权、
WeKnora 不可达降级为空列表。"""
import httpx
import respx
from fastapi.testclient import TestClient

from gateway.app import app
from gateway.config import settings

client = TestClient(app)
CLIENT = {"X-Client-Token": "test-token"}
settings.gateway_token = "test-token"


def _mock_kbs(payload: list[dict]) -> None:
    settings.weknora_base_url = "http://wk.test"
    respx.get("http://wk.test/api/v1/knowledge-bases").mock(
        return_value=httpx.Response(200, json={"data": payload}))


@respx.mock
def test_kbs_classified_by_dept_prefix():
    _mock_kbs([
        {"id": "1", "name": "101-结构所规范库"},
        {"id": "2", "name": "通用设计资料"},
        {"id": "3", "name": "021-岩一院图集"},
    ])
    resp = client.get("/knowledge/api/kbs", headers=CLIENT)
    assert resp.status_code == 200
    assert resp.json() == {"kbs": [
        {"id": "1", "name": "101-结构所规范库", "scope": "dept"},
        {"id": "2", "name": "通用设计资料", "scope": "public"},
        {"id": "3", "name": "021-岩一院图集", "scope": "dept"},
    ]}


@respx.mock
def test_kbs_empty_upstream():
    _mock_kbs([])
    resp = client.get("/knowledge/api/kbs", headers=CLIENT)
    assert resp.status_code == 200
    assert resp.json() == {"kbs": []}


@respx.mock
def test_kbs_weknora_unreachable_returns_empty():
    settings.weknora_base_url = "http://wk.test"
    respx.get("http://wk.test/api/v1/knowledge-bases").mock(
        side_effect=httpx.ConnectError("down"))
    resp = client.get("/knowledge/api/kbs", headers=CLIENT)
    assert resp.status_code == 200
    assert resp.json() == {"kbs": []}


@respx.mock
def test_kbs_malformed_upstream_json_returns_empty():
    settings.weknora_base_url = "http://wk.test"
    respx.get("http://wk.test/api/v1/knowledge-bases").mock(
        return_value=httpx.Response(200, text="<html>"))
    resp = client.get("/knowledge/api/kbs", headers=CLIENT)
    assert resp.status_code == 200
    assert resp.json() == {"kbs": []}


def test_kbs_requires_client_token():
    assert client.get("/knowledge/api/kbs").status_code == 401
    assert client.get("/knowledge/api/kbs", headers={"X-Client-Token": "wrong"}).status_code == 401
