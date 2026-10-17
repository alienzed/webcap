"""Backend-owned, disposable Epoch Finder campaigns using existing Test and VL queues."""
import io
import json
import math
import os
import re
import secrets
import shutil
import threading
import time
from pathlib import Path

from . import config as app_config
from . import epoch_test_bench as test_bench
from .epoch_finder_plan import normalize_dimensions
from .caption_vision import build_vision_question_messages, build_reference_comparison_messages, vision_resized_image_data_url
from .llm_runner import enqueue as enqueue_llm, job_status as llm_job_status
from .test_models import get_test_model_for_staging_key
from .training_history import all_history_payload
from .training_runner import passive_status_snapshot
from .training_runner import (
    _candidate_run_snapshot, _candidate_safetensors_path,
    _candidate_test_directory_for_run, candidate_run_folder_path,
)
from .training_candidates import saved_artifacts_for_run
from .video_frame_ops import VIDEO_EXTS, extract_boundary_frame_png


_workers = {}
_controls = {}
_pending_campaigns = []  # FIFO of (validated folder, campaign id); no new execution lane.
_worker_lock = threading.Lock()
_ID = re.compile(r"^[a-f0-9]{12}$")
_FRAME = re.compile(r"^r[0-9]+-e[0-9]+-c[0-9]+\.png$")


def _folder_key(folder_path):
    return test_bench._relative_set_folder(folder_path)


def _root(folder_path):
    return test_bench._workspace_root(folder_path) / "epoch-finder"


def _directory(folder_path, campaign_id):
    if not _ID.fullmatch(str(campaign_id or "")):
        raise ValueError("Invalid Epoch Finder campaign ID.")
    return _root(folder_path) / campaign_id


def _load(folder_path, campaign_id):
    directory = _directory(folder_path, campaign_id)
    if directory.is_symlink():
        raise RuntimeError("Campaign directory must not be a symlink.")
    path = directory / "campaign.json"
    if not path.is_file() or path.is_symlink():
        raise FileNotFoundError("Epoch Finder campaign does not exist.")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("id") != campaign_id or payload.get("folder") != _folder_key(folder_path):
        raise ValueError("Epoch Finder campaign ownership mismatch.")
    return payload


def _save(folder_path, campaign):
    test_bench._atomic_write_json(_directory(folder_path, campaign["id"]) / "campaign.json", campaign)


def _requires_reference(role):
    """Only Primary attributes need training references; legacy VL still scores Leakage."""
    return role == "primary"


def _runs(folder_path):
    folder = _folder_key(folder_path)
    result = []
    # Queue and history are distinct views: paused/resumable jobs leave History.
    # The existing run snapshot resolver already supports either owner.
    queue, code = passive_status_snapshot()
    if code != 200 or not queue.get("ok"):
        raise RuntimeError(str(queue.get("error") or "Training queue unavailable."))
    seen = set()
    jobs = list(queue.get("jobs") or []) + list(all_history_payload(folder=folder).get("jobs") or [])
    for job in jobs:
        if str(job.get("folder") or "").strip().replace("\\", "/").strip("/") != folder:
            continue
        job_id = str(job.get("id") or "")
        if not job_id or job_id in seen:
            continue
        seen.add(job_id)
        try:
            _path, run = _candidate_run_snapshot(folder, job_id)
            model = get_test_model_for_staging_key(str(run.get("stages") or ""))
            artifacts = saved_artifacts_for_run(candidate_run_folder_path(folder, job_id))
            epochs = [a["epoch"] for a in artifacts if a.get("status") == "available"]
        except (LookupError, FileNotFoundError, ValueError, RuntimeError, OSError):
            continue
        if epochs:
            result.append({
                "jobId": job_id, "runName": run.get("runName") or job_id,
                "modelId": model.PROFILE_ID, "stage": model.STAGING_KEY,
                "epochs": epochs,
            })
    return result


def _timing_key(campaign, plan):
    settings = plan["settings"]
    return "|".join((
        str(campaign["modelId"]),
        str(settings.get("megapixels", settings.get("dimensions", ""))),
        str(settings.get("duration", "")),
    ))


def _timing_profiles(folder_path):
    """Read measured render and VL durations from existing campaign records."""
    profiles = {}
    root = _root(folder_path)
    if not root.is_dir():
        return profiles
    for directory in root.iterdir():
        if not directory.is_dir() or directory.is_symlink() or not _ID.fullmatch(directory.name):
            continue
        try:
            campaign = _load(folder_path, directory.name)
        except (OSError, ValueError, json.JSONDecodeError):
            continue
        rounds = {plan["number"]: plan for plan in campaign["rounds"]}
        seen = set()
        for unit in campaign["units"]:
            plan = rounds.get(unit.get("round"))
            if plan is None:
                continue
            key = _timing_key(campaign, plan)
            render = unit.get("renderSeconds")
            vision = unit.get("visionWallSeconds")
            if key not in seen and isinstance(render, (int, float)) and render > 0:
                seen.add(key)
                render = None  # First completed render may include model loading.
            entry = profiles.setdefault(key, {"seconds": [], "visionSeconds": []})
            if isinstance(render, (int, float)) and render > 0:
                entry["seconds"].append(round(render, 2))
            if isinstance(vision, (int, float)) and vision > 0:
                entry["visionSeconds"].append(round(vision, 2))
    for entry in profiles.values():
        entry["seconds"] = entry["seconds"][-20:]
        entry["visionSeconds"] = entry["visionSeconds"][-20:]
    return profiles


def list_campaigns(folder_path):
    root = _root(folder_path)
    campaigns = []
    if root.is_dir():
        for directory in root.iterdir():
            if not directory.is_dir() or directory.is_symlink() or not _ID.fullmatch(directory.name):
                continue
            try:
                campaign = _load(folder_path, directory.name)
            except (ValueError, OSError, json.JSONDecodeError):
                continue
            campaigns.append({
                key: campaign.get(key) for key in
                ("id", "name", "status", "phase", "round", "startedAt", "detail", "modelId", "runName")
            })
    campaigns.sort(key=lambda row: row.get("startedAt") or 0, reverse=True)
    return {"runs": _runs(folder_path), "campaigns": campaigns, "timings": _timing_profiles(folder_path)}



