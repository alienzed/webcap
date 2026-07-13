import shlex


DEEPSPEED_LAUNCHER = "deepspeed"


def build_training_command_plan(hi_config_path, lo_config_path, launcher=DEEPSPEED_LAUNCHER):
    resolved_launcher = str(launcher or DEEPSPEED_LAUNCHER).strip() or DEEPSPEED_LAUNCHER
    hi_command = (
        'NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" '
        + resolved_launcher
        + " --num_gpus=1 train.py --deepspeed --config "
        + shlex.quote(str(hi_config_path))
    )
    lo_command = (
        'NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" '
        + resolved_launcher
        + " --num_gpus=1 train.py --deepspeed --config "
        + shlex.quote(str(lo_config_path))
    )
    return {
        "launcher": resolved_launcher,
        "hiCommand": hi_command,
        "loCommand": lo_command,
        "handoffCommand": hi_command + " ; " + lo_command,
    }


def build_training_launcher_probe(launcher=DEEPSPEED_LAUNCHER):
    return (str(launcher or DEEPSPEED_LAUNCHER).strip() or DEEPSPEED_LAUNCHER) + " --help >/dev/null"
