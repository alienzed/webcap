#!/usr/bin/env python3
"""Isolated single-draft Artist -> Engineer pilot; never saves Studio material."""
import argparse
import copy
import hashlib
import json
import random
import sys
import time
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts import studio_guidance_eval as e

DESIGN = e.DESIGN_DIR / "artist_mixer"
PRODUCTION_FILES = (
    "tool/server/studio_guidance_defaults.py", "tool/server/llm_guidance.py",
    "tool/server/studio_director.py", "tool/server/app.py",
    "tool/js/director_chat.js", "tool/tool.html", "docs/mmh3-prompt-runtime-context.txt",
)


def production_hashes():
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in PRODUCTION_FILES}


def make_plan(model, seed=221):
    plan = e.prepare_experiment(SimpleNamespace(
        design_dir=DESIGN, package=None, case=None, split="all", baseline_from=None,
        repeats=1, seed=seed, command="run", model=model, base_url=None,
    ))
    blocks = [(case["id"], arm) for case in plan["cases"] for arm in ("single", "combined", "pipeline")]
    random.Random(seed).shuffle(blocks)
    plan["trials"] = [{"case_id": case, "package_id": stage, "repeat": 1}
                      for case, arm in blocks
                      for stage in (("artist", "mixed") if arm == "pipeline" else (arm,))]
    plan.update({"actual_call_cap": 20, "max_tokens": 2048, "context_size": None,
                 "schemas": e.read_json(DESIGN / "schemas.json")["schemas"],
                 "production_hashes": production_hashes(),
                 "sampling_protocol": "single/combined: Chat .35, Write .2; artist .7; mixed .15; top_p unchanged by stage (.9 Chat/.85 Write); penalties zero; thinking disabled"})
    assert len(plan["trials"]) == plan["actual_call_cap"]
    return plan


def sampling(stage, operation):
    chat = operation == "studio_chat"
    temperature = .7 if stage == "artist" else .15 if stage == "mixed" else .35 if chat else .2
    return {"temperature": temperature, "top_p": .9 if chat else .85,
            "presence_penalty": 0., "frequency_penalty": 0.}


def stage_messages(case, package, technical, artist_text=None):
    messages = e.make_messages(case, package, technical)
    if artist_text is not None:
        messages.append({"role": "user", "content": json.dumps({
            "task": "Refine this Artist draft for the author's request above. Return the complete final answer or authored artifact.",
            "artistDraft": artist_text,
        }, ensure_ascii=False)})
    return messages


def call_real(model, messages, schema, settings, max_tokens, context_size):
    from tool.server import config as app_config
    from tool.server import storyboard_llm_runtime as runtime
    if runtime.uses_local_gpu(model):
        raise ValueError("This isolated pilot uses a configured remote runtime; local GPU work requires WebCap queue ownership.")
    if not app_config.CONFIG_PATH.is_file():
        raise FileNotFoundError("Existing WebCap model configuration is required.")
    app_config.reload_runtime_config()  # Existing configuration is read, never edited.
    wire = []
    original = runtime._remote_http_json_cancellable

    def observed(path, method="GET", payload=None, timeout=30):
        if path == "/chat/completions" and method == "POST":
            wire.append(copy.deepcopy(payload))
        return original(path, method=method, payload=payload, timeout=timeout)

    runtime._remote_http_json_cancellable = observed
    try:
        result = runtime.chat(model, messages, response_schema=schema,
                              max_tokens=max_tokens, context_size=context_size,
                              sampling=settings, allow_truncated=True, thinking=False)
    except Exception as exc:
        exc.inference_requests_observed = len(wire)
        raise
    finally:
        runtime._remote_http_json_cancellable = original
    if len(wire) != 1:
        raise RuntimeError("Expected exactly one recorded model request; received " + str(len(wire)))
    return result, wire[0]


def execute(plan, output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    e.write_json(output / "manifest.json", plan)
    cases = {case["id"]: case for case in plan["cases"]}
    artist_receipts = {}
    failures = calls = 0
    for index, trial in enumerate(plan["trials"], 1):
        case, stage = cases[trial["case_id"]], trial["package_id"]
        record = {**trial, "index": index, "operation": case["operation"], "split": case["split"], "started_at": e.utc_now()}
        start = time.monotonic()
        source = artist_receipts.get(case["id"]) if stage == "mixed" else None
        draft = str((source or {}).get("result", {}).get("text") or "")
        if stage == "mixed" and not draft:
            record.update(status="dependency_error", error="Artist supplied no draft text; independent outputs are retained.", result={}, inference_requests_observed=0)
        else:
            messages = stage_messages(case, plan["packages"][stage], plan["technical_reference"], draft if stage == "mixed" else None)
            settings = sampling(stage, case["operation"])
            record["request"] = {"model": plan["model"], "operation": case["operation"], "messages": messages,
                                 "sampling": settings, "response_schema": plan["schemas"][case["operation"]]}
            record["request_sha256"] = e.digest(record["request"])
            if source:
                record["artist_source_index"] = source["index"]
                record["artist_source_sha256"] = e.digest(draft)
            try:
                calls += 1
                result, wire = call_real(plan["model"], messages, plan["schemas"][case["operation"]], settings,
                                         plan["max_tokens"], plan["context_size"])
                record.update(status="completed", error="", result=result, wire_request=wire, inference_requests_observed=1)
            except Exception as exc:
                record.update(status="request_error", error=str(exc), result={},
                              inference_requests_observed=getattr(exc, "inference_requests_observed", None))
        record["elapsed_seconds"] = round(time.monotonic() - start, 3)
        record["finished_at"] = e.utc_now()
        e.append_jsonl(output / "trials.jsonl", record)
        if stage == "artist":
            artist_receipts[case["id"]] = record
        if record["status"] != "completed":
            failures += 1
            print("FAILED", index, case["id"], stage, record["error"], file=sys.stderr, flush=True)
        else:
            print(index, "of", len(plan["trials"]), case["id"], stage, "completed", flush=True)
    unchanged = production_hashes() == plan["production_hashes"]
    e.write_json(output / "execution_summary.json", {"model_call_attempts": calls,
                                                   "completed_model_calls": len(plan["trials"]) - failures,
                                                   "failures": failures,
                                                   "production_files_unchanged": unchanged})
    if not unchanged:
        raise RuntimeError("Production files changed during the isolated experiment; inspect the working tree.")
    return int(bool(failures))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("plan", "run"))
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--seed", type=int, default=221)
    args = parser.parse_args(argv)
    plan = make_plan(args.model, args.seed)
    if args.command == "plan":
        output = Path(args.output)
        output.mkdir(parents=True, exist_ok=False)
        e.write_json(output / "manifest.json", plan)
        print("Offline plan:", len(plan["trials"]), "requests; zero model calls.")
        return 0
    return execute(plan, args.output)


if __name__ == "__main__":
    raise SystemExit(main())
