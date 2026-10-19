"""Read-only Run Analytics from existing Run, Epoch Finder, and Test evidence.

A recorded job ID is the only join across sources. Test results without that
identity stay unlinked; different evaluators are never combined into one score.
"""
from collections import defaultdict
from pathlib import Path

from . import epoch_finder as finder
from . import epoch_test_bench as bench
from .training_archive import archive_metrics, list_archives


def _folder_key(folder_path):
    return bench._relative_set_folder(folder_path)


def _campaigns(folder_path, warnings):
    root = finder._root(folder_path)
    if not root.is_dir():
        return []
    rows = []
    for path in sorted(root.iterdir(), key=lambda p: p.name):
        if not path.is_dir() or path.is_symlink() or not finder._ID.fullmatch(path.name):
            continue
        try:
            rows.append(finder._load(folder_path, path.name))
        except (OSError, ValueError) as exc:
            warnings.append("Campaign " + path.name + " could not be read: " + str(exc))
    return rows


def _catalog(folder_path, campaigns, warnings):
    folder = _folder_key(folder_path)
    indexed = {}
    try:
        for run in finder._runs(folder_path, require_saved_checkpoints=False):
            identifier = str(run.get("jobId") or "")
            if identifier:
                indexed[identifier] = {
                    "jobId": identifier, "label": str(run.get("runName") or ("Run " + str(run.get("runSequence") or identifier))),
                    "stage": str(run.get("stage") or ""), "modelId": str(run.get("modelId") or ""),
                    "savedEpochs": list(run.get("epochs") or []), "archive": None, "source": "training",
                }
    except (OSError, RuntimeError) as exc:
        warnings.append("Live training-run discovery unavailable: " + str(exc))
    archive_rows = {}
    for entry in list_archives():
        if entry.get("invalid") or str(entry.get("sourceFolder") or "").replace("\\", "/").strip("/") != folder:
            continue
        name = str(entry.get("name") or "")
        identifier = str(entry.get("sourceJobId") or "").strip() or "archive:" + name
        archive_rows[identifier] = entry
        existing = indexed.get(identifier)
        if existing is None:
            indexed[identifier] = {
                "jobId": identifier, "label": str(entry.get("runName") or name), "stage": str(entry.get("stage") or ""),
                "modelId": "", "savedEpochs": [], "archive": name, "source": "archive",
            }
        else:
            existing["archive"] = name
        available = {int(x) for x in entry.get("retainedAlternateEpochs", []) if type(x) is int}
        chosen = entry.get("selectedEpoch")
        if type(chosen) is int:
            available.add(chosen)
        indexed[identifier]["savedEpochs"] = sorted(set(indexed[identifier]["savedEpochs"]) | available)
    for campaign in campaigns:
        cmap = campaign.get("candidateMap") or {}
        members = [(str(item.get("jobId") or ""), str(item.get("runName") or ""))
                   for item in cmap.values() if isinstance(item, dict)] if cmap else [
                       (str(campaign.get("jobId") or ""), str(campaign.get("runName") or ""))
                   ]
        for identifier, label in members:
            if identifier and identifier not in indexed:
                indexed[identifier] = {
                    "jobId": identifier, "label": label or "Run " + identifier, "stage": str(campaign.get("stage") or ""),
                    "modelId": str(campaign.get("modelId") or ""), "savedEpochs": [],
                    "archive": None, "source": "campaign evidence",
                }
    return sorted(indexed.values(), key=lambda item: (item["label"].casefold(), item["jobId"])), archive_rows


