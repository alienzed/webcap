"""Focused H3 Scene-writing experiment: same creative primer, single-factor addenda."""
import json

import pytest

from scripts import studio_guidance_eval as evals


FOCUSED = evals.DESIGN_DIR / "focused_h3"


def focused():
    return evals.load_design(FOCUSED)


def test_four_packages_share_the_exact_baseline_and_change_one_short_h3_focus():
    packages, cases = focused()
    assert {p["id"] for p in packages} == {"d-control", "state-anchor", "timed-cuts", "spoken-lines"}
    resolved = evals.resolve_packages(packages)
    baseline = resolved["d-control"]
    assert baseline["role"] == evals.repo_default("studio.classic")
    assert baseline["expertise"] == evals.repo_default("h3.toolkit")
    assert baseline["authoring_addendum"] == ""
    for package in packages:
        row = resolved[package["id"]]
        assert (row["role"], row["expertise"]) == (baseline["role"], baseline["expertise"])
        if row is not baseline:
            assert 100 < len(row["authoring_addendum"]) < 600
    assert len({row["authoring_addendum"] for row in resolved.values()}) == 4


def test_control_stays_frozen_while_codex_revises_one_candidate_addendum():
    packages, _ = focused()
    baseline = evals.resolve_packages(packages)
    changed = [dict(item) for item in packages]
    changed[0]["authoring_addendum"] = "A competing phrase that should never reach control."
    changed[1]["authoring_addendum"] += " Additional visual-state emphasis."
    resolved = evals.resolve_packages(changed, {"packages": baseline})
    assert resolved["d-control"] == baseline["d-control"]
    assert resolved["state-anchor"]["authoring_addendum"] != baseline["state-anchor"]["authoring_addendum"]
    assert resolved["state-anchor"]["role"] == baseline["state-anchor"]["role"]


def test_scenarios_are_disjoint_and_observable_without_scoring_creativity():
    packages, cases = focused()
    assert len(cases) == 12
    assert sum(c["split"] == "development" for c in cases) == 9
    assert sum(c["split"] == "holdout" for c in cases) == 3
    assert {c["category"] for c in cases} == {"visual-state", "shot-timing", "dialogue-notation"}
    for category in ("visual-state", "shot-timing", "dialogue-notation"):
        relevant = [c for c in cases if c["category"] == category]
        assert len(relevant) == 4
        assert len([c for c in relevant if c["split"] == "holdout"]) == 1
    assert all(c["operation"] == "studio_scenes_draft" for c in cases)
    assert all(c["fidelity_checks"] and c["focus"] for c in cases)


def test_only_the_single_focused_authoring_block_differs_between_requests():
    packages, cases = focused()
    entries = evals.resolve_packages(packages)
    scenario = next(c for c in cases if c["id"] == "timing-watch")
    technical = evals.repo_default("h3.authoring")
    baseline = evals.make_messages(scenario, entries["d-control"], technical)
    prefix = baseline[0]["content"]
    assert prefix.count("H3 PROMPT AUTHORING REFERENCE") == 1
    assert "SCENE AUTHORING FOCUS:" not in prefix
    for package in packages[1:]:
        actual = evals.make_messages(scenario, entries[package["id"]], technical)
        assert actual[1:] == baseline[1:]
        assert actual[0]["content"] == (
            prefix + "\n\nSCENE AUTHORING FOCUS:\n" + entries[package["id"]]["authoring_addendum"]
        )
        assert actual[0]["content"].count("H3 PROMPT AUTHORING REFERENCE") == 1


def test_focused_addenda_never_leak_into_chat_or_project_authoring():
    packages, cases = focused()
    p = evals.resolve_packages(packages)["spoken-lines"]
    for operation in ("studio_chat", "studio_project_draft"):
        fixture = {"operation": operation, "history": [{"role": "user", "content": "Hello."}],
                   "instruction": "Create an overview"}
        msg = evals.make_messages(fixture, p, "technical reference")
        assert "SCENE AUTHORING FOCUS" not in msg[0]["content"]
        assert "H3 PROMPT AUTHORING REFERENCE" not in msg[0]["content"]


def test_focused_plan_freezes_both_technical_reference_and_unmodified_control(tmp_path):
    out = tmp_path / "focused"
    assert evals.main(["plan", "--design-dir", str(FOCUSED), "--output", str(out),
                       "--model", "remote-1::mo-shakib/gemma4-e4b-uncensored:q4_k_m",
                       "--split", "development", "--repeats", "2", "--seed", "42"]) == 0
    run = evals.read_json(out / "manifest.json")
    assert len(run["trials"]) == 9 * 4 * 2
    assert len(evals.read_jsonl(out / "trials.jsonl")) == 72
    assert run["packages"]["d-control"]["authoring_addendum"] == ""
    assert run["technical_reference"] == evals.repo_default("h3.authoring")
    assert {row["status"] for row in evals.read_jsonl(out / "trials.jsonl")} == {"planned"}
    with pytest.raises(ValueError, match="no model evidence"):
        evals.main(["review", "--run-dir", str(out)])


def test_blinded_review_has_scoped_checks_and_reports_literals_separately(tmp_path):
    out = tmp_path / "smoke"
    evals.main(["plan", "--design-dir", str(FOCUSED), "--output", str(out),
                "--model", "fake", "--case", "dialogue-ferry", "--repeats", "1"])
    rows = evals.read_jsonl(out / "trials.jsonl")
    for row in rows:
        row["status"] = "completed"
        row["result"] = {"text": json.dumps({"scenes": [{"prompt": "Trial example"}]})}
    evals.save_jsonl(out / "trials.jsonl", rows)
    evals.main(["review", "--run-dir", str(out)])
    cards = evals.read_jsonl(out / "review_cards.jsonl")
    assert len(cards) == 4
    assert len({c["blind_id"] for c in cards}) == 4
    for card in cards:
        assert "package_id" not in card
        assert len(card["fidelity_results"]) == len(card["fidelity_checks"])
        assert all(value is None for value in card["fidelity_results"])
        card["fidelity_results"] = [True] * len(card["fidelity_checks"])
        card["usable_first_pass"] = True
    evals.save_jsonl(out / "review_cards.jsonl", cards)
    evals.main(["report", "--run-dir", str(out)])
    report = evals.read_json(out / "report.json")
    assert len(report["categories"]) == 4
    assert all(r["category"] == "dialogue-notation" for r in report["categories"])
    assert all(r["literal_checks_pass_rate"] == 1.0 for r in report["categories"])
    assert all(r["avg_creativity"] is None for r in report["categories"])
