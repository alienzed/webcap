import os
import re
from pathlib import Path


_EPOCH_CONFIG_PATTERN = re.compile(r"^\s*epochs\s*=\s*(\d+)\s*(?:#.*)?$", re.MULTILINE)
_SAVE_EPOCH_CONFIG_PATTERN = re.compile(r"^\s*save_every_n_epochs\s*=\s*(\d+)\s*(?:#.*)?$", re.MULTILINE)
_CHECKPOINT_EPOCH_CONFIG_PATTERN = re.compile(r"^\s*checkpoint_every_n_epochs\s*=\s*(\d+)\s*(?:#.*)?$", re.MULTILINE)
_LOG_EPOCH_PATTERN = re.compile(r"Started new epoch:\s*(\d+)", re.IGNORECASE)
_LOG_STEP_PATTERN = re.compile(r"\bstep=(\d+)", re.IGNORECASE)
_LOG_ITER_TIME_PATTERN = re.compile(r"\biter time \(s\):\s*(\d+(?:\.\d+)?)", re.IGNORECASE)
ETA_MIN_SAMPLES = 3
ETA_SAMPLE_WINDOW = 8


def normalize_training_stages(stages):
    value = str(stages or "both").strip().lower()
    if value not in ("hi", "lo", "both", "krea2", "wan21", "h3"):
        raise ValueError("Training stage must be hi, lo, both, krea2, wan21, or h3.")
    return value


def read_config_epochs(path):
    try:
        text = Path(str(path or "")).read_text(encoding="utf-8")
    except OSError:
        return 0
    match = _EPOCH_CONFIG_PATTERN.search(text)
    return int(match.group(1)) if match else 0


def read_config_checkpoint_interval(path):
    try:
        text = Path(str(path or "")).read_text(encoding="utf-8")
    except OSError:
        return 0
    match = _CHECKPOINT_EPOCH_CONFIG_PATTERN.search(text)
    return int(match.group(1)) if match else 0


def read_config_save_interval(path):
    try:
        text = Path(str(path or "")).read_text(encoding="utf-8")
    except OSError:
        return 0
    match = _SAVE_EPOCH_CONFIG_PATTERN.search(text)
    return int(match.group(1)) if match else 0


