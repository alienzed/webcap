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
from .caption_vision import build_vision_question_messages, vision_media_data_url
from .llm_runner import enqueue as enqueue_llm, job_status as llm_job_status
from .test_models import get_test_model_for_staging_key
from .training_history import all_history_payload
from .training_runner import (
    _candidate_run_snapshot, _candidate_safetensors_path,
    _candidate_test_directory_for_run, candidate_run_folder_path,
)
from .training_candidates import saved_artifacts_for_run
from .video_frame_ops import VIDEO_EXTS, extract_boundary_frame_png


_workers = {}
_controls = {}
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


def _runs(folder_path):
    folder = _folder_key(folder_path)
    result = []
    for job in all_history_payload(folder=folder).get("jobs", []):
        job_id = str(job.get("id") or "")
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
                ("id", "name", "status", "phase", "round", "startedAt", "detail")
            })
    campaigns.sort(key=lambda row: row.get("startedAt") or 0, reverse=True)
    return {"runs": _runs(folder_path), "campaigns": campaigns}


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
    model = get_test_model_for_staging_key(run["stage"])
    model.load_template()
    prompt = str(criteria.get("prompt") or "").strip()
    dimensions = normalize_dimensions(prompt, criteria.get("dimensions"))
    vision_model = str(criteria.get("visionModel") or "").strip()
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
    model.normalize_settings(model.load_template(), lambda: 1, dict(settings, seed=1))
    campaign_id = secrets.token_hex(6)
    directory = _directory(folder_path, campaign_id)
    directory.mkdir(parents=True, exist_ok=False)
    (directory / "frames").mkdir()
    campaign = {
        "version": 1, "id": campaign_id, "folder": folder, "jobId": job_id,
        "runName": run["runName"], "modelId": model.PROFILE_ID, "stage": run["stage"],
        "name": str(criteria.get("name") or run["runName"]).strip()[:120],
        "status": "paused", "phase": "Ready", "detail": "Ready to generate.",
        "round": 1, "rounds": _create_plan(run["epochs"], prompt, rounds, cases, keep_percent, settings, criteria.get("roundPlans")),
        "visionModel": vision_model, "dimensions": dimensions, "concept": str(criteria.get("concept") or "").strip(),
        "units": [], "scores": [], "startedAt": time.time(),
        "finishedAt": None,
    }
    _save(folder_path, campaign)
    _launch(folder_path, campaign_id)
    return campaign


def _staging(folder_path, campaign):
    _, run = _candidate_run_snapshot(_folder_key(folder_path), campaign["jobId"])
    base = _candidate_test_directory_for_run(run, create_missing=True)
    directory = base / ("epoch-finder-" + campaign["id"])
    if directory.is_symlink():
        raise RuntimeError("Epoch Finder staging folder is a symlink.")
    return directory


def _stage_epoch(folder_path, campaign, epoch):
    directory = _staging(folder_path, campaign)
    directory.mkdir(exist_ok=True)
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
             "error": "", "errorStage": ""}
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
        if unit["session"] and not _session_still_active(folder_path, unit["session"]):
            test_bench.delete_session(folder_path, unit["session"])
            unit["session"] = ""
            _save(folder_path, campaign)
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
    unit["groups"] = status.get("wildcardEvaluationGroups") or []
    for group, dimension in zip(unit["groups"], campaign["dimensions"]):
        if group.get("options") != dimension["options"]:
            raise RuntimeError("Resolved wildcard attributes diverged from the approved plan.")
        group.update({"label": dimension["label"], "role": dimension["role"], "weight": dimension["weight"]})
    unit["question"] = _question(unit["groups"])
    unit["prompt"] = status.get("resolvedPrompt") or status.get("prompt") or ""
    _save(folder_path, campaign)
    # This Test session and video are exclusively campaign-owned; ordinary Test
    # sessions are never modified.
    test_bench.delete_session(folder_path, unit["session"])
    unit["session"] = ""
    _save(folder_path, campaign)


def _evaluate_unit(folder_path, campaign, unit):
    if unit["assessment"] is not None:
        return
    frame = _directory(folder_path, campaign["id"]) / "frames" / unit["frame"]
    job = enqueue_llm("caption", campaign["visionModel"], {
        "operation": "vision_question",
        "messages": build_vision_question_messages(unit["question"], vision_media_data_url(frame))
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
            unit["assessment"] = {
                "modelId": campaign["visionModel"], "text": answer,
                "comparison": _compare(answer, unit["groups"]),
            }
            _save(folder_path, campaign)
            llm_job_status(job_id, consume=True)
            return
        time.sleep(1)


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
            "unclear": len(comparisons) - total, "count": total,
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
    try:
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
                if unit["round"] != number or unit["assessment"] is not None:
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
        failed = sum(bool(unit.get("error")) for unit in campaign["units"])
        _update(folder_path, campaign, status="complete", phase="Complete",
                detail="Evaluation finished." + (" " + str(failed) + " failed observations; review Console." if failed else " Review the ranked epochs."),
                finishedAt=time.time())
    except Exception as exc:
        _update(folder_path, campaign, status="failed", phase="Failed", detail=str(exc))
        raise
    finally:
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
        if unit.get("frame") and not _session_still_active(folder_path, session_name):
            test_bench.delete_session(folder_path, session_name)
            unit["session"] = ""
            _save(folder_path, campaign)
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


def _launch(folder_path, campaign_id):
    with _worker_lock:
        if any(thread.is_alive() for thread in _workers.values()):
            raise RuntimeError("An Epoch Finder campaign is already running.")
        control = {"pause": threading.Event(), "stop": threading.Event()}
        thread = threading.Thread(
            target=_run, args=(folder_path, campaign_id, control), daemon=True,
            name="webcap-epoch-finder",
        )
        _workers[campaign_id] = thread
        _controls[campaign_id] = control
        thread.start()


def status(folder_path, campaign_id):
    campaign = _load(folder_path, campaign_id)
    with _worker_lock:
        thread = _workers.get(campaign_id)
    if campaign.get("status") == "running" and (thread is None or not thread.is_alive()):
        campaign["status"] = "interrupted"
        campaign["phase"] = "Interrupted"
        campaign["detail"] = "WebCap restarted. Resume explicitly to continue."
    return campaign


def command(folder_path, operation, criteria=None):
    criteria = criteria if isinstance(criteria, dict) else {}
    if operation == "list":
        return list_campaigns(folder_path)
    if operation == "start":
        return {"campaign": create_campaign(folder_path, criteria)}
    campaign_id = str(criteria.get("campaignId") or "")
    if operation == "status":
        return {"campaign": status(folder_path, campaign_id)}
    if operation in {"pause", "stop"}:
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
            worker = _workers.get(campaign_id)
        if worker is not None and worker.is_alive():
            raise ValueError("Wait for the campaign worker to finish before deleting it.")
        if any(unit.get("session") and _session_still_active(folder_path, unit["session"]) for unit in campaign["units"]):
            raise RuntimeError("Campaign still has active Test work.")
        _clean_staging(folder_path, campaign)
        shutil.rmtree(_directory(folder_path, campaign_id))
        return {"deleted": campaign_id}
    raise ValueError("Unsupported Epoch Finder operation: " + operation)


def frame_path(folder_path, campaign_id, file_name):
    if not _FRAME.fullmatch(str(file_name or "")):
        raise ValueError("Invalid Epoch Finder frame name.")
    _load(folder_path, campaign_id)
    frame = _directory(folder_path, campaign_id) / "frames" / file_name
    if frame.is_symlink() or not frame.is_file():
        raise FileNotFoundError("Epoch Finder frame is unavailable.")
    return frame