def checkpoint_evidence(folder_path, job_id):
    """Read-only evidence for a training run, retaining each campaign's protocol.

    The identity is the saved run ID plus epoch number; no scores are
    averaged across different prompts, seeds or evaluator configurations.
    """
    job_id = str(job_id or "").strip()
    if not job_id:
        raise ValueError("Select a training run to inspect checkpoint evidence.")
    checkpoints = {}
    root = _root(folder_path)
    if not root.is_dir():
        return {"jobId": job_id, "checkpoints": []}
    for directory in root.iterdir():
        if not directory.is_dir() or directory.is_symlink() or not _ID.fullmatch(directory.name):
            continue
        campaign = _load(folder_path, directory.name)
        if campaign.get("jobId") != job_id or not campaign.get("rounds"):
            continue
        for row in _rank(campaign, len(campaign["rounds"])):
            epoch = row["epoch"]
            units = [unit for unit in campaign.get("units", [])
                     if unit.get("epoch") == epoch]
            observations = [unit for unit in units if unit.get("assessment") is not None]
            reference_verdicts = {"MATCH": 0, "PARTIAL": 0, "MISMATCH": 0, "UNCLEAR": 0}
            for unit in units:
                for assessment in unit.get("referenceAssessments") or []:
                    verdict = assessment.get("verdict")
                    if verdict in reference_verdicts:
                        reference_verdicts[verdict] += 1
            entry = {
                "campaignId": campaign["id"], "campaignName": campaign.get("name", ""),
                "status": campaign.get("status"), "score": row["score"],
                "weightedObservations": row["count"], "evaluatedRenders": len(observations),
                "failedRenders": sum(bool(unit.get("error")) for unit in units),
                "rvnVerdicts": reference_verdicts,
                "dinoComparisons": sum(len(unit.get("dinoAssessments") or []) for unit in units),
                "visionModel": campaign.get("visionModel"),
                "referenceEvaluation": campaign.get("referenceEvaluation", {}),
            }
            checkpoints.setdefault(epoch, []).append(entry)
    return {"jobId": job_id, "checkpoints": [
        {"epoch": epoch, "campaigns": sorted(entries, key=lambda entry: entry["campaignId"])}
        for epoch, entries in sorted(checkpoints.items())
    ]}



def _create_plan(epochs, prompt, rounds, cases, keep_percent, settings, round_options=None):
    plan = []
    options_by_round = round_options if round_options is not None else []
    if options_by_round and len(options_by_round) != rounds:
        raise ValueError("Provide settings for every planned round.")
    for index in range(rounds):
        edits = options_by_round[index] if options_by_round else {}
        if not isinstance(edits, dict):
            raise ValueError("Each Epoch Finder round must be an object.")
        case_count = int(edits.get("cases", cases))
        retention = int(edits.get("keepPercent", keep_percent))
        if not 1 <= case_count <= 6 or not 10 <= retention <= 90:
            raise ValueError("Each round needs 1-6 tests and 10-90% retention.")
        seeds = [secrets.randbelow(2 ** 32) for _ in range(case_count)]
        selected = dict(settings)
        if "megapixels" in selected:
            resolution = float(edits.get("megapixels", min(0.4, round(0.2 + index * 0.1, 2))))
            if not 0.1 <= resolution <= 0.4 or not math.isfinite(resolution):
                raise ValueError("Epoch Finder round resolution must be 0.1-0.4 MP.")
            selected["megapixels"] = resolution
        elif "megapixels" in edits:
            raise ValueError("Selected Test model does not support resolution in megapixels.")
        if "dimensions" in selected:
            resolution = str(edits.get("dimensions", selected["dimensions"])).strip()
            if not resolution:
                raise ValueError("Select a Krea resolution preset for every round.")
            selected["dimensions"] = resolution
        elif "dimensions" in edits:
            raise ValueError("Selected Test model does not support dimension presets.")
        plan.append({"number": index + 1, "epochs": list(epochs) if index == 0 else [],
                     "seeds": seeds, "settings": selected,
                     "keepPercent": retention, "prompt": prompt})
    return plan



