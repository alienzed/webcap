import json
from pathlib import Path

import pytest

from tool.server import training_runner
from tool.server.training_runtime import training_runtime_settings


@pytest.fixture(autouse=True)
def isolated_observer(monkeypatch):
    monkeypatch.setattr(training_runner, "_monitor_thread", None)
    monkeypatch.setattr(training_runner, "_handoff_job_id", "")
    monkeypatch.setattr(training_runner, "_startup_checked", True)
    monkeypatch.setattr(training_runner, "_ensure_monitor_started", lambda: None)


@pytest.fixture
def training_root(tmp_path, monkeypatch):
    root = tmp_path / "training"
    root.mkdir()
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    return root


def make_job(root, job_id="job", folder="set", stage="lo"):
    set_dir = root / folder
    set_dir.mkdir(parents=True, exist_ok=True)
    group = root / "output" / "runs" / "001-set"
    bundle = group / ".webcap" / "jobs" / job_id
    output = group / ("wan22-" + stage)
    bundle.mkdir(parents=True)
    output.mkdir(parents=True, exist_ok=True)
    return {
        "id": job_id,
        "folder": folder,
        "stages": stage,
        "profileId": "wan22_t2v",
        "runId": stage,
        "actionRunId": stage,
        "datasetTarget": "normal",
        "modelLabel": "Wan2.2 T2V",
        "createdAt": 10,
        "outputRoot": str(output),
        "effectiveOutputDir": str(output),
        "outputSlug": "wan22-" + stage,
        "launchGroupId": group.name,
        "launchGroupRoot": str(group),
        "artifactDir": str(bundle),
    }


def write_state(root, jobs, recent=None):
    state = {"version": 4, "jobs": jobs, "recentRuns": recent or []}
    training_runner._write_state(state)
    return state


def write_result(job, status, action="", exit_code=0):
    bundle = Path(job["artifactDir"])
    if action:
        (bundle / "action").write_text(action, encoding="utf-8")
    (bundle / "result.json").write_text(
        json.dumps({"status": status, "exitCode": exit_code, "finishedAt": 20}),
        encoding="utf-8",
    )


def test_invalid_existing_queue_state_is_preserved(training_root):
    path = training_root / ".webcap_training" / "queue.json"
    path.parent.mkdir()
    path.write_text("{not json", encoding="utf-8")

    with pytest.raises(training_runner.TrainingStateError, match="left unchanged"):
        training_runner._read_state()

    assert path.read_text(encoding="utf-8") == "{not json"


def test_version_four_state_is_a_fresh_whitelisted_snapshot(training_root):
    job = make_job(training_root)
    job.update(status="running", pid=123, progress={"step": 4}, queuePaused=True)

    training_runner._write_state({
        "version": 4,
        "activeJobId": "job",
        "queuePaused": True,
        "jobs": [job],
        "recentRuns": [],
    })

    saved = json.loads((training_root / ".webcap_training" / "queue.json").read_text(encoding="utf-8"))
    assert saved["version"] == 4
    assert "activeJobId" not in saved
    assert "queuePaused" not in saved
    assert "status" not in saved["jobs"][0]
    assert "pid" not in saved["jobs"][0]
    assert "progress" not in saved["jobs"][0]


def test_version_three_migration_preserves_intent_and_compacts_history(training_root):
    live = make_job(training_root, "live")
    live.update(status="interrupted", pid=99, artifactPath=live["artifactDir"])
    queued = make_job(training_root, "queued", stage="hi")
    queued["status"] = "queued"
    complete = make_job(training_root, "done")
    complete.update(status="completed", finishedAt=30)
    set_history = training_root / "set" / ".webcap_training.json"
    set_history.write_text(json.dumps({
        "version": 3,
        "outputGroup": "001-set",
        "jobs": [{"id": "older", "folder": "set", "status": "failed", "stages": "lo"}],
    }), encoding="utf-8")
    path = training_root / ".webcap_training" / "queue.json"
    path.parent.mkdir()
    path.write_text(json.dumps({
        "version": 3,
        "activeJobId": "live",
        "queuePaused": True,
        "jobs": [live, queued, complete],
    }), encoding="utf-8")

    state = training_runner._read_state()

    assert [job["id"] for job in state["jobs"]] == ["live", "queued"]
    assert {job["id"] for job in state["recentRuns"]} == {"done", "older"}
    assert json.loads(set_history.read_text(encoding="utf-8")) == {
        "version": 4, "outputGroup": "001-set",
    }
    assert json.loads(path.read_text(encoding="utf-8"))["version"] == 4


