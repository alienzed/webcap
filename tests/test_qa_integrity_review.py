from pathlib import Path

from tool.server import app as app_module
from tool.server.qa_llm_contract import build_set_review_request


def test_qa_review_store_separates_scopes_and_migrates_legacy(tmp_path, monkeypatch):
    root = tmp_path / "set"
    root.mkdir()
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", tmp_path)
    path = root / ".webcap_qa_review.json"
    old = {"version": 1, "scopeKey": "set\\x01a.jpg",
           "aiFindings": [{"title": "Original finding"}], "itemSignatures": {}}
    import json
    path.write_text(json.dumps(old), encoding="utf-8")
    client = app_module.app.test_client()
    review_b = {"version": 1, "scopeKey": "set\\x01b.jpg",
                "aiFindings": [{"title": "Second finding"}]}
    response = client.post("/fs/qa/review", json={
        "folder": "set", "scopeKey": review_b["scopeKey"], "review": review_b})
    assert response.status_code == 200
    for scope, title in ((old["scopeKey"], "Original finding"), (review_b["scopeKey"], "Second finding")):
        data = client.get("/fs/qa/review", query_string={"folder": "set", "scopeKey": scope}).get_json()
        assert data["review"]["aiFindings"][0]["title"] == title
    assert json.loads(path.read_text(encoding="utf-8"))["version"] == 2


def test_qa_review_rejects_scope_mismatch(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    folder.mkdir()
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", tmp_path)
    response = app_module.app.test_client().post("/fs/qa/review", json={
        "folder": "set", "scopeKey": "different",
        "review": {"version": 1, "scopeKey": "actual"}
    })
    assert response.status_code == 400


def test_qa_ui_uses_same_store_for_concept_evidence():
    source = (Path(__file__).resolve().parents[1] / "tool/js/qa_workbench.js").read_text()
    assert "conceptFindings: qaWorkbenchState.conceptFindings" in source
    assert "scopeKey: scopeKey, review: review" in source
    assert "finding.conceptQuestion !== concept" not in source.split(
        "function qaBeginConceptCheck(", 1)[1].split("function qaWaitForConceptJob(", 1)[0].split(
        "var returnedFindings", 1)[0]
    assert "qaSaveReview();" in source.split("function qaBeginConceptCheck(", 1)[1].split(
        "function qaWaitForConceptJob(", 1)[0]


def test_qa_evidence_budget_preserves_some_singletons():
    rows = [
        {"category": "color", "label": f"popular-{i}", "count": 100, "examples": []}
        for i in range(160)
    ] + [{"category": "quality", "label": "top: dual ring connector", "count": 1,
          "examples": ["a.jpg"]}]
    payload = build_set_review_request([{"fileName": "a.jpg"}], sight_evidence={
        "itemCount": 1, "evidence": rows
    })
    assert "dual ring connector" in payload["prompt"]


def test_qa_open_is_passive_and_set_review_does_not_certify_all_items():
    source = (Path(__file__).resolve().parents[1] / "tool/js/qa_workbench.js").read_text()
    assert "qaPrimeDeterministicSources(currentItems);" not in source
    assert "counts.unchecked = items.length" in source
    assert "qaBuildVisualAgreementFindings(items).map" in source
