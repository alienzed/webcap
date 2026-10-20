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
                name = str(run.get("runName") or "").strip()
                sequence = run.get("runSequence")
                if not name or name.casefold() == "run train":
                    name = "Run " + str(sequence) if sequence is not None and str(sequence).strip() else "Run " + identifier[-8:]
                indexed[identifier] = {
                    "jobId": identifier, "label": name,
                    "runSequence": run.get("runSequence"),
                    "stage": str(run.get("stage") or ""), "modelId": str(run.get("modelId") or ""),
                    "savedEpochs": [], "archive": None, "source": "training",
                }
                try:
                    run_dir = finder.candidate_run_folder_path(folder, identifier)
                    indexed[identifier]["savedEpochs"] = sorted({
                        item["epoch"] for item in finder.saved_artifacts_for_run(run_dir)
                        if item.get("status") == "available" and type(item.get("epoch")) is int
                    })
                except (OSError, ValueError, RuntimeError) as exc:
                    warnings.append("Saved checkpoints unavailable for run " + identifier + ": " + str(exc))

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


def report(folder_path, job_id="", session_name="", campaigns=None, catalog=None):
    """A deterministic on-demand snapshot. No writes, model calls or queue state mutations."""
    warnings = []
    if campaigns is None:
        campaigns = _campaigns(folder_path, warnings)
    runs, archives = catalog if catalog is not None else _catalog(folder_path, campaigns, warnings)
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
    if not series and not any(p["manualCount"] or p["testVlCount"] for p in test_points):
        warnings.append("No surviving per-epoch evaluation evidence for this run.")
    if len(series) > 1:
        warnings.append("Campaign tests can differ. Compare scores within an individual campaign, not across campaigns by default.")
    if len(sessions) > 1:
        warnings.append("Multiple Test sessions present. Use comparable cohort filtering; pooled legacy values are descriptive only.")
    epochs = sorted(set(chosen["savedEpochs"]) | {p["epoch"] for c in series for p in c["points"]} |
                    {p["epoch"] for p in test_points} | {p["epoch"] for p in loss})
    return {
        "runs": runs, "jobId": identifier, "run": chosen, "campaigns": series,
        "testPoints": test_points, "lossPoints": loss, "selectedEpoch": selected_epoch,
        "epochs": epochs, "sessions": sessions, "availableSessions": available_sessions,
        "sessionFilter": session_name, "warnings": warnings,
        "coverage": {
            "savedEpochs": len(chosen["savedEpochs"]), "observedEpochs": len(set(
                [p["epoch"] for c in series for p in c["points"] if p["observations"] > 0]
                + [p["epoch"] for p in test_points if p["manualCount"] or p["testVlCount"]])),
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
    scan_warnings = []
    campaigns_loaded = _campaigns(folder_path, scan_warnings)
    catalog = _catalog(folder_path, campaigns_loaded, scan_warnings)
    reports = [report(folder_path, item, session_name, campaigns_loaded, catalog) for item in job_ids]
    session_paths = bench._session_directories(folder_path)
    for item in reports:
        item["testCohorts"] = _test_cohorts(folder_path, item["jobId"], session_name, session_paths)
        item["roundPoints"] = _round_trajectories(folder_path, item["jobId"], campaigns_loaded)
        item["warnings"].extend(scan_warnings)
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
    unique_campaigns = sorted(campaigns.values(), key=lambda entry: entry["id"])
    return {
        "jobIds": job_ids, "sessionFilter": session_name,
        "runs": reports[0]["runs"], "reports": reports,
        "availableSessions": all_sessions,
        "campaigns": unique_campaigns,
        "coverage": {"runs": len(reports), "campaigns": len(unique_campaigns),
                     "testSessions": len({s for item in reports for s in item["sessions"]})},
        "warnings": sorted({warning for item in reports for warning in item["warnings"]}),
        "findings": _findings({"reports": reports}, ""),
    }


def _cohort_key(session, result=None, assessment=None, vision=None):
    """Frozen generation configuration plus per-preview LoRA and VL evaluation protocol."""
    import hashlib
    import json
    result = result or {}
    assessment = assessment or {}
    vision = vision or {}
    # Evaluation model/question/rubric may vary even within a Test session.
    rubric = sorted(
        (str(g.get("id") or ""), str(g.get("expectedText") or ""), str(g.get("weight") or ""))
        for g in (assessment.get("comparison") or []) if isinstance(g, dict)
    )
    payload = {key: session.get(key) for key in
               ("modelId", "sourcePrompt", "resolvedPrompt", "settings", "workflowSha256", "sweepWeights")}
    payload.update({
        "strength": result.get("strength", (session.get("settings") or {}).get("strength")),
        "vlModel": assessment.get("modelId") or "",
        "vlQuestion": assessment.get("question") or "",
        "vlRubric": rubric,
        "disabledGroups": sorted(vision.get("disabledGroups") or []),
        "ignoredGroups": sorted(assessment.get("ignoredGroups") or []),
    })
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:12]


def _test_cohorts(folder_path, job_id, session_name="", sessions=None):
    folder = _folder_key(folder_path)
    cohorts = {}
    for path in (sessions if sessions is not None else bench._session_directories(folder_path)):
        stored = bench._read_status(path) or {}
        if stored.get("campaignStaging") or (session_name and path.name != session_name):
            continue
        ratings = bench._session_rating_map(path)
        vision = bench._session_vision_state(path)
        by_media = vision.get("byMedia") if isinstance(vision.get("byMedia"), dict) else {}
        disabled = set(vision.get("disabledGroups") or [])
        for result in stored.get("results") or []:
            if not isinstance(result, dict) or result.get("kind") == "base":
                continue
            proof = result.get("provenance") if isinstance(result.get("provenance"), dict) else {}
            if (str(proof.get("sourceJobId") or "") != job_id or
                    str(proof.get("sourceFolder") or "").replace(chr(92), "/").strip("/") != folder or
                    type(proof.get("sourceEpoch")) is not int):
                continue
            epoch = proof["sourceEpoch"]
            media = bench._result_media_file(result)
            assessed = by_media.get(media)
            assessed = assessed if isinstance(assessed, dict) else {}
            signature = _cohort_key(stored, result, assessed, vision)
            cohort = cohorts.setdefault(signature, {
                "id": signature, "modelId": str(stored.get("modelId") or ""),
                "vlModelId": str(assessed.get("modelId") or ""),
                "strength": result.get("strength", (stored.get("settings") or {}).get("strength")),
                "sessions": set(), "points": {}, "settings": "Matching frozen Test generation and VL protocol",
            })
            row = cohort["points"].setdefault(epoch, {"epoch": epoch, "manualSum": 0,
                "manualCount": 0, "vlMatches": 0, "vlCount": 0, "sessions": set()})
            cohort["sessions"].add(path.name)
            row["sessions"].add(path.name)
            if media in ratings:
                row["manualSum"] += ratings[media]
                row["manualCount"] += 1
            ignored = set(assessed.get("ignoredGroups") or [])
            for group in assessed.get("comparison") or []:
                if not isinstance(group, dict) or group.get("id") in disabled | ignored:
                    continue
                if group.get("result") == "match":
                    row["vlMatches"] += 1
                    row["vlCount"] += 1
                elif group.get("result") == "mismatch":
                    row["vlMatches"] += bench._test_vl_partial_credit(
                        group.get("expectedText"), group.get("selectedText"))
                    row["vlCount"] += 1
    output = []
    for cohort in cohorts.values():
        cohort["sessions"] = sorted(cohort["sessions"])
        cohort["points"] = [{
            "epoch": row["epoch"], "sessions": sorted(row["sessions"]),
            "manual": row["manualSum"] / row["manualCount"] if row["manualCount"] else None,
            "manualCount": row["manualCount"],
            "testVl": row["vlMatches"] / row["vlCount"] if row["vlCount"] else None,
            "testVlCount": row["vlCount"],
        } for row in sorted(cohort["points"].values(), key=lambda row: row["epoch"])]
        output.append(cohort)
    return sorted(output, key=lambda row: (row["modelId"], row["id"]))


def _round_trajectories(folder_path, job_id, campaigns=None):
    output = []
    for campaign in (campaigns if campaigns is not None else _campaigns(folder_path, [])):
        if not campaign.get("rounds"):
            continue
        mapping = campaign.get("candidateMap") or {}
        # Actual assessed rounds only. Planned-but-unstarted rounds are not evidence.
        assessed = {u.get("round") for u in campaign.get("units") or []
                    if isinstance(u, dict) and u.get("assessment") and type(u.get("round")) is int}
        for round_no in sorted(n for n in assessed if 1 <= n <= len(campaign["rounds"])):
            for point in finder._rank(campaign, round_no):
                if point["count"] <= 0:
                    continue
                identity = mapping.get(str(point["epoch"])) if mapping else None
                source = identity.get("jobId") if identity else campaign.get("jobId")
                if source != job_id:
                    continue
                epoch = identity.get("epoch") if identity else point["epoch"]
                if type(epoch) is not int:
                    continue
                output.append({"campaignId": campaign["id"], "round": round_no,
                               "epoch": epoch, "score": point["score"], "observations": point["count"]})
    return output


def _findings(snapshot, campaign_id):
    findings = []
    for report in snapshot["reports"]:
        cohorts = report.get("testCohorts") or []
        if len(cohorts) > 1:
            findings.append(report["run"]["label"] + ": " + str(len(cohorts)) + " different Test protocols; scores are separated.")
        selected = next((c for c in report["campaigns"] if c["id"] == campaign_id), None)
        if not selected:
            continue
        ranked = sorted((p for p in selected["points"] if p["score"] is not None),
                        key=lambda p: (-p["score"], -p["observations"], p["epoch"]))
        if ranked:
            best = ranked[0]
            findings.append(report["run"]["label"] + ": epoch " + str(best["epoch"]) +
                            " has the highest observed campaign VL score (" + f'{best["score"]:.1%}' +
                            ", " + str(best["observations"]) + " weighted observations).")
            if best["observations"] < 6:
                findings.append("Limited evidence: leading checkpoint has fewer than six weighted observations.")
            if len(ranked) > 1:
                findings.append("Measured lead over runner-up: " +
                                f'{(best["score"] - ranked[1]["score"]) * 100:.1f}' +
                                " percentage points; not a significance estimate.")
    return findings


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
            "testCohorts": [{"cohortId": cohort["id"], "modelId": cohort["modelId"],
                "sessionCount": len(cohort["sessions"]),
                "points": [{"epoch": p["epoch"], "rating": p["manual"], "ratings": p["manualCount"],
                            "vl": p["testVl"], "vlJudgments": p["testVlCount"]}
                           for p in cohort["points"][:120]]}
                           for cohort in item.get("testCohorts", [])[:12]],
            "roundProgress": [{"campaignId": p["campaignId"], "round": p["round"],
                               "epoch": p["epoch"], "score": p["score"],
                               "weightedObservations": p["observations"]}
                              for p in item.get("roundPoints", [])[:150]
                              if not campaign_id or p["campaignId"] == campaign_id],
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


def overview(folder_path):
    """Read-only Set-wide Testing Lab summary. No inference, filesystem writes, or checkpoint scans.

    Scores are grouped by exact frozen Test protocol, then by recorded run/epoch.
    Campaign evaluations are counted separately and never pooled with Test VL.
    """
    warnings = []
    folder = _folder_key(folder_path)
    sessions = bench._session_directories(folder_path)
    cohorts = {}
    epochs = {}
    seen_runs = set()
    totals = {
        "sessions": 0, "testPreviews": 0, "campaignPreviews": 0,
        "ratedPreviews": 0, "vlReviewedPreviews": 0, "vlJudgments": 0,
        "unlinkedPreviews": 0, "campaigns": 0,
    }
    recent = []

    def epoch_record(job_id, epoch, name=""):
        key = (job_id, epoch)
        if key not in epochs:
            epochs[key] = {
                "jobId": job_id, "epoch": epoch, "runName": name,
                "testCount": 0, "campaignCount": 0, "ratedCount": 0,
                "vlReviewedCount": 0, "sessions": set(),
            }
        elif name and not epochs[key]["runName"]:
            epochs[key]["runName"] = name
        return epochs[key]

    for directory in sessions:
        stored = bench._read_status(directory) or {}
        if stored.get("campaignStaging"):
            continue
        totals["sessions"] += 1
        started = stored.get("startedAt")
        recent.append({
            "name": directory.name, "startedAt": started if isinstance(started, (int, float)) else 0,
            "status": str(stored.get("status") or ""),
            "results": len(stored.get("results") or []),
        })
        ratings = bench._session_rating_map(directory)
        vision = bench._session_vision_state(directory)
        by_media = vision.get("byMedia") if isinstance(vision.get("byMedia"), dict) else {}
        disabled = set(vision.get("disabledGroups") or [])
        for result in stored.get("results") or []:
            if not isinstance(result, dict):
                continue
            totals["testPreviews"] += 1
            media = bench._result_media_file(result)
            rated = media in ratings
            if rated:
                totals["ratedPreviews"] += 1
            assessment = by_media.get(media)
            assessment = assessment if isinstance(assessment, dict) else {}
            ignored = set(assessment.get("ignoredGroups") or [])
            judgments = []
            for group in assessment.get("comparison") or []:
                if not isinstance(group, dict) or group.get("id") in disabled | ignored:
                    continue
                outcome = group.get("result")
                if outcome == "match":
                    credit = 1.0
                elif outcome == "mismatch":
                    credit = bench._test_vl_partial_credit(group.get("expectedText"), group.get("selectedText"))
                else:
                    continue
                judgments.append((group, float(credit)))
            if judgments:
                totals["vlReviewedPreviews"] += 1
                totals["vlJudgments"] += len(judgments)
            if result.get("kind") == "base":
                continue
            source = result.get("provenance") if isinstance(result.get("provenance"), dict) else {}
            job_id = str(source.get("sourceJobId") or "").strip()
            source_folder = str(source.get("sourceFolder") or "").replace("\\", "/").strip("/")
            epoch = source.get("sourceEpoch")
            if not job_id or source_folder != folder or type(epoch) is not int or epoch < 0:
                totals["unlinkedPreviews"] += 1
                continue
            seen_runs.add(job_id)
            name = str(source.get("sourceRunName") or "").strip()
            entry = epoch_record(job_id, epoch, name)
            entry["testCount"] += 1
            entry["sessions"].add(directory.name)
            if rated:
                entry["ratedCount"] += 1
            if judgments:
                entry["vlReviewedCount"] += 1

            signature = _cohort_key(stored, result, assessment, vision)
            cohort = cohorts.setdefault(signature, {
                "id": signature, "modelId": str(stored.get("modelId") or stored.get("model") or ""),
                "strength": result.get("strength", (stored.get("settings") or {}).get("strength")),
                "vlModelId": str(assessment.get("modelId") or ""),
                "sessions": set(), "previews": 0, "ratedPreviews": 0,
                "vlReviewedPreviews": 0, "vlJudgments": 0, "points": {}, "attributes": {},
            })
            cohort["sessions"].add(directory.name)
            cohort["previews"] += 1
            cohort["ratedPreviews"] += int(rated)
            cohort["vlReviewedPreviews"] += int(bool(judgments))
            cohort["vlJudgments"] += len(judgments)
            point = cohort["points"].setdefault((job_id, epoch), {
                "jobId": job_id, "epoch": epoch, "runName": name,
                "previews": 0, "manualSum": 0, "manualCount": 0,
                "vlSum": 0.0, "vlCount": 0, "vlReviewedPreviews": 0, "sessions": set(),
            })
            if name and not point["runName"]:
                point["runName"] = name
            point["previews"] += 1
            point["sessions"].add(directory.name)
            if rated:
                point["manualSum"] += ratings[media]
                point["manualCount"] += 1
            point["vlReviewedPreviews"] += int(bool(judgments))
            for group, credit in judgments:
                point["vlSum"] += credit
                point["vlCount"] += 1
                identity = (str(group.get("id") or ""), str(group.get("expectedText") or ""))
                attribute = cohort["attributes"].setdefault(identity, {
                    "label": str(group.get("label") or group.get("name") or group.get("id") or "Attribute")[:100],
                    "matched": 0.0, "count": 0,
                })
                attribute["matched"] += credit
                attribute["count"] += 1

    campaigns = _campaigns(folder_path, warnings)
    totals["campaigns"] = len(campaigns)
    for campaign in campaigns:
        candidate_map = campaign.get("candidateMap") or {}
        for unit in campaign.get("units") or []:
            if not isinstance(unit, dict) or not (unit.get("frame") or unit.get("framePruned") or unit.get("captured")):
                continue
            totals["campaignPreviews"] += 1
            identity = candidate_map.get(str(unit.get("epoch"))) if candidate_map else None
            job_id = str((identity.get("jobId") if identity else campaign.get("jobId")) or "").strip()
            epoch = identity.get("epoch") if identity else unit.get("epoch")
            if not job_id or type(epoch) is not int or epoch < 0:
                continue
            seen_runs.add(job_id)
            entry = epoch_record(job_id, epoch,
                                 str((identity.get("runName") if identity else campaign.get("runName")) or ""))
            entry["campaignCount"] += 1

    groups = []
    for cohort in cohorts.values():
        points = []
        for point in cohort["points"].values():
            points.append({
                "jobId": point["jobId"], "epoch": point["epoch"],
                "runName": point["runName"], "previews": point["previews"],
                "manual": point["manualSum"] / point["manualCount"] if point["manualCount"] else None,
                "manualCount": point["manualCount"],
                "testVl": point["vlSum"] / point["vlCount"] if point["vlCount"] else None,
                "testVlCount": point["vlCount"],
                "vlReviewedPreviews": point["vlReviewedPreviews"],
                "sessions": sorted(point["sessions"]),
            })
        attrs = [{"label": a["label"], "matched": a["matched"] / a["count"],
                  "judgments": a["count"]} for a in cohort["attributes"].values() if a["count"]]
        groups.append({
            "id": cohort["id"], "modelId": cohort["modelId"],
            "strength": cohort["strength"], "vlModelId": cohort["vlModelId"],
            "sessions": len(cohort["sessions"]), "previews": cohort["previews"],
            "ratedPreviews": cohort["ratedPreviews"],
            "vlReviewedPreviews": cohort["vlReviewedPreviews"],
            "vlJudgments": cohort["vlJudgments"],
            "points": sorted(points, key=lambda p: (p["jobId"], p["epoch"])),
            "attributes": sorted(attrs, key=lambda a: (a["matched"], -a["judgments"], a["label"])),
        })
    # Choose the most measured comparable group, not the first run or six arbitrary runs.
    groups.sort(key=lambda g: (-(g["ratedPreviews"] + g["vlReviewedPreviews"]),
                               -g["previews"], g["id"]))
    indexed = sorted((dict(row, sessions=sorted(row["sessions"])) for row in epochs.values()),
                     key=lambda x: (-(x["testCount"] + x["campaignCount"]), x["jobId"], x["epoch"]))
    totals["runsWithResults"] = len(seen_runs)
    totals["epochsWithResults"] = len(indexed)
    totals["generatedPreviews"] = totals["testPreviews"] + totals["campaignPreviews"]
    return {
        "coverage": totals, "cohorts": groups, "epochs": indexed,
        "recentSessions": sorted(recent, key=lambda x: (-x["startedAt"], x["name"]))[:8],
        "warnings": warnings,
    }
