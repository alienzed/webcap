"""Regression tests for useful Model Assessment evidence, not retired interfaces."""
import os

import pytest

from tool.server import assessment_transfer, caption_ops, llm_runner, model_lab
from tool.server import director_model_calibration as calibration
from tool.server import storyboard_llm_runtime


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    monkeypatch.setattr(model_lab, "run_root", lambda: tmp_path / "runs")
    monkeypatch.setattr(calibration, "_path", lambda: tmp_path / "legacy.json")
    monkeypatch.setattr(caption_ops, "_resolve_folder", lambda _folder: tmp_path)
    yield tmp_path


def director():
    return {"modelRef": "local::director", "runtimeId": "local", "modelId": "director"}


def vision():
    return {"modelRef": "local::vision", "runtimeId": "local", "modelId": "vision"}


def test_historical_output_pathologies_survive_current_assessment(monkeypatch):
    monkeypatch.setattr(calibration, "get_report", lambda _ref: {
        "status": "complete", "health": "limited",
        "pathologies": ["looping"], "abilities": {
            "coherentOutputTokens": 4096, "contextTokens": 8192
        },
    })
    signal = storyboard_llm_runtime._assessment_signal("local::director", {
        "director_scene_plan_2048": {"status": "completed", "verifiedOutputTokens": 1300},
        "language_synthesis": {"status": "completed"},
        "language_challenge": {"status": "completed"},
    })
    assert signal["seriousWarning"] is True
    assert signal["pathologies"] == ["looping"]
    assert signal["limited"] is True
    assert signal["individualScenesRecommended"] is True
    assert signal["abilities"]["coherentOutputTokens"] == 4096


def test_scene_assessment_uses_actual_storyboard_director_contract(monkeypatch):
    queued = []
    def capture(_client, _model, contract, **kwargs):
        queued.append(contract)
        return {"jobId": "unused"}
    monkeypatch.setattr(llm_runner, "enqueue", capture)

    def attempt(_run, *, kind, enqueue, **kwargs):
        if kind.startswith("director_scene_plan_"):
            enqueue()
        return {"status": "completed"}
    monkeypatch.setattr(model_lab, "_probe_job", attempt)
    monkeypatch.setattr(model_lab, "_run_schema_pair", lambda *a: None)

    run = model_lab._new_run_payload({"directorModels": [director()]})
    model_lab._run_director_model(run, director())
    assert len(queued) == 1
    prompt = queued[0]["messages"][0]["content"]
    assert "[DIRECTOR CONTEXT]" in prompt
    assert "[STORY CONCEPT]" in prompt
    assert "Develop the complete concept into MiniMax H3 Scenes" in prompt
    assert queued[0]["response_schema"]["properties"]["scenes"]["type"] == "array"


def test_vision_reuse_tracks_actual_media_freshness(isolated):
    for name in ("one.jpg", "two.jpg"):
        (isolated / name).write_bytes(b"jpeg")
    config = {"folder": "media", "files": ["one.jpg", "two.jpg"],
              "visionModels": [vision()]}
    original = model_lab._new_run_payload(config)
    original["status"] = "completed"
    original["attempts"] = [{
        "id": "valid-sight", "modelRef": vision()["modelRef"],
        "kind": "vision_open", "file": "one.jpg", "status": "completed",
        "result": {"sight": {"things": []}},
    }]
    model_lab._write_run(original)
    identical = model_lab._new_run_payload(config)
    key = model_lab._attempt_key("vision_open", vision()["modelRef"], "one.jpg")
    assert key in identical["reused"]
    file = isolated / "one.jpg"
    old = file.stat()
    os.utime(file, ns=(old.st_atime_ns, old.st_mtime_ns + 1_000_000_000))
    updated = model_lab._new_run_payload(config)
    assert key not in updated["reused"]


def test_reused_attempt_is_preserved_during_export_and_source_deletion():
    config = {"directorModels": [director()]}
    original = model_lab._new_run_payload(config)
    original["status"] = "completed"
    original["attempts"] = [{
        "id": "completed-scene", "modelRef": director()["modelRef"],
        "kind": "director_scene_plan_2048", "status": "completed",
        "result": {"text": "saved original", "verifiedOutputTokens": 600},
    }]
    model_lab._write_run(original)
    next_run = model_lab._new_run_payload(config)
    key = model_lab._attempt_key("director_scene_plan_2048", director()["modelRef"])
    assert key in next_run["reused"]
    next_run["status"] = "completed"
    model_lab._write_run(next_run)

    exported = assessment_transfer.export_results()
    portable = next(row for row in exported["runs"] if row["id"] == next_run["id"])
    assert not portable.get("reused")
    assert any(a.get("id") == "completed-scene" for a in portable["attempts"])

    model_lab.delete_run(original["id"])
    remaining = model_lab.get_run(next_run["id"])
    assert not remaining["reused"]
    assert model_lab._completed_attempt(remaining, "director_scene_plan_2048",
                                        director()["modelRef"])["id"] == "completed-scene"


def test_mixed_assessment_pairs_schema_assist_with_existing_vision(isolated):
    for name in ("one.jpg", "two.jpg"):
        (isolated / name).write_bytes(b"jpeg")
    run = model_lab._new_run_payload({
        "folder": "media", "files": ["one.jpg", "two.jpg"],
        "visionModels": [vision()], "directorModels": [director()],
    })
    assert run["referenceVisionRef"] == vision()["modelRef"]
    planned = model_lab._planned_probes(run)
    assert model_lab._attempt_key("set_vocabulary_synthesis", director()["modelRef"]) in planned
    assert model_lab._attempt_key("language_synthesis", director()["modelRef"]) not in planned
    assert len(planned) == 6  # 2 Vision, 2 Set Schema Assist, Scene JSON and thinking
