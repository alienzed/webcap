import shlex


DEEPSPEED_LAUNCHER = "deepspeed"


def build_training_command_plan(hi_config_path, lo_config_path):
    hi_command = (
        'NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" '
        + DEEPSPEED_LAUNCHER
        + " --num_gpus=1 train.py --deepspeed --config "
        + shlex.quote(str(hi_config_path))
    )
    lo_command = (
        'NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" '
        + DEEPSPEED_LAUNCHER
        + " --num_gpus=1 train.py --deepspeed --config "
        + shlex.quote(str(lo_config_path))
    )
    return {
        "launcher": DEEPSPEED_LAUNCHER,
        "hiCommand": hi_command,
        "loCommand": lo_command,
        "handoffCommand": hi_command + " ; " + lo_command,
    }


def build_training_launcher_probe():
    return DEEPSPEED_LAUNCHER + " --help >/dev/null"