def _campaign_series(campaigns, job_id):
    output = []
    for campaign in campaigns:
        rounds = campaign.get("rounds") or []
        if not rounds:
            continue
        mapped = campaign.get("candidateMap") or {}
        unit_index = defaultdict(list)
        for unit in campaign.get("units") or []:
            if isinstance(unit, dict):
                unit_index[unit.get("epoch")].append(unit)
        points = []
        for item in finder._rank(campaign, len(rounds)):
            identity = mapped.get(str(item["epoch"])) if mapped else None
            source_job = str(identity.get("jobId") or "") if identity else str(campaign.get("jobId") or "")
            if source_job != job_id:
                continue
            source_epoch = identity.get("epoch") if identity else item["epoch"]
            if type(source_epoch) is not int:
                continue
            units = unit_index.get(item["epoch"], [])
            points.append({
                "epoch": source_epoch, "score": item["score"], "observations": item["count"],
                "unclear": item["unclear"], "renders": sum(bool(u.get("assessment")) for u in units),
                "rounds": item["roundsTested"],
                "rvn": sum(len(u.get("referenceAssessments") or []) for u in units),
                "dino": sum(len(u.get("dinoAssessments") or []) for u in units),
            })
        if points:
            output.append({
                "id": campaign["id"], "name": str(campaign.get("name") or "Campaign " + campaign["id"]),
                "modelId": str(campaign.get("modelId") or ""),
                "visionModel": str(campaign.get("visionModel") or ""),
                "status": str(campaign.get("status") or ""),
                "points": sorted(points, key=lambda item: item["epoch"]),
            })
    return sorted(output, key=lambda item: item["id"])


def _test_series(folder_path, job_id, session_name=''):
    folder = _folder_key(folder_path)
    by_epoch = defaultdict(lambda: {"ratingSum": 0, "ratingCount": 0,
                                    "vlMatches": 0.0, "vlCount": 0, "sessions": set()})
    sessions = set()
    available_sessions = set()
    unlinked = 0
    for path in bench._session_directories(folder_path):
        stored = bench._read_status(path) or {}
        if stored.get("campaignStaging"):
            continue
        rating = bench._session_rating_map(path)
        vision = bench._session_vision_state(path)
        disabled = set(vision.get("disabledGroups") or [])
        per_media = vision.get("byMedia") if isinstance(vision.get("byMedia"), dict) else {}
        for result in stored.get("results") or []:
            if not isinstance(result, dict) or result.get("kind") == "base":
                continue
            proof = result.get("provenance") if isinstance(result.get("provenance"), dict) else {}
            source_job = str(proof.get("sourceJobId") or "")
            source_folder = str(proof.get("sourceFolder") or "").replace("\\", "/").strip("/")
            source_epoch = proof.get("sourceEpoch")
            if source_job != job_id:
                if not source_job:
                    unlinked += 1
                continue
            if source_folder != folder or type(source_epoch) is not int or source_epoch < 0:
                unlinked += 1
                continue
            available_sessions.add(path.name)
            if session_name and path.name != session_name:
                continue
            media = bench._result_media_file(result)
            item = by_epoch[source_epoch]
            item["sessions"].add(path.name)
            sessions.add(path.name)
            if media in rating:
                item["ratingSum"] += rating[media]
                item["ratingCount"] += 1
            assessment = per_media.get(media) if isinstance(per_media, dict) else None
            if isinstance(assessment, dict):
                ignored = set(assessment.get("ignoredGroups") or [])
                for group in assessment.get("comparison") or []:
                    if not isinstance(group, dict) or group.get("id") in ignored or group.get("id") in disabled:
                        continue
                    if group.get("result") == "match":
                        item["vlMatches"] += 1
                        item["vlCount"] += 1
                    elif group.get("result") == "mismatch":
                        item["vlMatches"] += bench._test_vl_partial_credit(group.get("expectedText"), group.get("selectedText"))
                        item["vlCount"] += 1
    points = []
    for epoch, value in sorted(by_epoch.items()):
        points.append({
            "epoch": epoch,
            "manual": (value["ratingSum"] / value["ratingCount"]) if value["ratingCount"] else None,
            "manualCount": value["ratingCount"],
            "testVl": (value["vlMatches"] / value["vlCount"]) if value["vlCount"] else None,
            "testVlCount": value["vlCount"],
            "sessions": sorted(value["sessions"]),
        })
    return points, sorted(sessions), unlinked, sorted(available_sessions)


