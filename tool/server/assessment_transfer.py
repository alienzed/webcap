"""Portable assessment evidence; runtime configuration and media stay on their host."""
import hashlib
import json
import socket

from . import model_lab, director_model_calibration


def _portable_run(run):
    """Keep referenced successful evidence inside an export, without changing local journals."""
    payload = model_lab._copy(run)
    for key, source in list((payload.get("reused") or {}).items()):
        original = model_lab.get_run(source["runId"])
        attempt = next((a for a in original.get("attempts") or []
                        if a.get("id") == source["attemptId"] and a.get("status") == "completed"), None)
        if attempt is None:
            raise RuntimeError("Reused assessment evidence is missing: " + key)
        payload.setdefault("attempts", []).append(model_lab._copy(attempt))
    payload["reused"] = {}
    payload["previousFailures"] = {}
    payload["summary"] = model_lab._summarize(payload)
    return payload


def export_results():
    with model_lab._lock:
        rows = model_lab.list_runs()
        return {
            "format": "webcap-assessments", "version": 1,
            "sourceHost": socket.gethostname(), "exportedAt": model_lab._now_iso(),
            "runs": [_portable_run(model_lab.get_run(row["id"])) for row in rows if not row["active"]],
            "reports": director_model_calibration.list_reports(),
            "activeRunsExcluded": sum(bool(row["active"]) for row in rows),
        }


def import_results(bundle, runtime_map):
    if not isinstance(bundle, dict) or bundle.get("format") != "webcap-assessments" or bundle.get("version") != 1:
        raise ValueError("Choose a WebCap assessment export (version 1).")
    if not isinstance(bundle.get("runs"), list) or not isinstance(bundle.get("reports"), list):
        raise ValueError("Assessment export must contain runs and reports lists.")
    if not isinstance(runtime_map, dict):
        raise ValueError("Choose the destination runtime for each source runtime.")
    source = {"host": str(bundle.get("sourceHost") or ""), "exportedAt": str(bundle.get("exportedAt") or "")}

    def remap(ref):
        runtime, separator, model = str(ref or "").partition("::")
        target = runtime_map.get(runtime)
        if not separator or not model or not isinstance(target, str) or not target or "::" in target:
            raise ValueError("Choose a destination runtime for " + runtime + ".")
        return target + "::" + model

    def remap_model(model):
        if str(model.get("modelRef") or "") != str(model.get("runtimeId") or "") + "::" + str(model.get("modelId") or ""):
            raise ValueError("Assessment model identity is inconsistent.")
        model["modelRef"] = remap(model["modelRef"])
        model["runtimeId"] = model["modelRef"].split("::", 1)[0]
        # Keep the source runtime name as evidence; the destination owns its label.

    source_runs = {item.get("id"): item for item in bundle["runs"] if isinstance(item, dict)}
    runs, reports = [], []
    for original in bundle["runs"]:
        if not isinstance(original, dict) or original.get("version") != model_lab.RUN_VERSION:
            raise ValueError("Unsupported assessment run format.")
        model_lab._run_path(original.get("id"))  # Validate before any writes.
        if original.get("status") not in {"completed", "stopped", "interrupted", "error"}:
            raise ValueError("Only finished or interrupted assessment evidence can be imported.")
        run = model_lab._copy(original)
        if not isinstance(run.get("attempts"), list):
            raise ValueError("Assessment run is missing probe evidence.")
        # Read old bundles that carried run-ID references before portable
        # exports were self-contained. Missing sources are real invalid evidence.
        for key, source in (run.get("reused") or {}).items():
            earlier = source_runs.get(source.get("runId"))
            attempt = next((a for a in (earlier or {}).get("attempts") or []
                            if a.get("id") == source.get("attemptId") and
                            a.get("status") == "completed"), None)
            if attempt is None:
                raise ValueError("Assessment export lacks reused evidence: " + key)
            run["attempts"].append(model_lab._copy(attempt))
        for field in ("visionModels", "directorModels", "allVisionModels", "allDirectorModels"):
            for model in run.get(field) or []:
                remap_model(model)
        for field in ("referenceVisionRef", "referenceDirectorRef"):
            if run.get(field):
                run[field] = remap(run[field])
        for attempt in run["attempts"]:
            attempt["modelRef"] = remap(attempt["modelRef"])
            kind = str(attempt.get("kind") or "")
            if kind.startswith("vision:") and ":vocab_" in kind:
                ref, suffix = kind[7:].rsplit(":vocab_", 1)
                attempt["kind"] = "vision:" + remap(ref) + ":vocab_" + suffix
        # An imported host has different journal IDs and timings.
        # Portable exports materialize completed evidence, so never preserve
        # dangling cross-host reused-run references.
        run["reused"] = {}
        run["previousFailures"] = {}
        run["progress"] = {}
        run["summary"] = model_lab._summarize(run)
        run["importedFrom"] = original.get("importedFrom") or {**source, "runId": original["id"]}
        # Content identity makes repeated imports idempotent without replacing local evidence.
        identity = model_lab._copy(run)
        identity["id"] = run["importedFrom"]["runId"]
        identity["importedFrom"].pop("exportedAt", None)
        digest = hashlib.sha256(json.dumps(identity, sort_keys=True).encode("utf-8")).hexdigest()[:24]
        run["id"] = "import-" + digest
        runs.append((run, original))
    for original in bundle["reports"]:
        report = model_lab._copy(original)
        remap_model(report)
        report["importedFrom"] = original.get("importedFrom") or {**source, "modelRef": original["modelRef"]}
        reports.append(director_model_calibration.normalize_report(report))

    added = skipped = 0
    with model_lab._lock:
        for run, original in runs:
            path = model_lab._run_path(run["id"])
            original_path = model_lab._run_path(original["id"])
            unchanged_local = (all(key == value for key, value in runtime_map.items())
                               and original_path.exists() and model_lab._read_raw(original["id"]) == original)
            if path.exists() or unchanged_local:
                skipped += 1
            else:
                model_lab._write_run(run)
                added += 1
        report_count = director_model_calibration.import_reports(reports)
    return {"runsImported": added, "runsAlreadyPresent": skipped, "reportsImported": report_count}