def read_log_tail(path, byte_count=4096):
    try:
        with Path(path).open("rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            handle.seek(max(0, size - byte_count))
            return handle.read().decode("utf-8", errors="replace")
    except OSError:
        return ""


def recent_seconds_per_step(log_text, stage):
    marker = "[webcap] stage=" + str(stage or "").lower()
    stage_log = str(log_text or "")
    marker_index = stage_log.lower().rfind(marker)
    if marker_index >= 0:
        stage_log = stage_log[marker_index:]
    samples = [float(value) for value in _LOG_ITER_TIME_PATTERN.findall(stage_log)[-ETA_SAMPLE_WINDOW:]]
    samples = [value for value in samples if value > 0]
    if len(samples) < ETA_MIN_SAMPLES:
        return None
    return sum(samples) / len(samples)


def log_has_progress(log_text):
    return bool(_LOG_EPOCH_PATTERN.search(log_text or "") or _LOG_STEP_PATTERN.search(log_text or ""))


def sync_job_progress(job, log_text):
    stage = str(job.get("stage") or "").lower()
    if stage not in ("hi", "lo", "krea2", "wan21", "h3"):
        job.pop("progress", None)
        return

    snapshot = job.get("snapshot") if isinstance(job.get("snapshot"), dict) else {}
    current_epochs = read_config_epochs(snapshot.get(stage, ""))
    save_every_epochs = read_config_save_interval(snapshot.get(stage, ""))
    checkpoint_every_epochs = read_config_checkpoint_interval(snapshot.get(stage, ""))
    if not current_epochs:
        job.pop("progress", None)
        return

    previous = job.get("progress") if isinstance(job.get("progress"), dict) else {}
    previous_epoch = previous.get("epoch") if previous.get("stage") == stage else None
    epoch_matches = _LOG_EPOCH_PATTERN.findall(log_text or "")
    step_matches = _LOG_STEP_PATTERN.findall(log_text or "")
    epoch = int(epoch_matches[-1]) if epoch_matches else previous_epoch
    step = int(step_matches[-1]) if step_matches else previous.get("step")
    plan = job.get("progressPlan") if isinstance(job.get("progressPlan"), dict) else {}
    stage_plan = plan.get(stage) if isinstance(plan.get(stage), dict) else {}
    planned_steps = int(stage_plan.get("estimatedSteps") or 0)
    use_steps = epoch is None and step is not None and planned_steps > 0
    if not use_steps and epoch is None:
        return
    stage_fraction = min(1.0, max(0.0, float(step) / float(planned_steps))) if use_steps else min(1.0, max(0.0, float(epoch) / float(current_epochs)))

    stages = normalize_training_stages(job.get("stages"))
    hi_planned_steps = int((plan.get("hi") or {}).get("estimatedSteps") or 0) if isinstance(plan.get("hi"), dict) else 0
    lo_planned_steps = int((plan.get("lo") or {}).get("estimatedSteps") or 0) if isinstance(plan.get("lo"), dict) else 0
    hi_epochs = read_config_epochs(snapshot.get("hi", ""))
    lo_epochs = read_config_epochs(snapshot.get("lo", ""))
    if stages == "both" and use_steps and hi_planned_steps and lo_planned_steps:
        total_steps = hi_planned_steps + lo_planned_steps
        overall_fraction = (stage_fraction * hi_planned_steps / total_steps) if stage == "hi" else ((hi_planned_steps + stage_fraction * lo_planned_steps) / total_steps)
    elif stages == "both" and hi_epochs and lo_epochs:
        total_epochs = hi_epochs + lo_epochs
        overall_fraction = (stage_fraction * hi_epochs / total_epochs) if stage == "hi" else ((hi_epochs + stage_fraction * lo_epochs) / total_epochs)
    else:
        overall_fraction = stage_fraction

    progress = {
        "stage": stage,
        "epoch": int(epoch) if epoch is not None else None,
        "epochs": int(current_epochs),
        "step": int(step) if step is not None else None,
        "stagePercent": round(stage_fraction * 100, 1),
        "overallPercent": round(overall_fraction * 100, 1),
        "estimated": use_steps,
    }
    if use_steps:
        progress["plannedSteps"] = planned_steps
        progress["source"] = "steps"
    else:
        progress["source"] = "epochs"
    if save_every_epochs:
        progress["saveEveryNEpochs"] = save_every_epochs
    seconds_per_step = recent_seconds_per_step(log_text, stage)
    if step is not None and seconds_per_step is not None:
        progress["estimatedTrainingSeconds"] = round(max(0, step) * seconds_per_step)
    if step is not None and seconds_per_step is not None and (planned_steps > 0 or epoch is not None):
        if epoch is not None and stage_fraction > 0:
            estimated_stage_steps = float(step) / stage_fraction
            remaining_steps = max(0.0, estimated_stage_steps - float(step))
        else:
            remaining_steps = max(0, planned_steps - step)
        eta_scope = "completion"
        if stages == "both" and stage == "hi":
            next_stage_steps = lo_planned_steps
            if next_stage_steps > 0:
                remaining_steps += next_stage_steps
            else:
                eta_scope = "stage"
        progress["etaSeconds"] = round(remaining_steps * seconds_per_step)
        progress["etaScope"] = eta_scope
    if epoch is not None and checkpoint_every_epochs:
        completed_epochs = max(0, int(epoch) - 1)
        next_checkpoint_epoch = ((completed_epochs // checkpoint_every_epochs) + 1) * checkpoint_every_epochs
        if next_checkpoint_epoch <= current_epochs:
            progress["checkpointEveryNEpochs"] = checkpoint_every_epochs
            progress["nextCheckpointEpoch"] = next_checkpoint_epoch
            if planned_steps > 0 and seconds_per_step is not None:
                checkpoint_steps = max(0.0, (next_checkpoint_epoch - float(epoch) + 1) * planned_steps / float(current_epochs))
                progress["checkpointEtaSeconds"] = round(checkpoint_steps * seconds_per_step)
    job["progress"] = progress


def annotate_completed_job(job):
    if job.get("status") != "completed":
        return
    progress = job.get("progress") if isinstance(job.get("progress"), dict) else {}
    epoch = int(progress.get("epoch") or 0)
    epochs = int(progress.get("epochs") or 0)
    if epochs:
        if epoch < epochs * 0.9:
            job["completionNote"] = (
                "Finished at epoch " + format(epoch, ",") + " of " + format(epochs, ",")
                + " planned epochs. Review output; the run ended below the planned estimate."
            )
        else:
            job.pop("completionNote", None)
        return
    step = int(progress.get("step") or 0)
    planned_steps = int(progress.get("plannedSteps") or 0)
    if planned_steps and step < planned_steps * 0.9:
        job["completionNote"] = (
            "Finished at step " + format(step, ",") + " of ~" + format(planned_steps, ",")
            + " planned steps. Review output; the run ended below the planned estimate."
        )
    else:
        job.pop("completionNote", None)


def annotate_finished_early_job(job):
    if job.get("status") != "finished_early":
        return
    progress = job.get("progress") if isinstance(job.get("progress"), dict) else {}
    details = []
    epoch = progress.get("epoch")
    epochs = progress.get("epochs")
    step = progress.get("step")
    if isinstance(epoch, (int, float)) and isinstance(epochs, (int, float)) and epochs:
        details.append("epoch " + str(int(epoch)) + " / " + str(int(epochs)))
    if isinstance(step, (int, float)):
        details.append("step " + format(int(step), ","))
    job["completionNote"] = "Finished early" + (" at " + " · ".join(details) if details else ".")
