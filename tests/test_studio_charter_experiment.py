"""Offline contract tests for three-arm Studio creative charter comparison."""
import json
from pathlib import Path

import pytest

from scripts import studio_guidance_eval as evaluator
from scripts import studio_charter_preference as preferences

DESIGN = evaluator.DESIGN_DIR / "creative_charter"


def test_packages_have_frozen_d_and_original_functional_contract():
    packages, cases = evaluator.load_design(DESIGN)
    assert [p["id"] for p in packages] == ["d-frozen", "d-plus-core", "consolidated-core"]
    resolved = evaluator.resolve_packages(packages)
    d = resolved["d-frozen"]
    plus = resolved["d-plus-core"]
    consolidated = resolved["consolidated-core"]
    assert d["role"] == evaluator.repo_default("studio.classic")
    assert d["expertise"] == evaluator.repo_default("h3.toolkit")
    assert d["creative_addendum"] == d["authoring_addendum"] == ""
    assert plus["role"] == d["role"] and plus["expertise"] == d["expertise"]
    assert plus["authoring_addendum"] == ""
    assert consolidated["expertise"] == d["expertise"]
    assert consolidated["authoring_addendum"] == consolidated["creative_addendum"] == ""
    core = plus["creative_addendum"]
    assert core in consolidated["role"]
    material = d["role"].split("WEBCAP MATERIAL:", 1)[1].split("PROFILE | CLASSIC", 1)[0]
    assert "WEBCAP MATERIAL:" + material in consolidated["role"]
    assert "explicit Write actions" in consolidated["role"]
    assert "independently" in consolidated["role"]
    assert consolidated["role"] != d["role"]
    assert len(cases) == 16


def test_fresh_briefs_and_all_operations_are_present():
    _, cases = evaluator.load_design(DESIGN)
    assert sum(c["split"] == "development" for c in cases) == 12
    assert sum(c["split"] == "holdout" for c in cases) == 4
    assert {c["operation"] for c in cases} == {
        "studio_chat", "studio_project_draft", "studio_scenes_draft"
    }
    assert all(c["fidelity_checks"] and c["history"] and c["focus"] for c in cases)
    old = {c["id"] for c in evaluator.load_design(evaluator.DESIGN_DIR / "visual_completeness")[1]}
    assert not old.intersection({c["id"] for c in cases})


def test_system_variants_are_local_and_technical_reference_identical():
    packages, cases = evaluator.load_design(DESIGN)
    resolved = evaluator.resolve_packages(packages)
    technical = evaluator.repo_default("h3.authoring")
    for case in cases:
        msgs = {key: evaluator.make_messages(case, pkg, technical) for key, pkg in resolved.items()}
        assert msgs["d-frozen"][1:] == msgs["d-plus-core"][1:] == msgs["consolidated-core"][1:]
        assert ("H3 PROMPT AUTHORING REFERENCE" in msgs["d-frozen"][0]["content"]) == (
            case["operation"] == "studio_scenes_draft"
        )
        if case["operation"] == "studio_scenes_draft":
            for variant in msgs.values():
                assert variant[0]["content"].endswith(
                    "H3 PROMPT AUTHORING REFERENCE:\n" + technical
                )
        assert msgs["d-plus-core"][0]["content"].startswith(
            msgs["d-frozen"][0]["content"].split("\n\nH3 PROMPT AUTHORING REFERENCE:", 1)[0]
            if case["operation"] != "studio_scenes_draft" else
            resolved["d-frozen"]["role"].strip()
        )


def test_plan_is_offline_deterministic_and_frozen_control(tmp_path, monkeypatch):
    monkeypatch.setattr(evaluator, "job_api", lambda *a, **kw: (_ for _ in ()).throw(
        AssertionError("offline trial attempted model call")
    ))
    x, y = tmp_path / "x", tmp_path / "y"
    args = ["--design-dir", str(DESIGN), "--model", "test::offline",
            "--split", "development", "--repeats", "2", "--seed", "8"]
    assert evaluator.main(["plan", "--output", str(x), *args]) == 0
    assert evaluator.main(["plan", "--output", str(y), *args]) == 0
    mx, my = evaluator.read_json(x / "manifest.json"), evaluator.read_json(y / "manifest.json")
    assert len(mx["trials"]) == 12 * 3 * 2
    assert mx["trials"] == my["trials"]
    previous = evaluator.resolve_packages(evaluator.load_design(DESIGN)[0])
    tweaked = [dict(p) for p in evaluator.load_design(DESIGN)[0]]
    tweaked[0]["creative_addendum"] = "Attempted alteration"
    assert evaluator.resolve_packages(tweaked, {"packages": previous})["d-frozen"] == previous["d-frozen"]


def test_preference_review_is_blinded_requires_real_receipts_and_keeps_gaps(tmp_path):
    folder = tmp_path / "run"
    evaluator.main(["plan", "--design-dir", str(DESIGN), "--model", "test::offline",
                    "--case", "chat-theatrical-restraint", "--repeats", "2",
                    "--output", str(folder)])
    with pytest.raises(ValueError, match="actual-model"):
        preferences.build(folder)
    records = evaluator.read_jsonl(folder / "trials.jsonl")
    for row in records:
        row["status"] = "completed"
        row["result"] = {"text": "Controlled synthetic response " + row["package_id"]}
    evaluator.save_jsonl(folder / "trials.jsonl", records)
    preferences.build(folder)
    cards = evaluator.read_jsonl(folder / "preference_cards.jsonl")
    assert len(cards) == 3 * 2
    assert all("d-frozen" not in json.dumps(card) for card in cards)
    assert all(card["preference"] is None for card in cards)
    with pytest.raises(ValueError, match="exists"):
        preferences.build(folder)
    preferences.report(folder)
    report = evaluator.read_json(folder / "preference_report.json")
    assert report["winner"] is None
    assert all(row["rated"] == 0 and row["unrated"] == 2 for row in report["pairwise"])
    cards[0]["preference"] = "left"
    cards[1]["preference"] = "tie"
    evaluator.save_jsonl(folder / "preference_cards.jsonl", cards)
    preferences.report(folder)
    report = evaluator.read_json(folder / "preference_report.json")
    assert sum(row["rated"] for row in report["pairwise"]) == 2
    assert report["winner"] is None
