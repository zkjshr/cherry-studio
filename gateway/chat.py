"""对话编排：检索块 → prompt 组装 → SSE 事件语义。"""
import json

SYSTEM_PROMPT = (
    "你是 TJAD 企业知识助手。基于下面提供的资料片段回答用户问题；"
    "答案用中文、简洁分点；资料不足以回答时明确说明。不要编造来源。"
)


def build_prompt(query: str, chunks: list[dict], history: list[dict]) -> list[dict]:
    parts = [f"【{c.get('kb_name') or '知识库'}】{c.get('title')}\n{c.get('content', '')[:600]}" for c in chunks]
    context = "\n\n".join(parts)
    msgs = [{"role": "system", "content": SYSTEM_PROMPT}]
    msgs.extend({"role": h["role"], "content": h["content"]} for h in history[:4])
    msgs.append({"role": "user", "content": f"参考资料：\n{context}\n\n问题：{query}"})
    return msgs


def extract_ollama_delta(line: str) -> str | None:
    try:
        d = json.loads(line)
    except (json.JSONDecodeError, ValueError):
        return None
    if d.get("done"):
        return None
    return (d.get("message") or {}).get("content") or None


def parse_sse_chunk(buf: str) -> list[tuple[str, str]]:
    """把一段 SSE 文本解析为 (event, data-json字符串) 列表。"""
    out: list[tuple[str, str]] = []
    for block in buf.split("\n\n"):
        event, data = "message", ""
        for ln in block.splitlines():
            if ln.startswith("event:"):
                event = ln[6:].strip()
            elif ln.startswith("data:"):
                data = ln[5:].strip()
        if block.strip():
            out.append((event, data))
    return out


import re as _re

DEPT_KB_RE = _re.compile(r"^\d{3}-")


def select_kb_ids(all_kbs: list[dict], explicit_ids: list[str], fallback_top: int = 12) -> list[str]:
    """选库：显式指定优先；否则全部部门库（^\d{3}- 命名规范）；无部门库回退前 N。"""
    if explicit_ids:
        return explicit_ids
    dept = [k["id"] for k in all_kbs if DEPT_KB_RE.match(k.get("name") or "")]
    return dept or [k["id"] for k in all_kbs[:fallback_top]]
