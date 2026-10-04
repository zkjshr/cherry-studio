"""插件市场（E5）：网关作为官方市场源。管理员把插件包放入市场目录即上架（scp 上传，
与 downloads 同范式，无管理端写接口），目录每次请求现扫、无状态无缓存。

插件包格式：MARKETPLACE_DIR（环境变量可覆盖，默认 gateway/data/marketplace/，读取
范式同 enterprise 的 ENTERPRISE_DB_PATH）下每个子目录即一个插件，目录名即插件 id；
plugin.json 携带 {id,name,version,description,category,icon,skills[],mcp_servers[],
assistants[],minapps[]}，payload/*.zip 为技能包等附属文件。客户端经 /marketplace/api/*
浏览目录、取完整 manifest 并下载插件内文件（icon 相对路径即经 files 端点下发，https
绝对 URL 由客户端直连）；/admin/api/marketplace 供管理员核对目录有效性（只读）。

鉴权：客户端端点用 X-Client-Token，语义与 enterprise 一致（复用 _token_matches，
timing-safe 比较，网关未配置 token 时放行）；管理端点用 X-Admin-Token（复用
_require_admin_token，token 未配置时直接拒绝）。
"""
import json
import os
import re

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import FileResponse

from gateway.enterprise import _require_admin_token, _token_matches

router = APIRouter()

# 市场目录默认 gateway/data/marketplace/；测试/部署用 MARKETPLACE_DIR 覆盖
_DEFAULT_MARKETPLACE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "marketplace")

# 插件 id 白名单：目录名即 id，先于任何路径拼接校验，防穿越
_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")

# files 端点按扩展名推断 Content-Type，未识别的一律 application/octet-stream
_CONTENT_TYPES = {
    ".zip": "application/zip",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".json": "application/json",
    ".md": "text/markdown",
}

# 组件清单固定四类（catalog 计数用）
_COMPONENT_KEYS = ("skills", "mcp_servers", "assistants", "minapps")


def _marketplace_dir() -> str:
    return os.environ.get("MARKETPLACE_DIR", _DEFAULT_MARKETPLACE_DIR)


