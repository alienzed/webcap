#!/usr/bin/env python3
"""Controlled, opt-in evaluation of Studio Director creative primers.

Runs real configured Director models through WebCap's existing read-only-in-effect
Chat/Write drafting API. Does not call any Project or Scene persistence route.
Python standard library only; see docs/studio-guidance-evaluation.md.
"""

import argparse
import hashlib
import json
import random
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DESIGN_DIR = ROOT / "experiments" / "studio_guidance"
TERMINAL = {"completed", "failed", "cancelled", "stopped", "interrupted"}
SCENE_TASK = (
    "Create the requested independently generatable H3 Scenes for this Project. "
    "Give each Scene a useful title, complete H3 Prompt and durationSeconds. "
    "H3 can generate clips between 4 and 15 seconds. Give every Scene a "
    "durationSeconds within that range, honoring the author's requested timing "
    "when it fits. Choose each duration independently to support its action, "
    "shot transitions and dialogue rather than making every Scene the same length. "
    "Match the final timed H3 shot to the selected durationSeconds. "
    "For longer developments, use connected short Scenes with clear continuity. "
    "Deliver the authored Scenes now."
)
PROJECT_TASK = (
    "Create one Project with its title, Concept, Visual / atmosphere and relevant "
    "Invariants. Return complete Project field values in the supplied response "
    "format. Scene writing is a separate Write → Scene(s) action."
)
RATING_FIELDS = ("intent_fidelity", "creative_value", "h3_readiness")
SCORE_FIELDS = RATING_FIELDS + ("estimated_correction_rounds",)


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def digest(value):
    return hashlib.sha256(json_bytes(value)).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def read_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def save_jsonl(path, rows):
    with Path(path).open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def append_jsonl(path, row):
    with Path(path).open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        handle.flush()


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def load_design(design_dir=DESIGN_DIR):
    design_dir = Path(design_dir)
    source_packages = read_json(design_dir / "packages.json")
    source_scenarios = read_json(design_dir / "scenarios.json")
    assert source_packages["version"] == source_scenarios["version"] == 1
    cases, packages = source_scenarios["cases"], source_packages["packages"]
    assert len({item["id"] for item in cases}) == len(cases)
    assert len({item["id"] for item in packages}) == len(packages)
    assert cases and packages
    for item in cases:
        assert item["operation"] in {"studio_chat", "studio_project_draft", "studio_scenes_draft"}
        assert item["split"] in {"development", "holdout"}
        assert item["history"] and all(m["role"] in {"user", "assistant"} for m in item["history"])
        if item["operation"] != "studio_chat":
            assert item["instruction"]
        if item["operation"] == "studio_scenes_draft":
            assert isinstance(item["project"], dict)
    return packages, cases


def repo_default(module):
    sys.path.insert(0, str(ROOT))
    from tool.server.llm_guidance import default_for
    return default_for(module)


def resolve_packages(packages, baseline_manifest=None):
    frozen = baseline_manifest or {}
    results = {}
    for item in packages:
        if item.get("source") == "repository_default":
            if frozen:
                previous = frozen["packages"][item["id"]]
                role, expertise = previous["role"], previous["expertise"]
            else:
                role, expertise = repo_default(item["profile"]), repo_default(item["toolkit"])
        else:
            role, expertise = item["role"], item["expertise"]
        assert isinstance(role, str) and role.strip()
        assert isinstance(expertise, str)
        addendum = item.get("authoring_addendum", "")
        if not isinstance(addendum, str):
            raise ValueError("Authoring addendum must be a text string.")
        results[item["id"]] = {
            "revision": item["revision"], "hypothesis": item["hypothesis"],
            "role": role, "expertise": expertise,
            "authoring_addendum": addendum,
            "sha256": digest([role, expertise, addendum])
        }
    return results