def create_campaign(folder_path, criteria):
    criteria = criteria if isinstance(criteria, dict) else {}
    folder = _folder_key(folder_path)
    job_id = str(criteria.get("jobId") or "").strip()
    runs = {run["jobId"]: run for run in _runs(folder_path)}
    if job_id not in runs:
        raise ValueError("Select a training run with available saved epochs.")
    run = runs[job_id]
    available = set(run["epochs"])
    selected_epochs = criteria.get("epochs", run["epochs"])
    if (not isinstance(selected_epochs, list) or not selected_epochs or
            any(type(epoch) is not int or epoch not in available for epoch in selected_epochs) or
            len(selected_epochs) != len(set(selected_epochs))):
        raise ValueError("Select one or more distinct available epochs from this training run.")
    selected_epochs = sorted(selected_epochs)
    model = get_test_model_for_staging_key(run["stage"])
    model.load_template()
    prompt = str(criteria.get("prompt") or "").strip()
    dimensions = normalize_dimensions(prompt, criteria.get("dimensions"))
    vision_model = str(criteria.get("visionModel") or "").strip()
    vl_image_mp = float(criteria.get("vlImageMP", 0.45))
    if not math.isfinite(vl_image_mp) or not 0.1 <= vl_image_mp <= 1.6:
        raise ValueError("VL image size must be between 0.1 and 1.6 MP.")
    from .storyboard_llm_runtime import list_vision_models
    if vision_model not in {str(item.get("id") or "") for item in list_vision_models()}:
        raise ValueError("Select an available Vision model.")
    rounds = int(criteria.get("rounds") or 2)
    cases = int(criteria.get("cases") or 2)
    keep_percent = int(criteria.get("keepPercent") or 50)
    if not 1 <= rounds <= 4 or not 1 <= cases <= 6 or not 10 <= keep_percent <= 90:
        raise ValueError("Use 1-4 rounds, 1-6 tests per epoch, and 10-90% retention.")
    settings = criteria.get("settings") if isinstance(criteria.get("settings"), dict) else {}
    settings = {key: value for key, value in settings.items() if key in model.settings}
    # Existing Test model owns actual setting normalization and validation.
    template = model.load_template()
    model.normalize_settings(template, lambda: 1, dict(settings, seed=1))
    plans = _create_plan(selected_epochs, prompt, rounds, cases, keep_percent, settings, criteria.get("roundPlans"))
    for round_plan in plans:
        model.normalize_settings(template, lambda: 1, dict(round_plan["settings"], seed=1))
    from .epoch_reference import verified_reference
    reference_choices = criteria.get("referencePlan")
    if not isinstance(reference_choices, list):
        raise ValueError("Approve a training reference for every Primary wildcard option.")
    approved = {}
    for entry in reference_choices:
        if not isinstance(entry, dict):
            raise ValueError("Invalid reference selection.")
        key = (str(entry.get("attribute") or ""), str(entry.get("option") or ""))
        if key in approved:
            raise ValueError("Duplicate approved reference.")
        approved[key] = entry
    required = {(dimension["label"], option) for dimension in dimensions
                if _requires_reference(dimension["role"]) for option in dimension["options"]}
    if not set(approved).issubset(required):
        raise ValueError("Only Primary wildcard choices may have training references.")
    references = []
    for (attribute, option), entry in sorted(approved.items()):
        group = str(entry.get("group") or "")
        media = str(entry.get("media") or "")
        tag = str(entry.get("tag") or option)
        reference = verified_reference(folder, group, tag, media, job_id)
        references.append({"attribute": attribute, "option": option, "group": group,
                           "tag": tag, **reference})
    evaluation = criteria.get("referenceEvaluation")
    if not isinstance(evaluation, dict) or any(type(evaluation.get(k)) is not bool for k in ("rvn", "dino")):
        raise ValueError("Select reference evaluation mechanisms explicitly.")
    if evaluation["dino"]:
        from .epoch_dino import preflight as dino_preflight
        dino_preflight()
    parent_id = str(criteria.get("parentCampaignId") or "")
    if parent_id:
        parent = _load(folder_path, parent_id)
        if parent.get("jobId") != job_id:
            raise ValueError("Follow-up must use the same source training run.")
    campaign_id = secrets.token_hex(6)
    directory = _directory(folder_path, campaign_id)
    directory.mkdir(parents=True, exist_ok=False)
    (directory / "frames").mkdir()
    campaign = {
        "version": 1, "id": campaign_id, "folder": folder, "jobId": job_id,
        "parentCampaignId": parent_id or None,
        "runName": run["runName"], "modelId": model.PROFILE_ID, "stage": run["stage"],
        "name": str(criteria.get("name") or run["runName"]).strip()[:120],
        "status": "paused", "phase": "Ready", "detail": "Ready to generate.",
        "round": 1, "rounds": plans,
        "visionModel": vision_model, "vlImageMP": vl_image_mp, "dimensions": dimensions,
        "referencePlan": references, "referenceEvaluation": {"rvn": evaluation["rvn"], "dino": evaluation["dino"]}, "concept": str(criteria.get("concept") or "").strip(),
        "units": [], "scores": [], "startedAt": time.time(),
        "finishedAt": None,
    }
    _save(folder_path, campaign)
    _launch(folder_path, campaign_id)
    return campaign


def _staging(folder_path, campaign):
    # Saved campaigns must remain manageable even after training history is
    # cleared. Resolve the known Test model's configured staging root directly.
    model = get_test_model_for_staging_key(campaign["stage"])
    base = test_bench._test_directory(folder_path, model)
    directory = base / ("epoch-finder-" + campaign["id"])
    if directory.is_symlink():
        raise RuntimeError("Epoch Finder staging folder is a symlink.")
    return directory


def _stage_epoch(folder_path, campaign, epoch):
    directory = _staging(folder_path, campaign)
    directory.mkdir(parents=True, exist_ok=True)
    source = _candidate_safetensors_path(_folder_key(folder_path), campaign["jobId"], epoch)
    target = directory / ("epoch" + str(epoch) + ".safetensors")
    if target.exists():
        if target.is_symlink() or target.stat().st_size != source.stat().st_size:
            raise RuntimeError("Campaign checkpoint copy is incomplete or unexpected: " + str(target))
    else:
        try:
            with source.open("rb") as incoming, target.open("xb") as outgoing:
                shutil.copyfileobj(incoming, outgoing)
        except Exception:
            target.unlink(missing_ok=True)
            raise
    return directory.name + "/" + target.name


def _clean_staging(folder_path, campaign):
    directory = _staging(folder_path, campaign)
    if not directory.exists():
        return
    if directory.is_symlink():
        raise RuntimeError("Refusing to remove symlinked Epoch Finder staging.")
    for entry in directory.iterdir():
        if entry.is_symlink() or not re.fullmatch(r"epoch[0-9]+\.safetensors", entry.name) or not entry.is_file():
            raise RuntimeError("Unexpected item in temporary Epoch Finder staging: " + str(entry))
        entry.unlink()
    directory.rmdir()


def _update(folder_path, campaign, **changes):
    campaign.update(changes)
    _save(folder_path, campaign)


def _check_signal(folder_path, campaign, control):
    if control["stop"].is_set():
        _update(folder_path, campaign, status="stopped", phase="Stopped",
                detail="Stopped after the current operation.", finishedAt=time.time())
        return False
    if control["pause"].is_set():
        _update(folder_path, campaign, status="paused", phase="Paused",
                detail="Paused after the current operation.")
        return False
    return True


def _unit(campaign, round_number, epoch, case):
    for existing in campaign["units"]:
        if existing["round"] == round_number and existing["epoch"] == epoch and existing["case"] == case:
            return existing
    value = {"round": round_number, "epoch": epoch, "case": case, "session": "",
             "frame": "", "question": "", "groups": [], "assessment": None,
             "error": "", "errorStage": "", "captured": False, "framePruned": False,
             "queuedAt": None, "captureWallSeconds": None}
    campaign["units"].append(value)
    return value