def _load_dir(base: str, name: str) -> tuple[dict | None, str | None]:
    """读取并校验单个插件目录的 plugin.json，返回 (manifest, error)：合法时 error 为 None。

    非法情形（均只记原因不抛出）：plugin.json 缺失/损坏/非 JSON 对象、id 缺失或含
    白名单外字符、id 与目录名不一致（detail/files 端点按目录名寻址，不一致必然出坏链）、
    name 缺失或空白（catalog 按它排序展示）。
    """
    fp = os.path.join(base, name, "plugin.json")
    try:
        with open(fp, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return None, "plugin.json missing"
    except (OSError, ValueError) as e:
        return None, f"plugin.json unreadable: {e}"
    if not isinstance(data, dict):
        return None, "plugin.json must be a JSON object"
    pid = data.get("id")
    if not isinstance(pid, str) or not _ID_RE.match(pid):
        return None, f"invalid manifest id: {pid!r}"
    if pid != name:
        return None, f"manifest id {pid!r} does not match directory name"
    if not isinstance(data.get("name"), str) or not data["name"].strip():
        return None, "manifest name required"
    return data, None


def _scan() -> list[dict]:
    """扫描市场目录（每次调用现扫）：返回 [{"id": 目录名, "manifest": dict|None,
    "error": str|None}, ...] 按 id 排序。目录不存在视作空市场；散落的普通文件忽略，
    只认子目录。"""
    base = _marketplace_dir()
    try:
        names = sorted(os.listdir(base))
    except OSError:
        return []
    entries: list[dict] = []
    for name in names:
        if not os.path.isdir(os.path.join(base, name)):
            continue
        manifest, error = _load_dir(base, name)
        entries.append({"id": name, "manifest": manifest, "error": error})
    return entries


def _summary(manifest: dict) -> dict:
    """manifest → 目录卡片摘要：标量字段 + 四类组件计数（组件明细走 detail 端点）。"""
    return {
        "id": manifest.get("id") or "",
        "name": manifest.get("name") or "",
        "version": manifest.get("version") or "",
        "description": manifest.get("description") or "",
        "category": manifest.get("category") or "",
        "featured": manifest.get("featured") is True,
        "icon": manifest.get("icon") or "",
        "components": {
            k: len(manifest[k]) if isinstance(manifest.get(k), list) else 0
            for k in _COMPONENT_KEYS
        },
    }


def _require_client_token(x_client_token: str = Header(default="")) -> None:
    if not _token_matches(x_client_token):
        raise HTTPException(status_code=401, detail="unauthorized")


def _load_manifest(pid: str) -> dict:
    """按 id 取完整 manifest；id 不合法或目录/清单缺失损坏一律 404（不区分不存在与非法，
    防探测）。与 catalog 的严格校验解耦：只要 plugin.json 可解析为对象即原样返回。"""
    if not _ID_RE.match(pid):
        raise HTTPException(status_code=404, detail="plugin not found")
    fp = os.path.join(_marketplace_dir(), pid, "plugin.json")
    try:
        with open(fp, encoding="utf-8") as f:
            manifest = json.load(f)
    except (OSError, ValueError):
        raise HTTPException(status_code=404, detail="plugin not found")
    if not isinstance(manifest, dict):
        raise HTTPException(status_code=404, detail="plugin not found")
    return manifest


@router.get("/marketplace/api/catalog", dependencies=[Depends(_require_client_token)])
def catalog() -> dict:
    """市场目录：合法插件摘要按 name 排序；非法目录跳过并在 warnings 里列出（"目录: 原因"）。"""
    entries = _scan()
    plugins = sorted((_summary(e["manifest"]) for e in entries if e["error"] is None),
                     key=lambda p: p["name"])
    warnings = [f'{e["id"]}: {e["error"]}' for e in entries if e["error"] is not None]
    return {"plugins": plugins, "warnings": warnings}


@router.get("/marketplace/api/plugins/{pid}", dependencies=[Depends(_require_client_token)])
def plugin_detail(pid: str) -> dict:
    """单个插件完整 manifest（组件明细），供安装流程逐组件落地。"""
    return _load_manifest(pid)


@router.get("/marketplace/api/plugins/{pid}/files/{path:path}",
            dependencies=[Depends(_require_client_token)])
def plugin_file(pid: str, path: str) -> FileResponse:
    """下发插件目录内文件（技能 zip/icon 等）。绝对路径、反斜杠、空段与 ".." 段一律 400
    （先于路径拼接检查）；文件不存在 404；Content-Type 按扩展名推断，FileResponse 流式回传。"""
    if not _ID_RE.match(pid):
        raise HTTPException(status_code=404, detail="plugin not found")
    if (not path or path.startswith(("/", "\\")) or "\\" in path
            or any(seg in ("", "..") for seg in path.split("/"))):
        raise HTTPException(status_code=400, detail="invalid path")
    fp = os.path.join(_marketplace_dir(), pid, *path.split("/"))
    if not os.path.isfile(fp):
        raise HTTPException(status_code=404, detail="file not found")
    ctype = _CONTENT_TYPES.get(os.path.splitext(path)[1].lower(), "application/octet-stream")
    return FileResponse(fp, media_type=ctype)


@router.get("/admin/api/marketplace", dependencies=[Depends(_require_admin_token)])
def admin_marketplace() -> dict:
    """管理员核对市场目录：逐目录列出有效性与原因；上架/更新仍走 scp 放文件（与 downloads
    同范式），本端点只读。"""
    entries = _scan()
    return {"dir": _marketplace_dir(),
            "plugins": [{"id": e["id"], "valid": e["error"] is None, "error": e["error"]}
                        for e in entries]}
