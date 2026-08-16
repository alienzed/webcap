import json

import tool.server.app as app_module
import tool.server.prune_candidates as prune_module


def _touch(folder, name):
    path = folder / name
    path.write_bytes(b"media")
    return path


def _meta(resolution, **extra):
    return {"resolution": resolution, **extra}


def test_prune_candidates_detects_absolute_and_relative_resolution_outliers(tmp_path):
    folder = tmp_path / "set"
    folder.mkdir()
    names = ["a.png", "b.png", "c.png", "d.png", "e.png", "tiny.png"]
    for name in names:
        _touch(folder, name)
    metadata = {name: _meta("512x512") for name in names}
    metadata["tiny.png"] = _meta("320x320")

    payload = prune_module.build_prune_candidates(folder, metadata)

    assert [row["file"] for row in payload["candidates"]] == ["tiny.png"]
    candidate = payload["candidates"][0]
    assert candidate["priority"] == "outlier"
    assert candidate["reasons"][0]["code"] == "low_resolution"
    assert candidate["metrics"]["cohort_size"] == 6
    assert candidate["metrics"]["cohort_median_short_edge"] == 512


def test_prune_candidates_does_not_apply_relative_rule_to_small_or_mixed_cohorts(tmp_path):
    folder = tmp_path / "set"
    folder.mkdir()
    for name in ["a.png", "b.png", "c.png", "d.png", "portrait.png", "clip.mp4"]:
        _touch(folder, name)
    metadata = {
        "a.png": _meta("512x512"),
        "b.png": _meta("512x512"),
        "c.png": _meta("512x512"),
        "d.png": _meta("320x320"),
        "portrait.png": _meta("240x320"),
        "clip.mp4": _meta("320x320", frame_count=40),
    }

    payload = prune_module.build_prune_candidates(folder, metadata)

    assert "d.png" not in [row["file"] for row in payload["candidates"]]
    assert "clip.mp4" not in [row["file"] for row in payload["candidates"]]
    assert "portrait.png" in [row["file"] for row in payload["candidates"]]


def test_prune_candidates_detects_blocking_metadata_aspect_and_video_frame_problems(tmp_path):
    folder = tmp_path / "set"
    folder.mkdir()
    for name in ["missing.png", "odd.png", "short.mp4", "unknown.mp4"]:
        _touch(folder, name)
    metadata = {
        "missing.png": {},
        "odd.png": _meta("500x300"),
        "short.mp4": _meta("512x512", frame_count=15),
        "unknown.mp4": _meta("512x512"),
    }

    payload = prune_module.build_prune_candidates(folder, metadata)
    reasons = {row["file"]: [reason["code"] for reason in row["reasons"]] for row in payload["candidates"]}

    assert reasons["missing.png"] == ["missing_resolution"]
    assert reasons["odd.png"] == ["unsupported_aspect_ratio"]
    assert reasons["short.mp4"] == ["short_video_frames"]
    assert reasons["unknown.mp4"] == ["missing_video_frames"]
    assert all(row["priority"] == "blocking" for row in payload["candidates"])


def test_context_is_returned_but_does_not_create_candidates(tmp_path):
    folder = tmp_path / "set"
    folder.mkdir()
    _touch(folder, "busy.png")
    _touch(folder, "busy-low.png")
    (folder / ".webcap_state.json").write_text(json.dumps({
        "ratings_by_media": {"busy.png": 1, "busy-low.png": 2},
        "flags": {"busy.png": "red", "busy-low.png": "yellow"},
    }), encoding="utf-8")
    contextual = {
        "scene_complexity": {"bucket": "busy", "score": 0.95},
        "face_focus": {"bucket": "unknown", "face_count": 0},
        "selection_pose": {"pose_detected": False},
    }
    metadata = {
        "busy.png": _meta("512x512", **contextual),
        "busy-low.png": _meta("128x128", **contextual),
    }

    payload = prune_module.build_prune_candidates(folder, metadata)

    assert [row["file"] for row in payload["candidates"]] == ["busy-low.png"]
    candidate = payload["candidates"][0]
    assert candidate["context"]["scene_complexity"]["bucket"] == "busy"
    assert candidate["context"]["face_focus"]["bucket"] == "unknown"
    assert candidate["context"]["selection_pose"]["pose_detected"] is False
    assert candidate["context"]["rating"] == 2
    assert candidate["context"]["flag"] == "yellow"


def test_prune_candidates_route_returns_normalized_payload(tmp_path, monkeypatch):
    root = tmp_path / "root"
    folder = root / "set"
    folder.mkdir(parents=True)
    _touch(folder, "tiny.png")
    monkeypatch.setattr(prune_module.app_config, "FS_ROOT", root)
    monkeypatch.setattr(prune_module, "update_media_metadata", lambda *args, **kwargs: {"tiny.png": _meta("128x128")})

    response = app_module.app.test_client().get("/fs/prune_candidates?folder=set")

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["version"] == 1
    assert payload["folder"] == "set"
    assert payload["candidate_count"] == 1
    assert payload["candidates"][0]["file"] == "tiny.png"


def test_prune_candidates_route_rejects_missing_folder():
    response = app_module.app.test_client().get("/fs/prune_candidates")
    assert response.status_code == 400


def test_prune_candidates_route_rejects_unknown_folder(tmp_path, monkeypatch):
    monkeypatch.setattr(prune_module.app_config, "FS_ROOT", tmp_path)
    response = app_module.app.test_client().get("/fs/prune_candidates?folder=missing")
    assert response.status_code == 404