def test_version_three_migration_leaves_invalid_set_history_untouched(training_root):
    job = make_job(training_root)
    job["status"] = "queued"
    set_history = training_root / "set" / ".webcap_training.json"
    set_history.write_text("{bad", encoding="utf-8")
    path = training_root / ".webcap_training" / "queue.json"
    path.parent.mkdir()
    legacy = {"version": 3, "activeJobId": "", "jobs": [job]}
    path.write_text(json.dumps(legacy), encoding="utf-8")

    with pytest.raises(training_runner.TrainingStateError, match="left unchanged"):
        training_runner._read_state()

    assert json.loads(path.read_text(encoding="utf-8"))["version"] == 3
    assert set_history.read_text(encoding="utf-8") == "{bad"


def test_interrupted_legacy_job_is_derived_running_from_exact_process(training_root, monkeypatch):
    job = make_job(training_root)
    bundle = Path(job["artifactDir"])
    (bundle / "runner.sh").write_text("#!/bin/bash\n", encoding="utf-8")
    (bundle / "pid").write_text("123", encoding="utf-8")
    monkeypatch.setattr(training_runner, "_to_wsl_path", lambda path, distribution="": "/mnt/w/" + Path(path).name)
    expected = training_runner._job_runner_script_wsl(job)
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *args, **kwargs: (0, "bash\n" + expected + "\n", ""))

    view = training_runner._refresh_job(dict(job, status="interrupted"))

    assert view["status"] == "starting"
    assert view["runnerVerified"] is True
    assert view["pid"] == 123


def test_wsl_bundle_path_is_resolved_before_validation(training_root, monkeypatch):
    job = make_job(training_root)
    bundle = Path(job["artifactDir"])
    job["artifactDir"] = "/mnt/w/training/output/runs/001-set/.webcap/jobs/job"
    monkeypatch.setattr(
        training_runner,
        "host_path_for_training_path",
        lambda raw: bundle if str(raw).startswith("/mnt/w/") else Path(raw),
    )

    assert training_runner._job_dir(job) == bundle.resolve()


def test_process_inspection_rejects_a_reused_pid(training_root, monkeypatch):
    job = make_job(training_root)
    bundle = Path(job["artifactDir"])
    (bundle / "runner.sh").write_text("#!/bin/bash\n", encoding="utf-8")
    (bundle / "pid").write_text("123", encoding="utf-8")
    monkeypatch.setattr(training_runner, "_to_wsl_path", lambda path, distribution="": "/mnt/w/" + Path(path).name)
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *args, **kwargs: (0, "python\nother.sh\n", ""))

    assert training_runner._inspect_job_runner(job) == (
        "absent", "Recorded runner PID is now used by a different process.",
    )


def test_reused_pid_is_never_signalled(training_root, monkeypatch):
    job = make_job(training_root)
    bundle = Path(job["artifactDir"])
    (bundle / "pid").write_text("123", encoding="utf-8")
    monkeypatch.setattr(
        training_runner,
        "_inspect_job_runner",
        lambda candidate: ("absent", "Recorded runner PID is now used by a different process."),
    )
    signals = []
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *args, **kwargs: signals.append(args))

    error = training_runner._request_job_action(job, "pause")

    assert "different process" in error
    assert signals == []
    assert not (bundle / "action").exists()


def test_process_inspection_error_is_unconfirmed(training_root, monkeypatch):
    job = make_job(training_root)
    bundle = Path(job["artifactDir"])
    (bundle / "runner.sh").write_text("#!/bin/bash\n", encoding="utf-8")
    (bundle / "pid").write_text("123", encoding="utf-8")
    monkeypatch.setattr(training_runner, "_to_wsl_path", lambda path, distribution="": "/mnt/w/" + Path(path).name)
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *args, **kwargs: (1, "", "WSL timed out"))

    view = training_runner._refresh_job(job)

    assert view["status"] == "unconfirmed"
    assert "WSL timed out" in view["confirmationNote"]


@pytest.mark.parametrize("contents", ["{bad", "[]", '{"status":"mystery"}'])
def test_malformed_result_is_unconfirmed(training_root, contents):
    job = make_job(training_root)
    (Path(job["artifactDir"]) / "result.json").write_text(contents, encoding="utf-8")

    view = training_runner._refresh_job(job)

    assert view["status"] == "unconfirmed"


def test_startup_never_launches_dormant_work(training_root, monkeypatch):
    job = make_job(training_root)
    state = write_state(training_root, [job])
    monkeypatch.setattr(training_runner, "_startup_checked", False)
    launched = []
    monkeypatch.setattr(training_runner, "_launch_job", lambda *args: launched.append(args) or True)

    changed = training_runner._observe_state(state)

    assert changed is False
    assert launched == []
    assert state["jobs"][0]["id"] == "job"
    assert training_runner._handoff_job_id == ""


