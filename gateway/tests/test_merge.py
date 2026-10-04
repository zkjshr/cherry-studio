from gateway.merge import merge_deep_results

def _r(kb, kid, score):
    return {"id": kid, "kb_id": kb, "kb_name": f"KB-{kb}", "title": f"t{kid}", "file_name": f"{kid}.md", "score": score}

def test_minmax_normalizes_and_dedups():
    a = [_r("kb1", "d1", 0.9), _r("kb1", "d2", 0.5)]
    b = [_r("kb2", "d3", 0.4), _r("kb2", "d4", 0.2)]
    out = merge_deep_results({"kb1": a, "kb2": b}, limit=10)
    assert [r["id"] for r in out] == ["d1", "d3", "d2", "d4"]

def test_dedup_keeps_higher_score():
    a = [_r("kb1", "d1", 0.2)]
    b = [_r("kb2", "d1", 0.9)]
    out = merge_deep_results({"kb1": a, "kb2": b}, limit=10)
    assert len(out) == 1 and out[0]["kb_id"] == "kb2"

def test_limit_and_empty():
    assert merge_deep_results({}, limit=5) == []
    a = [_r("kb1", f"d{i}", 0.5 + i / 100) for i in range(30)]
    assert len(merge_deep_results({"kb1": a}, limit=20)) == 20
