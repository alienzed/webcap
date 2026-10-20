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

    assert 'data-diagnostics-tab="assessment"' in html
    assert 'data-diagnostics-tab="model-lab"' not in html
    assert 'data-diagnostics-panel="model-lab"' not in html
    assert 'data-diagnostics-panel="benchmark"' not in html
    assert 'data-diagnostics-panel="models"' not in html
    assert '/static/js/model_lab.js' in html
    assert '/static/js/director_model_test.js' not in html
    assert "if (next === 'model-lab')" not in diagnostics
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
    assert captured == ["director_thinking", "director_scene_plan_2048", "language"]


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
    base = {"folder": "set", "files": files, "directorModels": [_director()], "visionModels": [_vision()]}
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
    assert "(2048, 4096, 8192, 16384)" in source
    assert 'kind="director_scene_plan_" + str(budget)' in source


def test_director_only_assessment_does_not_require_a_set():
    run = model_lab._new_run_payload({"directorModels": [_director()]})
    assert run["folder"] == ""
    assert run["files"] == []
    assert run["assessmentProtocol"] == model_lab.ASSESSMENT_PROTOCOL


def test_compatible_completed_probe_reused_across_runs():
    previous = model_lab._new_run_payload({"directorModels": [_director()]})
    previous["status"] = "completed"
    previous["attempts"] = [{
        "id": "p-verified", "kind": "director_scene_plan_2048",
        "modelRef": "local::director.gguf", "file": "", "status": "completed",
        "result": {"text": '{"scenes":[]}', "verifiedOutputTokens": 1234},
    }]
    model_lab._write_run(previous)
    next_run = model_lab._new_run_payload({"directorModels": [_director()]})
    assert model_lab._attempt_completed(next_run, "director_scene_plan_2048", "local::director.gguf")
    assert not model_lab._attempt_completed(next_run, "director_scene_plan_4096", "local::director.gguf")
    assert next_run["reused"]["director_scene_plan_2048|local::director.gguf|"]["runId"] == previous["id"]


def test_failed_probe_is_deferred_until_retry_pass():
    run = model_lab._new_run_payload({"directorModels": [_director()]})
    run["previousFailures"] = {"director_scene_plan_2048|local::director.gguf|": True}
    outcome = model_lab._probe_job(
        run, kind="director_scene_plan_2048", role="director",
        model_ref="local::director.gguf", enqueue=lambda: pytest.fail("should defer"),
    )
    assert outcome["status"] == "deferred"
    assert len(run["deferredRetries"]) == 1


def test_completed_assessment_has_no_pending_probes():
    director = _director()
    run = model_lab._new_run_payload({"directorModels": [director]})
    keys = ("director_thinking", "director_scene_plan_2048", "language_synthesis", "language_challenge")
    run["reused"] = {
        model_lab._attempt_key(kind, director["modelRef"]): {"runId": "previous", "attemptId": kind}
        for kind in keys
    }
    assert model_lab._pending_probe_plan(run) == {"missing": 0, "retry": 0, "total": 0}


def test_failed_and_missing_probes_are_counted_separately():
    director = _director()
    run = model_lab._new_run_payload({"directorModels": [director]})
    key = model_lab._attempt_key("director_thinking", director["modelRef"])
    run["previousFailures"] = {key: True}
    assert model_lab._pending_probe_plan(run) == {"missing": 3, "retry": 1, "total": 4}


def test_assessment_does_not_consider_historical_prose_structured_evidence():
    run = model_lab._new_run_payload({"directorModels": [_director()]})
    run["reused"] = {"director_writing|local::director.gguf|": {"runId": "previous", "attemptId": "a"}}
    assert model_lab._pending_probe_plan(run)["missing"] == 4


