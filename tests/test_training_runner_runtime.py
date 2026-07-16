from pathlib import Path

from tool.server import training_runner
from tool.server import training_history
from tool.server import config as config_module
from tool.server.training_runtime import training_runtime_settings


def test_runner_script_uses_conda_run_without_sourcing_an_activation_script(tmp_path, monkeypatch):
    hi_path = tmp_path / "config.hi.toml"
    lo_path = tmp_path / "config.lo.toml"
    hi_path.write_text("hi", encoding="utf-8")
    lo_path.write_text("lo", encoding="utf-8")
    monkeypatch.setattr(
        training_runner,
        "_to_wsl_path",
        lambda path, distribution="": "/mnt/c/" + path.name,
    )
    settings = training_runtime_settings({
        "diffusion_pipe_wsl": "/home/user/diffusion-pipe",
        "wsl_distribution": "Ubuntu_W",
        "conda_executable": "/home/user/miniconda3/bin/conda",
        "conda_environment": "dp-clean",
        "activate_script": "/home/user/project/.venv/bin/activate",
    })

    script, _ = training_runner._build_runner_script(
        {"snapshot": {}},
        settings,
        {"hiConfig": hi_path, "loConfig": lo_path},
        tmp_path / "job",
    )

    assert "source /home/user/project/.venv/bin/activate" not in script
    assert "/home/user/miniconda3/bin/conda run --no-capture-output --name dp-clean deepspeed" in script
    assert "training working directory is unavailable" in script
    assert "ACTION_FILE=" in script
    assert "finish_requested_stop" in script


def test_wsl_path_conversion_keeps_existing_wsl_paths(monkeypatch):
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("wslpath should not run")))

    assert training_runner._to_wsl_path("/mnt/w/training/config.hi.toml", "Ubuntu_W") == "/mnt/w/training/config.hi.toml"


def test_gpu_snapshot_reports_compact_gpu_and_process_data(monkeypatch):
    commands = []
    monkeypatch.setattr(training_runner, "_training_settings", lambda: {"wslDistribution": "Ubuntu_W"})

    def fake_run(command, **kwargs):
        commands.append((command, kwargs))
        if "--query-gpu" in command:
            return 0, "0, NVIDIA RTX, 92, 18842, 24576, 67, 302.14\n", ""
        return 0, "1234, python, 18600\n", ""

    monkeypatch.setattr(training_runner, "_run_wsl", fake_run)

    payload, status = training_runner.gpu_status_response()

    assert status == 200
    assert payload["gpu"]["available"] is True
    assert payload["gpu"]["gpus"] == [{
        "index": "0", "name": "NVIDIA RTX", "utilization": "92", "memoryUsed": "18842",
        "memoryTotal": "24576", "temperature": "67", "powerDraw": "302.14",
    }]
    assert payload["gpu"]["processes"] == [{"pid": "1234", "name": "python", "memoryUsed": "18600"}]
    assert len(commands) == 2
    assert all(kwargs["distribution"] == "Ubuntu_W" for _, kwargs in commands)


def test_gpu_snapshot_reports_unavailable_without_raising(monkeypatch):
    monkeypatch.setattr(training_runner, "_training_settings", lambda: {"wslDistribution": "Ubuntu_W"})
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *args, **kwargs: (127, "", "nvidia-smi not found"))

    payload, status = training_runner.gpu_status_response()

    assert status == 200
    assert payload["gpu"]["available"] is False
    assert payload["gpu"]["gpus"] == []
    assert payload["gpu"]["error"] == "nvidia-smi not found"


def test_native_wsl_runner_uses_the_current_bash_shell(monkeypatch):
    captured = {}

    class Result:
        returncode = 0
        stdout = "ok"
        stderr = ""

    def fake_run(args, **kwargs):
        captured["args"] = args
        return Result()

    monkeypatch.setattr(training_runner.os, "name", "posix")
    monkeypatch.setattr(training_runner.subprocess, "run", fake_run)

    assert training_runner._run_wsl("echo ok", distribution="Ubuntu_W") == (0, "ok", "")
    assert captured["args"] == ["bash", "-lc", "echo ok"]