def report(folder_path, job_id="", session_name=""):
    """A deterministic on-demand snapshot. No writes, model calls or queue state mutations."""
    warnings = []
    campaigns = _campaigns(folder_path, warnings)
    runs, archives = _catalog(folder_path, campaigns, warnings)
    identifier = str(job_id or "").strip()
    if not identifier:
        return {"runs": runs, "jobId": "", "campaigns": [], "testPoints": [],
                "lossPoints": [], "warnings": warnings}
    chosen = next((run for run in runs if run["jobId"] == identifier), None)
    if chosen is None:
        raise ValueError("Selected training run is not available in this Set.")
    series = _campaign_series(campaigns, identifier)
    test_points, sessions, unlinked, available_sessions = _test_series(folder_path, identifier, session_name)
    loss = []
    archive = archives.get(identifier)
    selected_epoch = archive.get("selectedEpoch") if archive else None
    if archive:
        try:
            metrics = archive_metrics(archive["name"])
            loss = metrics.get("epochLossPoints") or []
        except (OSError, RuntimeError, ValueError) as exc:
            warnings.append("Archived training loss is unavailable: " + str(exc))
    if archive and not sessions:
        warnings.append("Archiving can clear Test sessions. Deleted per-image Test evidence cannot be reconstructed from aggregate ratings.")
    if unlinked:
        warnings.append(str(unlinked) + " Test preview(s) without usable recorded run provenance were left unlinked.")
    if not series and not test_points:
        warnings.append("No surviving per-epoch evaluation evidence for this run.")
    if len(series) > 1:
        warnings.append("Campaign tests can differ. Compare scores within an individual campaign, not across campaigns by default.")
    if len(sessions) > 1:
        warnings.append("Test session prompts and settings can differ. Pooled manual ratings and VL results are descriptive, not controlled comparisons.")
    epochs = sorted(set(chosen["savedEpochs"]) | {p["epoch"] for c in series for p in c["points"]} |
                    {p["epoch"] for p in test_points} | {p["epoch"] for p in loss})
    return {
        "runs": runs, "jobId": identifier, "run": chosen, "campaigns": series,
        "testPoints": test_points, "lossPoints": loss, "selectedEpoch": selected_epoch,
        "epochs": epochs, "sessions": sessions, "availableSessions": available_sessions,
        "sessionFilter": session_name, "warnings": warnings,
        "coverage": {
            "savedEpochs": len(chosen["savedEpochs"]), "observedEpochs": len(set(
                [p["epoch"] for c in series for p in c["points"]] + [p["epoch"] for p in test_points])),
            "campaigns": len(series), "testSessions": len(sessions),
            "campaignVlRenders": sum(p["renders"] for c in series for p in c["points"]),
            "manualRatings": sum(p["manualCount"] for p in test_points),
            "testVlJudgments": sum(p["testVlCount"] for p in test_points),
        },
    }


def report_selected(folder_path, job_ids, session_name=""):
    """Bounded same-Set run selection. Never join scores across independent campaigns."""
    if (not isinstance(job_ids, list) or not 1 <= len(job_ids) <= 6 or
            any(not isinstance(value, str) or not value.strip() for value in job_ids) or
            len(set(job_ids)) != len(job_ids)):
        raise ValueError("Choose 1–6 distinct training runs in this Set.")
    session_name = str(session_name or "").strip()
    if session_name and (Path(session_name).name != session_name or
                         "/" in session_name or chr(92) in session_name):
        raise ValueError("Invalid Test session filter.")
    reports = [report(folder_path, item, session_name) for item in job_ids]
    all_sessions = sorted({session for item in reports for session in item["availableSessions"]})
    if session_name and session_name not in all_sessions:
        raise ValueError("Selected Test session does not contain identified results for these runs.")
    campaigns = {}
    for item in reports:
        for campaign in item["campaigns"]:
            entry = campaigns.setdefault(campaign["id"], {
                "id": campaign["id"], "name": campaign["name"],
                "modelId": campaign["modelId"], "visionModel": campaign["visionModel"],
                "runs": []})
            entry["runs"].append(item["jobId"])
    return {
        "jobIds": job_ids, "sessionFilter": session_name,
        "runs": reports[0]["runs"], "reports": reports,
        "availableSessions": all_sessions,
        "campaigns": sorted(campaigns.values(), key=lambda entry: entry["id"]),
        "warnings": sorted({warning for item in reports for warning in item["warnings"]}),
    }