def test_status_observes_only_the_first_queue_item(training_root, monkeypatch):
    first = make_job(training_root, "first")
    second = make_job(training_root, "second")
    inspected = []
    monkeypatch.setattr(
        training_runner,
        "_refresh_job",
        lambda candidate: inspected.append(candidate["id"]) or dict(candidate, status="queued", stage="queued"),
    )

    views = training_runner._queue_views({"jobs": [first, second], "recentRuns": []})

    assert inspected == ["first"]
    assert [view["status"] for view in views] == ["queued", "queued"]


def test_startup_reattaches_a_live_first_runner(training_root, monkeypatch):
    job = make_job(training_root)
    monkeypatch.setattr(training_runner, "_startup_checked", False)
    monkeypatch.setattr(
        training_runner,
        "_refresh_job",
        lambda candidate: dict(candidate, status="running", stage="lo", runnerVerified=True),
    )

    state = {"version": 4, "jobs": [job], "recentRuns": []}
    training_runner._observe_state(state)

    assert training_runner._handoff_job_id == "job"


def test_live_session_completion_records_history_and_launches_next(training_root, monkeypatch):
    first = make_job(training_root, "first")
    second = make_job(training_root, "second", stage="hi")
    views = {
        "first": dict(first, status="completed", stage="completed", finishedAt=30),
        "second": dict(second, status="queued", stage="queued"),
    }
    monkeypatch.setattr(training_runner, "_refresh_job", lambda candidate: dict(views[candidate["id"]]))
    monkeypatch.setattr(training_runner, "_latest_checkpoint", lambda job: "")
    launched = []
    monkeypatch.setattr(training_runner, "_launch_job", lambda job, folder: launched.append(job["id"]) or True)
    monkeypatch.setattr(training_runner, "_handoff_job_id", "first")
    state = {"version": 4, "jobs": [first, second], "recentRuns": []}

    assert training_runner._observe_state(state) is True

    assert [job["id"] for job in state["jobs"]] == ["second"]
    assert [job["id"] for job in state["recentRuns"]] == ["first"]
    assert launched == ["second"]
    assert training_runner._handoff_job_id == "second"


def test_finish_result_records_finished_early(training_root):
    job = make_job(training_root)
    write_result(job, "stopped", action="finish", exit_code=130)

    view = training_runner._refresh_job(job)

    assert view["status"] == "finished_early"


def test_scheduled_finish_signals_after_the_saved_epoch(training_root, monkeypatch):
    job = make_job(training_root)
    job["finishAfterEpoch"] = 5
    state = {"version": 4, "jobs": [job], "recentRuns": []}
    monkeypatch.setattr(
        training_runner,
        "_refresh_job",
        lambda candidate: dict(candidate, status="running", progress={"epoch": 6}),
    )
    actions = []
    monkeypatch.setattr(training_runner, "_request_job_action", lambda view, action: actions.append(action) or "")

    assert training_runner._observe_state(state) is True
    assert actions == ["finish"]
    assert "finishAfterEpoch" not in state["jobs"][0]


@pytest.mark.parametrize("status", ["failed", "interrupted"])
def test_unexpected_failure_leaves_the_same_job_first(training_root, monkeypatch, status):
    first = make_job(training_root, "first")
    second = make_job(training_root, "second")
    monkeypatch.setattr(training_runner, "_refresh_job", lambda candidate: dict(candidate, status=status, error="boom"))
    launched = []
    monkeypatch.setattr(training_runner, "_launch_job", lambda *args: launched.append(args) or True)
    monkeypatch.setattr(training_runner, "_handoff_job_id", "first")
    state = {"version": 4, "jobs": [first, second], "recentRuns": []}

    assert training_runner._observe_state(state) is False
    assert [job["id"] for job in state["jobs"]] == ["first", "second"]
    assert launched == []
    assert training_runner._handoff_job_id == ""


def test_paused_result_waits_with_checkpoint_on_same_intent(training_root, monkeypatch):
    job = make_job(training_root)
    write_result(job, "stopped", action="pause", exit_code=130)
    monkeypatch.setattr(training_runner, "_latest_checkpoint", lambda candidate: "/mnt/w/run")
    monkeypatch.setattr(
        training_runner,
        "resume_point_from_directory",
        lambda *args: {"checkpointAvailable": True, "step": 10},
    )

    view = training_runner._refresh_job(job)

    assert view["status"] == "queued"
    assert view["resumeFromCheckpoint"] == "/mnt/w/run"
    assert view["resumePoint"]["step"] == 10


