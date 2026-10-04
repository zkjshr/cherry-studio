"""跨库 hybrid-search 结果归一合并：min-max 归一后全局排序，按知识 id 去重保留最高分。"""


def _normalize(scores: list[float]) -> list[float]:
    if not scores:
        return []
    lo, hi = min(scores), max(scores)
    if hi - lo < 1e-9:
        return [1.0] * len(scores)
    return [(s - lo) / (hi - lo) for s in scores]


def merge_deep_results(by_kb: dict[str, list[dict]], limit: int) -> list[dict]:
    # 去重比较必须用原始 score：单条结果的库经 min-max 归一后全为 1.0，
    # 归一值无法区分优劣（与 test_dedup_keeps_higher_score 对齐）。
    merged: dict[str, dict] = {}
    raw_scores: dict[str, float] = {}
    for results in by_kb.values():
        norms = _normalize([float(r.get("score") or 0.0) for r in results])
        for r, n in zip(results, norms):
            raw = float(r.get("score") or 0.0)
            r = {**r, "score": round(n, 4)}
            old_raw = raw_scores.get(r["id"])
            if old_raw is None or raw > old_raw:
                merged[r["id"]] = r
                raw_scores[r["id"]] = raw
    ranked = sorted(merged.values(), key=lambda r: r["score"], reverse=True)
    return ranked[:limit]