def _question(groups):
    if not groups:
        return "Describe this image using only visible evidence, including distinctive details."
    return (
        "Inspect the image and choose the best visible option for EVERY numbered attribute below. "
        "Respond with exactly one line per group, e.g. G1: 2. Use only the option number, "
        'or "unclear" if you cannot see it, or "none" if no option fits. '
        'If "(absent)" is an option, select its number when that attribute is absent. '
        "Do not assume any option is present; use only visible evidence.\n\n" +
        "\n".join(g["id"] + " (" + g["label"] + "): " +
                  "; ".join(str(i + 1) + "=" + (value or "(absent)")
                            for i, value in enumerate(g["options"]))
                  for g in groups)
    )


def _compare(answer, groups):
    lines = str(answer or "").splitlines()
    comparison = []
    for group in groups:
        matches = [line for line in lines if re.match(r"^\s*" + re.escape(group["id"]) + r"\s*[:=-]\s*", line, re.I)]
        value = re.sub(r"^\s*" + re.escape(group["id"]) + r"\s*[:=-]\s*", "", matches[0], flags=re.I).strip() if len(matches) == 1 else ""
        selected = int(value) if value.isdigit() and 1 <= int(value) <= len(group["options"]) else None
        expected = group.get("expected")
        result = ("unclear" if expected is None else
                  "match" if selected == expected else
                  "mismatch" if selected is not None or re.fullmatch(r"none(?: of these)?", value, re.I) else
                  "unclear")
        comparison.append({"id": group["id"], "label": group["label"],
                           "weight": float(group.get("weight", 1)),
                           "expected": expected, "selected": selected, "result": result})
    return comparison


def _wait_for_session(folder_path, campaign, unit):
    while True:
        session = test_bench.open_session(folder_path, unit["session"])
        phase = str(session.get("status") or "")
        if phase in {"complete", "failed", "stopped", "interrupted"}:
            if phase != "complete" or not session.get("results"):
                raise RuntimeError("Test render " + unit["session"] + " ended as " + phase +
                                   ": " + str(session.get("error") or session.get("failures") or ""))
            return session
        # A paused inference queue stays authoritative. No lane manipulation.
        time.sleep(2)


def _render_unit(folder_path, campaign, plan, unit, staged, enqueue_only=False):
    if unit["frame"]:
        return
    if not unit["session"]:
        settings = dict(plan["settings"], seed=plan["seeds"][unit["case"]])
        answer = test_bench.enqueue(
            folder_path, plan["prompt"], settings=settings,
            name="Epoch Finder " + str(unit["epoch"]) + " / " + str(unit["case"] + 1),
            selected_files=[staged], candidate_strengths={Path(staged).name: 1.0},
            include_base=False, model_id=campaign["modelId"],
            campaign_staging="epoch-finder-" + campaign["id"],
        )
        unit["session"] = answer["job"]["id"]
        unit["queuedAt"] = time.time()
        _save(folder_path, campaign)
    if enqueue_only:
        return
    status = _wait_for_session(folder_path, campaign, unit)
    result = status["results"][0]
    media = test_bench.resolve_result_media(folder_path, unit["session"], result["mediaFile"])
    file_name = "r" + str(unit["round"]) + "-e" + str(unit["epoch"]) + "-c" + str(unit["case"]) + ".png"
    frame = _directory(folder_path, campaign["id"]) / "frames" / file_name
    if media.suffix.lower() in VIDEO_EXTS:
        pixels = extract_boundary_frame_png(media, "first")
    elif media.suffix.lower() == ".png":
        pixels = media.read_bytes()
    elif media.suffix.lower() in {".jpg", ".jpeg", ".webp", ".bmp"}:
        from PIL import Image
        with Image.open(media) as image, io.BytesIO() as buffer:
            image.save(buffer, format="PNG")
            pixels = buffer.getvalue()
    else:
        raise ValueError("Epoch Finder expected supported Test video or image output.")
    temp = frame.with_suffix(".tmp")
    try:
        temp.write_bytes(pixels)
        os.replace(temp, frame)
    finally:
        temp.unlink(missing_ok=True)
    unit["frame"] = file_name
    unit["captured"] = True
    if unit.get("queuedAt"):
        unit["captureWallSeconds"] = round(time.time() - unit["queuedAt"], 2)
    elapsed_ms = result.get("elapsedMs")
    if isinstance(elapsed_ms, (int, float)) and elapsed_ms > 0:
        unit["renderSeconds"] = round(elapsed_ms / 1000, 2)
    unit["groups"] = status.get("wildcardEvaluationGroups") or []
    if len(unit["groups"]) != len(campaign["dimensions"]):
        raise RuntimeError("Resolved wildcard group count differs from the approved plan.")
    for group, dimension in zip(unit["groups"], campaign["dimensions"]):
        if group.get("options") != dimension["options"]:
            raise RuntimeError("Resolved wildcard attributes diverged from the approved plan.")
        group.update({"label": dimension["label"], "role": dimension["role"], "weight": dimension["weight"]})
    unit["question"] = _question(unit["groups"])
    unit["prompt"] = status.get("resolvedPrompt") or status.get("prompt") or ""
    _save(folder_path, campaign)
    # Preserve source media until the VL assessment has been saved.



def _retire_scored_session(folder_path, campaign, unit):
    """Discard campaign-owned source media only after a durable VL score."""
    if unit.get("assessment") is None or not unit.get("session"):
        return
    try:
        test_bench.delete_session(folder_path, unit["session"])
    except FileNotFoundError:
        pass
    unit["session"] = ""
    _save(folder_path, campaign)


def _prune_screening_frames(folder_path, campaign):
    """Keep final field frames and all unscored failure evidence."""
    finalists = set(campaign["rounds"][-1]["epochs"])
    for unit in campaign["units"]:
        if (unit["epoch"] in finalists or unit.get("assessment") is None or not unit.get("frame")
                or unit.get("referenceError") or unit.get("dinoError")):
            continue
        frame = _directory(folder_path, campaign["id"]) / "frames" / unit["frame"]
        if frame.is_symlink():
            raise RuntimeError("Refusing to prune a symlinked campaign frame.")
        frame.unlink(missing_ok=True)
        unit["frame"] = ""
        unit["framePruned"] = True
        _save(folder_path, campaign)