def test_resume_retries_from_latest_checkpoint(training_root, monkeypatch):
    job = make_job(training_root)
    state = write_state(training_root, [job])
    monkeypatch.setattr(training_runner, "_latest_checkpoint", lambda candidate: "/mnt/w/run")
    captured = []
    monkeypatch.setattr(training_runner, "_launch_job", lambda candidate, folder: captured.append(candidate) or True)

    payload, status = training_runner.resume_queue_response()

    assert status == 200
    assert payload["ok"] is True
    assert captured[0]["resumeFromCheckpoint"] == "/mnt/w/run"
    assert captured[0]["resumeStage"] == "lo"


def test_resume_without_checkpoint_restarts_from_beginning(training_root, monkeypatch):
    job = make_job(training_root)
    job["resumeFromCheckpoint"] = "/missing"
    write_state(training_root, [job])
    monkeypatch.setattr(training_runner, "_latest_checkpoint", lambda candidate: "")
    captured = []
    monkeypatch.setattr(training_runner, "_launch_job", lambda candidate, folder: captured.append(candidate) or True)

    _, status = training_runner.resume_queue_response()

    assert status == 200
    assert "resumeFromCheckpoint" not in captured[0]
    assert "resumeFromCheckpoint" not in training_runner._read_state()["jobs"][0]


def test_launch_copy_uses_the_current_stage_config(training_root):
    job = make_job(training_root)
    set_config = training_root / "set" / "config.lo.toml"
    set_config.write_text('epochs = 12\noutput_dir = "old"\n', encoding="utf-8")
    bundle = Path(job["artifactDir"])
    (bundle / "run.log").write_text("old attempt", encoding="utf-8")
    (bundle / "result.json").write_text("{}", encoding="utf-8")

    artifacts = training_runner._launch_artifacts(job, {"loConfig": set_config})

    copied = artifacts["loConfig"]
    assert copied.parent == bundle
    assert "epochs = 12" in copied.read_text(encoding="utf-8")
    assert str(job["effectiveOutputDir"]).replace("\\", "/") in copied.read_text(encoding="utf-8")


def test_retry_replaces_prior_bundle_evidence(training_root, monkeypatch):
    job = make_job(training_root)
    bundle = Path(job["artifactDir"])
    config = training_root / "set" / "config.lo.toml"
    config.write_text('output_dir = "old"\n', encoding="utf-8")
    (bundle / "run.log").write_text("old attempt", encoding="utf-8")
    (bundle / "result.json").write_text("{}", encoding="utf-8")
    (bundle / "obsolete-snapshot.toml").write_text("old", encoding="utf-8")
    settings = training_runtime_settings({"diffusion_pipe_wsl": "/home/user/diffusion-pipe"})
    monkeypatch.setattr(
        training_runner,
        "_build_launch_preflight",
        lambda *args: ("set", training_root / "set", {"hiConfig": config, "loConfig": config}, settings, []),
    )
    monkeypatch.setattr(training_runner, "_to_wsl_path", lambda path, distribution="": "/mnt/w/" + Path(path).name)
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *args, **kwargs: (0, "123\n", ""))

    assert training_runner._launch_job(job, training_root / "set") is True

    assert not (bundle / "run.log").exists()
    assert not (bundle / "result.json").exists()
    assert not (bundle / "obsolete-snapshot.toml").exists()
    assert (bundle / "runner.sh").is_file()
    assert (bundle / "config.lo.toml").is_file()


def test_pause_signals_only_the_verified_first_job(training_root, monkeypatch):
    first = make_job(training_root, "first")
    second = make_job(training_root, "second")
    write_state(training_root, [first, second])
    monkeypatch.setattr(
        training_runner,
        "_refresh_job",
        lambda candidate: dict(candidate, status="running", stage="lo") if candidate["id"] == "first" else candidate,
    )
    actions = []
    monkeypatch.setattr(training_runner, "_request_job_action", lambda job, action: actions.append((job["id"], action)) or "")

    payload, status = training_runner.stop_response("first", pause=True)

    assert status == 200
    assert payload["ok"] is True
    assert actions == [("first", "pause")]
    assert [job["id"] for job in training_runner._read_state()["jobs"]] == ["first", "second"]


def test_generic_stop_is_removed(training_root):
    job = make_job(training_root)
    write_state(training_root, [job])

    payload, status = training_runner.stop_response("job")

    assert status == 400
    assert "Use Pause or Finish" in payload["error"]