def make_messages(case, package, technical):
    system = package["role"].strip()
    if package["expertise"].strip():
        system += "\n\n" + package["expertise"].strip()
    if case["operation"] == "studio_scenes_draft":
        system += "\n\nH3 PROMPT AUTHORING REFERENCE:\n" + technical
        if package.get("authoring_addendum", "").strip():
            system += "\n\nSCENE AUTHORING FOCUS:\n" + package["authoring_addendum"].strip()
    messages = [{"role": "system", "content": system}] + [
        {"role": m["role"], "content": m["content"]} for m in case["history"]
    ]
    if case["operation"] == "studio_project_draft":
        request = {"task": PROJECT_TASK, "instruction": case["instruction"]}
        messages.append({"role": "user", "content": json.dumps(request, ensure_ascii=False)})
    if case["operation"] == "studio_scenes_draft":
        request = {"task": SCENE_TASK, "authorDirection": case["instruction"], "project": case["project"]}
        messages.append({"role": "user", "content": json.dumps(request, ensure_ascii=False)})
    return messages


def prepare_experiment(args):
    packages_spec, scenarios = load_design(args.design_dir)
    allowed_ids = set(args.package or [p["id"] for p in packages_spec])
    known_packages = {p["id"] for p in packages_spec}
    if not allowed_ids <= known_packages:
        raise ValueError("Unknown package IDs: " + ", ".join(sorted(allowed_ids - known_packages)))
    wanted_cases = set(args.case or [s["id"] for s in scenarios])
    unknown_cases = wanted_cases - {s["id"] for s in scenarios}
    if unknown_cases:
        raise ValueError("Unknown case IDs: " + ", ".join(sorted(unknown_cases)))
    selection = [
        s for s in scenarios if s["id"] in wanted_cases and
        (args.split == "all" or s["split"] == args.split)
    ]
    if not selection:
        raise ValueError("No scenarios match the selected split and case IDs.")
    old = read_json(args.baseline_from) if args.baseline_from else None
    if old and old["scenarios_sha256"] != digest(scenarios):
        raise ValueError("The scenario file changed since the frozen baseline run.")
    packages = resolve_packages(packages_spec, old)
    packages = {key: value for key, value in packages.items() if key in allowed_ids}
    technical = old["technical_reference"] if old else repo_default("h3.authoring")
    assert technical.strip()
    trials = [
        {"case_id": s["id"], "package_id": pid, "repeat": repeat}
        for s in selection for pid in packages for repeat in range(1, args.repeats + 1)
    ]
    random.Random(args.seed).shuffle(trials)
    run = {
        "version": 1, "created_at": utc_now(), "mode": args.command,
        "design_dir": str(Path(args.design_dir).resolve()),
        "model": args.model, "base_url": args.base_url if args.command == "run" else None,
        "seed": args.seed, "split": args.split, "repeats": args.repeats,
        "scenarios_sha256": digest(scenarios),
        "packages": packages, "technical_reference": technical,
        "technical_reference_sha256": digest(technical),
        "cases": selection, "trials": trials,
        "run_protocol": "same model, operation, case messages, base primer, technical contract and sampling; only declared package text varies",
    }
    return run


def job_api(base_url, path, payload=None, timeout=30):
    url = base_url.rstrip("/") + path
    body = json_bytes(payload) if payload is not None else None
    request = Request(url, data=body, headers={"Content-Type": "application/json"},
                      method="POST" if payload is not None else "GET")
    try:
        with urlopen(request, timeout=timeout) as response:
            value = json.loads(response.read().decode("utf-8"))
            if not response.status in (200, 201, 202) or not value.get("ok"):
                raise RuntimeError("WebCap rejected request: " + str(value))
            return value
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError("WebCap HTTP " + str(exc.code) + ": " + detail) from exc
    except URLError as exc:
        raise RuntimeError("WebCap connection failed: " + str(exc.reason)) from exc


def real_trial(base_url, model, case, messages, timeout):
    operation = case["operation"]
    payload = {"model": model, "operation": operation, "messages": messages}
    queued = job_api(base_url, "/fs/director/chat", payload)
    job = queued.get("job") or {}
    job_id = str(job.get("jobId") or "")
    if not job_id:
        raise RuntimeError("WebCap did not return an LLM job ID.")
    deadline = time.monotonic() + timeout
    while True:
        receipt = job_api(base_url, "/fs/director/job?job=" + quote(job_id) + "&consume=1")
        job = receipt.get("job") or {}
        status = str(job.get("status") or "")
        if status in TERMINAL:
            return {"job_id": job_id, "status": status, "result": job.get("result") or {},
                    "error": job.get("error") or "", "job_request": queued["job"].get("request")}
        if time.monotonic() >= deadline:
            raise TimeoutError("LLM job " + job_id + " remained " + (status or "unknown") +
                               " after " + str(timeout) + " seconds; inspect WebCap queue.")
        time.sleep(1)


