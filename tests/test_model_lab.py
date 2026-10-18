import json
import threading
from pathlib import Path

import pytest

from tool.server import model_lab


def test_status_reader_cannot_hold_open_journal_during_atomic_replace(monkeypatch):
    run = {"id": "read-write-race", "version": 1, "status": "completed", "attempts": []}
    model_lab._write_run(run)
    path = model_lab._run_path(run["id"])
    reader_open, release_reader, writer_started, writer_done = [threading.Event() for _ in range(4)]
    original_read = Path.read_text
    errors = []

    def held_read(target, *args, **kwargs):
        if target != path:
            return original_read(target, *args, **kwargs)
        with target.open("r", encoding="utf-8") as handle:
            reader_open.set()
            assert release_reader.wait(3)
            return handle.read()

    def reader():
        try:
            model_lab._read_raw(run["id"])
        except Exception as exc:
            errors.append(exc)

    def writer():
        writer_started.set()
        try:
            model_lab._write_run({**run, "updated": True})
        except Exception as exc:
            errors.append(exc)
        finally:
            writer_done.set()

    monkeypatch.setattr(Path, "read_text", held_read)
    read_thread, write_thread = threading.Thread(target=reader), threading.Thread(target=writer)
    read_thread.start()
    try:
        assert reader_open.wait(3)
        write_thread.start()
        assert writer_started.wait(3)
        assert not writer_done.wait(0.1), "writer must wait for the journal reader to close"
    finally:
        release_reader.set()
        read_thread.join(3)
        if write_thread.ident is not None:
            write_thread.join(3)
    assert not errors
    assert not read_thread.is_alive() and not write_thread.is_alive()
    assert json.loads(original_read(path, encoding="utf-8"))["updated"] is True
    assert not list(path.parent.glob("*.tmp"))


def test_journal_write_failure_remains_visible_and_preserves_previous_record(monkeypatch):
    run = {"id": "write-denied", "version": 1, "status": "error"}
    model_lab._write_run(run)
    def denied(*args):
        raise PermissionError("Persistent filesystem denial")
    monkeypatch.setattr(model_lab.os, "replace", denied)
    with pytest.raises(PermissionError, match="Persistent filesystem denial"):
        model_lab._write_run({**run, "status": "running"})
    path = model_lab._run_path(run["id"])
    assert json.loads(path.read_text(encoding="utf-8")) == run
    assert not list(path.parent.glob("*.tmp"))


@pytest.fixture(autouse=True)
def isolated_model_lab(monkeypatch, tmp_path):
    root = tmp_path / "cache"
    monkeypatch.setattr(model_lab.app_config, "app_cache_root", lambda: root)
    with model_lab._lock:
        model_lab._active.clear()
    yield root
    with model_lab._lock:
        model_lab._active.clear()


def _vision(ref="local::vision.gguf"):
    return {
        "modelRef": ref,
        "runtimeId": "local",
        "runtimeName": "Local",
        "modelId": ref.split("::", 1)[-1],
        "label": ref.split("::", 1)[-1],
        "sizeBytes": 123,
    }


def _director(ref="local::director.gguf"):
    return {
        "modelRef": ref,
        "runtimeId": "local",
        "runtimeName": "Local",
        "modelId": ref.split("::", 1)[-1],
        "label": ref.split("::", 1)[-1],
        "sizeBytes": 456,
    }


def test_model_lab_freezes_deterministic_set_sample_and_models(monkeypatch):
    files = ["{:02d}.jpg".format(index) for index in range(20)]
    monkeypatch.setattr(model_lab, "_supported_media", lambda folder, values: list(values))

    run = model_lab._new_run_payload({
        "folder": "set",
        "files": files,
        "sampleCount": 6,
        "groups": [
            {"group": "Viewpoint", "terms": ["front", "side"]},
            {"group": "BT Shape", "terms": ["triangle"]},
        ],
        "visionModels": [_vision()],
        "directorModels": [_director()],
        "referenceVisionRef": "local::vision.gguf",
        "referenceDirectorRef": "local::director.gguf",
    })

    assert run["status"] == "running"
    assert len(run["files"]) == 6
    assert run["files"][0] == files[0]
    assert run["files"][-1] == files[-1]
    assert run["visionModels"][0]["modelRef"] == "local::vision.gguf"
    assert run["directorModels"][0]["modelRef"] == "local::director.gguf"
    assert run["groups"][1]["group"] == "BT Shape"


