from tool.server.training_commands import build_h3_command_plan, build_training_command_plan, build_training_launcher_probe
from tool.server.training_runtime import build_runtime_command, build_training_launcher, training_runtime_settings
from tool.server import training_runner


def test_training_command_plan_uses_the_same_stage_commands_for_handoff():
    plan = build_training_command_plan("/mnt/c/sets/one/config.hi.toml", "/mnt/c/sets/one/config.lo.toml")

    assert plan["launcher"] == "deepspeed"
    assert plan["hiCommand"] == 'NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" deepspeed --num_gpus=1 train.py --deepspeed --config /mnt/c/sets/one/config.hi.toml'
    assert plan["loCommand"] == 'NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" deepspeed --num_gpus=1 train.py --deepspeed --config /mnt/c/sets/one/config.lo.toml'
    assert plan["handoffCommand"] == plan["hiCommand"] + " ; " + plan["loCommand"]


def test_training_launcher_probe_is_a_valid_help_probe_not_a_version_probe():
    assert build_training_launcher_probe() == "deepspeed --help >/dev/null"


def test_training_command_plan_appends_a_quoted_resume_checkpoint_only_to_its_selected_stage_command():
    plan = build_training_command_plan(
        "/mnt/w/sets/one/config.hi.toml",
        "/mnt/w/sets/one/config.lo.toml",
        resume_from_checkpoint="/mnt/w/training/output/runs/20260710_23-57-51",
        resume_stage="lo",
    )

    assert "--resume_from_checkpoint" not in plan["hiCommand"]
    assert plan["loCommand"].endswith(" --resume_from_checkpoint /mnt/w/training/output/runs/20260710_23-57-51")


def test_h3_command_plan_runs_cache_and_training_in_separate_processes():
    plan = build_h3_command_plan("/mnt/w/sets/one/config.h3.toml")

    assert plan["cacheCommand"] == (
        'NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" deepspeed --num_gpus=1 train.py --deepspeed '
        '--config /mnt/w/sets/one/config.h3.toml --trust_cache --cache_only'
    )
    assert plan["trainCommand"] == (
        'NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" deepspeed --num_gpus=1 train.py --deepspeed '
        '--config /mnt/w/sets/one/config.h3.toml --trust_cache'
    )
    resumed = build_h3_command_plan(
        "/mnt/w/sets/one/config.h3.toml",
        resume_from_checkpoint="/mnt/w/output/run-1",
    )
    assert "--resume_from_checkpoint" not in resumed["cacheCommand"]
    assert resumed["trainCommand"].endswith("--resume_from_checkpoint /mnt/w/output/run-1 --trust_cache")


def test_resumed_h3_runner_caches_the_current_capture_before_training(tmp_path, monkeypatch):
    config = tmp_path / "config.h3.toml"
    config.write_text("config", encoding="utf-8")
    job_dir = tmp_path / "job"
    monkeypatch.setattr(training_runner, "_to_wsl_path", lambda path, _distribution="": str(path).replace("\\", "/"))
    script, _ = training_runner._build_runner_script(
        {"id": "job", "stages": "h3", "resumeFromCheckpoint": "/mnt/w/old-run", "resumeStage": "h3", "artifactDir": str(job_dir)},
        {"cwd": "/mnt/w/diffusion-pipe", "activate": "", "wslDistribution": "", "condaExecutable": "", "condaEnvironment": ""},
        {"h3Config": config}, job_dir,
    )
    assert script.index("--cache_only") < script.index("--resume_from_checkpoint /mnt/w/old-run")
    assert "--regenerate_cache" not in script


def test_custom_resume_runner_resets_its_dataloader_but_managed_resume_does_not(tmp_path, monkeypatch):
    config = tmp_path / "config.h3.toml"
    config.write_text("config", encoding="utf-8")
    job_dir = tmp_path / "job"
    monkeypatch.setattr(training_runner, "_to_wsl_path", lambda path, _distribution="": str(path).replace("\\", "/"))
    settings = {"cwd": "/mnt/w/diffusion-pipe", "activate": "", "wslDistribution": "", "condaExecutable": "", "condaEnvironment": ""}
    custom_script, _ = training_runner._build_runner_script(
        {"id": "custom", "stages": "h3", "resumeFromCheckpoint": "/mnt/w/external-run", "resumeStage": "h3", "artifactDir": str(job_dir)},
        settings, {"h3Config": config}, job_dir,
    )
    managed_script, _ = training_runner._build_runner_script(
        {"id": "managed", "stages": "h3", "resumeFromCheckpoint": "/mnt/w/local-run", "resumeStage": "h3", "resumeOutputId": "output/local-run", "artifactDir": str(job_dir)},
        settings, {"h3Config": config}, job_dir,
    )

    assert "--resume_from_checkpoint /mnt/w/external-run --reset_dataloader --trust_cache" in custom_script
    assert "--reset_dataloader" not in managed_script


def test_conda_runtime_wraps_child_commands_without_shell_activation():
    settings = training_runtime_settings({
        "conda_executable": "/home/user/miniconda3/bin/conda",
        "conda_environment": "dp-clean",
    })

    assert build_runtime_command(settings, "python --version") == (
        "/home/user/miniconda3/bin/conda run --no-capture-output --name dp-clean python --version"
    )
    assert build_training_launcher(settings) == (
        "/home/user/miniconda3/bin/conda run --no-capture-output --name dp-clean deepspeed"
    )
