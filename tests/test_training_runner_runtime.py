from tool.server import training_runner
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


def test_paused_queue_does_not_launch_the_next_job(monkeypatch):
    state = {"queuePaused": True, "activeJobId": "", "jobs": [{"id": "next", "status": "queued", "folder": "set"}]}
    monkeypatch.setattr(training_runner, "_launch_job", lambda *args: (_ for _ in ()).throw(AssertionError("queue must remain held")))

    training_runner._start_next(state)

    assert state["activeJobId"] == ""


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


def test_completed_job_flags_a_result_far_below_the_planned_steps():
    job = {
        "status": "completed",
        "progress": {"step": 1650, "plannedSteps": 20000},
    }

    training_runner._annotate_completed_job(job)

    assert "step 1,650" in job["completionNote"]
    assert "~20,000 planned steps" in job["completionNote"]


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


def test_finish_clears_a_restart_hold_and_advances_the_queue(monkeypatch):
    active = {"id": "active", "status": "running", "pid": 42, "progress": {"epoch": 85, "epochs": 90}}
    state = {
        "activeJobId": "active",
        "queuePaused": True,
        "queuePauseReason": "Queue held after WebCap restarted.",
        "jobs": [active, {"id": "next", "status": "queued", "folder": "set"}],
    }
    advanced = []
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_apply_restart_hold", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *args, **kwargs: (0, "", ""))
    monkeypatch.setattr(training_runner, "_pid_alive", lambda *args, **kwargs: False)
    monkeypatch.setattr(training_runner, "_refresh_job", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_sync_histories", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_write_state", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_start_next", lambda candidate: advanced.append(candidate["queuePaused"]))

    payload, status = training_runner.stop_response("active", finish=True)

    assert status == 200
    assert payload["job"]["status"] == "finished_early"
    assert state["queuePaused"] is False
    assert state["queuePauseReason"] == ""
    assert advanced == [False]


def test_refresh_state_holds_queue_after_an_unexplained_exit(monkeypatch):
    active = {"id": "active", "status": "running", "stage": "hi", "stages": "hi", "pid": 42}
    state = {"activeJobId": "active", "queuePaused": False, "queuePauseReason": "", "jobs": [active, {"id": "next", "status": "queued", "folder": "set"}]}
    monkeypatch.setattr(training_runner, "_read_result", lambda job: None)
    monkeypatch.setattr(training_runner, "_pid_alive", lambda *args: False)
    monkeypatch.setattr(training_runner, "_launch_job", lambda *args: (_ for _ in ()).throw(AssertionError("queue must be held")))

    training_runner._refresh_state(state)

    assert active["status"] == "interrupted"
    assert state["queuePaused"] is True
    assert state["jobs"][1]["status"] == "queued"


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