def test_planned_work_counts_actual_probe_suite_and_reused_evidence():
    run = model_lab._new_run_payload({"directorModels": [_director()], "depth": "deep"})
    planned = model_lab._planned_probes(run)
    assert len(planned) == 7  # thinking, four JSON tiers, two Schema Assist probes
    run["reused"] = {
        planned[0]: {"runId": "earlier", "attemptId": "a"},
        planned[1]: {"runId": "earlier", "attemptId": "b"},
    }
    run["previousFailures"] = {planned[2]: True}
    work = model_lab._assessment_work(run)
    assert work == {
        "planned": 7, "completed": 2, "reused": 2, "skipped": 0,
        "failed": 0, "deferred": 1, "running": 0, "remaining": 5, "resolved": 2,
    }
    assert model_lab._pending_probe_plan(run) == {"missing": 4, "retry": 1, "total": 5}


def test_attempts_and_retries_never_inflate_assessment_denominator():
    run = model_lab._new_run_payload({"directorModels": [_director()]})
    kind, model_ref = "director_scene_plan_2048", "local::director.gguf"
    run["attempts"] = [
        {"id": "initial", "kind": kind, "modelRef": model_ref, "status": "failed"},
        {"id": "retry", "kind": kind, "modelRef": model_ref, "status": "running", "retry": True},
        {"id": "unexpected", "kind": "director_model_error",
         "modelRef": model_ref, "status": "failed"},
    ]
    work = model_lab._assessment_work(run)
    assert work["planned"] == 4
    assert work["running"] == 1
    assert work["remaining"] == 4
    run["attempts"][1]["status"] = "completed"
    work = model_lab._assessment_work(run)
    assert work["completed"] == 1
    assert work["remaining"] == 3
    assert work["resolved"] == 1
    run["attempts"][1]["status"] = "failed"
    work = model_lab._assessment_work(run)
    assert work["failed"] == 1
    assert work["resolved"] == 1  # Final failed retry is terminal work, not a success.


def test_assessment_skips_and_resume_have_real_determinate_progress():
    run = model_lab._new_run_payload({"directorModels": [_director()]})
    run["attempts"] = [
        {"id": "s1", "kind": "language_synthesis",
         "modelRef": "local::director.gguf", "status": "completed"},
        {"id": "s2", "kind": "language_challenge",
         "modelRef": "local::director.gguf", "status": "skipped"},
        {"id": "s3", "kind": "director_scene_plan_2048",
         "modelRef": "local::director.gguf", "status": "interrupted"},
    ]
    model_lab._write_run(run)
    restored = model_lab.get_run(run["id"])
    assert restored["work"]["planned"] == 4
    assert restored["work"]["completed"] == 1
    assert restored["work"]["skipped"] == 1
    assert restored["work"]["remaining"] == 2
    assert restored["work"]["resolved"] == 2


def test_vision_progress_plans_only_supported_probes_for_selected_groups(monkeypatch):
    monkeypatch.setattr(model_lab, "_supported_media", lambda folder, values: list(values))
    basic = model_lab._new_run_payload({
        "folder": "set", "files": ["a.jpg", "b.jpg"], "visionModels": [_vision()],
    })
    assert model_lab._assessment_work(basic)["planned"] == 2
    guided = model_lab._new_run_payload({
        "folder": "set", "files": ["a.jpg", "b.jpg"],
        "visionModels": [_vision()], "groups": [{"group": "Viewpoint", "terms": ["front"]}],
    })
    assert model_lab._assessment_work(guided)["planned"] == 4


def test_dependent_reference_probes_included_in_expected_total(monkeypatch):
    monkeypatch.setattr(model_lab, "_supported_media", lambda folder, values: list(values))
    run = model_lab._new_run_payload({
        "folder": "set", "files": ["a.jpg", "b.jpg"],
        "visionModels": [_vision()], "directorModels": [_director()],
        "referenceVisionRef": "local::vision.gguf",
        "referenceDirectorRef": "local::director.gguf",
    })
    keys = model_lab._planned_probes(run)
    assert len(keys) == 10  # two Vision + four Director + two pairs of reference probes
    assert "set_vocabulary_challenge|local::director.gguf|" in keys
    assert "vision:local::vision.gguf:vocab_challenge|local::director.gguf|" in keys
