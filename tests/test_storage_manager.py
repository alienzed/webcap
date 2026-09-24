import json
from pathlib import Path

import pytest

from tool.server import generate_store, storage_manager
from tool.server import app as app_module


def _write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _training_action(root, action_id="001-set--abc/001-h3--demo"):
    action = root / "output" / "runs" / Path(action_id)
    (action / "captures").mkdir(parents=True)
    (action / "jobs").mkdir()
    (action / "output").mkdir()
    _write_json(action / "action.json", {
        "version": 2,
        "actionId": action_id,
        "runName": "Demo",
        "folder": "sets/demo",
        "profileId": "minimax_h3",
        "profileLabel": "MiniMax H3",
        "mode": "normal",
        "requestedStages": ["h3"],
        "createdAt": 1,
        "captures": [],
        "jobs": {"h3": []},
        "outputs": {"h3": []},
    })
    return action


def _generation(root, day="2026-09-23", job_id="job-1"):
    directory = root / "output" / "generations" / day / job_id
    directory.mkdir(parents=True)
    (directory / "result.mp4").write_bytes(b"x" * 10)
    _write_json(directory / "generation.json", {
        "version": 1,
        "jobId": job_id,
        "createdAt": 1,
        "modelId": "minimax_h3",
        "mediaKind": "video",
        "sourcePrompt": "demo",
        "mediaPath": "output/generations/" + day + "/" + job_id + "/result.mp4",
    })
    return directory


def _story(root, story_id="story-demo"):
    directory = root / "output" / "storyboards" / story_id
    take_dir = directory / "takes" / "scene-1"
    take_dir.mkdir(parents=True)
    take_path = take_dir / "take-1.mp4"
    take_path.write_bytes(b"take-video")
    _write_json(directory / "story.json", {
        "id": story_id,
        "title": "Demo Story",
        "concept": "",
        "tags": [],
        "status": "active",
        "pinned": False,
        "createdAt": "2026-09-23T00:00:00+00:00",
        "updatedAt": "2026-09-23T00:00:00+00:00",
        "sceneOrder": ["scene-1"],
        "scenes": {
            "scene-1": {
                "id": "scene-1",
                "title": "Opening",
                "references": [],
                "takes": {
                    "take-1": {
                        "id": "take-1",
                        "sceneId": "scene-1",
                        "createdAt": "2026-09-23T00:00:00+00:00",
                        "mediaPath": "takes/scene-1/take-1.mp4",
                        "label": "",
                        "rating": None,
                    }
                },
                "removedTakes": {},
                "takeOrder": ["take-1"],
                "selectedTakeId": "take-1",
            }
        },
        "removedScenes": {},
    })
    return directory


