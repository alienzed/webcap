from pathlib import Path

from flask import Response, stream_with_context

from . import config as app_config
from .training_action import action_id_for_root, allocate_action, update_action
from .training_history import resolve_managed_resume, validate_resumable_run_for_path
from .training_profiles import config_for_stage, normalize_mode, profile_run
from .training_bundle import materialize_training_bundle
from .training_commands import build_h3_command_plan, build_training_command_plan
from .training_review import prepare_training_review, resolve_saved_initializer
from .training_runtime import build_training_launcher, to_wsl_path, training_runtime_settings


def _to_wsl_path(path_obj: Path, distribution=""):
    return to_wsl_path(path_obj, distribution)


def train_run_response(
    folder: str,
    stages="",
    resume_from_checkpoint="",
    resume_stage="",
    resume_action_id="",
    resume_output_id="",
    run_name="",
    profile_id="",
    run_id="",
    mode="normal",
    selected_media=None,
    fallback_captions=None,
    selection_criteria=None,
    total_media_count=None,
    initializer_action_id="",
    initializer_export_id="",
    initializer_stage="",
    initializer_custom_path="",
    force_constant_lr=None,
):
    if not folder:
        return Response("[ERROR] Missing folder argument\n", status=400, mimetype="text/plain")

    live_config = app_config.config
    training_cfg = live_config.get("training", {}) if isinstance(live_config, dict) else {}
    runtime_settings = training_runtime_settings(training_cfg)
    diffusion_pipe_wsl = runtime_settings["cwd"]
    try:
        folder_path = app_config.safe_join_fs_root(folder)
        if not folder_path.exists() or not folder_path.is_dir():
            return Response(f"[ERROR] Folder does not exist: {folder}\n", status=404, mimetype="text/plain")
        selected_profile, selected_run = profile_run(profile_id, run_id)
        selected_mode = normalize_mode(mode)
        stages = selected_run["stages"][0]
        stage_names = (stages,)
        if bool(resume_action_id) != bool(resume_output_id):
            return Response("[ERROR] A managed resume requires both an action and output selection.\n", status=400, mimetype="text/plain")
        if resume_from_checkpoint and resume_output_id:
            return Response("[ERROR] Choose either a managed checkpoint or a filesystem checkpoint, not both.\n", status=400, mimetype="text/plain")
        managed_action_root = None
        managed_action = None
        if resume_output_id:
            resolved = resolve_managed_resume(folder_path, resume_action_id, resume_output_id, resume_stage or stages)
            resume_from_checkpoint = str(resolved["runPath"])
            resume_stage = str(resolved["stage"])
            managed_action_root = resolved["actionRoot"]
            managed_action = resolved["action"]
        elif resume_from_checkpoint:
            validate_resumable_run_for_path(folder_path, resume_stage or stages, resume_from_checkpoint)
        review = prepare_training_review(
            folder_path, selected_profile["id"], selected_run["id"], selected_media,
            selection_criteria, total_media_count, fallback_captions, persist=False,
        )
        initializer = None
        if initializer_action_id or initializer_export_id or initializer_stage or initializer_custom_path:
            if resume_from_checkpoint:
                return Response("[ERROR] Checkpoint Resume and LoRA initialization cannot be combined.\n", status=400, mimetype="text/plain")
            if initializer_stage not in stage_names:
                return Response("[ERROR] Initializer target stage does not belong to this run.\n", status=400, mimetype="text/plain")
            if initializer_custom_path:
                initializer = {"sourcePath": Path(str(initializer_custom_path).strip()), "exportId": "custom", "actionId": "", "epoch": ""}
            elif initializer_action_id and initializer_export_id:
                initializer = resolve_saved_initializer(folder_path, selected_profile["id"], initializer_stage, initializer_action_id, initializer_export_id)
            else:
                return Response("[ERROR] Saved LoRA initialization needs an action, export, and target stage.\n", status=400, mimetype="text/plain")
            initializer["stage"] = initializer_stage
            settings = (((review or {}).get("review") or {}).get("stages", {}).get(initializer_stage, {}).get("settings") or {})
            initializer["forceConstantLr"] = force_constant_lr if force_constant_lr not in (None, "") else settings.get("optimizerLr")
        if managed_action_root is not None:
            action_root, action = managed_action_root, managed_action
        else:
            action_root, action = allocate_action(folder_path, selected_profile, selected_mode, stage_names, run_name)
        output_dirs = {}
        for stage in stage_names:
            stage_output = action_root / "output"
            stage_output.mkdir(parents=True, exist_ok=True)
            output_dir = _to_wsl_path(stage_output, runtime_settings["wslDistribution"])
            output_dirs[stage] = output_dir
        bundle = materialize_training_bundle(
            folder_path,
            action_root,
            selected_profile["id"],
            selected_mode,
            stages,
            selected_media,
            fallback_captions=fallback_captions,
            selection_criteria=selection_criteria,
            total_media_count=total_media_count,
            output_dirs=output_dirs,
            distribution=runtime_settings["wslDistribution"],
            review=review if not review.get("customDataset") else None,
            initializer=initializer,
        )
        def mark_manual(data):
            data["launchType"] = "manual"
            data["observation"] = "unobserved"
            if resume_from_checkpoint and managed_action_root is None:
                data["externalOutput"] = {"kind": "external", "resumeStage": str(resume_stage or "")}
            if bundle.get("initializer"):
                data["initializer"] = bundle["initializer"]
        update_action(action_id_for_root(action_root), mark_manual)
        artifacts = bundle["artifacts"]
        stage_configs = {
            stage: _to_wsl_path(artifacts[stage + "Config"], runtime_settings["wslDistribution"])
            for stage in stage_names
        }
        hi_wsl = stage_configs.get("hi") or next(iter(stage_configs.values()))
        lo_wsl = stage_configs.get("lo") or next(iter(stage_configs.values()))

        if not diffusion_pipe_wsl:
            diffusion_pipe_wsl = "<set training.diffusion_pipe_wsl>"

        resume_command_path = resume_from_checkpoint if str(resume_from_checkpoint).startswith("/") else (
            _to_wsl_path(Path(resume_from_checkpoint), runtime_settings["wslDistribution"]) if resume_from_checkpoint else ""
        )
        command_plan = build_training_command_plan(
            hi_wsl,
            lo_wsl,
            build_training_launcher(runtime_settings),
            resume_command_path,
            resume_stage,
        )
        h3_command_plan = build_h3_command_plan(
            lo_wsl,
            build_training_launcher(runtime_settings),
            resume_command_path if stages == "h3" and resume_stage == "h3" else "",
        ) if stages == "h3" else None
        if stages == "hi":
            handoff_cmd = command_plan["hiCommand"]
        elif stages in ("lo", "krea2", "wan21"):
            handoff_cmd = command_plan["loCommand"]
        elif stages == "h3":
            handoff_cmd = h3_command_plan["cacheCommand"] + " && " + h3_command_plan["trainCommand"]
        else:
            handoff_cmd = command_plan["handoffCommand"]
        def generate():
            try:
                yield f"[INFO] Running from: {diffusion_pipe_wsl}\n"
                yield f"[INFO] Training stages: {stages}\n"
                yield f"[INFO] Action folder: {action_root}\n"
                yield f"[INFO] Captured input: {bundle['inputPath']}\n"
                yield f"[INFO] Captured media items: {bundle['capturedItemCount']}\n"
                summary = bundle.get("summary") or {}
                actions = summary.get("captureActions") or {}
                if actions:
                    yield "[INFO] Capture actions: " + ", ".join(
                        str(name) + "=" + str(count) for name, count in sorted(actions.items())
                    ) + "\n"
                for stage in stage_names:
                    yield f"[INFO] Effective output {stage.upper()}: {output_dirs[stage]}\n"
                if resume_from_checkpoint:
                    yield f"[INFO] Resume {resume_stage.upper()} checkpoint: {resume_from_checkpoint}\n"
                if stages in ("krea2", "wan21", "h3"):
                    yield f"[INFO] Config {selected_profile['label']}: {lo_wsl}\n"
                else:
                    yield f"[INFO] Config HI: {hi_wsl}\n"
                    yield f"[INFO] Config LO: {lo_wsl}\n"
                yield "[INFO] Manual training command (copy/paste):\n"
                yield handoff_cmd + "\n"
                yield "[train] Manual handoff only; run this command in WSL yourself.\n"
            except Exception as e:
                yield f"[ERROR] {e}\n"

        return Response(stream_with_context(generate()), mimetype="text/plain")
    except ValueError as e:
        return Response(f"[ERROR] {e}\n", status=400, mimetype="text/plain")
    except Exception as e:
        app_config.debug_traceback()
        return Response(f"[ERROR] {e}\n", status=500, mimetype="text/plain")
