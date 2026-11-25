"""Isolated visual-completeness guidance experiment and live-harness contract tests."""
import json
from pathlib import Path

import pytest

from scripts import studio_guidance_eval as evaluation
from tool.server.llm_guidance import SPECIALIST_DEFAULTS

DESIGN = evaluation.DESIGN_DIR / "visual_completeness"
OLD = evaluation.DESIGN_DIR / "focused_h3"


def design():
    return evaluation.load_design(DESIGN)


def test_six_packages_share_the_same_core_and_use_concise_behavioral_language():
    packages, _ = design()
    assert [p["id"] for p in packages] == [
        "d-control", "thorough", "fully-defined", "studio-baseline",
        "clear-choices", "combined"
    ]
    assert packages[0]["freeze_addendum"] is True
    resolved = evaluation.resolve_packages(packages)
    baseline = resolved["d-control"]
    assert baseline["role"] == evaluation.read_json(evaluation.DESIGN_DIR / "frozen-d-20261122.json")["role"]
    assert baseline["expertise"] == evaluation.read_json(evaluation.DESIGN_DIR / "frozen-d-20261122.json")["expertise"]
    assert baseline["creative_addendum"] == baseline["authoring_addendum"] == ""
    for variant in resolved.values():
        assert variant["role"] == baseline["role"]
        assert variant["expertise"] == baseline["expertise"]
        assert variant["authoring_addendum"] == ""
        assert len(variant["creative_addendum"].split()) < 50
    assert len({p["creative_addendum"] for p in resolved.values()}) == len(packages)
    assert resolved["thorough"]["creative_addendum"] in SPECIALIST_DEFAULTS["task.visual_direction"]
    assert all("prevent" not in p["creative_addendum"].lower() for p in resolved.values())


def test_scenarios_cover_all_scopes_and_reuse_previous_regression_evidence_exactly():
    _, cases = design()
    assert len(cases) == 17
    assert sum(c["split"] == "development" for c in cases) == 13
    assert sum(c["split"] == "holdout" for c in cases) == 4
    assert set(c["operation"] for c in cases) == {
        "studio_chat", "studio_project_draft", "studio_scenes_draft"
    }
    assert {c["category"] for c in cases} >= {
        "visual-completeness", "multiple-actors", "scene-continuity", "studio-boundaries"
    }
    assert all(c["fidelity_checks"] and c["focus"] and c["history"] for c in cases)
    assert all(c["instruction"] and c["project"] for c in cases if c["operation"] == "studio_scenes_draft")
    old = {c["id"]: c for c in evaluation.load_design(OLD)[1]}
    for original in ("state-pool", "timing-watch", "dialogue-ferry"):
        new = next(c for c in cases if c["id"] == "regression-" + original)
        assert new["split"] == "development"
        assert new["history"] == old[original]["history"]
        assert new["project"] == old[original]["project"]
        assert new["instruction"] == old[original]["instruction"]
        assert new["fidelity_checks"] == old[original]["fidelity_checks"]


def test_only_creative_guidance_changes_across_all_three_director_operations():
    packages, cases = design()
    resolved = evaluation.resolve_packages(packages)
    technical = evaluation.repo_default("h3.authoring")
    for case in cases:
        baseline = evaluation.make_messages(case, resolved["d-control"], technical)
        system = baseline[0]["content"]
        assert "CREATIVE DIRECTION:" not in system
        for key in ("thorough", "fully-defined", "studio-baseline", "clear-choices", "combined"):
            variant = evaluation.make_messages(case, resolved[key], technical)
            assert variant[1:] == baseline[1:]
            assert variant[0]["content"] == system.replace(
                "\n\nH3 PROMPT AUTHORING REFERENCE:", 
                "\n\nCREATIVE DIRECTION:\n" + resolved[key]["creative_addendum"] +
                "\n\nH3 PROMPT AUTHORING REFERENCE:"
            ) if case["operation"] == "studio_scenes_draft" else (
                variant[0]["content"] == system + "\n\nCREATIVE DIRECTION:\n" +
                resolved[key]["creative_addendum"]
            )
            assert ("H3 PROMPT AUTHORING REFERENCE" in system) == (
                case["operation"] == "studio_scenes_draft"
            )