def director_facts(snapshot, campaign_id=""):
    """Only derived numeric data. No prompts, media, captions, transcripts, or logs."""
    campaign_id = str(campaign_id or "").strip()
    if campaign_id and campaign_id not in {entry["id"] for entry in snapshot["campaigns"]}:
        raise ValueError("Choose a campaign present in the selected runs.")
    facts = {
        "protocol": "Campaign VL scores are weighted matched judgments; Test VL and human ratings are independent.",
        "limits": "Only explicitly recorded source IDs joined. Different campaigns and sessions can use different prompts, settings, and evaluators.",
        "sessionFilter": snapshot["sessionFilter"] or "all",
        "campaignFilter": campaign_id or "none",
        "runs": [],
    }
    for item in snapshot["reports"]:
        campaigns = [campaign for campaign in item["campaigns"] if campaign["id"] == campaign_id] if campaign_id else []
        facts["runs"].append({
            "runId": item["jobId"], "label": item["run"]["label"][:100],
            "stage": item["run"]["stage"], "archive": bool(item["run"]["archive"]),
            "coverage": item["coverage"],
            "campaigns": [{
                "id": c["id"], "status": c["status"], "visionModel": c["visionModel"],
                "points": [{"epoch": p["epoch"], "score": p["score"],
                            "weightedObservations": p["observations"], "renders": p["renders"]}
                           for p in c["points"][:120]],
            } for c in campaigns],
            "test": [{"epoch": p["epoch"], "rating": p["manual"], "ratings": p["manualCount"],
                      "vl": p["testVl"], "vlJudgments": p["testVlCount"]}
                     for p in item["testPoints"][:120]],
            "loss": [{"epoch": p["epoch"], "loss": p["loss"]}
                     for p in item["lossPoints"][:120]],
            "warnings": item["warnings"][:8],
        })
    return facts

def director_contract(facts):
    """Bounded schema-based interpretation, not another assessment or rating."""
    import json
    return {
        "operation": "interpret_run_analytics",
        "prompt": (
            "Review only the numerical evidence below. Never assume a causal effect from "
            "loss, learning rate, epoch count, or sample size. Distinguish direct observations "
            "from hypotheses and experiments. Do not fabricate comparisons where campaign "
            "settings or evaluation protocols differ. Mention small denominators. "
            "Reply with four concise sections: Observed, Hypotheses, Try next, Limits.\n"
            + json.dumps(facts, ensure_ascii=False, separators=(",", ":"))
        ),
        "response_schema": {
            "type": "object", "additionalProperties": False,
            "required": ["observed", "hypotheses", "tryNext", "limits"],
            "properties": {
                "observed": {"type": "string"},
                "hypotheses": {"type": "string"},
                "tryNext": {"type": "string"},
                "limits": {"type": "string"}
            }
        }
    }


def normalize_director_response(payload):
    if not isinstance(payload, dict):
        raise ValueError("Director Analytics response must be structured.")
    fields = ("observed", "hypotheses", "tryNext", "limits")
    if any(not isinstance(payload.get(field), str) for field in fields):
        raise ValueError("Director Analytics response is missing a required section.")
    return {field: payload[field][:3000] for field in fields}
