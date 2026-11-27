#!/usr/bin/env python3
"""Run actual sequential Chat turns using the existing experiment transport."""
import argparse
import random
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
from studio_guidance_eval import (load_design, resolve_packages, read_json,
    write_json, append_jsonl, make_messages, real_trial, digest)

DESIGN = Path(__file__).resolve().parent


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--model", required=True)
    p.add_argument("--base-url", required=True)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--package", action="append")
    p.add_argument("--repeats", type=int, default=2)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--timeout", type=int, default=900)
    args = p.parse_args()
    specs, _ = load_design(DESIGN)
    packages = resolve_packages(specs)
    selected = args.package or list(packages)
    if not set(selected) <= packages.keys() or args.repeats < 1 or args.timeout < 1:
        p.error("Invalid package, repeats or timeout")
    chains = read_json(DESIGN / "chains.json")["chains"]
    trials = [(c, k, r) for c in chains for k in selected
              for r in range(1, args.repeats + 1)]
    random.Random(args.seed).shuffle(trials)
    args.output.mkdir(parents=True, exist_ok=False)
    write_json(args.output / "manifest.json", {
        "model": args.model, "base_url": args.base_url, "seed": args.seed,
        "repeats": args.repeats, "chains": chains,
        "packages": {k: packages[k] for k in selected}})
    failures = 0
    for chain, key, repeat in trials:
        history = []
        for index, turn in enumerate(chain["turns"], 1):
            history.append({"role": "user", "content": turn})
            case = {"operation": "studio_chat", "history": history}
            messages = make_messages(case, packages[key], "")
            row = {"chain": chain["id"], "package": key, "repeat": repeat,
                   "turn": index, "messages": messages, "request_sha256": digest(messages)}
            try:
                row.update(real_trial(args.base_url, args.model, case, messages, args.timeout))
            except (RuntimeError, TimeoutError, ValueError, OSError) as exc:
                row.update(status="request_error", error=str(exc))
            answer = (row.get("result") or {}).get("text")
            if row["status"] == "completed" and (not isinstance(answer, str) or not answer.strip()):
                row.update(status="empty_response", error="No usable chat text")
            append_jsonl(args.output / "turns.jsonl", row)
            print(chain["id"], key, repeat, index, row["status"], flush=True)
            if row["status"] != "completed":
                failures += 1
                break
            history.append({"role": "assistant", "content": answer})
    return int(bool(failures))


if __name__ == "__main__":
    sys.exit(main())
