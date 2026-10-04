import json

from gateway.chat import build_prompt, extract_ollama_delta


def test_build_prompt_contains_chunks_and_history():
    msgs = build_prompt(
        "资质通知",
        [{"title": "关于资质的通知", "content": "正文摘要A", "kb_name": "103-科技质量部"}],
        [{"role": "user", "content": "之前问过什么"}, {"role": "assistant", "content": "之前答过什么"}],
    )
    assert msgs[0]["role"] == "system" and "知识助手" in msgs[0]["content"]
    assert any("关于资质的通知" in m["content"] for m in msgs)
    assert msgs[-1]["role"] == "user" and "资质通知" in msgs[-1]["content"]
    # history 在 system 之后、检索 user 之前
    assert msgs[1]["content"] == "之前问过什么" and msgs[2]["content"] == "之前答过什么"


def test_extract_ollama_delta():
    assert extract_ollama_delta('{"message":{"content":"你好"}}') == "你好"
    assert extract_ollama_delta('{"done":true,"message":{"content":""}}') is None
    assert extract_ollama_delta("not json") is None
