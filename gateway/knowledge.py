"""共享知识库目录端点：把 WeKnora 库列表按部门/公共分类下发给客户端。

部门/公共的划分沿用 chat.py 的命名约定（^\\d{3}- 前缀 = 部门库），与检索选库
(select_kb_ids) 同一语义——不在管理端另设配置，WeKnora 侧改名即时生效。
鉴权同 marketplace client 端点（X-Client-Token，复用 enterprise._token_matches）；
WeKnora 不可达降级为空列表——客户端据此把两个共享分区留空，不报错。
"""
import httpx
from fastapi import APIRouter, Depends, Header, HTTPException

from gateway import weknora
from gateway.chat import DEPT_KB_RE
from gateway.enterprise import _token_matches

router = APIRouter()


def _require_client_token(x_client_token: str = Header(default="")) -> None:
    if not _token_matches(x_client_token):
        raise HTTPException(status_code=401, detail="unauthorized")


@router.get("/knowledge/api/kbs", dependencies=[Depends(_require_client_token)])
async def client_kbs() -> dict:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=60.0)) as client:
            kbs = await weknora.list_kbs(client)
    except httpx.HTTPError:
        return {"kbs": []}
    return {
        "kbs": [
            {
                "id": kb["id"],
                "name": kb["name"],
                "scope": "dept" if DEPT_KB_RE.match(kb.get("name") or "") else "public"
            }
            for kb in kbs
        ]
    }
