"""No-model coverage for the opt-in Studio guidance comparison harness."""
import json
from pathlib import Path

import pytest

from scripts import studio_guidance_eval as evaluation


@pytest.fixture
def design():
    return evaluation.load_design()


def test_versioned_design_contains_four_distinct_packages_and_twelve_grounded_cases(design):
    packages, cases = design
    assert [item["id"] for item in packages] == [
        "a-minimal", "b-medium", "c-principles", "d-baseline"
    ]
    assert len(cases) == 12
    assert sum(case["split"] == "development" for case in cases) == 8
    assert sum(case["split"] == "holdout" for case in cases) == 4
    assert {case["operation"] for case in cases} == {
        "studio_chat", "studio_project_draft", "studio_scenes_draft"
    }
    assert all(case["focus"] for case in cases)
    assert all(case["history"] for case in cases)
    assert all(case["id"] and case["category"] for case in cases)
    assert {p["id"]: len(p.get("role", "")) + len(p.get("expertise", "")) for p in packages}[
        "a-minimal"
    ] < 600


def test_explicit_packages_are_independent_and_baseline_uses_historical_defaults(design):
    packages, cases = design
    resolved = evaluation.resolve_packages(packages)
    assert resolved["a-minimal"]["role"] == resolved["c-principles"]["role"]
    assert resolved["a-minimal"]["expertise"] == ""
    assert resolved["b-medium"]["expertise"] in resolved["c-principles"]["expertise"]
    assert resolved["d-baseline"]["role"] == evaluation.read_json(
        evaluation.DESIGN_DIR / "frozen-d-20261122.json")["role"]
    assert resolved["d-baseline"]["expertise"] == evaluation.read_json(evaluation.DESIGN_DIR / "frozen-d-20261122.json")["expertise"]
    assert all(resolved[key]["sha256"] for key in resolved)


def test_historical_designs_remain_frozen_after_production_defaults_change(monkeypatch):
    folders = [evaluation.DESIGN_DIR, *(evaluation.DESIGN_DIR / name for name in
               ("focused_h3", "visual_completeness", "creative_charter"))]
    before = [evaluation.resolve_packages(evaluation.load_design(folder)[0]) for folder in folders]
    monkeypatch.setattr(evaluation, "repo_default", lambda module: "Changed production " + module)
    after = [evaluation.resolve_packages(evaluation.load_design(folder)[0]) for folder in folders]
    assert after == before
    for packages, control in zip(after, ("d-baseline", "d-control", "d-control", "d-frozen")):
        assert packages[control]["sha256"] == "7861b0cce4980a6343d0edea254825177c66cd7ef720cb342b71573a5e0a4681"


def test_fixed_request_scope_matches_chat_and_write_contracts(design):
    packages, cases = design
    resolved = evaluation.resolve_packages(packages)
    technical = evaluation.repo_default("h3.authoring")
    for case in cases:
        messages = evaluation.make_messages(case, resolved["b-medium"], technical)
        assert len(messages) == 1 + len(case["history"]) + (case["operation"] != "studio_chat")
        assert messages[0]["role"] == "system"
        assert messages[1:1 + len(case["history"])] == case["history"]
        assert ("H3 PROMPT AUTHORING REFERENCE:" in messages[0]["content"]) == (
            case["operation"] == "studio_scenes_draft"
        )
        assert ("integrated_multimodal_description:" in messages[0]["content"]) == (
            case["operation"] == "studio_scenes_draft"
        )
        if case["operation"] == "studio_scenes_draft":
            task = json.loads(messages[-1]["content"])
            assert task["task"] == evaluation.SCENE_TASK
            assert task["project"] == case["project"]
            assert task["authorDirection"] == case["instruction"]
        if case["operation"] == "studio_project_draft":
            task = json.loads(messages[-1]["content"])
            assert task == {"task": evaluation.PROJECT_TASK, "instruction": case["instruction"]}


def test_plan_is_deterministic_and_creates_no_model_jobs(tmp_path, monkeypatch):
    def deny(*args, **kwargs):
        raise AssertionError("Planning made an LLM call")
    monkeypatch.setattr(evaluation, "job_api", deny)
    first, second = tmp_path / "first", tmp_path / "second"
    args = ["--model", "local::comparison", "--split", "development", "--repeats", "2", "--seed", "6"]
    assert evaluation.main(["plan", "--output", str(first), *args]) == 0
    assert evaluation.main(["plan", "--output", str(second), *args]) == 0
    manifest = evaluation.read_json(first / "manifest.json")
    copy = evaluation.read_json(second / "manifest.json")
    assert len(manifest["trials"]) == 4 * 8 * 2
    assert manifest["trials"] == copy["trials"]
    assert manifest["model"] == "local::comparison"
    assert len(evaluation.read_jsonl(first / "trials.jsonl")) == 64
    assert all(row["status"] == "planned" for row in evaluation.read_jsonl(first / "trials.jsonl"))
    with pytest.raises(FileExistsError):
        evaluation.main(["plan", "--output", str(first), *args])