def execute(args):
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=False)
    run = prepare_experiment(args)
    write_json(output / "manifest.json", run)
    cases = {s["id"]: s for s in run["cases"]}
    failures = 0
    for index, trial in enumerate(run["trials"], 1):
        case = cases[trial["case_id"]]
        package = run["packages"][trial["package_id"]]
        messages = make_messages(case, package, run["technical_reference"])
        record = {
            **trial, "index": index, "operation": case["operation"], "split": case["split"],
            "started_at": utc_now(), "request": {
                "operation": case["operation"], "model": args.model, "messages": messages
            }, "request_sha256": digest([case["operation"], messages]),
        }
        start = time.monotonic()
        if args.command == "run":
            try:
                record.update(real_trial(args.base_url, args.model, case, messages, args.timeout))
            except (RuntimeError, TimeoutError, ValueError) as exc:
                record.update({"status": "request_error", "error": str(exc), "result": {}})
        else:
            record.update({"status": "planned", "result": {}})
        record["elapsed_seconds"] = round(time.monotonic() - start, 3)
        record["finished_at"] = utc_now()
        append_jsonl(output / "trials.jsonl", record)
        if record["status"] not in ("completed", "planned"):
            failures += 1
            print("FAILED", index, case["id"], trial["package_id"], record["error"], file=sys.stderr)
        else:
            print(index, "of", len(run["trials"]), trial["case_id"], trial["package_id"], record["status"], flush=True)
    print("Evidence:", output.resolve(), "trials:", len(run["trials"]), "failures:", failures)
    return 1 if failures else 0


def prepare_review(args):
    folder = Path(args.run_dir)
    manifest = read_json(folder / "manifest.json")
    rows = read_jsonl(folder / "trials.jsonl")
    if len(rows) != len(manifest["trials"]):
        raise ValueError("Run is incomplete: collect all trial receipts before blind review.")
    if any(row["status"] == "planned" for row in rows):
        raise ValueError("A dry-run plan contains no model evidence; run the actual trials before review.")
    if (folder / "review_cards.jsonl").exists() or (folder / "review_key.json").exists():
        raise ValueError("Review files already exist. Preserve the original blind assignment.")
    order = list(rows)
    random.Random(manifest["seed"] + 4103).shuffle(order)
    cases = {s["id"]: s for s in manifest["cases"]}
    cards, key = [], {}
    for index, record in enumerate(order, 1):
        case = cases[record["case_id"]]
        blind_id = "R" + str(index).zfill(4)
        key[blind_id] = {"package_id": record["package_id"], "case_id": record["case_id"],
                         "repeat": record["repeat"], "record_index": record["index"]}
        cards.append({
            "blind_id": blind_id, "scenario": case["id"], "operation": case["operation"],
            "category": case["category"], "fidelity_checks": case.get("fidelity_checks", []),
            "review_focus": case["focus"], "author_messages": case["history"],
            "author_direction": case.get("instruction"),
            "response": (record.get("result") or {}).get("text", ""),
            "request_succeeded": record["status"] == "completed",
            "usable_first_pass": None,
            "intent_fidelity": None, "creative_value": None, "h3_readiness": None,
            "estimated_correction_rounds": None, "actual_revision_rounds": None,
            "notes": ""
        })
    save_jsonl(folder / "review_cards.jsonl", cards)
    write_json(folder / "review_key.json", {"version": 1, "entries": key})
    print("Review", len(cards), "blinded responses in", folder / "review_cards.jsonl")
    print("Keep review_key.json separate from reviewers until all ratings are recorded.")


def average(values):
    return round(sum(values) / len(values), 3) if values else None


