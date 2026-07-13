from tool.server.training_commands import build_training_command_plan, build_training_launcher_probe
from tool.server.training_runtime import build_runtime_command, build_training_launcher, training_runtime_settings


def test_training_command_plan_uses_the_same_stage_commands_for_handoff():
    plan = build_training_command_plan("/mnt/c/sets/one/config.hi.toml", "/mnt/c/sets/one/config.lo.toml")

    assert plan["launcher"] == "deepspeed"
    assert plan["hiCommand"] == 'NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" deepspeed --num_gpus=1 train.py --deepspeed --config /mnt/c/sets/one/config.hi.toml'
    assert plan["loCommand"] == 'NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" deepspeed --num_gpus=1 train.py --deepspeed --config /mnt/c/sets/one/config.lo.toml'
    assert plan["handoffCommand"] == plan["hiCommand"] + " ; " + plan["loCommand"]


def test_training_launcher_probe_is_a_valid_help_probe_not_a_version_probe():
    assert build_training_launcher_probe() == "deepspeed --help >/dev/null"


def test_training_command_plan_appends_a_quoted_resume_checkpoint_to_each_selected_stage_command():
    plan = build_training_command_plan(
        "/mnt/w/sets/one/config.hi.toml",
        "/mnt/w/sets/one/config.lo.toml",
        resume_from_checkpoint="/mnt/w/training/output/runs/20260710_23-57-51",
    )

    assert plan["hiCommand"].endswith(" --resume_from_checkpoint /mnt/w/training/output/runs/20260710_23-57-51")
    assert plan["loCommand"].endswith(" --resume_from_checkpoint /mnt/w/training/output/runs/20260710_23-57-51")


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
