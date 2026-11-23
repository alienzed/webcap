#!/usr/bin/env python3
"""Blind, paired human preference review for the isolated creative charter trial.

Uses existing studio_guidance_eval.py receipts. Never calls WebCap or an LLM.
Only scored human preferences are summarized; no automatic winner is selected.
"""
import argparse
import json
import random
from collections import defaultdict
from itertools import combinations
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import studio_guidance_eval as evaluation


def build(run_dir):
    folder = Path(run_dir)
    manifest = evaluation.read_json(folder / "manifest.json")
    if (folder / "preference_cards.jsonl").exists() or (folder / "preference_key.json").exists():
        raise ValueError("Preference review exists; do not overwrite blind evidence.")
    receipts = evaluation.read_jsonl(folder / "trials.jsonl")
    if len(receipts) != len(manifest["trials"]) or any(r["status"] == "planned" for r in receipts):
        raise ValueError("Requires completed actual-model trial receipts, not an offline plan.")
    by_case = defaultdict(dict)
    for receipt in receipts:
        k = (receipt["case_id"], receipt["repeat"])
        by_case[k][receipt["package_id"]] = receipt
    cases = {case["id"]: case for case in manifest["cases"]}
    rng = random.Random(manifest["seed"] + 97531)
    pairs = []
    for (case_id, repeat), variants in sorted(by_case.items()):
        for a, b in combinations(sorted(variants), 2):
            left, right = variants[a], variants[b]
            if rng.randrange(2):
                left, right = right, left
            pairs.append((case_id, repeat, left, right))
    rng.shuffle(pairs)
    cards, key = [], {}
    for index, (case_id, repeat, left, right) in enumerate(pairs, 1):
        cid = "P" + str(index).zfill(4)
        case = cases[case_id]
        cards.append({
            "blind_id": cid, "scenario": case_id, "repeat": repeat,
            "operation": case["operation"], "category": case["category"],
            "author_messages": case["history"], "author_direction": case.get("instruction"),
            "project": case.get("project"),
            "review_question": "Which is the stronger overall creative-director contribution for this author's goal?",
            "left": {"response": (left.get("result") or {}).get("text", ""), "completed": left["status"] == "completed"},
            "right": {"response": (right.get("result") or {}).get("text", ""), "completed": right["status"] == "completed"},
            "preference": None, "reason": "", "reviewer": None
        })
        key[cid] = {"left": left["package_id"], "right": right["package_id"],
                    "case_id": case_id, "repeat": repeat}
    evaluation.save_jsonl(folder / "preference_cards.jsonl", cards)
    evaluation.write_json(folder / "preference_key.json", {"version": 1, "entries": key})
    print("Prepared", len(cards), "blind preference cards. Keep preference_key.json private.")


def report(run_dir):
    folder = Path(run_dir)
    cards = evaluation.read_jsonl(folder / "preference_cards.jsonl")
    manifest = evaluation.read_json(folder / "manifest.json")
    key = evaluation.read_json(folder / "preference_key.json")["entries"]
    if {c["blind_id"] for c in cards} != set(key):
        raise ValueError("Preference cards and private key differ.")
    results = defaultdict(lambda: {"left_wins": 0, "right_wins": 0, "ties": 0, "rated": 0, "unrated": 0})
    for card in cards:
        vote = card.get("preference")
        if vote not in (None, "left", "right", "tie", "both_unusable"):
            raise ValueError("Invalid preference on " + card["blind_id"])
        who = key[card["blind_id"]]
        if who["case_id"] != card["scenario"] or who["repeat"] != card["repeat"]:
            raise ValueError("Pair identity mismatch for " + card["blind_id"])
        pair = tuple(sorted((who["left"], who["right"])))
        k = (pair, card["operation"])
        row = results[k]
        if vote is None:
            row["unrated"] += 1
        else:
            row["rated"] += 1
            if vote in ("tie", "both_unusable"):
                row["ties"] += 1
            elif who[vote] == pair[0]:
                row["left_wins"] += 1
            else:
                row["right_wins"] += 1
    items = []
    for (pair, operation), tally in sorted(results.items()):
        items.append({"packages": list(pair), "operation": operation, **tally})
    output = {"version": 1, "model": manifest["model"],
              "score_source": "human pairwise blind preference; missing votes stay missing",
              "pairwise": items, "winner": None}
    evaluation.write_json(folder / "preference_report.json", output)
    print(json.dumps(output, indent=2))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("review", "report"):
        sub.add_parser(command).add_argument("--run-dir", required=True)
    args = parser.parse_args(argv)
    if args.command == "review":
        build(args.run_dir)
    else:
        report(args.run_dir)


if __name__ == "__main__":
    main()
