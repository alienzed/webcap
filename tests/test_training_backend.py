"""Backend boundary tests: no alternative trainer is connected yet."""

import pytest

from tool.server.training_backend import DEFAULT_TRAINER_ID, backend_for_job
from tool.server import training_runner


def test_legacy_jobs_keep_diffusion_pipe_behavior():
    assert backend_for_job({}).id == DEFAULT_TRAINER_ID
    assert backend_for_job({"trainerId": "diffusion_pipe"}).id == DEFAULT_TRAINER_ID


def test_unknown_trainer_fails_instead_of_launching_diffusion_pipe():
    with pytest.raises(ValueError, match="Unsupported training backend: fizgig"):
        backend_for_job({"trainerId": "fizgig"})


def test_diffusion_pipe_backend_preserves_h3_launch_commands():
    backend = backend_for_job({})
    settings = {
        "cwd": "/mnt/w/diffusion-pipe",
        "activate": "",
        "wslDistribution": "",
        "condaExecutable": "",
        "condaEnvironment": "",
    }
    plan = backend.h3_command_plan(
        "/mnt/w/sets/config.h3.toml",
        settings,
        resume_path="/mnt/w/checkpoints/run-1",
        reset_dataloader=True,
    )
    assert "deepspeed --num_gpus=1 train.py --deepspeed" in plan["singleCommand"]
    assert plan["singleCommand"].endswith(
        "--resume_from_checkpoint /mnt/w/checkpoints/run-1 --reset_dataloader"
    )
    assert plan["cacheCommand"].endswith("--cache_only")
    assert plan["trainCommand"].endswith("--trust_cache")


def test_diffusion_pipe_save_request_uses_original_signal(tmp_path):
    backend_for_job({}).request_checkpoint_save(tmp_path)
    assert (tmp_path / "save_quit").exists()


def test_runner_rejects_unconnected_trainer_before_command_generation(tmp_path, monkeypatch):
    monkeypatch.setattr(training_runner, "_to_wsl_path", lambda value, _distribution="": str(value))
    settings = {
        "cwd": "/mnt/w/diffusion-pipe",
        "activate": "",
        "wslDistribution": "",
        "condaExecutable": "",
        "condaEnvironment": "",
    }
    with pytest.raises(ValueError, match="Unsupported training backend: fizgig"):
        training_runner._build_runner_script(
            {"id": "fizgig-probe", "stages": "h3", "trainerId": "fizgig"},
            settings,
            {"h3Config": tmp_path / "config.h3.toml"},
            tmp_path,
        )