def _evaluate_unit(folder_path, campaign, unit):
    if unit["assessment"] is not None:
        return
    frame = _directory(folder_path, campaign["id"]) / "frames" / unit["frame"]
    vision_started = time.monotonic()
    job = enqueue_llm("caption", campaign["visionModel"], {
        "operation": "vision_question",
        "messages": build_vision_question_messages(unit["question"], vision_resized_image_data_url(frame, int(campaign.get("vlImageMP", 0.45) * 1000000)))
    }, label="Epoch Finder Ask VL")
    job_id = str(job.get("jobId") or job.get("id") or "")
    if not job_id:
        raise RuntimeError("VL request did not return an execution job ID.")
    while True:
        result = llm_job_status(job_id, consume=False)
        if not result:
            raise RuntimeError("Epoch Finder VL request was lost.")
        if result["status"] in {"completed", "failed", "cancelled", "stopped", "interrupted"}:
            if result["status"] != "completed":
                raise RuntimeError("VL request " + result["status"] + ": " + str(result.get("error") or ""))
            answer = str((result.get("result") or {}).get("text") or "").strip()
            unit["visionWallSeconds"] = round(time.monotonic() - vision_started, 2)
            unit["assessment"] = {
                "modelId": campaign["visionModel"], "text": answer,
                "comparison": _compare(answer, unit["groups"]),
            }
            _save(folder_path, campaign)
            llm_job_status(job_id, consume=True)
            return
        time.sleep(1)


def _evaluate_reference_unit(folder_path, campaign, unit):
    """Add paired VL evidence without altering original attribute judgments."""
    if not campaign.get("referenceEvaluation", {}).get("rvn") or unit.get("referenceComplete"):
        return
    frame = _directory(folder_path, campaign["id"]) / "frames" / unit["frame"]
    if not frame.is_file():
        raise FileNotFoundError("Generated comparison frame is unavailable.")
    from .epoch_reference import verified_reference
    references = {(entry["attribute"], entry["option"]): entry for entry in campaign["referencePlan"]}
    outcomes = list(unit.get("referenceAssessments") or [])
    completed_groups = {row["groupId"] for row in outcomes}
    for group in unit.get("groups", []):
        if group["id"] in completed_groups:
            continue
        if not _requires_reference(group.get("role")) or group.get("expected") is None:
            continue
        expected = group["options"][group["expected"] - 1]
        assigned = references.get((group["label"], expected))
        if assigned is None:
            continue
        verified = verified_reference(_folder_key(folder_path), assigned["group"], assigned.get("tag") or expected, assigned["media"], campaign["jobId"])
        if verified["size"] != assigned["size"] or verified["mtimeNs"] != assigned["mtimeNs"]:
            raise ValueError("Training reference changed after campaign approval.")
        reference = folder_path / assigned["media"]
        question = (group["label"] + " — training reference demonstrates " + expected + ". "
                    "Select the visible option in B from: " +
                    "; ".join(str(index + 1) + "=" + option for index, option in enumerate(group["options"])))
        messages = build_reference_comparison_messages(
            question,
            vision_resized_image_data_url(reference, int(campaign.get("vlImageMP", .45) * 1000000)),
            vision_resized_image_data_url(frame, int(campaign.get("vlImageMP", .45) * 1000000)))
        started = time.monotonic()
        job = enqueue_llm("caption", campaign["visionModel"], {"operation": "vision_question", "messages": messages},
                          label="Epoch Finder Reference VL")
        job_id = str(job.get("jobId") or job.get("id") or "")
        if not job_id:
            raise RuntimeError("Reference VL request did not return a job ID.")
        while True:
            result = llm_job_status(job_id, consume=False)
            if not result:
                raise RuntimeError("Reference VL request lost.")
            if result["status"] in {"completed", "failed", "cancelled", "stopped", "interrupted"}:
                if result["status"] != "completed":
                    raise RuntimeError("Reference VL failed: " + str(result.get("error") or result["status"]))
                answer = str((result.get("result") or {}).get("text") or "").strip()
                option_line = next((line for line in answer.splitlines() if re.match(r"^OPTION\s*:", line, re.I)), "")
                verdict_line = next((line for line in answer.splitlines() if re.match(r"^VERDICT\s*:", line, re.I)), "")
                option_value = option_line.partition(":")[2].strip()
                selected = int(option_value) if option_value.isdigit() and 1 <= int(option_value) <= len(group["options"]) else None
                verdict = verdict_line.partition(":")[2].strip().upper()
                if verdict not in {"MATCH", "PARTIAL", "MISMATCH", "UNCLEAR"}:
                    verdict = "UNCLEAR"
                outcomes.append({"groupId": group["id"], "label": group["label"], "option": expected,
                                 "reference": assigned["media"], "selected": selected, "verdict": verdict,
                                 "response": answer, "modelId": campaign["visionModel"],
                                 "elapsedSeconds": round(time.monotonic() - started, 2)})
                unit["referenceAssessments"] = outcomes
                _save(folder_path, campaign)
                llm_job_status(job_id, consume=True)
                break
            time.sleep(1)
    unit["referenceAssessments"] = outcomes
    unit["referenceComplete"] = True
    _save(folder_path, campaign)


def _evaluate_dino_unit(folder_path, campaign, unit):
    if not campaign.get("referenceEvaluation", {}).get("dino") or unit.get("dinoComplete"):
        return
    from .epoch_dino import compare_images
    from .epoch_reference import verified_reference
    frame = _directory(folder_path, campaign["id"]) / "frames" / unit["frame"]
    if not frame.is_file():
        raise FileNotFoundError("Generated DINO comparison frame is unavailable.")
    references = {(entry["attribute"], entry["option"]): entry for entry in campaign["referencePlan"]}
    unique = {}
    for group in unit.get("groups", []):
        if not _requires_reference(group.get("role")) or group.get("expected") is None:
            continue
        option = group["options"][group["expected"] - 1]
        entry = references.get((group["label"], option))
        if entry is None:
            continue
        actual = verified_reference(_folder_key(folder_path), entry["group"], entry.get("tag") or option, entry["media"], campaign["jobId"])
        if actual["size"] != entry["size"] or actual["mtimeNs"] != entry["mtimeNs"]:
            raise ValueError("Training reference changed since approval.")
        unique.setdefault(entry["media"], []).append(group["label"] + ": " + option)
    results = unit.get("dinoAssessments", [])
    completed = {item["reference"] for item in results}
    for name, attributes in unique.items():
        if name in completed:
            continue
        started = time.monotonic()
        score = compare_images(folder_path / name, frame, _directory(folder_path, campaign["id"]) / "embedding-cache")
        results.append({"reference": name, "attributes": attributes,
                        "similarity": score, "elapsedSeconds": round(time.monotonic() - started, 2)})
        unit["dinoAssessments"] = results
        _save(folder_path, campaign)
    unit["dinoAssessments"] = results
    unit["dinoComplete"] = True
    _save(folder_path, campaign)


