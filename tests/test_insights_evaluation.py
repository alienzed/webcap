from concurrent.futures import ThreadPoolExecutor

import pytest

from tool.server import epoch_test_bench as bench, llm_runner


@pytest.fixture
def sessions(tmp_path, monkeypatch):
    directories = []
    monkeypatch.setattr(bench, "_session_directories", lambda folder: directories)
    monkeypatch.setattr(bench, "_session_directory", lambda folder, name: tmp_path / name)
    monkeypatch.setattr(bench, "_relative_set_folder", lambda folder: "set-a")
    monkeypatch.setattr(bench, "_session_vision_state", lambda directory: {})
    monkeypatch.setattr(bench, "open_session", lambda *args: {"wildcardEvaluationGroups": []})
    monkeypatch.setattr(bench, "resolve_result_media", lambda folder, session, media: tmp_path / media)

    def create(name, media, **extra):
        directory = tmp_path / name
        directory.mkdir()
        bench._atomic_write_json(directory / "test.json", {
            "status": "complete", "results": [{"mediaFile": value} for value in media], **extra,
        })
        directories.append(directory)
        return directory

    return create


def test_progress_counts_saved_active_failed_absent_and_unavailable(tmp_path, monkeypatch, sessions):
    sessions("a", ["done.mp4", "queued.mp4", "failed.mp4", "absent.mp4", "gone.mp4"],
             autoVlJobs={"queued.mp4": "q", "failed.mp4": "f", "absent.mp4": "old"})
    sessions("b", ["running.mp4", "missing.mp4"], autoVlJobs={"running.mp4": "r"})
    sessions("staging", ["excluded.mp4"], campaignStaging=True)
    monkeypatch.setattr(bench, "_session_vision_state", lambda directory: {"byMedia": {"done.mp4": {"text": "Saved"}}})

    def state(job_id):
        if job_id == "old":
            raise FileNotFoundError(job_id)
        return {"status": {"q": "queued", "f": "failed", "r": "running"}[job_id]}

    def media(folder, session, name):
        if name == "gone.mp4":
            raise FileNotFoundError(name)
        return tmp_path / name

    monkeypatch.setattr(llm_runner, "job_status", state)
    monkeypatch.setattr(bench, "resolve_result_media", media)
    assert bench.evaluation_progress(tmp_path) == {
        "total": 6, "completed": 1, "queued": 1, "running": 1,
        "failed": 1, "stopped": 0, "unavailable": 1, "missing": 2, "remaining": 5, "actionable": 3,
    }


def test_explicit_missing_retry_preserves_saved_evidence_and_prevents_duplicate_submissions(tmp_path, monkeypatch, sessions):
    sessions("a", ["done.mp4", "missing.mp4", "failed.mp4"], autoVlJobs={"failed.mp4": "failed"})
    monkeypatch.setattr(bench, "_session_vision_state", lambda directory: {"byMedia": {"done.mp4": {"text": "Author assessment"}}})
    calls = []

    def enqueue(client, model, request, **kwargs):
        calls.append((model, kwargs["context"]["testMedia"]))
        return {"jobId": "new-" + str(len(calls))}

    monkeypatch.setattr(llm_runner, "enqueue", enqueue)
    monkeypatch.setattr(llm_runner, "job_status", lambda job: {"status": "failed" if job == "failed" else "queued"})
    assert bench.evaluate_missing(tmp_path, "selected-vision")["submitted"] == 2
    assert bench.evaluate_missing(tmp_path, "selected-vision")["submitted"] == 0
    assert calls == [("selected-vision", "missing.mp4"), ("selected-vision", "failed.mp4")]


def test_two_tabs_admit_only_one_job_for_a_preview(tmp_path, monkeypatch, sessions):
    sessions("a", ["one.mp4"])
    calls = []
    monkeypatch.setattr(llm_runner, "enqueue", lambda *args, **kwargs: calls.append(kwargs) or {"jobId": "one-job"})
    monkeypatch.setattr(llm_runner, "job_status", lambda job: {"status": "queued"})
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda _: bench._queue_test_auto_vl(tmp_path, "a", "one.mp4", "vision"), range(2)))
    assert len(calls) == 1
    assert bench._read_status(tmp_path / "a")["autoVlJobs"] == {"one.mp4": "one-job"}


def test_stop_only_cancels_this_sets_outstanding_test_jobs(tmp_path, monkeypatch, sessions):
    sessions("a", ["queued.mp4", "running.mp4", "failed.mp4"],
             autoVlJobs={"queued.mp4": "q", "running.mp4": "r", "failed.mp4": "f"})
    cancelled = []
    monkeypatch.setattr(llm_runner, "job_status", lambda job: {"status": {"q": "queued", "r": "running", "f": "failed"}[job]})
    monkeypatch.setattr(llm_runner, "cancel_job", lambda job: cancelled.append(job))
    assert bench.stop_missing_evaluation(tmp_path)["stopped"] == 2
    assert cancelled == ["q", "r"]


def test_stopped_evaluations_are_retryable_without_being_reported_as_failed(tmp_path, monkeypatch, sessions):
    sessions("a", ["one.mp4"], autoVlJobs={"one.mp4": "cancelled"})
    monkeypatch.setattr(llm_runner, "job_status", lambda job: {"status": "cancelled"})
    result = bench.evaluation_progress(tmp_path)
    assert result["stopped"] == 1
    assert result["failed"] == 0
    assert result["actionable"] == 1


def test_submission_error_remains_visible_and_recorded(tmp_path, monkeypatch, sessions):
    directory = sessions("a", ["one.mp4"])
    def fail(*args, **kwargs):
        raise RuntimeError("Vision endpoint unavailable")
    monkeypatch.setattr(llm_runner, "enqueue", fail)
    with pytest.raises(RuntimeError, match="Vision endpoint unavailable"):
        bench.evaluate_missing(tmp_path, "vision")
    assert "Vision endpoint unavailable" in bench._read_status(directory)["autoVlErrors"][0]


@pytest.mark.parametrize("state", ["stopping", "stopped"])
def test_late_auto_vl_respects_stop_but_explicit_evaluate_is_a_new_request(tmp_path, monkeypatch, sessions, state):
    sessions("a", ["one.mp4"], status=state, autoVlModel="automatic-model")
    submitted = []
    monkeypatch.setattr(llm_runner, "enqueue", lambda *args, **kwargs: submitted.append(args[1]) or {"jobId": "explicit"})
    bench._queue_test_auto_vl(tmp_path, "a", "one.mp4")
    assert not submitted
    assert bench._queue_test_auto_vl(tmp_path, "a", "one.mp4", model_override="selected-vision") == "explicit"
    assert submitted == ["selected-vision"]
