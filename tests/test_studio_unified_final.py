"""Offline boundaries for the final, fixed unified-guidance comparison."""
from types import SimpleNamespace

from scripts import studio_guidance_eval as e

DESIGN = e.DESIGN_DIR / "unified_final"


def test_final_roles_replace_overlap_and_share_functional_knowledge():
    spec, cases = e.load_design(DESIGN)
    packages = e.resolve_packages(spec)
    classic, current, unified = [packages[k] for k in ("classic-v3", "cleaned-current", "unified")]
    assert classic["role"] == e.repo_default("studio.classic")
    assert classic["expertise"] == current["expertise"] == unified["expertise"] == e.repo_default("h3.toolkit")
    assert classic["sha256"] == "f4781c8c8c6c91a84e113696c64f2b725275ec7e99a1c567a757b9dc079c19e8"
    previous = e.resolve_packages(e.load_design(e.DESIGN_DIR / "profile_cleanup")[0])["current"]
    assert current["role"] == previous["role"]
    proposal = e.read_json(DESIGN / "packages.json")["proposed_unified_direction"]
    common = "WEBCAP MATERIAL:" + current["role"].split("WEBCAP MATERIAL:", 1)[1].split("PROFILE | CURRENT", 1)[0]
    assert unified["role"] == "STUDIO DIRECTOR | CREATIVE PARTNER\n" + proposal + "\n" + common
    assert len(cases) == 4
    assert {c["operation"] for c in cases} == {"studio_chat", "studio_project_draft", "studio_scenes_draft"}


def test_exact_24_trial_plan_and_identical_author_messages_across_treatments():
    plan = e.prepare_experiment(SimpleNamespace(
        design_dir=DESIGN, package=None, case=None, split="all", baseline_from=None,
        repeats=2, seed=323, command="plan", model="test::offline", base_url=None,
    ))
    assert len(plan["trials"]) == 24
    for case in plan["cases"]:
        trials = [t for t in plan["trials"] if t["case_id"] == case["id"]]
        assert len(trials) == 6
        assert all({t["repeat"] for t in trials if t["package_id"] == key} == {1, 2} for key in plan["packages"])
        msgs = [e.make_messages(case, p, plan["technical_reference"]) for p in plan["packages"].values()]
        assert msgs[0][1:] == msgs[1][1:] == msgs[2][1:]
        if case["operation"] == "studio_scenes_draft":
            assert all(m[0]["content"].endswith("H3 PROMPT AUTHORING REFERENCE:\n" + plan["technical_reference"]) for m in msgs)