def _mark_unit_error(folder_path, campaign, unit, stage, exc):
    """Retain actionable failure evidence without scoring a failed observation."""
    import logging
    message = str(exc)
    unit["error"] = message
    unit["errorStage"] = stage
    logging.getLogger(__name__).exception(
        "Epoch Finder %s failed: campaign %s, round %s, epoch %s, case %s",
        stage, campaign["id"], unit["round"], unit["epoch"], unit["case"],
    )
    campaign["detail"] = stage.title() + " failure · epoch " + str(unit["epoch"]) + ": " + message
    _save(folder_path, campaign)


def _rank(campaign, round_number):
    """Rank *every* source epoch using durable evidence through this round."""
    initial = campaign["rounds"][0]["epochs"]
    by_epoch = {}
    for epoch in initial:
        comparisons = [
            group for unit in campaign["units"]
            if unit["round"] <= round_number and unit["epoch"] == epoch
            and unit.get("assessment")
            for group in unit["assessment"].get("comparison", [])
        ]
        matches = sum(float(group.get("weight", 1)) for group in comparisons if group.get("result") == "match")
        mismatches = sum(float(group.get("weight", 1)) for group in comparisons if group.get("result") == "mismatch")
        total = matches + mismatches
        rounds_tested = sorted({
            unit["round"] for unit in campaign["units"]
            if unit["round"] <= round_number and unit["epoch"] == epoch and unit.get("assessment")
        })
        by_epoch[epoch] = {
            "epoch": epoch, "matches": matches, "mismatches": mismatches,
            "unclear": sum(group.get("result") == "unclear" for group in comparisons), "count": total,
            "score": matches / total if total else None,
            "roundsTested": rounds_tested,
            "active": epoch in campaign["rounds"][round_number - 1]["epochs"],
        }
    rows = list(by_epoch.values())
    rows.sort(key=lambda item: (item["score"] is None, -(item["score"] or 0), item["epoch"]))
    return rows


def _select_next_epochs(ranking, active_epochs, keep_percent):
    """Cut the current field by relative rank, then allow historical re-entry.

    Earlier sidelined epochs have no new tests, but can clear a cutoff that
    shifted downward as the active field gathered more evidence.
    """
    active = [row for row in ranking if row["epoch"] in active_epochs and row["score"] is not None]
    active.sort(key=lambda row: (-row["score"], row["epoch"]))
    if not active:
        raise RuntimeError("No scoreable wildcard attributes in the active field.")
    retain = max(1, math.ceil(len(active) * keep_percent / 100))
    boundary = active[retain - 1]["score"]
    next_epochs = sorted(
        row["epoch"] for row in ranking
        if row["score"] is not None and row["score"] >= boundary
    )
    reentered = sorted(set(next_epochs) - set(active_epochs))
    return next_epochs, reentered, boundary