def test_train_while_waiting_only_appends(training_root, monkeypatch):
    existing = make_job(training_root, "existing")
    write_state(training_root, [existing])
    monkeypatch.setattr(training_runner, "profile_run", lambda *args: ({"id": "profile"}, {"id": "lo", "stages": ["lo"]}))
    monkeypatch.setattr(training_runner, "_build_launch_preflight", lambda *args: ("set", training_root / "set", {}, {}, []))
    queued = make_job(training_root, "new")
    monkeypatch.setattr(training_runner, "_new_job", lambda *args, **kwargs: queued)
    launches = []
    monkeypatch.setattr(training_runner, "_launch_first", lambda state: (launches.append(True), "") or (True, ""))

    payload, status = training_runner.start_response("set", stages="lo")

    assert status == 200
    assert payload["queued"] is True
    assert launches == []
    assert [job["id"] for job in training_runner._read_state()["jobs"]] == ["existing", "new"]


def test_train_with_empty_queue_starts_immediately(training_root, monkeypatch):
    monkeypatch.setattr(training_runner, "profile_run", lambda *args: ({"id": "profile"}, {"id": "lo", "stages": ["lo"]}))
    monkeypatch.setattr(training_runner, "_build_launch_preflight", lambda *args: ("set", training_root / "set", {}, {}, []))
    job = make_job(training_root, "new")
    monkeypatch.setattr(training_runner, "_new_job", lambda *args, **kwargs: job)
    launches = []
    monkeypatch.setattr(training_runner, "_launch_first", lambda state: (launches.append(state["jobs"][0]["id"]) or True, ""))

    payload, status = training_runner.start_response("set", stages="lo")

    assert status == 200
    assert payload["queued"] is False
    assert launches == ["new"]


def test_cancel_waiting_job_removes_only_its_bundle(training_root):
    job = make_job(training_root)
    bundle = Path(job["artifactDir"])
    output = Path(job["outputRoot"])
    (bundle / "queued-config.toml").write_text("owned", encoding="utf-8")
    (output / "checkpoint.safetensors").write_text("trainer", encoding="utf-8")
    write_state(training_root, [job])

    payload, status = training_runner.stop_response("job", cancel=True)

    assert status == 200
    assert payload["bundleDeleted"] is True
    assert not bundle.exists()
    assert (output / "checkpoint.safetensors").is_file()
    assert training_runner._read_state()["jobs"] == []


def test_clear_recent_run_removes_bundle_but_not_trainer_output(training_root):
    job = make_job(training_root)
    job.update(status="completed", finishedAt=20)
    bundle = Path(job["artifactDir"])
    output = Path(job["outputRoot"])
    (bundle / "run.log").write_text("log", encoding="utf-8")
    (output / "checkpoint.safetensors").write_text("trainer", encoding="utf-8")
    write_state(training_root, [], [job])

    payload, status = training_runner.clear_history_response("set", "job")

    assert status == 200
    assert payload["bundleDeleted"] is True
    assert not bundle.exists()
    assert output.is_dir()
    assert training_runner._read_state()["recentRuns"] == []


def test_runner_script_has_atomic_results_and_no_emergency_stop(tmp_path, monkeypatch):
    config = tmp_path / "config.lo.toml"
    config.write_text("epochs = 2", encoding="utf-8")
    monkeypatch.setattr(training_runner, "_to_wsl_path", lambda path, distribution="": "/mnt/w/" + Path(path).name)
    settings = training_runtime_settings({"diffusion_pipe_wsl": "/home/user/diffusion-pipe"})

    script, _ = training_runner._build_runner_script(
        {"stages": "lo"},
        settings,
        {"hiConfig": config, "loConfig": config},
        tmp_path / "job",
    )

    assert 'mv -f "$tmp" "$RESULT_FILE"' in script
    assert "pause|finish" in script
    assert "pause|finish|stop" not in script


def test_log_response_reads_central_recent_history(training_root):
    job = make_job(training_root)
    log = Path(job["artifactDir"]) / "run.log"
    log.write_text("hello", encoding="utf-8")
    job.update(status="completed", finishedAt=20)
    write_state(training_root, [], [job])

    payload, status = training_runner.log_response("job", folder="set")

    assert status == 200
    assert payload["text"] == "hello"


def test_historical_resume_without_checkpoint_is_rejected_before_creation(monkeypatch):
    created = []
    monkeypatch.setattr(training_runner, "_new_job", lambda *args, **kwargs: created.append(True))

    payload, status = training_runner.start_response("set", parent_job_id="old")

    assert status == 400
    assert "requires a checkpoint path" in payload["error"]
    assert created == []