def test_model_lab_run_journal_persists_each_attempt(isolated_model_lab):
    run = {
        "version": model_lab.RUN_VERSION,
        "id": "run-1",
        "status": "running",
        "startedAt": "2026-10-07T00:00:00+00:00",
        "finishedAt": "",
        "folder": "set",
        "files": ["a.jpg"],
        "groups": [],
        "visionModels": [],
        "directorModels": [],
        "allVisionModels": [],
        "allDirectorModels": [],
        "referenceVisionRef": "",
        "referenceDirectorRef": "",
        "options": {},
        "progress": {},
        "summary": {},
        "error": "",
        "attempts": [],
    }
    model_lab._write_run(run)
    model_lab._append_attempt(run, {
        "id": "p-1",
        "kind": "vision_open",
        "role": "vision",
        "modelRef": "local::vl",
        "file": "a.jpg",
        "status": "failed",
        "startedAt": "x",
        "finishedAt": "y",
        "jobId": "",
        "error": "bad response",
        "result": {},
    })

    payload = json.loads((isolated_model_lab / model_lab.ROOT_NAME / "run-1.json").read_text(encoding="utf-8"))
    assert payload["attempts"][0]["status"] == "failed"
    assert payload["summary"]["failed"] == 1


def test_interrupted_server_run_is_reconciled_but_never_auto_resumed():
    run = {
        "version": model_lab.RUN_VERSION,
        "id": "run-2",
        "status": "running",
        "startedAt": "2026-10-07T00:00:00+00:00",
        "finishedAt": "",
        "folder": "set",
        "files": ["a.jpg"],
        "groups": [],
        "visionModels": [],
        "directorModels": [],
        "allVisionModels": [],
        "allDirectorModels": [],
        "referenceVisionRef": "",
        "referenceDirectorRef": "",
        "options": {},
        "progress": {},
        "summary": {},
        "error": "",
        "attempts": [{
            "id": "p-1",
            "kind": "vision_open",
            "role": "vision",
            "modelRef": "local::vl",
            "file": "a.jpg",
            "status": "running",
            "startedAt": "x",
            "finishedAt": "",
            "jobId": "job-1",
            "error": "",
            "result": {},
        }],
    }
    model_lab._write_run(run)

    restored = model_lab.get_run("run-2")

    assert restored["status"] == "interrupted"
    assert restored["attempts"][0]["status"] == "interrupted"
    assert "Resume explicitly" in restored["error"]


def test_completed_probe_is_not_repeated_on_resume():
    run = {
        "attempts": [{
            "kind": "vision_open",
            "modelRef": "local::vl",
            "file": "a.jpg",
            "status": "completed",
            "result": {"sight": {"description": "x", "inventory": {}}},
        }]
    }
    assert model_lab._attempt_completed(run, "vision_open", "local::vl", "a.jpg") is True
    assert model_lab._attempt_completed(run, "vision_open", "local::vl", "b.jpg") is False


def test_failures_are_results_not_whole_run_failures():
    run = {
        "attempts": [
            {"modelRef": "local::vl", "kind": "vision_open", "status": "completed"},
            {"modelRef": "local::vl", "kind": "vision_group_aware", "status": "failed"},
            {"modelRef": "local::vl", "kind": "vision_open", "status": "skipped"},
        ]
    }
    summary = model_lab._summarize(run)
    assert summary["completed"] == 1
    assert summary["failed"] == 1
    assert summary["skipped"] == 1
    assert summary["byModel"]["local::vl"]["failed"] == 1