def report(args):
    folder = Path(args.run_dir)
    manifest, cards = read_json(folder / "manifest.json"), read_jsonl(folder / "review_cards.jsonl")
    key = read_json(folder / "review_key.json")["entries"]
    if set(card["blind_id"] for card in cards) != set(key):
        raise ValueError("Blinded review IDs do not match the sealed key.")
    trials = read_jsonl(folder / "trials.jsonl")
    by_index = {row["index"]: row for row in trials}
    results = defaultdict(list)
    cases = {case["id"]: case for case in manifest["cases"]}
    for card in cards:
        identity = key[card["blind_id"]]
        record = by_index[identity["record_index"]]
        if identity["case_id"] != record["case_id"] or identity["package_id"] != record["package_id"]:
            raise ValueError("Review-to-trial identity does not match.")
        for field in RATING_FIELDS:
            value = card[field]
            if value is not None and (type(value) not in (int, float) or not 1 <= value <= 5):
                raise ValueError(field + " must be 1-5 or blank for " + card["blind_id"])
        for field in ("estimated_correction_rounds", "actual_revision_rounds"):
            value = card[field]
            if value is not None and (type(value) is not int or value < 0):
                raise ValueError(field + " must be a nonnegative integer or blank")
        if card["usable_first_pass"] is not None and type(card["usable_first_pass"]) is not bool:
            raise ValueError("usable_first_pass must be true, false, or blank")
        results[identity["package_id"], record["operation"], cases[record["case_id"]]["category"]].append((card, record))
    summary = []
    for (package, operation, category), pairs in sorted(results.items()):
        rated = [card for card, rec in pairs if card["usable_first_pass"] is not None]
        row = {
            "package": package, "operation": operation, "category": category,
            "trials": len(pairs), "responses_ok": sum(rec["status"] == "completed" for card, rec in pairs),
            "reviewed": len(rated), "first_pass_usable_rate": (
                round(sum(card["usable_first_pass"] for card in rated) / len(rated), 3) if rated else None
            ),
            "avg_intent": average([card["intent_fidelity"] for card, rec in pairs if card["intent_fidelity"] is not None]),
            "avg_creativity": average([card["creative_value"] for card, rec in pairs if card["creative_value"] is not None]),
            "avg_render_readiness": average([card["h3_readiness"] for card, rec in pairs if card["h3_readiness"] is not None]),
            "avg_estimated_correction_rounds": average([
                card["estimated_correction_rounds"] for card, rec in pairs if card["estimated_correction_rounds"] is not None
            ]),
            "avg_actual_revision_rounds": average([
                card["actual_revision_rounds"] for card, rec in pairs if card["actual_revision_rounds"] is not None
            ]),
            "avg_elapsed_seconds": average([rec["elapsed_seconds"] for card, rec in pairs if rec["status"] == "completed"]),
        }
        summary.append(row)
    result = {"version": 1, "model": manifest["model"], "split": manifest["split"],
              "score_source": "human blind review; blank values are not imputed",
              "categories": summary}
    write_json(folder / "report.json", result)
    print(json.dumps(result, indent=2))
    print("Human review metrics describe recorded judgments. No package is auto-selected as a winner.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("plan", "run"):
        p = commands.add_parser(name, help="Prepare comparable requests" if name == "plan" else "Run actual WebCap model jobs")
        p.add_argument("--output", required=True, help="A new directory for the entire experiment")
        p.add_argument("--model", required=True, help="Exact configured Director model ID")
        p.add_argument("--design-dir", default=str(DESIGN_DIR), help="Versioned packages.json and scenarios.json directory")
        p.add_argument("--base-url", help="Live WebCap URL; required for run")
        p.add_argument("--split", choices=("development", "holdout", "all"), default="development")
        p.add_argument("--repeats", type=int, default=2)
        p.add_argument("--seed", type=int, default=42)
        p.add_argument("--package", action="append", help="Select package ID; repeat option")
        p.add_argument("--case", action="append", help="Select case ID; repeat option")
        p.add_argument("--baseline-from", help="Prior manifest.json to freeze baseline and technical reference")
        p.add_argument("--timeout", type=int, default=900, help="Maximum seconds per actual model job")
    for name in ("review", "report"):
        p = commands.add_parser(name)
        p.add_argument("--run-dir", required=True)
    args = parser.parse_args(argv)
    if args.command in ("plan", "run"):
        if args.repeats < 1 or args.timeout < 1:
            parser.error("--repeats and --timeout must be positive")
        if args.command == "run" and not args.base_url:
            parser.error("run requires --base-url for a running WebCap instance")
        return execute(args)
    if args.command == "review":
        prepare_review(args)
    else:
        report(args)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, RuntimeError, ValueError, KeyError, AssertionError) as error:
        print(type(error).__name__ + ": " + str(error), file=sys.stderr)
        sys.exit(2)
