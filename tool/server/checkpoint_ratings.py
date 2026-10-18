"""Read-only per-checkpoint grouping of existing Test Generations ratings."""


def by_checkpoint(candidate_metadata, candidate_scores):
    """Keep run identities independent; exclude candidates without trusted provenance."""
    groups = {}
    for name, score in candidate_scores.items():
        info = candidate_metadata.get(name)
        if not isinstance(info, dict):
            continue
        folder = str(info.get("folder") or "").strip()
        job = str(info.get("sourceJobId") or "").strip()
        stage = str(info.get("stage") or "").strip()
        epoch = info.get("epoch")
        if not folder or not job or not stage or type(epoch) is not int:
            continue
        if not isinstance(score, dict) or not score.get("count"):
            continue
        key = (folder, job, stage, epoch)
        group = groups.setdefault(key, {"folder": folder, "sourceJobId": job,
                                         "stage": stage, "epoch": epoch,
                                         "ratingSum": 0, "ratingCount": 0,
                                         "candidates": []})
        group["ratingSum"] += score["average"] * score["count"]
        group["ratingCount"] += score["count"]
        group["candidates"].append(name)
    return [dict((field, value) for field, value in group.items() if field != "ratingSum") |
            {"average": round(group["ratingSum"] / group["ratingCount"], 2)}
            for _, group in sorted(groups.items())]