def _run(folder_path, campaign_id, control):
    campaign = _load(folder_path, campaign_id)
    from . import workflow_gate
    admitted = False
    try:
        _update(folder_path, campaign, status="running", phase="Queued",
                detail="Waiting for workflow FIFO turn.")
        if not workflow_gate.wait_for_epoch(campaign_id, control):
            _check_signal(folder_path, campaign, control)
            return
        admitted = True
        for unit in campaign["units"]:
            if unit.get("assessment") is not None and unit.get("session"):
                _retire_scored_session(folder_path, campaign, unit)
        for plan in campaign["rounds"]:
            number = plan["number"]
            if number < campaign["round"]:
                continue
            epochs = plan["epochs"]
            if not epochs:
                raise RuntimeError("Round has no candidates.")
            campaign["round"] = number
            _update(folder_path, campaign, status="running", phase="Rendering",
                    detail="Round " + str(number) + " · " + str(len(epochs)) + " epochs")
            for epoch in epochs:
                pending = [
                    _unit(campaign, number, epoch, case)
                    for case in range(len(plan["seeds"]))
                    if not _unit(campaign, number, epoch, case)["frame"]
                    and not _unit(campaign, number, epoch, case).get("error")
                ]
                if pending:
                    if not _check_signal(folder_path, campaign, control):
                        return
                    staged = _stage_epoch(folder_path, campaign, epoch)
                    # Queue this epoch's renders first. ComfyUI can start the
                    # following render while we extract and delete the previous
                    # completed clip on the CPU.
                    for unit in pending:
                        try:
                            _render_unit(folder_path, campaign, plan, unit, staged, enqueue_only=True)
                        except Exception as exc:
                            _mark_unit_error(folder_path, campaign, unit, "render", exc)
                    for unit in pending:
                        _update(folder_path, campaign, phase="Rendering",
                                detail="Epoch " + str(epoch) + " · capturing " +
                                str(unit["case"] + 1) + "/" + str(len(plan["seeds"])))
                        if unit["error"]:
                            continue
                        try:
                            _render_unit(folder_path, campaign, plan, unit, staged)
                        except Exception as exc:
                            _mark_unit_error(folder_path, campaign, unit, "render", exc)
                if not _campaign_has_active_sessions(folder_path, campaign):
                    _clean_staging(folder_path, campaign)
            _update(folder_path, campaign, phase="Evaluating", detail="All round frames captured.")
            for unit in campaign["units"]:
                if unit["round"] != number:
                    continue
                needs_vl = unit.get("assessment") is None
                needs_rvn = campaign.get("referenceEvaluation", {}).get("rvn") and not unit.get("referenceComplete") and "referenceError" not in unit
                needs_dino = campaign.get("referenceEvaluation", {}).get("dino") and not unit.get("dinoComplete") and "dinoError" not in unit
                if not (needs_vl or needs_rvn or needs_dino):
                    continue
                if not _check_signal(folder_path, campaign, control):
                    return
                _update(folder_path, campaign, detail="Ask VL · epoch " + str(unit["epoch"]) +
                        " · frame " + str(unit["case"] + 1))
                if not unit["frame"] or unit.get("error"):
                    continue
                try:
                    _evaluate_unit(folder_path, campaign, unit)
                except Exception as exc:
                    _mark_unit_error(folder_path, campaign, unit, "vision", exc)
                if unit.get("assessment") is not None and needs_rvn:
                    try:
                        _evaluate_reference_unit(folder_path, campaign, unit)
                    except Exception as exc:
                        unit["referenceError"] = str(exc)
                        _save(folder_path, campaign)
                if unit.get("assessment") is not None and needs_dino:
                    try:
                        _update(folder_path, campaign, detail="DINOv2 · epoch " + str(unit["epoch"]) +
                                " · frame " + str(unit["case"] + 1))
                        _evaluate_dino_unit(folder_path, campaign, unit)
                    except Exception as exc:
                        unit["dinoError"] = str(exc)
                        _save(folder_path, campaign)
                if unit.get("assessment") is not None:
                    _retire_scored_session(folder_path, campaign, unit)
            ranking = _rank(campaign, number)
            campaign["scores"] = ranking
            plan["ranking"] = ranking
            _update(folder_path, campaign, phase="Ranking", detail="Round " + str(number) + " ranked.")
            if number < len(campaign["rounds"]):
                survivors, reentered, boundary = _select_next_epochs(
                    ranking, epochs, plan["keepPercent"],
                )
                plan["cutoff"] = boundary
                plan["reentered"] = reentered
                campaign["rounds"][number]["epochs"] = survivors
                _update(
                    folder_path, campaign,
                    detail=str(len(survivors)) + " epochs advance to round " + str(number + 1) +
                    (" · " + str(len(reentered)) + " re-entered" if reentered else "") + ".",
                )
            campaign["round"] = number + 1
            _save(folder_path, campaign)
            if not _check_signal(folder_path, campaign, control):
                return
        _update(folder_path, campaign, phase="Finalizing", detail="Pruning assessed screening frames.")
        _prune_screening_frames(folder_path, campaign)
        failed = sum(bool(unit.get("error")) for unit in campaign["units"])
        _update(folder_path, campaign, status="complete", phase="Complete",
                detail="Evaluation finished." + (" " + str(failed) + " failed observations; review Console." if failed else " Review the ranked epochs."),
                finishedAt=time.time())
    except Exception as exc:
        _update(folder_path, campaign, status="failed", phase="Failed", detail=str(exc))
        raise
    finally:
        if admitted:
            workflow_gate.release("epoch", campaign_id)
        # The coordinator queues only one Test session at a time. A failed or
        # interrupted active session retains its checkpoint until its queue
        # reference is resolved; otherwise release the staging directory.
        try:
            if not _campaign_has_active_sessions(folder_path, campaign):
                _clean_staging(folder_path, campaign)
        finally:
            with _worker_lock:
                _workers.pop(campaign_id, None)
                _controls.pop(campaign_id, None)
                while _pending_campaigns:
                    next_folder, next_id = _pending_campaigns.pop(0)
                    try:
                        next_campaign = _load(next_folder, next_id)
                        if next_campaign.get("status") != "queued":
                            continue
                        _start_campaign_worker_locked(next_folder, next_id)
                        break
                    except Exception:
                        import logging
                        logging.getLogger(__name__).exception("Could not dispatch next queued Epoch Finder campaign")


def _campaign_has_active_sessions(folder_path, campaign):
    return any(
        unit.get("session") and _session_still_active(folder_path, unit["session"])
        for unit in campaign["units"]
    )


def _session_still_active(folder_path, session_name):
    try:
        status = test_bench.open_session(folder_path, session_name)
    except FileNotFoundError:
        return False
    return status.get("status") not in {"complete", "failed", "stopped", "interrupted"}


def _resume_saved_work(folder_path, campaign):
    """Promote only this campaign's parked Test requests on explicit Resume."""
    from .execution_queue import get_job as execution_get_job, promote_backlog
    from .inference_runner import start_observer

    owned_staging = "epoch-finder-" + campaign["id"]
    promoted = False
    for unit in campaign["units"]:
        session_name = unit.get("session")
        if not session_name:
            continue
        session = test_bench.open_session(folder_path, session_name)
        if session.get("campaignStaging") != owned_staging:
            raise RuntimeError("Epoch Finder session ownership mismatch.")
        if unit.get("assessment") is not None and not _session_still_active(folder_path, session_name):
            _retire_scored_session(folder_path, campaign, unit)
            continue
        for job_id in session.get("inferenceJobs") or []:
            try:
                job = execution_get_job(str(job_id))
            except FileNotFoundError:
                continue
            if job.get("status") == "backlog":
                promote_backlog(str(job_id))
                promoted = True
    if promoted:
        start_observer()


def _start_campaign_worker_locked(folder_path, campaign_id):
    """Caller holds _worker_lock; only one active Epoch Finder coordinator."""
    control = {"pause": threading.Event(), "stop": threading.Event()}
    thread = threading.Thread(
        target=_run, args=(folder_path, campaign_id, control), daemon=True,
        name="webcap-epoch-finder",
    )
    _workers[campaign_id] = thread
    _controls[campaign_id] = control
    thread.start()


def _launch(folder_path, campaign_id):
    with _worker_lock:
        if any(thread.is_alive() for thread in _workers.values()):
            campaign = _load(folder_path, campaign_id)
            _update(folder_path, campaign, status="queued", phase="Queued",
                    detail="Waiting for earlier Epoch Finder campaign.")
            if not any(id_ == campaign_id for _, id_ in _pending_campaigns):
                _pending_campaigns.append((folder_path, campaign_id))
            return
        _start_campaign_worker_locked(folder_path, campaign_id)