def test_runner_script_can_run_only_the_lo_stage(tmp_path, monkeypatch):
    hi_path = tmp_path / "config.hi.toml"
    lo_path = tmp_path / "config.lo.toml"
    hi_path.write_text("hi", encoding="utf-8")
    lo_path.write_text("lo", encoding="utf-8")
    monkeypatch.setattr(training_runner, "_to_wsl_path", lambda path, distribution="": "/mnt/w/" + path.name)
    settings = training_runtime_settings({"diffusion_pipe_wsl": "/home/user/diffusion-pipe"})

    script, _ = training_runner._build_runner_script(
        {"snapshot": {}, "stages": "lo", "resumeFromCheckpoint": "/mnt/w/output/run-1"},
        settings,
        {"hiConfig": hi_path, "loConfig": lo_path},
        tmp_path / "job",
    )

    assert "[webcap] stage=hi" not in script
    assert "[webcap] stage=lo" in script
    assert "[webcap] resume stage=lo checkpoint=/mnt/w/output/run-1" in script
    assert "[webcap] command lo:" in script
    assert "--resume_from_checkpoint /mnt/w/output/run-1" in script


def test_discovered_resume_path_is_the_run_directory_not_its_latest_marker(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    output_root = tmp_path / "output"
    run = output_root / "20260716_08-31-48"
    folder.mkdir()
    run.mkdir(parents=True)
    (run / "config.lo.toml").write_text("lo", encoding="utf-8")
    (run / "global_step10800").mkdir()
    (run / "latest").write_text("global_step10800", encoding="utf-8")
    monkeypatch.setattr(training_history, "output_root_for_folder", lambda *args: output_root)
    monkeypatch.setattr(training_history, "output_root_path_for_folder", lambda *args: "/mnt/w/output")

    runs = training_history.discover_runs(folder, "lo")

    assert len(runs) == 1
    assert runs[0]["path"] == "/mnt/w/output/20260716_08-31-48"
    assert runs[0]["checkpointAvailable"] is True
    assert runs[0]["checkpointName"] == "latest"


def test_new_runner_binds_the_first_new_matching_run_directory(monkeypatch):
    job = {
        "folder": "set", "stages": "lo", "status": "running",
        "outputRunPathsAtLaunch": ["/mnt/w/output/older-run"],
    }
    monkeypatch.setattr(training_runner.app_config, "safe_join_fs_root", lambda folder: folder)
    monkeypatch.setattr(training_runner, "discover_runs", lambda folder, stage: [
        {"path": "/mnt/w/output/older-run"},
        {"path": "/mnt/w/output/20260716_08-31-48"},
    ])

    training_runner._bind_job_run_path(job)

    assert job["outputRunPath"] == "/mnt/w/output/20260716_08-31-48"


def test_paused_job_uses_its_bound_run_path_before_legacy_discovery(monkeypatch):
    job = {"folder": "set", "stages": "lo", "status": "paused", "outputRunPath": "/mnt/w/output/run"}
    monkeypatch.setattr(training_runner.app_config, "safe_join_fs_root", lambda folder: folder)
    monkeypatch.setattr(training_runner, "resumable_run_for_path", lambda folder, stage, path: {"path": path})
    monkeypatch.setattr(training_runner, "ranked_resumable_runs", lambda *args: (_ for _ in ()).throw(AssertionError("bound path should win")))

    assert training_runner._prepare_paused_job_for_resume(job) == ""
    assert job["resumeFromCheckpoint"] == "/mnt/w/output/run"


def test_paused_queue_does_not_launch_the_next_job(monkeypatch):
    state = {"queuePaused": True, "activeJobId": "", "jobs": [{"id": "next", "status": "queued", "folder": "set"}]}
    monkeypatch.setattr(training_runner, "_launch_job", lambda *args: (_ for _ in ()).throw(AssertionError("queue must remain held")))

    training_runner._start_next(state)

    assert state["activeJobId"] == ""


def test_new_job_keeps_large_snapshots_under_the_output_sidecar(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    dataset = folder / "auto_dataset"
    dataset.mkdir(parents=True)
    for name in ("config.hi.toml", "config.lo.toml", "dataset.hi.toml", "dataset.lo.toml"):
        (folder / name).write_text("model_path = 'models/example.safetensors'\n", encoding="utf-8")
    (dataset / "training_plan.json").write_text('{"mode": "poc", "stages": {}}', encoding="utf-8")
    (dataset / "prep_manifest.json").write_text('{"images": [], "videos": []}', encoding="utf-8")
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_training_settings", lambda: {"wslDistribution": ""})

    job = training_runner._new_job("set", {"checks": [], "summary": {"blockers": 0}}, "hi")

    artifact = Path(job["artifactPath"])
    assert artifact.is_dir()
    assert ".webcap" in artifact.parts
    assert (artifact / "config.hi.toml").is_file()
    assert (artifact / "dataset.hi.toml").is_file()
    assert job["profile"] == "poc"
    assert job["model"]["source"] == "models/example.safetensors"


def test_model_identity_keeps_the_specific_wan_checkpoint_name(tmp_path):
    config = tmp_path / "config.hi.toml"
    config.write_text('ckpt_path = "/models/Wan2.2-T2V-A14B"\n', encoding="utf-8")

    model = training_runner._model_identity({"hiConfig": config, "loConfig": config})

    assert model == {
        "label": "Wan2.2-T2V-A14B",
        "source": "/models/Wan2.2-T2V-A14B",
    }


def test_start_next_resumes_a_paused_item_before_later_queued_work(monkeypatch):
    paused = {"id": "paused", "status": "paused", "folder": "penny", "stages": "lo"}
    queued = {"id": "next", "status": "queued", "folder": "sue", "stages": "hi"}
    state = {"queuePaused": False, "activeJobId": "", "jobs": [paused, queued]}
    launched = []
    monkeypatch.setattr(training_runner, "_prepare_paused_job_for_resume", lambda job: job.update(status="queued") or "")
    monkeypatch.setattr(training_runner.app_config, "safe_join_fs_root", lambda folder: folder)
    monkeypatch.setattr(training_runner, "_launch_job", lambda job, folder: launched.append(job["id"]) or job.update(status="starting"))

    training_runner._start_next(state)

    assert launched == ["paused"]
    assert state["activeJobId"] == "paused"
    assert queued["status"] == "queued"


def test_paused_job_resumes_the_latest_checkpoint_from_its_stage_artifacts(monkeypatch):
    job = {"folder": "set", "stages": "lo", "status": "paused", "actionRequested": "pause"}
    monkeypatch.setattr(training_runner.app_config, "safe_join_fs_root", lambda folder: folder)
    monkeypatch.setattr(training_runner, "ranked_resumable_runs", lambda folder, stage, job: [
        {"path": "this-job-run", "checkpointAvailable": True, "modifiedAt": 110},
        {"path": "older-run", "checkpointAvailable": True, "modifiedAt": 90},
    ])

    assert training_runner._prepare_paused_job_for_resume(job) == ""
    assert job["resumeFromCheckpoint"] == "this-job-run"
    assert "actionRequested" not in job


def test_paused_job_without_checkpoint_starts_a_fresh_run(monkeypatch):
    job = {
        "folder": "set", "stages": "lo", "status": "paused",
        "actionRequested": "pause", "resumeFromCheckpoint": "stale-path", "resumeStage": "lo",
    }
    monkeypatch.setattr(training_runner.app_config, "safe_join_fs_root", lambda folder: folder)
    monkeypatch.setattr(training_runner, "ranked_resumable_runs", lambda folder, stage, job: [])

    assert training_runner._prepare_paused_job_for_resume(job) == ""
    assert job["status"] == "queued"
    assert job["resumeFromCheckpoint"] == ""
    assert job["resumeStage"] == ""
    assert "actionRequested" not in job


def test_user_paused_job_from_legacy_state_stays_at_the_front_of_the_queue(monkeypatch):
    paused = {"id": "paused", "folder": "penny", "stages": "lo", "status": "paused", "createdAt": 1}
    state = {
        "activeJobId": "",
        "queuePaused": True,
        "queuePauseReason": "Queue paused by the user.",
        "jobs": [paused, {"id": "next", "folder": "sue", "stages": "hi", "status": "queued", "createdAt": 2}],
    }
    monkeypatch.setattr(training_runner, "_startup_reconciled", False)

    training_runner._apply_restart_hold(state)

    assert state["activeJobId"] == ""
    assert state["queuePauseReason"] == "Queue paused by the user."


def test_restart_hold_keeps_an_active_run_handing_off_to_its_queue(monkeypatch):
    state = {
        "queuePaused": False,
        "queuePauseReason": "",
        "activeJobId": "active",
        "jobs": [
            {"id": "active", "status": "running", "folder": "set"},
            {"id": "next", "status": "queued", "folder": "set"},
        ],
    }
    monkeypatch.setattr(training_runner, "_startup_reconciled", False)

    training_runner._apply_restart_hold(state)

    assert state["queuePaused"] is False
    assert state["queuePauseReason"] == ""


def test_restart_hold_keeps_a_dormant_queue_from_starting_unattended(monkeypatch):
    state = {
        "queuePaused": False,
        "queuePauseReason": "",
        "activeJobId": "",
        "jobs": [{"id": "next", "status": "queued", "folder": "set"}],
    }
    monkeypatch.setattr(training_runner, "_startup_reconciled", False)

    training_runner._apply_restart_hold(state)

    assert state["queuePaused"] is True
    assert state["queuePauseReason"] == "Queue held after WebCap restarted."


def test_runner_progress_estimates_stage_and_overall_from_epoch_logs(tmp_path):
    hi_path = tmp_path / "config.hi.toml"
    lo_path = tmp_path / "config.lo.toml"
    hi_path.write_text("epochs = 50\n", encoding="utf-8")
    lo_path.write_text("epochs = 90\n", encoding="utf-8")
    job = {
        "stage": "hi",
        "stages": "both",
        "snapshot": {"hi": str(hi_path), "lo": str(lo_path)},
    }

    training_runner._sync_job_progress(
        job,
        "Started new epoch: 38\n[INFO] [Rank 0] step=4160, skipped=0\n",
    )

    assert job["progress"] == {
        "stage": "hi",
        "epoch": 38,
        "epochs": 50,
        "step": 4160,
        "stagePercent": 76.0,
        "overallPercent": 27.1,
        "estimated": False,
        "source": "epochs",
    }

    training_runner._sync_job_progress(job, "[INFO] [Rank 0] step=4170, skipped=0\n")

    assert job["progress"]["epoch"] == 38
    assert job["progress"]["step"] == 4170


def test_runner_progress_uses_generated_step_plan_without_an_epoch_marker(tmp_path):
    hi_path = tmp_path / "config.hi.toml"
    lo_path = tmp_path / "config.lo.toml"
    hi_path.write_text("epochs = 50\n", encoding="utf-8")
    lo_path.write_text("epochs = 90\n", encoding="utf-8")
    job = {
        "stage": "lo",
        "stages": "both",
        "snapshot": {"hi": str(hi_path), "lo": str(lo_path)},
        "progressPlan": {
            "hi": {"estimatedSteps": 5000},
            "lo": {"estimatedSteps": 20000},
        },
    }

    training_runner._sync_job_progress(job, "[INFO] [Rank 0] step=9700, skipped=0, iter time (s): 3.0\n")

    assert job["progress"] == {
        "stage": "lo",
        "epoch": None,
        "epochs": 90,
        "step": 9700,
        "stagePercent": 48.5,
        "overallPercent": 58.8,
        "estimated": True,
        "plannedSteps": 20000,
        "source": "steps",
        "etaSeconds": 30900,
    }


def test_runner_progress_prefers_logged_epochs_over_the_generated_step_estimate(tmp_path):
    lo_path = tmp_path / "config.lo.toml"
    lo_path.write_text("epochs = 90\n", encoding="utf-8")
    job = {
        "stage": "lo",
        "stages": "lo",
        "snapshot": {"lo": str(lo_path)},
        "progressPlan": {"lo": {"estimatedSteps": 20000}},
    }

    training_runner._sync_job_progress(
        job,
        "Started new epoch: 85\n[INFO] [Rank 0] step=9410, skipped=0, iter time (s): 3.0\n",
    )

    assert job["progress"] == {
        "stage": "lo",
        "epoch": 85,
        "epochs": 90,
        "step": 9410,
        "stagePercent": 94.4,
        "overallPercent": 94.4,
        "estimated": False,
        "source": "epochs",
    }


def test_completed_job_flags_a_result_far_below_the_step_estimate_without_epoch_progress():
    job = {
        "status": "completed",
        "progress": {"step": 1650, "plannedSteps": 20000},
    }

    training_runner._annotate_completed_job(job)

    assert "step 1,650" in job["completionNote"]
    assert "~20,000 planned steps" in job["completionNote"]


def test_completed_job_uses_logged_epochs_instead_of_a_stale_step_estimate():
    job = {
        "status": "completed",
        "completionNote": "Finished at step 10,080 of ~20,000 planned steps.",
        "progress": {"epoch": 90, "epochs": 90, "step": 10080, "plannedSteps": 20000, "source": "epochs"},
    }

    training_runner._annotate_completed_job(job)

    assert "completionNote" not in job


def test_finish_action_records_a_finished_early_outcome(monkeypatch):
    job = {
        "id": "finished-early",
        "status": "running",
        "actionRequested": "finish",
        "progress": {"epoch": 85, "epochs": 90, "step": 9410},
    }
    monkeypatch.setattr(
        training_runner,
        "_read_result",
        lambda candidate: {"status": "stopped", "exitCode": 130, "finishedAt": 123.0},
    )

    training_runner._refresh_job(job)

    assert job["status"] == "finished_early"
    assert job["completionNote"] == "Finished early by the user at epoch 85 / 90 · step 9,410"


def test_runner_result_overrides_a_finish_request_when_the_job_completed(monkeypatch):
    job = {"id": "completed", "status": "stopping", "actionRequested": "finish"}
    monkeypatch.setattr(
        training_runner,
        "_read_result",
        lambda candidate: {"status": "completed", "exitCode": 0, "finishedAt": 123.0},
    )

    training_runner._refresh_job(job)

    assert job["status"] == "completed"


def test_finish_request_waits_for_the_runner_result(tmp_path, monkeypatch):
    active = {"id": "active", "status": "running", "pid": 42, "progress": {"epoch": 85, "epochs": 90}}
    state = {
        "activeJobId": "active",
        "queuePaused": True,
        "queuePauseReason": "Queue held after WebCap restarted.",
        "jobs": [active, {"id": "next", "status": "queued", "folder": "set"}],
    }
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_apply_restart_hold", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *args, **kwargs: (0, "", ""))
    monkeypatch.setattr(training_runner, "_write_state", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_job_action_path", lambda job: tmp_path / "action")

    payload, status = training_runner.stop_response("active", finish=True)

    assert status == 200
    assert payload["job"]["status"] == "stopping"
    assert payload["job"]["actionRequested"] == "finish"
    assert "Waiting for the runner result" in payload["job"]["confirmationNote"]
    assert state["activeJobId"] == "active"
    assert state["queuePaused"] is True


def test_pause_request_waits_for_the_runner_result(tmp_path, monkeypatch):
    active = {"id": "active", "status": "running", "pid": 42}
    state = {
        "activeJobId": "active",
        "queuePaused": False,
        "queuePauseReason": "",
        "jobs": [active, {"id": "next", "status": "queued", "folder": "set"}],
    }
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_apply_restart_hold", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *args, **kwargs: (0, "", ""))
    monkeypatch.setattr(training_runner, "_write_state", lambda candidate: None)
    action_path = tmp_path / "action"
    monkeypatch.setattr(training_runner, "_job_action_path", lambda job: action_path)

    payload, status = training_runner.stop_response("active", pause=True)

    assert status == 200
    assert payload["job"]["status"] == "stopping"
    assert payload["job"]["actionRequested"] == "pause"
    assert state["activeJobId"] == "active"
    assert state["queuePaused"] is False
    assert action_path.read_text(encoding="utf-8") == "pause"


def test_stop_request_failure_does_not_change_the_recorded_job_state(tmp_path, monkeypatch):
    active = {"id": "active", "status": "running", "pid": 42}
    state = {"activeJobId": "active", "queuePaused": False, "jobs": [active]}
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_apply_restart_hold", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *args, **kwargs: (1, "", "no such process"))
    monkeypatch.setattr(training_runner, "_write_state", lambda candidate: None)
    action_path = tmp_path / "action"
    monkeypatch.setattr(training_runner, "_job_action_path", lambda job: action_path)

    payload, status = training_runner.stop_response("active", pause=True)

    assert status == 502
    assert active["status"] == "running"
    assert "actionRequested" not in active
    assert payload["error"] == "no such process"
    assert not action_path.exists()


def test_pause_result_is_recorded_as_paused_even_when_the_trainer_exits_nonzero(monkeypatch):
    job = {"id": "paused", "status": "stopping", "actionRequested": "pause"}
    monkeypatch.setattr(
        training_runner,
        "_read_result",
        lambda candidate: {"status": "failed", "exitCode": 1, "finishedAt": 123.0},
    )

    training_runner._refresh_job(job)

    assert job["status"] == "paused"
    assert "error" not in job


def test_stop_request_without_a_recorded_pid_does_not_signal_any_process(monkeypatch):
    active = {"id": "active", "status": "running"}
    state = {"activeJobId": "active", "queuePaused": False, "jobs": [active]}
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_apply_restart_hold", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("must not signal without a PID")))

    payload, status = training_runner.stop_response("active", pause=True)

    assert status == 409
    assert active["status"] == "running"
    assert "no recorded runner PID" in payload["error"]


def test_log_response_restarts_from_zero_when_the_log_was_truncated(tmp_path, monkeypatch):
    log_path = tmp_path / "run.log"
    log_path.write_text("new\n", encoding="utf-8")
    job = {"id": "active", "status": "running", "logPath": str(log_path)}
    state = {"activeJobId": "active", "jobs": [job]}
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_apply_restart_hold", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_sync_histories", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_write_state", lambda candidate: None)

    payload, status = training_runner.log_response("active", offset=999)

    assert status == 200
    assert payload["offset"] == log_path.stat().st_size
    assert payload["nextOffset"] == log_path.stat().st_size
    assert payload["text"] == ""


def test_cancelling_a_paused_job_removes_it_from_the_queue(monkeypatch):
    active = {"id": "active", "folder": "set", "status": "paused", "progress": {"epoch": 85, "epochs": 90}}
    state = {
        "activeJobId": "active",
        "queuePaused": True,
        "queuePauseReason": "Queue paused by the user.",
        "jobs": [active, {"id": "next", "status": "queued", "folder": "set"}],
    }
    advanced = []
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_apply_restart_hold", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda candidate: None)
    monkeypatch.setattr(training_runner.app_config, "safe_join_fs_root", lambda folder: folder)
    cleared = []
    monkeypatch.setattr(training_runner, "clear_history_job", lambda folder, job_id: cleared.append((folder, job_id)) or True)
    monkeypatch.setattr(training_runner, "_write_state", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_start_next", lambda candidate: advanced.append(candidate["queuePaused"]))

    payload, status = training_runner.stop_response("active", cancel=True)

    assert status == 200
    assert payload["job"]["status"] == "cancelled"
    assert active["historyHidden"] is True
    assert cleared == [("set", "active")]
    assert state["queuePaused"] is True
    assert advanced == []


def test_resuming_a_paused_job_keeps_its_queue_position(monkeypatch):
    paused = {"id": "paused", "folder": "penny", "stages": "lo", "status": "paused"}
    queued = {"id": "next", "folder": "sue", "stages": "hi", "status": "queued"}
    state = {
        "activeJobId": "",
        "queuePaused": True,
        "queuePauseReason": "Queue paused by the user.",
        "jobs": [paused, queued],
    }
    advanced = []
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_apply_restart_hold", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_prepare_paused_job_for_resume", lambda job: job.update(status="queued") or "")
    monkeypatch.setattr(training_runner, "_start_next", lambda candidate: advanced.append(candidate["activeJobId"]))
    monkeypatch.setattr(training_runner, "_sync_histories", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_write_state", lambda candidate: None)

    payload, status = training_runner.resume_job_response("paused")

    assert status == 200
    assert payload["job"]["id"] == "paused"
    assert [job["id"] for job in state["jobs"]] == ["paused", "next"]
    assert paused["status"] == "queued"
    assert state["activeJobId"] == ""
    assert state["queuePaused"] is False
    assert advanced == [""]


def test_resume_queue_reports_a_hold_instead_of_a_false_success(monkeypatch):
    state = {"activeJobId": "", "queuePaused": True, "queuePauseReason": "Queue paused by the user.", "jobs": [{"id": "next", "status": "queued", "folder": "set"}]}
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_apply_restart_hold", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda candidate: candidate.update(queuePaused=True, queuePauseReason="Queued inputs changed. Confirm current inputs or cancel this item."))
    monkeypatch.setattr(training_runner, "_sync_histories", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_write_state", lambda candidate: None)

    payload, status = training_runner.resume_queue_response()

    assert status == 409
    assert payload["error"] == "Queued inputs changed. Confirm current inputs or cancel this item."


def test_refresh_state_marks_a_missing_confirmation_without_ending_the_job(monkeypatch):
    active = {"id": "active", "status": "running", "stage": "hi", "stages": "hi", "pid": 42}
    state = {"activeJobId": "active", "queuePaused": False, "queuePauseReason": "", "jobs": [active, {"id": "next", "status": "queued", "folder": "set"}]}
    monkeypatch.setattr(training_runner, "_read_result", lambda job: None)
    monkeypatch.setattr(training_runner, "_pid_alive", lambda *args: False)
    monkeypatch.setattr(training_runner, "_launch_job", lambda *args: (_ for _ in ()).throw(AssertionError("queue must be held")))

    training_runner._refresh_state(state)

    assert active["status"] == "unconfirmed"
    assert "cannot currently confirm" in active["confirmationNote"]
    assert state["queuePaused"] is False
    assert state["activeJobId"] == "active"
    assert state["jobs"][1]["status"] == "queued"


def test_refresh_state_uses_new_log_output_as_current_confirmation(tmp_path, monkeypatch):
    log_path = tmp_path / "run.log"
    log_path.write_text("step=580\n", encoding="utf-8")
    active = {
        "id": "active", "status": "running", "stage": "hi", "stages": "hi", "pid": 42,
        "logPath": str(log_path), "lastLogAt": 1,
    }
    state = {"activeJobId": "active", "queuePaused": False, "queuePauseReason": "", "jobs": [active]}
    monkeypatch.setattr(training_runner, "_read_result", lambda job: None)
    monkeypatch.setattr(training_runner, "_pid_alive", lambda *args: False)

    training_runner._refresh_state(state)

    assert active["status"] == "running"
    assert "confirmationNote" not in active


def test_runner_stopped_without_an_app_action_is_interrupted(monkeypatch):
    job = {"id": "external-stop", "status": "running"}
    monkeypatch.setattr(training_runner, "_read_result", lambda candidate: {"status": "stopped", "exitCode": 130, "finishedAt": 123.0})

    training_runner._refresh_job(job)

    assert job["status"] == "interrupted"
    assert job["error"] == "Runner stopped without a WebCap stop or pause action."


def test_stop_outcome_advances_to_the_next_queued_job(monkeypatch):
    active = {"id": "active", "status": "stopped", "stage": "stopped", "stages": "hi"}
    next_job = {"id": "next", "status": "queued", "folder": "set"}
    state = {"activeJobId": "active", "queuePaused": False, "queuePauseReason": "", "jobs": [active, next_job]}

    def launch(job, folder):
        job["status"] = "running"

    monkeypatch.setattr(training_runner, "_launch_job", launch)
    monkeypatch.setattr(training_runner.app_config, "safe_join_fs_root", lambda folder: folder)
    training_runner._refresh_state(state)

    assert state["activeJobId"] == "next"
    assert next_job["status"] == "running"


def test_starting_both_creates_adjacent_hi_and_lo_jobs(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    (folder / "auto_dataset").mkdir(parents=True)
    for name in ("config.hi.toml", "config.lo.toml", "dataset.hi.toml", "dataset.lo.toml"):
        (folder / name).write_text("ok", encoding="utf-8")
    (folder / "auto_dataset" / "prep_manifest.json").write_text("{}", encoding="utf-8")
    artifacts = {
        "hiConfig": folder / "config.hi.toml", "loConfig": folder / "config.lo.toml",
        "hiDataset": folder / "dataset.hi.toml", "loDataset": folder / "dataset.lo.toml",
        "manifest": folder / "auto_dataset" / "prep_manifest.json",
    }
    state = training_runner._default_state()
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_build_launch_preflight", lambda value: ("set", folder, artifacts, {}, []))
    monkeypatch.setattr(training_runner, "_ensure_monitor_started", lambda: None)
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_write_state", lambda value: None)
    monkeypatch.setattr(training_runner, "_sync_histories", lambda value: None)
    monkeypatch.setattr(training_runner, "_training_settings", lambda: {"wslDistribution": ""})
    monkeypatch.setattr(training_runner, "_launch_job", lambda job, path: job.update(status="running", stage=job["stages"]))

    payload, status = training_runner.start_response("set", stages="both")

    assert status == 200
    assert [job["stages"] for job in payload["jobs"]] == ["hi", "lo"]
    assert state["jobs"][0]["status"] == "running"
    assert state["jobs"][1]["status"] == "queued"


def test_starting_with_an_empty_queue_clears_a_stale_hold_and_launches(monkeypatch):
    state = {
        "activeJobId": "",
        "queuePaused": True,
        "queuePauseReason": "Queue held after LO failed.",
        "jobs": [{"id": "old", "status": "failed", "folder": "old-set"}],
    }
    job = {"id": "new", "folder": "set", "stages": "lo", "status": "queued"}
    monkeypatch.setattr(training_runner, "_ensure_monitor_started", lambda: None)
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_write_state", lambda value: None)
    monkeypatch.setattr(training_runner, "_sync_histories", lambda value: None)
    monkeypatch.setattr(training_runner, "_apply_restart_hold", lambda value: None)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda value: None)
    monkeypatch.setattr(training_runner, "_build_launch_preflight", lambda value: ("set", "folder", {}, {}, []))
    monkeypatch.setattr(training_runner, "_new_job", lambda *args: job)
    monkeypatch.setattr(training_runner.app_config, "safe_join_fs_root", lambda folder: folder)
    monkeypatch.setattr(training_runner, "_launch_job", lambda candidate, folder: candidate.update(status="starting"))

    payload, status = training_runner.start_response("set", queue=True, stages="lo")

    assert status == 200
    assert payload["queued"] is False
    assert state["activeJobId"] == "new"
    assert state["queuePaused"] is False
    assert state["queuePauseReason"] == ""


def test_folder_status_prefers_queue_state_over_output_artifacts(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    folder.mkdir(parents=True)
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    queued = {"id": "queued", "folder": "set", "status": "queued", "stages": "lo"}
    monkeypatch.setattr(training_runner, "_read_state", lambda: {"jobs": [queued]})
    monkeypatch.setattr(training_runner, "discover_runs", lambda path: [{"path": "run"}])

    status = training_runner.folder_statuses_for_folders([folder])[folder]

    assert status == {"status": "queued", "label": "Queued #1", "queuePosition": 1}


def test_folder_status_distinguishes_partial_and_complete_training(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    folder.mkdir(parents=True)
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_read_state", lambda: {"jobs": []})
    monkeypatch.setattr(training_runner, "completed_stages", lambda path: (["hi", "lo"], {"hi"}))

    partial = training_runner.folder_statuses_for_folders([folder])[folder]

    monkeypatch.setattr(training_runner, "completed_stages", lambda path: (["hi", "lo"], {"hi", "lo"}))
    complete = training_runner.folder_statuses_for_folders([folder])[folder]

    assert partial == {"status": "partial", "label": "Partially trained"}
    assert complete == {"status": "trained", "label": "Trained"}


def test_attention_ignores_a_failed_attempt_after_the_same_stage_retries():
    failed = {"id": "failed", "folder": "set", "stages": "lo", "status": "failed", "createdAt": 1}
    retry = {"id": "retry", "folder": "set", "stages": "lo", "status": "running", "createdAt": 2}

    assert training_runner._attention_payload({"queuePaused": True, "jobs": [failed, retry]}) is None


def test_folder_status_requires_prepared_captions_before_ready(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    (folder / "auto_dataset" / "square_img").mkdir(parents=True)
    for name in ("config.hi.toml", "config.lo.toml", "dataset.hi.toml", "dataset.lo.toml"):
        (folder / name).write_text("ok", encoding="utf-8")
    (folder / "auto_dataset" / "prep_manifest.json").write_text(
        '{"images": [{"prepared_path": "square_img/one.png", "caption": true}], "videos": []}', encoding="utf-8"
    )
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_read_state", lambda: {"jobs": []})
    monkeypatch.setattr(training_runner, "completed_stages", lambda path: (["hi", "lo"], set()))

    assert training_runner.folder_statuses_for_folders([folder])[folder] == {"status": "never", "label": ""}

    (folder / "auto_dataset" / "square_img" / "one.txt").write_text("caption", encoding="utf-8")

    assert training_runner.folder_statuses_for_folders([folder])[folder] == {"status": "ready", "label": "Ready to train"}


def test_folder_status_requires_caption_review_for_partial_annotations(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    (folder / "auto_dataset" / "square_img").mkdir(parents=True)
    for name in ("config.hi.toml", "config.lo.toml", "dataset.hi.toml", "dataset.lo.toml"):
        (folder / name).write_text("ok", encoding="utf-8")
    (folder / "auto_dataset" / "prep_manifest.json").write_text(
        '{"images": [{"prepared_path": "square_img/one.png", "caption": true}], "videos": []}', encoding="utf-8"
    )
    (folder / "auto_dataset" / "square_img" / "one.txt").write_text("caption", encoding="utf-8")
    for index in range(20):
        media_name = "item_" + str(index) + ".png"
        (folder / media_name).write_bytes(b"")
        if index >= 3:
            (folder / ("item_" + str(index) + ".txt")).write_text("caption", encoding="utf-8")
    (folder / ".webcap_state.json").write_text(
        '{"caption_tags_by_media": {"item_0.png": ["tag"], "item_1.png": ["tag"], "item_2.png": ["tag"]}}',
        encoding="utf-8",
    )
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_read_state", lambda: {"jobs": []})
    monkeypatch.setattr(training_runner, "completed_stages", lambda path: (["hi", "lo"], set()))

    assert training_runner.folder_statuses_for_folders([folder])[folder] == {
        "status": "caption-review",
        "label": "Caption review needed (3 of 20)",
    }


def test_folder_status_keeps_ready_for_low_rate_of_partial_annotations(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    (folder / "auto_dataset" / "square_img").mkdir(parents=True)
    for name in ("config.hi.toml", "config.lo.toml", "dataset.hi.toml", "dataset.lo.toml"):
        (folder / name).write_text("ok", encoding="utf-8")
    (folder / "auto_dataset" / "prep_manifest.json").write_text(
        '{"images": [{"prepared_path": "square_img/one.png", "caption": true}], "videos": []}', encoding="utf-8"
    )
    (folder / "auto_dataset" / "square_img" / "one.txt").write_text("caption", encoding="utf-8")
    for index in range(40):
        media_name = "item_" + str(index) + ".png"
        (folder / media_name).write_bytes(b"")
        if index >= 3:
            (folder / ("item_" + str(index) + ".txt")).write_text("caption", encoding="utf-8")
    (folder / ".webcap_state.json").write_text(
        '{"caption_tags_by_media": {"item_0.png": ["tag"], "item_1.png": ["tag"], "item_2.png": ["tag"]}}',
        encoding="utf-8",
    )
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_read_state", lambda: {"jobs": []})
    monkeypatch.setattr(training_runner, "completed_stages", lambda path: (["hi", "lo"], set()))

    assert training_runner.folder_statuses_for_folders([folder])[folder] == {
        "status": "ready",
        "label": "Ready to train",
    }
