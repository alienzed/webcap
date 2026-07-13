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
