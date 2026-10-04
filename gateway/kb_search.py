"""WeKnora 检索共享核心：按库扇出 hybrid-search + 跨库轮转融合。

openai_compat（/v1/kb/chat/completions）与 mcp_weknora（MCP 检索工具）共用同一份实现，
避免检索语义复制粘贴后漂移。语义（沿用原 openai_compat._retrieve）：
- 选库 select_kb_ids：显式 kb_ids 优先；否则全部部门库（^\\d{3}- 命名规范）；无部门库回退前 12
- 并发 ≤ FANOUT_CONCURRENCY，单库 KB_TIMEOUT 秒预算；失败/超时的库记为失败，其余库照常返回
- 全部库失败 → "unavailable"，与 0 命中 "no_result" 区分（供上层降级文案，避免误读为"没有资料"）
- 跨库 score 不可比（实测同查询下小库噪声 0.48 vs 相关文档 0.016），按库轮转取优：
  各库先出库内最优 1 条，再按库内分数补足至 MAX_SOURCES
"""
import asyncio

import httpx

from gateway import weknora
from gateway.chat import select_kb_ids

# 单库预算与并发上限（与 app.py 的 DEEP_PER_KB_TIMEOUT/FANOUT_CONCURRENCY 同值）
KB_TIMEOUT = 6.0
FANOUT_CONCURRENCY = 8
MAX_SOURCES = 8


async def retrieve(
    client: httpx.AsyncClient, q: str, kb_ids: list[str], recent: bool = False
) -> tuple[str, list[dict], list[dict]]:
    """返回 (mode, chunks, sources)。mode: "ok"|"no_result"|"unavailable"。

    recent=True 走 WeKnora 全局最近更新检索（忽略 q 与 kb_ids 范围，供"最新文档"类问题）。
    """
    if recent:
        return await _retrieve_recent(client)
    try:
        all_kbs = await weknora.list_kbs(client)
    except httpx.HTTPError:
        return "unavailable", [], []
    kb_names = {k["id"]: k["name"] for k in all_kbs}
    ids = select_kb_ids(all_kbs, kb_ids)
    if not ids:
        return "unavailable", [], []

    sem = asyncio.Semaphore(FANOUT_CONCURRENCY)

    async def one(kb_id: str):
        async with sem:
            try:
                rs = await asyncio.wait_for(weknora.kb_hybrid_search(client, kb_id, q, 3), timeout=KB_TIMEOUT)
                for r in rs:
                    r["kb_name"] = kb_names.get(kb_id, r.get("kb_name") or "")
                return True, rs
            except (httpx.HTTPError, asyncio.TimeoutError):
                return False, []

    pairs = await asyncio.gather(*(one(k) for k in ids))
    if not any(ok for ok, _ in pairs):
        return "unavailable", [], []

    chunks: list[dict] = [r for _, rs in pairs for r in rs]
    by_kb: dict[str, list[dict]] = {}
    for c in chunks:
        by_kb.setdefault(c["kb_id"], []).append(c)
    for rs in by_kb.values():
        rs.sort(key=lambda c: c.get("score") or 0, reverse=True)
    q_terms = [t for t in q.split() if t] or [q]
    pools = sorted(
        by_kb.values(),
        key=lambda rs: any(t in (rs[0].get("title") or "") for t in q_terms),
        reverse=True,
    )
    merged: list[dict] = []
    while any(pools) and len(merged) < MAX_SOURCES:
        before = len(merged)
        for pool in pools:
            if pool and len(merged) < MAX_SOURCES:
                merged.append(pool.pop(0))
        if len(merged) == before:
            break
    sources: list[dict] = []
    seen: set[str] = set()
    for c in merged:
        if c["id"] not in seen:
            seen.add(c["id"])
            sources.append({
                "id": c["id"],
                "kb_id": c["kb_id"],
                "kb_name": c.get("kb_name") or "",
                "title": c.get("title") or "",
            })
    mode = "ok" if sources else "no_result"
    return mode, merged, sources


async def _retrieve_recent(client: httpx.AsyncClient) -> tuple[str, list[dict], list[dict]]:
    """全库最近更新检索（WeKnora 全局 recent 接口，非按库扇出）。"""
    try:
        items = await weknora.recent_knowledge(client, MAX_SOURCES)
    except httpx.HTTPError:
        return "unavailable", [], []
    if not items:
        return "no_result", [], []
    return "ok", items, items
