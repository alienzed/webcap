from tool.server.training_commands import build_training_command_plan, build_training_launcher_probe


def test_training_command_plan_uses_the_same_stage_commands_for_handoff():
    plan = build_training_command_plan("/mnt/c/sets/one/config.hi.toml", "/mnt/c/sets/one/config.lo.toml")

    assert plan["launcher"] == "deepspeed"
    assert plan["hiCommand"] == 'NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" deepspeed --num_gpus=1 train.py --deepspeed --config /mnt/c/sets/one/config.hi.toml'
    assert plan["loCommand"] == 'NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" deepspeed --num_gpus=1 train.py --deepspeed --config /mnt/c/sets/one/config.lo.toml'
    assert plan["handoffCommand"] == plan["hiCommand"] + " ; " + plan["loCommand"]


def test_training_launcher_probe_is_a_valid_help_probe_not_a_version_probe():
    assert build_training_launcher_probe() == "deepspeed --help >/dev/null"