def test_model_lab_is_diagnostics_owned_and_does_not_write_set_intelligence():
    root = Path(__file__).resolve().parents[1]
    backend = (root / "tool" / "server" / "model_lab.py").read_text(encoding="utf-8")
    html = (root / "tool" / "tool.html").read_text(encoding="utf-8")
    diagnostics = (root / "tool" / "js" / "diagnostics.js").read_text(encoding="utf-8")
    frontend = (root / "tool" / "js" / "model_lab.js").read_text(encoding="utf-8")
    set_scan = (root / "tool" / "js" / "set_scan.js").read_text(encoding="utf-8")
    vocabulary = (root / "tool" / "js" / "vision_schema_assist.js").read_text(encoding="utf-8")

    assert 'data-diagnostics-tab="model-lab"' in html
    assert 'data-diagnostics-panel="model-lab"' in html
    assert '/static/js/model_lab.js' in html
    assert "if (next === 'model-lab') {" in diagnostics
    assert "modelLabFetch(modelLabRunId)" in diagnostics
    assert "else modelLabRefresh();" in diagnostics
    assert "/app/model-lab" in frontend

    assert "save_vision_sight" not in backend
    assert "save_vision_vocabulary_sight" not in backend
    assert "set_media_metadata_analysis_block" not in backend
    assert "mergeChecklistSchemaVocabulary" not in backend
    assert "assignChecklistTagToMediaKey" not in backend
    assert "modelLab" not in set_scan
    assert "modelLab" not in vocabulary


def test_model_lab_runner_is_server_owned_not_browser_sequenced():
    root = Path(__file__).resolve().parents[1]
    backend = (root / "tool" / "server" / "model_lab.py").read_text(encoding="utf-8")
    frontend = (root / "tool" / "js" / "model_lab.js").read_text(encoding="utf-8")

    assert "threading.Thread(" in backend
    assert "daemon=True" in backend
    assert "Resume explicitly" in backend
    assert "completed probes" not in frontend.lower()
    assert "directorModelTestRunOne" not in frontend


def test_director_standard_suite_includes_writing_and_schema(monkeypatch):
    captured = []
    monkeypatch.setattr(model_lab, "_probe_job", lambda run, **kw: captured.append(kw["kind"]) or {"status": "failed"})
    monkeypatch.setattr(model_lab, "_run_schema_pair", lambda run, ref, analysis, groups, prefix: captured.append(prefix))
    model_lab._run_director_model({"referenceVisionRef": ""}, _director())
    assert captured == ["director_writing", "language"]


def test_capability_summaries_do_not_expose_model_text(monkeypatch):
    run = {
        "version": model_lab.RUN_VERSION, "id": "summary-1", "status": "completed",
        "startedAt": "2026-10-18T00:00:00+00:00", "finishedAt": "",
        "folder": "set", "files": [], "groups": [],
        "visionModels": [], "directorModels": [], "allVisionModels": [],
        "allDirectorModels": [], "referenceVisionRef": "", "referenceDirectorRef": "",
        "options": {}, "progress": {}, "summary": {}, "error": "",
        "attempts": [{"kind": "director_writing", "modelRef": "local::writer",
                      "status": "completed", "error": "",
                      "result": {"text": "private test response", "finishReason": "stop"}}],
    }
    model_lab._write_run(run)
    summaries = model_lab.capability_run_summaries()
    assert summaries[0]["models"]["local::writer"]["director_writing"]["status"] == "completed"
    assert "private test response" not in json.dumps(summaries)


def test_deep_assessment_freezes_depth_and_expanded_sample(monkeypatch):
    monkeypatch.setattr(model_lab, "_supported_media", lambda folder, values: list(values))
    files = ["{:02d}.jpg".format(i) for i in range(24)]
    base = {"folder": "set", "files": files, "directorModels": [_director()]}
    quick = model_lab._new_run_payload(base)
    deep = model_lab._new_run_payload(dict(base, depth="deep", sampleCount=16))
    assert quick["depth"] == "quick"
    assert deep["depth"] == "deep"
    assert len(quick["files"]) == 8
    assert len(deep["files"]) == 16
    with pytest.raises(ValueError, match="depth"):
        model_lab._new_run_payload(dict(base, depth="unexpected"))


def test_deep_assessment_director_probe_budgets_exist():
    source = (Path(__file__).resolve().parents[1] / "tool" / "server" / "model_lab.py").read_text(encoding="utf-8")
    assert 'if run.get("depth") == "deep":' in source
    assert "for budget in (1024, 4096):" in source
    assert 'kind="director_writing_" + str(budget)' in source
