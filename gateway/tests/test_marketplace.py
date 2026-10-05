"""插件市场测试：目录扫描（正常/非法/空）、id 防穿越、文件下发（zip 字节一致与
Content-Type 推断）、X-Client-Token / X-Admin-Token 鉴权语义（复用 enterprise 同款）。"""
import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient

from gateway.app import app
from gateway.config import settings

client = TestClient(app)
CLIENT = {"X-Client-Token": "test-token"}
ADMIN = {"X-Admin-Token": "test-token"}
settings.gateway_token = "test-token"


@pytest.fixture(autouse=True)
def market_dir(tmp_path, monkeypatch):
    """用例间隔离：每个用例指到独立临时市场目录（MARKETPLACE_DIR 请求时读取，
    同 ENTERPRISE_DB_PATH 覆盖范式）。"""
    d = tmp_path / "marketplace"
    d.mkdir()
    monkeypatch.setenv("MARKETPLACE_DIR", str(d))
    return d


def _plugin(dir_path, pid, **over) -> dict:
    """写入一个合法插件目录并返回 manifest（组件清单默认各含一份，便于计数断言）。"""
    manifest = {"id": pid, "name": pid.title(), "version": "1.0.0", "description": f"{pid} 插件",
                "category": "utilities", "icon": "icon.png",
                "skills": [{"name": "s1", "zip": "payload/s1.zip", "description": "技能"}],
                "mcp_servers": [{"name": "wk", "type": "sse", "base_url": "http://wk.test/sse"}],
                "assistants": [{"name": "助手", "prompt": "hi", "emoji": "✨"}],
                "minapps": [{"id": "m1", "name": "小程序", "url": "https://x.test"}]}
    manifest.update(over)
    p = dir_path / pid
    p.mkdir(parents=True, exist_ok=True)
    (p / "plugin.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    return manifest


def _zip_bytes() -> bytes:
    """构造真实 zip（内含技能文件夹 + SKILL.md），校验下发字节一致。"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("weknora-usage/SKILL.md", "# demo")
    return buf.getvalue()


# ---------- catalog 目录扫描 ----------

def test_catalog_empty_dir():
    resp = client.get("/marketplace/api/catalog", headers=CLIENT)
    assert resp.status_code == 200
    assert resp.json() == {"plugins": [], "warnings": []}


def test_catalog_missing_dir_is_empty(monkeypatch):
    monkeypatch.setenv("MARKETPLACE_DIR", "/nonexistent/marketplace-tjad")
    resp = client.get("/marketplace/api/catalog", headers=CLIENT)
    assert resp.status_code == 200
    assert resp.json() == {"plugins": [], "warnings": []}


def test_catalog_scans_plugins_and_counts_sorted_by_name(market_dir):
    _plugin(market_dir, "beta", name="B 插件")
    _plugin(market_dir, "alpha", name="A 插件")
    resp = client.get("/marketplace/api/catalog", headers=CLIENT)
    assert resp.status_code == 200
    body = resp.json()
    assert body["warnings"] == []
    # 按 name 排序（与目录名字典序无关）
    assert [p["name"] for p in body["plugins"]] == ["A 插件", "B 插件"]
    card = body["plugins"][0]
    assert card["id"] == "alpha" and card["version"] == "1.0.0"
    assert card["description"] == "alpha 插件" and card["category"] == "utilities"
    assert card["icon"] == "icon.png"
    # 组件计数：只数清单，不校验 zip 文件是否真实存在
    assert card["components"] == {"skills": 1, "mcp_servers": 1, "assistants": 1, "minapps": 1}
    # 展示元数据缺省值：plugin.json 未写时给空串，客户端按可选字段隐藏
    assert card["author"] == "" and card["department"] == ""


def test_catalog_passes_through_author_department_but_not_downloads(market_dir):
    """下载热度仅管理端可见：客户端目录不带 downloads 字段。"""
    _plugin(market_dir, "hot", author="知开始", department="数字研发中心", downloads=128)
    resp = client.get("/marketplace/api/catalog", headers=CLIENT)
    assert resp.status_code == 200
    card = resp.json()["plugins"][0]
    assert card["author"] == "知开始"
    assert card["department"] == "数字研发中心"
    assert "downloads" not in card


def test_admin_marketplace_lists_metadata_with_downloads(market_dir):
    _plugin(market_dir, "hot", author="知开始", department="数字研发中心", downloads=128)
    _plugin(market_dir, "bad", downloads="not-a-number")
    (market_dir / "broken").mkdir()
    (market_dir / "broken" / "plugin.json").write_text("{oops", encoding="utf-8")
    resp = client.get("/admin/api/marketplace", headers=ADMIN)
    assert resp.status_code == 200
    rows = {p["id"]: p for p in resp.json()["plugins"]}
    assert rows["hot"]["name"] == "Hot"
    assert rows["hot"]["department"] == "数字研发中心"
    assert rows["hot"]["author"] == "知开始"
    assert rows["hot"]["downloads"] == 128
    assert rows["hot"]["valid"] is True
    # 非法 downloads 回退 0；无效目录 validity=False 但不打挂列表
    assert rows["bad"]["downloads"] == 0
    assert rows["broken"]["valid"] is False
    assert rows["broken"]["downloads"] == 0


def test_catalog_warns_and_skips_invalid_plugins(market_dir):
    d = market_dir
    _plugin(d, "good")
    (d / "broken-json").mkdir()
    (d / "broken-json" / "plugin.json").write_text("{oops", encoding="utf-8")
    (d / "no-manifest").mkdir()
    (d / "not-object").mkdir()
    (d / "not-object" / "plugin.json").write_text('"str"', encoding="utf-8")
    (d / "no-name").mkdir()
    (d / "no-name" / "plugin.json").write_text('{"id": "no-name"}', encoding="utf-8")
    (d / "bad-id").mkdir()
    (d / "bad-id" / "plugin.json").write_text('{"id": "bad id!", "name": "x"}', encoding="utf-8")
    (d / "id-mismatch").mkdir()
    (d / "id-mismatch" / "plugin.json").write_text('{"id": "other", "name": "x"}', encoding="utf-8")
    (d / "loose-file.txt").write_text("not a plugin dir", encoding="utf-8")  # 散落文件忽略
    body = client.get("/marketplace/api/catalog", headers=CLIENT).json()
    assert [p["id"] for p in body["plugins"]] == ["good"]
    warned = {w.split(":")[0] for w in body["warnings"]}
    assert warned == {"broken-json", "no-manifest", "not-object", "no-name", "bad-id", "id-mismatch"}
    assert all(w.split(":", 1)[1].strip() for w in body["warnings"])  # 每条带原因


# ---------- plugin detail ----------

def test_detail_returns_full_manifest(market_dir):
    m = _plugin(market_dir, "weknora-toolkit", description="工具包")
    resp = client.get("/marketplace/api/plugins/weknora-toolkit", headers=CLIENT)
    assert resp.status_code == 200
    assert resp.json() == m


def test_detail_404_on_bad_id_or_missing(market_dir):
    d = market_dir
    _plugin(d, "good")
    (d / "hollow").mkdir()  # 有目录无 plugin.json
    (d / "junk").mkdir()
    (d / "junk" / "plugin.json").write_text("nope", encoding="utf-8")
    # id 白名单外（含 %2E%2E 解码后的 ..）一律 404，不区分不存在与非法
    for pid in ["ghost", "%2E%2E", "a%2Fb", "bad%7Eid"]:
        assert client.get(f"/marketplace/api/plugins/{pid}", headers=CLIENT).status_code == 404, pid
    assert client.get("/marketplace/api/plugins/hollow", headers=CLIENT).status_code == 404
    assert client.get("/marketplace/api/plugins/junk", headers=CLIENT).status_code == 404


# ---------- files 文件下发 ----------

def test_files_bytes_fidelity_and_content_types(market_dir):
    p = market_dir / "p1"
    (p / "payload").mkdir(parents=True)
    zdata = _zip_bytes()
    (p / "payload" / "skill.zip").write_bytes(zdata)
    (p / "icon.png").write_bytes(b"\x89PNG\r\n\x1a\nfake")
    (p / "icon.svg").write_text("<svg/>", encoding="utf-8")
    (p / "photo.jpg").write_bytes(b"\xff\xd8\xff")
    (p / "pic.webp").write_bytes(b"RIFF0000WEBP")
    (p / "data.json").write_text("{}", encoding="utf-8")
    (p / "README.md").write_text("# md", encoding="utf-8")
    (p / "blob.bin").write_bytes(b"\x00\x01\x02")
    want = {"payload/skill.zip": (zdata, "application/zip"),
            "icon.png": (b"\x89PNG\r\n\x1a\nfake", "image/png"),
            "icon.svg": (b"<svg/>", "image/svg+xml"),
            "photo.jpg": (b"\xff\xd8\xff", "image/jpeg"),
            "pic.webp": (b"RIFF0000WEBP", "image/webp"),
            "data.json": (b"{}", "application/json"),
            "README.md": (b"# md", "text/markdown"),
            "blob.bin": (b"\x00\x01\x02", "application/octet-stream")}
    for path, (data, ctype) in want.items():
        resp = client.get(f"/marketplace/api/plugins/p1/files/{path}", headers=CLIENT)
        assert resp.status_code == 200, path
        assert resp.content == data, path  # 字节一致（zip 可原样解包）
        # text/* 会被 FileResponse 附加 charset 参数，按主值比较
        assert resp.headers["content-type"].split(";")[0] == ctype, path


def test_files_rejects_traversal_and_missing(market_dir):
    p = market_dir / "p1"
    p.mkdir()
    (p / "real.zip").write_bytes(b"PK")
    # 绝对路径 / ".." 段 / 反斜杠 / 空段 → 400（先于路径拼接拒绝）
    for bad in ["%2Fetc%2Fpasswd", "..%2F..%2Fenterprise.sqlite3", "payload%2F..%2F..%2Fx.zip",
                "..%5C..%5Cx.zip", "a%2F%2Fb.zip"]:
        resp = client.get(f"/marketplace/api/plugins/p1/files/{bad}", headers=CLIENT)
        assert resp.status_code == 400, bad
    # id 白名单外的 files 请求同样 404；文件缺失 404
    assert client.get("/marketplace/api/plugins/%2E%2E/files/x.zip", headers=CLIENT).status_code == 404
    assert client.get("/marketplace/api/plugins/p1/files/nope.zip", headers=CLIENT).status_code == 404
    assert client.get("/marketplace/api/plugins/ghost/files/icon.png", headers=CLIENT).status_code == 404


# ---------- 鉴权语义 ----------

def test_client_token_required_when_configured():
    # 模块级已设 settings.gateway_token = "test-token"：缺失/错误 token → 401
    for headers in [{}, {"X-Client-Token": "wrong"}]:
        assert client.get("/marketplace/api/catalog", headers=headers).status_code == 401
        assert client.get("/marketplace/api/plugins/p1", headers=headers).status_code == 401
        assert client.get("/marketplace/api/plugins/p1/files/x.zip", headers=headers).status_code == 401
    assert client.get("/marketplace/api/catalog", headers=CLIENT).status_code == 200


def test_client_token_open_when_unset_admin_still_closed(monkeypatch):
    """网关未配置 token：客户端端点放行（与 enterprise._token_matches 一致），
    管理端点仍拒绝（_require_admin_token 不随空 token 放行）。"""
    monkeypatch.setattr(settings, "gateway_token", "")
    assert client.get("/marketplace/api/catalog").status_code == 200
    assert client.get("/marketplace/api/plugins/p1").status_code == 404  # 放行但资源不存在
    assert client.get("/admin/api/marketplace").status_code == 401


def test_admin_marketplace_lists_validity_and_requires_token(market_dir):
    d = market_dir
    _plugin(d, "good")
    (d / "bad").mkdir()
    (d / "bad" / "plugin.json").write_text("{", encoding="utf-8")
    assert client.get("/admin/api/marketplace").status_code == 401
    assert client.get("/admin/api/marketplace", headers={"X-Admin-Token": "wrong"}).status_code == 401
    resp = client.get("/admin/api/marketplace", headers=ADMIN)
    assert resp.status_code == 200
    body = resp.json()
    assert body["dir"] == str(d)
    rows = {p["id"]: p for p in body["plugins"]}
    assert set(rows) == {"bad", "good"}
    assert rows["bad"]["valid"] is False and rows["bad"]["error"] is not None
    assert rows["good"]["valid"] is True and rows["good"]["error"] is None
    # 展示元数据随行携带（downloads 仅此处可见）
    assert rows["good"]["name"] == "Good" and rows["good"]["downloads"] == 0
    assert "plugin.json unreadable" in rows["bad"]["error"]
