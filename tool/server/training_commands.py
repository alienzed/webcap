import shlex


DEEPSPEED_LAUNCHER = "deepspeed"


def build_training_command_plan(hi_config_path, lo_config_path, launcher=DEEPSPEED_LAUNCHER, resume_from_checkpoint="", resume_stage="", reset_dataloader=False):
    resolved_launcher = str(launcher or DEEPSPEED_LAUNCHER).strip() or DEEPSPEED_LAUNCHER
    resume_path = str(resume_from_checkpoint or "").strip()
    resume_option = " --resume_from_checkpoint " + shlex.quote(resume_path) if resume_path else ""
    reset_dataloader_option = " --reset_dataloader" if resume_path and reset_dataloader else ""
    resume_stage = str(resume_stage or "").strip().lower()
    hi_command = (
        'NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" '
        + resolved_launcher
        + " --num_gpus=1 train.py --deepspeed --config "
        + shlex.quote(str(hi_config_path))
        + (resume_option + reset_dataloader_option if resume_stage == "hi" else "")
    )
    lo_command = (
        'NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" '
        + resolved_launcher
        + " --num_gpus=1 train.py --deepspeed --config "
        + shlex.quote(str(lo_config_path))
        + (resume_option + reset_dataloader_option if resume_stage in ("lo", "krea2", "wan21", "h3") else "")
    )
    return {
        "launcher": resolved_launcher,
        "hiCommand": hi_command,
        "loCommand": lo_command,
        "handoffCommand": hi_command + " ; " + lo_command,
    }


def build_h3_command_plan(config_path, launcher=DEEPSPEED_LAUNCHER, resume_from_checkpoint="", reset_dataloader=False):
    base_plan = build_training_command_plan(config_path, config_path, launcher)
    train_plan = build_training_command_plan(
        config_path,
        config_path,
        launcher,
        resume_from_checkpoint=resume_from_checkpoint,
        resume_stage="h3",
        reset_dataloader=reset_dataloader,
    )
    return {
        "cacheCommand": base_plan["loCommand"] + " --trust_cache --cache_only",
        "trainCommand": train_plan["loCommand"] + " --trust_cache",
    }


def build_training_launcher_probe(launcher=DEEPSPEED_LAUNCHER):
    return (str(launcher or DEEPSPEED_LAUNCHER).strip() or DEEPSPEED_LAUNCHER) + " --help >/dev/null"