def test_baseline_can_be_frozen_while_experimental_packages_change(design, tmp_path):
    packages, cases = design
    snapshot = evaluation.resolve_packages(packages)
    old = {
        "scenarios_sha256": evaluation.digest(cases),
        "packages": snapshot,
        "technical_reference": "Frozen technical reference"
    }
    previous = [{"id": item["id"], **item} for item in packages]
    previous[0]["role"] = "New candidate language"
    resolved = evaluation.resolve_packages(previous, old)
    assert resolved["a-minimal"]["role"] == "New candidate language"
    assert resolved["d-baseline"] == snapshot["d-baseline"]
    assert evaluation.repo_default("h3.authoring") != old["technical_reference"]


def test_runner_uses_existing_webcap_endpoint_without_mutating_projects(monkeypatch, design):
    packages, cases = design
    case = next(c for c in cases if c["operation"] == "studio_scenes_draft")
    messages = evaluation.make_messages(case, evaluation.resolve_packages(packages)["a-minimal"],
                                         evaluation.repo_default("h3.authoring"))
    seen = []

    def fake_api(url, path, payload=None):
        seen.append((path, payload))
        if payload is not None:
            return {"ok": True, "job": {"jobId": "j1", "request": {"responseSchema": {"scenes": True}}}}
        return {"ok": True, "job": {
            "jobId": "j1", "status": "completed",
            "result": {"text": '{"scenes":[{"title":"Scene","prompt":"Text","durationSeconds":8}]}'}
        }}

    monkeypatch.setattr(evaluation, "job_api", fake_api)
    receipt = evaluation.real_trial("http://127.0.0.1:5000", "local::test", case, messages, 5)
    assert receipt["status"] == "completed"
    assert seen[0][0] == "/fs/director/chat"
    assert seen[0][1] == {
        "operation": "studio_scenes_draft", "model": "local::test", "messages": messages
    }
    assert seen[1][0] == "/fs/director/job?job=j1&consume=1"
    assert len(seen) == 2


def test_blind_review_hides_package_and_report_requires_human_scores(tmp_path, monkeypatch):
    folder = tmp_path / "trial"
    assert evaluation.main([
        "plan", "--output", str(folder), "--model", "test-model",
        "--case", "chat-tableau", "--repeats", "1"
    ]) == 0
    with pytest.raises(ValueError, match="no model evidence"):
        evaluation.main(["review", "--run-dir", str(folder)])
    # Only actual-job receipts are eligible for blind review. Supply representative
    # terminal records here; this unit test does not call any model.
    simulated = evaluation.read_jsonl(folder / "trials.jsonl")
    for record in simulated:
        record["status"] = "completed"
        record["result"] = {"text": "A specific, coherent production suggestion."}
    evaluation.save_jsonl(folder / "trials.jsonl", simulated)
    evaluation.main(["review", "--run-dir", str(folder)])
    cards = evaluation.read_jsonl(folder / "review_cards.jsonl")
    assert len(cards) == 4
    assert len({card["blind_id"] for card in cards}) == 4
    assert all(card["usable_first_pass"] is None for card in cards)
    assert all("package_id" not in card and "role" not in card for card in cards)
    with pytest.raises(ValueError, match="already exist"):
        evaluation.main(["review", "--run-dir", str(folder)])
    for card in cards:
        card.update({"usable_first_pass": True, "intent_fidelity": 4,
                     "creative_value": 3, "h3_readiness": 5, "estimated_correction_rounds": 1})
    evaluation.save_jsonl(folder / "review_cards.jsonl", cards)
    evaluation.main(["report", "--run-dir", str(folder)])
    report = evaluation.read_json(folder / "report.json")
    assert len(report["categories"]) == 4
    assert all(row["reviewed"] == 1 and row["first_pass_usable_rate"] == 1 for row in report["categories"])
    assert all(row["avg_estimated_correction_rounds"] == 1 for row in report["categories"])
    assert all(row["responses_ok"] == 1 for row in report["categories"])  # fixture receipts only
