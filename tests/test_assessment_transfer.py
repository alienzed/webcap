import copy

import pytest

from tool.server import assessment_transfer as transfer, model_lab, director_model_calibration as calibration


@pytest.fixture(autouse=True)
def isolate(monkeypatch, tmp_path):
    monkeypatch.setattr(model_lab, "run_root", lambda: tmp_path / "runs")
    monkeypatch.setattr(calibration, "_path", lambda: tmp_path / "reports.json")


def bundle():
    model = {"modelRef": "remote-1::model:q4", "modelId": "model:q4", "runtimeId": "remote-1"}
    return {"format": "webcap-assessments", "version": 1, "sourceHost": "source",
            "exportedAt": "2026-10-18T00:00:00Z", "reports": [], "runs": [{
                "id": "run-1", "version": 1, "status": "completed", "startedAt": "2026-10-17T00:00:00Z",
                "directorModels": [model], "attempts": [
                    {"kind": "director_writing", "modelRef": model["modelRef"], "status": "completed",
                     "result": {"text": "actual evidence"}},
                    {"kind": "vision_open", "modelRef": model["modelRef"], "status": "failed", "error": "empty response"},
                    {"kind": "vision_open", "modelRef": model["modelRef"], "status": "completed"}],
            }]}


def test_roundtrip_remaps_runtime_preserves_evidence_and_deduplicates():
    data = bundle()
    assert transfer.import_results(data, {"remote-1": "local"})["runsImported"] == 1
    run = model_lab.get_run(model_lab.list_runs()[0]["id"])
    assert run["attempts"][0]["modelRef"] == "local::model:q4"
    assert run["attempts"][0]["result"]["text"] == "actual evidence"
    assert run["importedFrom"]["host"] == "source"
    assert transfer.import_results(data, {"remote-1": "local"})["runsAlreadyPresent"] == 1
    data["exportedAt"] = "2026-10-19T00:00:00Z"
    assert transfer.import_results(data, {"remote-1": "local"})["runsAlreadyPresent"] == 1
    exported = transfer.export_results()
    assert transfer.import_results(exported, {"local": "local"})["runsAlreadyPresent"] == 1
    with pytest.raises(ValueError, match="historical evidence"):
        model_lab.resume_run(run["id"])


def test_malformed_or_active_bundle_does_not_partially_import():
    data = bundle()
    data["runs"].append({**copy.deepcopy(data["runs"][0]), "id": "run-2", "status": "running"})
    with pytest.raises(ValueError, match="finished or interrupted"):
        transfer.import_results(data, {"remote-1": "local"})
    assert model_lab.list_runs() == []
    with pytest.raises(ValueError, match="destination runtime"):
        transfer.import_results(bundle(), {})
    assert model_lab.list_runs() == []


def test_importing_own_export_does_not_duplicate_local_runs():
    data = bundle()
    model_lab._write_run(data["runs"][0])
    result = transfer.import_results(data, {"remote-1": "remote-1"})
    assert result["runsImported"] == 0
    assert result["runsAlreadyPresent"] == 1
    assert len(model_lab.list_runs()) == 1


def test_export_excludes_live_work(monkeypatch):
    run = bundle()["runs"][0]
    run["status"] = "running"
    model_lab._write_run(run)
    monkeypatch.setattr(model_lab, "_active", {run["id"]: {"thread": True}})
    exported = transfer.export_results()
    assert exported["activeRunsExcluded"] == 1
    assert exported["runs"] == []
    assert model_lab._read_raw(run["id"])["status"] == "running"


def test_summary_does_not_hide_earlier_failures():
    transfer.import_results(bundle(), {"remote-1": "local"})
    result = model_lab.capability_run_summaries()[0]["models"]["local::model:q4"]["vision_open"]
    assert result["status"] == "completed"
    assert result["counts"] == {"completed": 1}
    assert len(model_lab.get_run(model_lab.list_runs()[0]["id"])["attempts"]) == 3
    assert result["error"] == ""  # recovered failures remain in raw history, not the current verdict


@pytest.mark.parametrize("result,expected", [
    ({"text": "", "reasoning": "thinking", "finishReason": "length"}, "failed"),
    ({"text": "bad json", "structureWarning": "Invalid Sight JSON"}, "failed"),
    ({"text": "answer", "sight": {"description": "valid"}}, "completed"),
])
def test_vision_probe_keeps_raw_evidence_but_does_not_count_invalid_answers_as_success(monkeypatch, result, expected):
    from tool.server import llm_runner
    run = {**bundle()["runs"][0], "attempts": [], "progress": {}, "options": {"activeTimeoutSeconds": 20}}
    monkeypatch.setattr(llm_runner, "job_status", lambda *args, **kwargs: {"status": "completed", "result": result})
    attempt = model_lab._probe_job(run, kind="vision_open", role="vision", model_ref="remote-1::model:q4",
                                   enqueue=lambda: {"id": "job-1"})
    assert attempt["status"] == expected
    assert attempt["result"] == result
    if expected == "failed":
        assert attempt["error"]


def test_import_reports_preserves_newer_evidence_and_runtime_profiles():
    data = bundle()
    report = {"modelRef": "remote-1::model:q4", "modelId": "model:q4", "runtimeId": "remote-1",
              "contextMode": "runtime", "status": "complete", "attempts": [], "updatedAt": "2026-10-17T00:00:00Z"}
    data["reports"] = [report]
    calibration._write_document({"version": 1, "profiles": {"unrelated": {"contextSize": 8192}}, "reports": {}})
    assert transfer.import_results(data, {"remote-1": "local"})["reportsImported"] == 1
    saved = calibration.get_report("local::model:q4")
    assert saved["updatedAt"] == report["updatedAt"]
    assert saved["importedFrom"]["modelRef"] == report["modelRef"]
    calibration.save_report({**report, "modelRef": "local::model:q4", "runtimeId": "local"})
    assert transfer.import_results(data, {"remote-1": "local"})["reportsImported"] == 0
    assert calibration._read_document()["profiles"] == {"unrelated": {"contextSize": 8192}}
