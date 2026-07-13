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
    assert "--resume_from_checkpoint /mnt/w/output/run-1" in script


def test_paused_queue_does_not_launch_the_next_job(monkeypatch):
    state = {"queuePaused": True, "activeJobId": "", "jobs": [{"id": "next", "status": "queued", "folder": "set"}]}
    monkeypatch.setattr(training_runner, "_launch_job", lambda *args: (_ for _ in ()).throw(AssertionError("queue must remain held")))

    training_runner._start_next(state)

    assert state["activeJobId"] == ""


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
        "estimated": True,
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


def test_completed_job_flags_a_result_far_below_the_planned_steps():
    job = {
        "status": "completed",
        "progress": {"step": 1650, "plannedSteps": 20000},
    }

    training_runner._annotate_completed_job(job)

    assert "step 1,650" in job["completionNote"]
    assert "~20,000 planned steps" in job["completionNote"]