def test_d_control_freezes_across_iterations_not_candidates():
    packages, _ = design()
    previous = evaluation.resolve_packages(packages)
    changed = [dict(p) for p in packages]
    changed[0]["creative_addendum"] = "This attempted change must not reach the control."
    changed[1]["creative_addendum"] = "A revised concise instruction."
    fresh = evaluation.resolve_packages(changed, {"packages": previous})
    assert fresh["d-control"] == previous["d-control"]
    assert fresh["thorough"]["creative_addendum"] != previous["thorough"]["creative_addendum"]
    assert fresh["thorough"]["role"] == previous["thorough"]["role"]


def test_offline_plan_is_deterministic_and_contains_no_live_model_call(tmp_path, monkeypatch):
    def unexpected(*args, **kwargs):
        raise AssertionError("Offline plan tried to contact WebCap.")
    monkeypatch.setattr(evaluation, "job_api", unexpected)
    paths = [tmp_path / "a", tmp_path / "b"]
    for p in paths:
        assert evaluation.main([
            "plan", "--design-dir", str(DESIGN), "--output", str(p),
            "--model", "remote-1::mo-shakib/gemma4-e4b-uncensored:q4_k_m",
            "--split", "development", "--repeats", "2", "--seed", "42"
        ]) == 0
    manifest = evaluation.read_json(paths[0] / "manifest.json")
    other = evaluation.read_json(paths[1] / "manifest.json")
    assert len(manifest["trials"]) == 13 * 6 * 2
    assert manifest["trials"] == other["trials"]
    assert manifest["technical_reference"] == evaluation.repo_default("h3.authoring")
    assert all(row["status"] == "planned" for row in evaluation.read_jsonl(paths[0] / "trials.jsonl"))
    with pytest.raises(ValueError, match="no model evidence"):
        evaluation.main(["review", "--run-dir", str(paths[0])])


def test_blind_review_tracks_intent_fidelity_and_response_length_without_winner(tmp_path):
    path = tmp_path / "fake-live"
    evaluation.main(["plan", "--design-dir", str(DESIGN), "--output", str(path),
                     "--model", "offline-test", "--case", "clothing-complete", "--repeats", "1"])
    receipts = evaluation.read_jsonl(path / "trials.jsonl")
    for rec in receipts:
        rec["status"] = "completed"
        rec["result"] = {"text": json.dumps({"scenes": [{"prompt": "Fully specified fake output."}]})}
    evaluation.save_jsonl(path / "trials.jsonl", receipts)
    evaluation.main(["review", "--run-dir", str(path)])
    cards = evaluation.read_jsonl(path / "review_cards.jsonl")
    assert len(cards) == 6
    assert all("package_id" not in card for card in cards)
    assert all(len(card["fidelity_checks"]) == len(card["fidelity_results"]) for card in cards)
    assert all(set(card["fidelity_results"]) == {None} for card in cards)
    for card in cards:
        card["fidelity_results"] = [True] * len(card["fidelity_checks"])
        card["creative_value"] = 4
    evaluation.save_jsonl(path / "review_cards.jsonl", cards)
    evaluation.main(["report", "--run-dir", str(path)])
    report = evaluation.read_json(path / "report.json")
    assert len(report["categories"]) == 6
    assert all(row["category"] == "visual-completeness" for row in report["categories"])
    assert all(row["literal_checks_pass_rate"] == 1.0 for row in report["categories"])
    assert all(row["avg_creativity"] == 4 for row in report["categories"])
    assert all(row["avg_response_chars"] > 20 for row in report["categories"])
    assert all(row["avg_response_words"] > 3 for row in report["categories"])
    assert all(row["first_pass_usable_rate"] is None for row in report["categories"])
    assert not ("winner" in report)