def test_overview_enumerates_known_producer_roots_without_measuring(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    _training_action(tmp_path)
    _generation(tmp_path)
    _story(tmp_path)

    payload = storage_manager.overview("")

    assert payload["ok"] is True
    assert len(payload["items"]["training"]) == 1
    assert len(payload["items"]["generate"]) == 1
    assert len(payload["items"]["storyboard"]) == 1
    assert payload["items"]["tests"] == []
    assert all(item["bytes"] is None for area in ("training", "generate", "storyboard") for item in payload["items"][area])
    tests = next(row for row in payload["categories"] if row["area"] == "tests")
    assert tests["complete"] is False
    assert "Start scan" in tests["note"]
    assert "workspace-wide Test inventory" in tests["note"]


def test_measure_is_item_scoped_and_cached(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    directory = _generation(tmp_path)
    (directory / "references").mkdir()
    (directory / "references" / "frame.png").write_bytes(b"abc")

    measured = storage_manager.measure("generate", "2026-09-23/job-1")
    payload = storage_manager.overview("")

    assert measured["bytes"] >= 13
    item = payload["items"]["generate"][0]
    assert item["measured"] is True
    assert item["bytes"] == measured["bytes"]
    assert (tmp_path / ".webcap" / "storage_usage.json").is_file()


def test_measure_refuses_symlinked_root(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "file.bin").write_bytes(b"1234")
    generated = tmp_path / "output" / "generations" / "2026-09-23"
    generated.mkdir(parents=True)
    link = generated / "job-1"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("Symlink creation is unavailable on this platform.")

    with pytest.raises((ValueError, FileNotFoundError)):
        storage_manager.measure("generate", "2026-09-23/job-1")


def test_storyboard_measure_refuses_symlinked_story(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    outside = tmp_path / "outside-story"
    outside.mkdir()
    (outside / "takes" / "scene-1").mkdir(parents=True)
    (outside / "takes" / "scene-1" / "take-1.mp4").write_bytes(b"outside")
    _write_json(outside / "story.json", {
        "id": "story-demo",
        "title": "Outside",
        "concept": "",
        "tags": [],
        "status": "active",
        "pinned": False,
        "createdAt": "2026-09-23T00:00:00+00:00",
        "updatedAt": "2026-09-23T00:00:00+00:00",
        "sceneOrder": ["scene-1"],
        "scenes": {
            "scene-1": {
                "id": "scene-1",
                "references": [],
                "takes": {
                    "take-1": {
                        "id": "take-1",
                        "sceneId": "scene-1",
                        "mediaPath": "takes/scene-1/take-1.mp4",
                    }
                },
                "removedTakes": {},
                "takeOrder": ["take-1"],
            }
        },
        "removedScenes": {},
    })
    root = tmp_path / "output" / "storyboards"
    root.mkdir(parents=True)
    link = root / "story-demo"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("Symlink creation is unavailable on this platform.")

    with pytest.raises(ValueError, match="symlinked"):
        storage_manager.measure("storyboard", "story-demo/scene-1/take-1")



def test_storyboard_storage_deletes_take_not_story(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    story_dir = _story(tmp_path)

    item = storage_manager.overview("")["items"]["storyboard"][0]

    assert item["id"] == "story-demo/scene-1/take-1"
    assert item["kind"] == "Generated Take"
    assert item["purgeable"] is True
    storage_manager.purge("storyboard", item["id"])

    assert story_dir.is_dir()
    assert (story_dir / "story.json").is_file()
    assert not (story_dir / "takes" / "scene-1" / "take-1.mp4").exists()
    story = json.loads((story_dir / "story.json").read_text(encoding="utf-8"))
    assert story["scenes"]["scene-1"]["takes"] == {}


def test_storyboard_storage_protects_take_used_as_reference(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    story_dir = _story(tmp_path)
    story_path = story_dir / "story.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    story["scenes"]["scene-1"]["references"] = [{
        "role": "first_frame",
        "source": "take",
        "sourceSceneId": "scene-1",
        "sourceTakeId": "take-1",
        "frame": "first",
        "mediaPath": "takes/scene-1/take-1.mp4",
    }]
    _write_json(story_path, story)

    item = storage_manager.overview("")["items"]["storyboard"][0]

    assert item["purgeable"] is False
    assert "Scene reference" in item["protectedReason"]
    with pytest.raises(RuntimeError, match="used as a Scene reference"):
        storage_manager.purge("storyboard", item["id"])
    assert (story_dir / "takes" / "scene-1" / "take-1.mp4").is_file()


def test_storyboard_storage_surfaces_but_protects_take_in_removed_scene(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    story_dir = _story(tmp_path)
    story_path = story_dir / "story.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    scene = story["scenes"].pop("scene-1")
    story["sceneOrder"] = []
    story["removedScenes"] = {"scene-1": scene}
    _write_json(story_path, story)

    item = storage_manager.overview("")["items"]["storyboard"][0]

    assert item["purgeable"] is False
    assert "removed Scene" in item["status"]
    assert "Restore the Scene" in item["protectedReason"]
    with pytest.raises(RuntimeError, match="Restore the Scene"):
        storage_manager.purge("storyboard", item["id"])
    assert (story_dir / "takes" / "scene-1" / "take-1.mp4").is_file()

def test_generate_purge_requires_manifest_ownership(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    directory = _generation(tmp_path)
    _write_json(directory / "generation.json", {"version": 1, "jobId": "someone-else"})

    with pytest.raises(RuntimeError):
        storage_manager.purge("generate", "2026-09-23/job-1")

    assert directory.is_dir()


def test_training_purge_blocks_nonterminal_queue_reference(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    action_id = "001-set--abc/001-h3--demo"
    action = _training_action(tmp_path, action_id)
    _write_json(tmp_path / ".webcap_training" / "queue.json", {
        "version": 3,
        "jobs": [{"id": "job-live", "actionId": action_id, "status": "queued"}],
    })

    with pytest.raises(RuntimeError, match="job-live"):
        storage_manager.purge("training", action_id)

    assert action.is_dir()


def test_training_overview_marks_nonterminal_reference_protected(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    action_id = "001-set--abc/001-h3--demo"
    _training_action(tmp_path, action_id)
    _write_json(tmp_path / ".webcap_training" / "queue.json", {
        "version": 3,
        "jobs": [{"id": "job-live", "actionId": action_id, "status": "running"}],
    })

    item = storage_manager.overview("")["items"]["training"][0]

    assert item["purgeable"] is False
    assert item["status"] == "active / queued"
    assert "job-live" in item["protectedReason"]


def test_current_set_storage_is_visible_but_never_purgeable(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    set_path = tmp_path / "sets" / "demo"
    (set_path / "originals").mkdir(parents=True)
    (set_path / "originals" / "image.png").write_bytes(b"original")
    (set_path / "auto_dataset").mkdir()
    (set_path / "auto_dataset" / "copy.png").write_bytes(b"copy")
    _write_json(set_path / "media_metadata.json", {"image.png": {"size": 8}})
    _write_json(set_path / ".webcap_state.json", {"ratings_by_media": {}})

    payload = storage_manager.overview("sets/demo")
    items = payload["items"]["set"]

    assert {item["id"] for item in items} == {
        "originals", "auto_dataset", "media_metadata.json", ".webcap_state.json"
    }
    assert all(item["purgeable"] is False for item in items)
    measured = storage_manager.measure("set", "originals", "sets/demo")
    assert measured["bytes"] == len(b"original")
    with pytest.raises(ValueError):
        storage_manager.purge("set", "originals", "sets/demo")
    assert (set_path / "originals" / "image.png").is_file()


def test_storage_has_no_path_based_or_set_source_purge(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    source = tmp_path / "sets" / "demo" / "image.png"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"source")

    with pytest.raises(ValueError):
        storage_manager.purge("set", "sets/demo/image.png")

    with pytest.raises(ValueError):
        storage_manager.purge("anything", str(source))

    assert source.is_file()


def test_storage_routes_delegate_only_identity_fields(monkeypatch):
    seen = {}

    monkeypatch.setattr(app_module, "storage_overview", lambda folder="": {"ok": True, "folder": folder, "categories": [], "items": {}})

    def fake_measure(area, item_id, folder=""):
        seen["measure"] = (area, item_id, folder)
        return {"ok": True, "bytes": 12}

    monkeypatch.setattr(app_module, "storage_measure", fake_measure)
    monkeypatch.setattr(app_module, "storage_start_scan", lambda folder="": {"ok": True, "scan": {"status": "running", "folder": folder}})
    monkeypatch.setattr(app_module, "storage_scan_status", lambda: {"ok": True, "scan": {"status": "completed"}})
    monkeypatch.setattr(app_module, "storage_cancel_scan", lambda: {"ok": True, "scan": {"status": "cancelling"}})
    client = app_module.app.test_client()

    response = client.get("/fs/storage?folder=sets/demo")
    measured = client.post("/fs/storage/measure", json={"area": "generate", "id": "2026-09-23/job-1", "folder": ""})
    scan_started = client.post("/fs/storage/scan/start", json={"folder": "sets/demo"})
    scan_status = client.get("/fs/storage/scan/status")
    scan_cancelled = client.post("/fs/storage/scan/cancel", json={})

    assert response.status_code == 200
    assert response.get_json()["folder"] == "sets/demo"
    assert measured.status_code == 200
    assert seen["measure"] == ("generate", "2026-09-23/job-1", "")
    assert scan_started.get_json()["scan"]["folder"] == "sets/demo"
    assert scan_status.get_json()["scan"]["status"] == "completed"
    assert scan_cancelled.get_json()["scan"]["status"] == "cancelling"


def test_storage_ui_is_isolated_global_activity():
    root = Path(__file__).resolve().parents[1]
    html = (root / "tool" / "tool.html").read_text(encoding="utf-8")
    shell = (root / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    storage_js = (root / "tool" / "js" / "storage_manager.js").read_text(encoding="utf-8")
    backend = (root / "tool" / "server" / "storage_manager.py").read_text(encoding="utf-8")

    assert 'id="activity-storage-btn"' in html
    assert 'id="storage-workspace"' in html
    assert 'id="storage-scan-btn"' in html
    assert 'data-workspace-root="storage"' in html
    assert "/static/js/storage_manager.js" in html
    assert "window.openStorageActivity = openStorageActivity" in storage_js
    assert "window.closeStorageActivity = closeStorageActivity" in storage_js
    assert "measurementAge(item.measuredAt)" in storage_js
    assert "/fs/storage/scan/start" in storage_js
    assert "/fs/storage/scan/status" in storage_js
    assert "/fs/storage/scan/cancel" in storage_js
    assert "Measure all" not in storage_js
    assert "storageState.activeArea" in storage_js
    assert "storage-overview-back" in storage_js
    assert "Delete Take" in storage_js
    assert "Delete Story" not in storage_js
    assert "typeof window.reportConsoleError" not in storage_js
    assert "typeof window.closeGenerateActivity" not in storage_js
    assert "This removes only this generated Take. The Story and other Takes remain." in storage_js
    assert "workspace === 'storage'" in shell
    assert "activity === 'storage'" in shell
    assert "os.walk" not in backend
    assert 'PURGEABLE_AREAS = {"training", "tests", "staged", "generate", "storyboard", "runtime", "comfy"}' in backend
    assert '"set": _set_items(cache, folder)' in backend
    assert '"staged": _staged_items(cache, folder)' in backend
    assert '"comfy": _comfy_items(cache)' in backend



def test_workspace_scan_discovers_historical_tests_and_records_usage(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    _generation(tmp_path, job_id="job-scan")

    for set_name, session_name in (("alpha", "session-a"), ("beta", "session-b")):
        set_path = tmp_path / "sets" / set_name
        session = set_path / "test-generations" / session_name
        session.mkdir(parents=True)
        _write_json(set_path / ".webcap_state.json", {"ratings_by_media": {}})
        _write_json(session / "test.json", {
            "name": session_name,
            "status": "completed",
            "modelId": "minimax_h3",
            "completed": 1,
            "failed": 0,
            "total": 1,
        })
        (session / "result.mp4").write_bytes(b"video-" + set_name.encode("utf-8"))

    summary = storage_manager._scan_workspace("", cancel_check=lambda: False, progress=lambda event: None)
    payload = storage_manager.overview("")

    assert summary["setsDiscovered"] == 2
    assert summary["testsDiscovered"] == 2
    assert {(item["folder"], item["id"]) for item in payload["items"]["tests"]} == {
        ("sets/alpha", "session-a"),
        ("sets/beta", "session-b"),
    }
    assert all(item["measured"] is True for item in payload["items"]["tests"])
    assert all(item["measurementSource"] == "scan" for item in payload["items"]["tests"])
    assert all(item["fileCount"] >= 2 for item in payload["items"]["tests"])
    tests_category = next(row for row in payload["categories"] if row["area"] == "tests")
    assert tests_category["complete"] is True
    assert payload["lastScan"]["completedAt"] > 0



def test_generate_persistence_registers_exact_usage_without_scan(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr(generate_store.app_config, "FS_ROOT", tmp_path)

    payload = generate_store.persist_result(
        "job-usage",
        {
            "modelId": "minimax_h3",
            "mediaKind": "video",
            "prompt": "demo",
            "settings": {},
            "loras": [],
            "references": {},
        },
        {"filename": "render.mp4"},
        b"video-bytes",
        "provider-1",
        25,
    )

    item = storage_manager.overview("")["items"]["generate"][0]
    assert payload["jobId"] == "job-usage"
    assert item["measured"] is True
    assert item["measurementSource"] == "producer"
    assert item["fileCount"] == 2
    assert item["bytes"] >= len(b"video-bytes")



def test_manual_measure_records_file_count_and_source(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    directory = _generation(tmp_path)
    (directory / "references").mkdir()
    (directory / "references" / "frame.png").write_bytes(b"abc")

    measured = storage_manager.measure("generate", "2026-09-23/job-1")
    item = storage_manager.overview("")["items"]["generate"][0]

    assert measured["source"] == "manual"
    assert measured["fileCount"] == 3
    assert item["fileCount"] == 3
    assert item["measurementSource"] == "manual"


def test_workspace_scan_cancellation_is_checked_during_recursive_inspection(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    directory = _generation(tmp_path)
    (directory / "nested").mkdir()
    (directory / "nested" / "large.bin").write_bytes(b"x" * 32)

    with pytest.raises(storage_manager._ScanCancelled):
        storage_manager._safe_recursive_stats(directory, cancel_check=lambda: True)


def _h3_probe(root, probe_id="h3-20260923-120000-deadbeef", status="completed"):
    probe = root / ".webcap_training" / "h3-probes" / probe_id
    probe.mkdir(parents=True)
    _write_json(probe / "seed.json", {
        "version": 1,
        "id": probe_id,
        "createdAt": "2026-09-23T12:00:00+00:00",
    })
    if status is not None:
        _write_json(probe / "runtime.json", {
            "version": 1,
            "probeId": probe_id,
            "status": status,
        })
    return probe


def test_runtime_h3_probe_is_purgeable_only_when_inactive(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    completed = _h3_probe(tmp_path, "h3-completed", "completed")
    active = _h3_probe(tmp_path, "h3-running", "running")

    items = {item["id"]: item for item in storage_manager.overview("")["items"]["runtime"]}

    assert items["h3-probe/h3-completed"]["purgeable"] is True
    assert items["h3-probe/h3-completed"]["status"] == "completed"
    assert items["h3-probe/h3-running"]["purgeable"] is False
    assert "stop it before deletion" in items["h3-probe/h3-running"]["protectedReason"]

    storage_manager.purge("runtime", "h3-probe/h3-completed")
    assert not completed.exists()

    with pytest.raises(RuntimeError, match="stop it before deletion"):
        storage_manager.purge("runtime", "h3-probe/h3-running")
    assert active.is_dir()


def test_runtime_h3_probe_requires_matching_ownership_seed(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    probe = tmp_path / ".webcap_training" / "h3-probes" / "h3-demo"
    probe.mkdir(parents=True)
    _write_json(probe / "seed.json", {"version": 1, "id": "someone-else"})

    assert storage_manager.overview("")["items"]["runtime"] == []
    with pytest.raises(RuntimeError, match="does not match"):
        storage_manager.purge("runtime", "h3-probe/h3-demo")
    assert probe.is_dir()


def test_test_purge_rechecks_active_status_at_mutation_time(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    set_path = tmp_path / "sets" / "demo"
    session = set_path / "test-generations" / "session-1"
    session.mkdir(parents=True)
    _write_json(session / "test.json", {
        "name": "Session 1",
        "status": "completed",
        "modelId": "minimax_h3",
        "completed": 1,
        "failed": 0,
        "total": 1,
    })

    item = storage_manager.overview("sets/demo")["items"]["tests"][0]
    assert item["purgeable"] is True

    _write_json(session / "test.json", {
        "name": "Session 1",
        "status": "running",
        "modelId": "minimax_h3",
        "completed": 1,
        "failed": 0,
        "total": 2,
    })

    with pytest.raises(RuntimeError, match="Active Test Session"):
        storage_manager.purge("tests", "session-1", "sets/demo")
    assert session.is_dir()


def _staged_copy(root, set_name="demo", filename="demo__epoch10.safetensors"):
    directory = root / "external-test" / set_name
    directory.mkdir(parents=True, exist_ok=True)
    candidate = directory / filename
    candidate.write_bytes(b"staged")
    _write_json(candidate.with_suffix(".webcap.json"), {
        "version": 1,
        "sourceJobId": "job-source",
        "sourceRunName": "Demo Run",
        "sourceRunSequence": "abc123",
        "sourceEpoch": 10,
        "sourceFileName": "epoch10.safetensors",
        "sourceFolder": "sets/demo",
        "stage": "h3",
        "runSummary": {},
    })
    return candidate


def test_staged_test_copy_is_exposed_and_purges_copy_only(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    set_path = tmp_path / "sets" / "demo"
    set_path.mkdir(parents=True)
    source = tmp_path / "output" / "runs" / "source" / "epoch10.safetensors"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"source")
    candidate = _staged_copy(tmp_path)

    monkeypatch.setattr(
        storage_manager,
        "test_copy_destination",
        lambda stage, set_name: (tmp_path / "external-test", [set_name]),
    )
    monkeypatch.setattr(
        storage_manager,
        "execution_lane_snapshot",
        lambda lane, include_terminal=False: {"jobs": []},
    )

    items = storage_manager.overview("sets/demo")["items"]["staged"]
    assert len(items) == 1
    assert items[0]["id"] == "h3/" + candidate.name
    assert items[0]["purgeable"] is True

    storage_manager.purge("staged", items[0]["id"], "sets/demo")

    assert not candidate.exists()
    assert not candidate.with_suffix(".webcap.json").exists()
    assert source.is_file()


def test_staged_test_copy_requires_webcap_provenance(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    (tmp_path / "sets" / "demo").mkdir(parents=True)
    directory = tmp_path / "external-test" / "demo"
    directory.mkdir(parents=True)
    unknown = directory / "unknown.safetensors"
    unknown.write_bytes(b"unknown")

    monkeypatch.setattr(
        storage_manager,
        "test_copy_destination",
        lambda stage, set_name: (tmp_path / "external-test", [set_name]),
    )
    monkeypatch.setattr(
        storage_manager,
        "execution_lane_snapshot",
        lambda lane, include_terminal=False: {"jobs": []},
    )

    assert storage_manager.overview("sets/demo")["items"]["staged"] == []
    with pytest.raises(RuntimeError, match="ownership could not be proven"):
        storage_manager.purge("staged", "h3/unknown.safetensors", "sets/demo")
    assert unknown.is_file()


def test_staged_test_copy_is_protected_while_shared_inference_references_it(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    (tmp_path / "sets" / "demo").mkdir(parents=True)
    candidate = _staged_copy(tmp_path)

    monkeypatch.setattr(
        storage_manager,
        "test_copy_destination",
        lambda stage, set_name: (tmp_path / "external-test", [set_name]),
    )
    monkeypatch.setattr(
        storage_manager,
        "execution_lane_snapshot",
        lambda lane, include_terminal=False: {
            "jobs": [{
                "status": "running",
                "metadata": {
                    "client": "test",
                    "folder": "sets/demo",
                    "candidateKind": "lora",
                    "candidateFile": candidate.name,
                },
            }],
        },
    )

    item = storage_manager.overview("sets/demo")["items"]["staged"][0]
    assert item["purgeable"] is False

    with pytest.raises(RuntimeError, match="queued or active Test work"):
        storage_manager.purge("staged", item["id"], "sets/demo")
    assert candidate.is_file()
    assert candidate.with_suffix(".webcap.json").is_file()


def test_comfy_scratch_inventory_is_prefix_scoped_and_purgeable(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path / "fs")
    (tmp_path / "fs").mkdir()
    provider = tmp_path / "ComfyUI"
    generate = provider / "input" / "webcap-generate" / "job-old"
    unknown = provider / "input" / "someone-else" / "job-old"
    generate.mkdir(parents=True)
    unknown.mkdir(parents=True)
    (generate / "reference.png").write_bytes(b"owned")
    (unknown / "keep.png").write_bytes(b"external")
    (provider / "output").mkdir(parents=True)

    monkeypatch.setattr(storage_manager.inference_runtime, "known_provider_root", lambda: provider)
    monkeypatch.setattr(
        storage_manager,
        "execution_lane_snapshot",
        lambda lane, include_terminal=False: {"jobs": []},
    )

    items = storage_manager.overview("")["items"]["comfy"]
    assert [item["id"] for item in items] == ["input/generate/job-old"]
    assert items[0]["purgeable"] is True

    storage_manager.purge("comfy", "input/generate/job-old")

    assert not generate.exists()
    assert unknown.is_dir()
    assert (unknown / "keep.png").is_file()


def test_comfy_scratch_rechecks_active_inference_before_purge(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path / "fs")
    (tmp_path / "fs").mkdir()
    provider = tmp_path / "ComfyUI"
    scratch = provider / "output" / "webcap-generate" / "job-live"
    scratch.mkdir(parents=True)
    (scratch / "render.mp4").write_bytes(b"video")
    (provider / "input").mkdir(parents=True)

    monkeypatch.setattr(storage_manager.inference_runtime, "known_provider_root", lambda: provider)
    monkeypatch.setattr(
        storage_manager,
        "execution_lane_snapshot",
        lambda lane, include_terminal=False: {
            "jobs": [{
                "id": "job-live",
                "status": "running",
                "metadata": {"client": "generate"},
            }],
        },
    )

    item = storage_manager.overview("")["items"]["comfy"][0]
    assert item["purgeable"] is False
    assert "active Generate work" in item["protectedReason"]

    with pytest.raises(RuntimeError, match="queued or active inference work"):
        storage_manager.purge("comfy", "output/generate/job-live")
    assert scratch.is_dir()


def test_comfy_scratch_refuses_symlinked_owned_job_root(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path / "fs")
    (tmp_path / "fs").mkdir()
    provider = tmp_path / "ComfyUI"
    family = provider / "input" / "webcap-generate"
    family.mkdir(parents=True)
    (provider / "output").mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    link = family / "job-link"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("Symlink creation is unavailable on this platform.")

    monkeypatch.setattr(storage_manager.inference_runtime, "known_provider_root", lambda: provider)
    monkeypatch.setattr(
        storage_manager,
        "execution_lane_snapshot",
        lambda lane, include_terminal=False: {"jobs": []},
    )

    assert storage_manager.overview("")["items"]["comfy"] == []
    with pytest.raises(ValueError, match="symlinked"):
        storage_manager.purge("comfy", "input/generate/job-link")
    assert outside.is_dir()


def test_generate_purge_rechecks_active_shared_inference_job(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    directory = _generation(tmp_path, job_id="job-live")
    monkeypatch.setattr(
        storage_manager,
        "execution_lane_snapshot",
        lambda lane, include_terminal=False: {
            "jobs": [{
                "id": "job-live",
                "status": "running",
                "metadata": {"client": "generate"},
            }],
        },
    )

    item = storage_manager.overview("")["items"]["generate"][0]
    assert item["purgeable"] is False
    assert item["status"] == "finalizing"

    with pytest.raises(RuntimeError, match="active Generate work"):
        storage_manager.purge("generate", "2026-09-23/job-live")
    assert directory.is_dir()


def _generate_reference(root, token="1790180000000-abcdef123456"):
    directory = root / ".webcap_runtime" / "generate-references" / token
    directory.mkdir(parents=True)
    (directory / "reference.png").write_bytes(b"reference")
    return directory


def test_generate_reference_bundle_is_manually_purgeable_when_unreferenced(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    reference = _generate_reference(tmp_path)
    monkeypatch.setattr(
        storage_manager,
        "execution_lane_snapshot",
        lambda lane, include_terminal=False: {"jobs": []},
    )

    item = next(
        row for row in storage_manager.overview("")["items"]["runtime"]
        if row["id"].startswith("generate-reference/")
    )
    assert item["purgeable"] is True
    assert item["status"] == "draft / residual"

    storage_manager.purge("runtime", item["id"])

    assert not reference.exists()


def test_generate_reference_bundle_is_protected_while_queued(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    token = "1790180000000-abcdef123456"
    reference = _generate_reference(tmp_path, token)
    job = {
        "id": "job-live",
        "status": "queued",
        "metadata": {"client": "generate"},
    }
    stored = {
        **job,
        "payload": {
            "request": {
                "references": {
                    "first": ".webcap_runtime/generate-references/" + token + "/reference.png"
                }
            }
        },
    }
    monkeypatch.setattr(
        storage_manager,
        "execution_lane_snapshot",
        lambda lane, include_terminal=False: {"jobs": [job]},
    )
    monkeypatch.setattr(
        storage_manager,
        "execution_get_job",
        lambda job_id, include_payload=False: stored if include_payload else job,
    )

    item = next(
        row for row in storage_manager.overview("")["items"]["runtime"]
        if row["id"] == "generate-reference/" + token
    )
    assert item["purgeable"] is False
    assert "active Generate work" in item["protectedReason"]

    with pytest.raises(RuntimeError, match="queued or active Generate work"):
        storage_manager.purge("runtime", item["id"])
    assert reference.is_dir()


def test_generate_reference_bundle_refuses_unknown_or_symlinked_tokens(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    root = tmp_path / ".webcap_runtime" / "generate-references"
    root.mkdir(parents=True)
    unknown = root / "not-a-webcap-token"
    unknown.mkdir()
    outside = tmp_path / "outside-reference"
    outside.mkdir()
    link = root / "1790180000000-abcdef123456"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("Symlink creation is unavailable on this platform.")
    monkeypatch.setattr(
        storage_manager,
        "execution_lane_snapshot",
        lambda lane, include_terminal=False: {"jobs": []},
    )

    runtime_ids = {row["id"] for row in storage_manager.overview("")["items"]["runtime"]}
    assert "generate-reference/not-a-webcap-token" not in runtime_ids
    assert "generate-reference/1790180000000-abcdef123456" not in runtime_ids

    with pytest.raises(ValueError, match="symlinked"):
        storage_manager.purge("runtime", "generate-reference/1790180000000-abcdef123456")
    assert outside.is_dir()


def test_storage_manager_lists_and_purges_central_test_sessions(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_manager.app_config, "FS_ROOT", tmp_path)
    session = tmp_path / ".webcap" / "test-generations" / "session-central"
    session.mkdir(parents=True)
    _write_json(session / "test.json", {
        "status": "complete",
        "modelId": "minimax_h3",
        "source": "archive/demo",
        "ownerFolder": "sets/demo",
        "completed": 1,
        "failed": 0,
        "total": 1,
        "results": [],
    })
    (session / "result.mp4").write_bytes(b"video")

    items = storage_manager.overview("")["items"]["tests"]

    assert len(items) == 1
    assert items[0]["id"] == "session-central"
    assert items[0]["folder"] == ""
    assert items[0]["meta"]["source"] == "archive/demo"
    assert items[0]["purgeable"] is True

    storage_manager.purge("tests", "session-central", "")

    assert not session.exists()