def status(folder_path, campaign_id):
    campaign = _load(folder_path, campaign_id)
    with _worker_lock:
        thread = _workers.get(campaign_id)
    if campaign.get("status") in {"running", "queued"} and (thread is None or not thread.is_alive()):
        with _worker_lock:
            waiting = any(id_ == campaign_id for _, id_ in _pending_campaigns)
        if campaign["status"] == "running" or not waiting:
            campaign["status"] = "interrupted"
            campaign["phase"] = "Interrupted"
            campaign["detail"] = "WebCap restarted. Resume explicitly to continue."
    return campaign


def command(folder_path, operation, criteria=None):
    criteria = criteria if isinstance(criteria, dict) else {}
    if operation == "list":
        return list_campaigns(folder_path)
    if operation == "checkpoint_evidence":
        return checkpoint_evidence(folder_path, criteria.get("jobId"))
    if operation == "reference_vocabulary":
        from .epoch_reference import reference_vocabulary
        return {"vocabulary": reference_vocabulary(_folder_key(folder_path), criteria.get("jobId"))}
    if operation == "reference_suggestions":
        from .epoch_reference import suggest_references
        return {"references": suggest_references(_folder_key(folder_path), criteria.get("jobId"), criteria.get("option"))}
    if operation == "reference_candidates":
        from .epoch_reference import find_reference_candidates
        return {"references": find_reference_candidates(_folder_key(folder_path), criteria.get("group"), criteria.get("term"), criteria.get("jobId"))}
    if operation == "start":
        return {"campaign": create_campaign(folder_path, criteria)}
    campaign_id = str(criteria.get("campaignId") or "")
    if operation == "status":
        return {"campaign": status(folder_path, campaign_id)}
    if operation in {"pause", "stop"}:
        campaign = status(folder_path, campaign_id)
        if campaign.get("status") == "queued":
            with _worker_lock:
                _pending_campaigns[:] = [(folder, id_) for folder, id_ in _pending_campaigns if id_ != campaign_id]
                _update(folder_path, campaign, status="paused" if operation == "pause" else "stopped",
                        phase="Paused" if operation == "pause" else "Stopped",
                        detail="Removed from the campaign queue before starting.")
            return {"campaign": status(folder_path, campaign_id)}
        with _worker_lock:
            control = _controls.get(campaign_id)
        if not control:
            raise ValueError("This campaign is not running.")
        control[operation].set()
        return {"campaign": status(folder_path, campaign_id)}
    if operation == "resume":
        campaign = status(folder_path, campaign_id)
        if campaign["status"] not in {"paused", "interrupted", "failed"}:
            raise ValueError("Only a paused or interrupted campaign can resume.")
        _resume_saved_work(folder_path, campaign)
        _launch(folder_path, campaign_id)
        return {"campaign": status(folder_path, campaign_id)}
    if operation == "delete":
        campaign = status(folder_path, campaign_id)
        with _worker_lock:
            _pending_campaigns[:] = [(folder, id_) for folder, id_ in _pending_campaigns if id_ != campaign_id]
            worker = _workers.get(campaign_id)
        if worker is not None and worker.is_alive():
            raise ValueError("Wait for the campaign worker to finish before deleting it.")
        if any(unit.get("session") and _session_still_active(folder_path, unit["session"]) for unit in campaign["units"]):
            raise RuntimeError("Campaign still has active Test work.")
        for unit in campaign["units"]:
            if unit.get("session"):
                try:
                    test_bench.delete_session(folder_path, unit["session"])
                except FileNotFoundError:
                    pass
        _clean_staging(folder_path, campaign)
        shutil.rmtree(_directory(folder_path, campaign_id))
        return {"deleted": campaign_id}
    raise ValueError("Unsupported Epoch Finder operation: " + operation)



def storage_campaigns():
    """Owned campaign data across all Test workspaces."""
    workspaces = test_bench._workspace_sets_root()
    if not workspaces.is_dir():
        return []
    records = []
    for workspace in workspaces.iterdir():
        if workspace.is_symlink() or not workspace.is_dir():
            continue
        root = workspace / "epoch-finder"
        if root.is_symlink() or not root.is_dir():
            continue
        for directory in root.iterdir():
            if directory.is_symlink() or not directory.is_dir() or not _ID.fullmatch(directory.name):
                continue
            manifest = directory / "campaign.json"
            if manifest.is_symlink() or not manifest.is_file():
                continue
            payload = json.loads(manifest.read_text(encoding="utf-8"))
            folder = str(payload.get("folder") or "")
            owner = app_config.safe_join_fs_root(folder)
            if _directory(owner, directory.name) != directory or payload.get("id") != directory.name:
                raise RuntimeError("Epoch Finder storage ownership mismatch: " + str(directory))
            with _worker_lock:
                thread = _workers.get(directory.name)
            active = bool(thread and thread.is_alive()) or _campaign_has_active_sessions(owner, payload)
            staged = _staging(owner, payload)
            records.append({
                "stagingPath": staged if staged.is_dir() and not staged.is_symlink() else None,
                "id": directory.name, "folder": folder, "path": directory,
                "name": payload.get("name") or directory.name,
                "status": ("interrupted" if payload.get("status") == "running" and not active else payload.get("status") or ""),
                "active": active,
                "frames": sum(bool(unit.get("frame")) for unit in payload.get("units") or []),
                "retainedSessions": sum(bool(unit.get("session")) for unit in payload.get("units") or []),
            })
    return records


def storage_staging_path(folder, campaign_id):
    owner = app_config.safe_join_fs_root(folder)
    payload = _load(owner, campaign_id)
    staging = _staging(owner, payload)
    if staging.is_symlink() or not staging.is_dir():
        raise FileNotFoundError("Epoch Finder temporary checkpoint storage is unavailable.")
    return staging


def storage_campaign_path(folder, campaign_id):
    owner = app_config.safe_join_fs_root(folder)
    _load(owner, campaign_id)
    return _directory(owner, campaign_id)


def frame_path(folder_path, campaign_id, file_name):
    if not _FRAME.fullmatch(str(file_name or "")):
        raise ValueError("Invalid Epoch Finder frame name.")
    _load(folder_path, campaign_id)
    frame = _directory(folder_path, campaign_id) / "frames" / file_name
    if frame.is_symlink() or not frame.is_file():
        raise FileNotFoundError("Epoch Finder frame is unavailable.")
    return frame
