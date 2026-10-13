from pathlib import Path

import pytest

from tool.server import app as app_module
from tool.server.qa_llm_contract import build_set_review_request, normalize_set_review_result


def _items():
    return [
        {"fileName": "a.jpg", "groupedTags": [{"group": "Shape", "term": "triangle"}],
         "otherTags": ["red"], "caption": "An irrelevant long caption."},
        {"fileName": "b.jpg", "groupedTags": [{"group": "Shape", "term": "teardrop"}],
         "otherTags": ["blue"], "caption": "Another long caption."},
    ]


def test_set_review_is_compact_and_bounded():
    contract = build_set_review_request(
        _items(), [{"group": "Shape", "alias": "Top shape", "terms": ["triangle", "teardrop"]}],
        "Teach garment shapes", "Subject followed by clothing.")
    assert contract["operation"] == "qa_set_review"
    assert contract["source_files"] == ["a.jpg", "b.jpg"]
    assert contract["response_schema"]["properties"]["findings"]["maxItems"] == 5
    assert contract["max_tokens"] == 2048
    assert "An irrelevant long caption" not in contract["prompt"]
    assert "Teach garment shapes" in contract["prompt"]
    assert "triangle" in contract["prompt"]
    assert "Subject followed by clothing" in contract["prompt"]


def test_set_review_keeps_unrepresented_concept_without_inventing_actions():
    result = normalize_set_review_result({
        "summary": "Investigate missing construction dimensions.",
        "findings": [{
            "concept": "Check for variations in garment construction.",
            "title": "Construction may be under-described",
            "summary": "No corresponding vocabulary dimension.",
            "why": "Important for training garment differences.",
            "priority": "high", "confidence": "medium", "trainingValue": "high",
            "files": [], "evidence": ["Tags cover color and shape but not construction."]
        }]
    }, ["a.jpg", "b.jpg"])
    finding = result["findings"][0]
    assert finding["concept"].startswith("Check for")
    assert finding["files"] == []
    assert finding["tagActions"] == []
    assert finding["patches"] == []


def test_set_review_rejects_invented_filenames():
    item = {
        "concept": "Inspect construction", "title": "Construction", "summary": "Missing",
        "why": "Relevant", "priority": "high", "confidence": "medium",
        "trainingValue": "high", "files": ["invented.jpg"], "evidence": [],
    }
    with pytest.raises(ValueError, match="invented a filename"):
        normalize_set_review_result({"summary": "Review", "findings": [item]}, ["a.jpg"])


def test_set_review_preflight_does_not_queue_model(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    folder.mkdir()
    (folder / "a.jpg").write_bytes(b"sample")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", Path(tmp_path))
    monkeypatch.setattr(app_module.app_config, "load_config_from_disk", lambda: {
        "storyboard": {"director": {"context_size": 4096}}
    })
    def unexpected_enqueue(*args, **kwargs):
        raise AssertionError("Preflight queued inference.")
    monkeypatch.setattr(app_module, "enqueue_llm", unexpected_enqueue)
    response = app_module.app.test_client().post("/fs/qa/deep-scan", json={
        "folder": "set", "setReview": True, "preflight": True,
        "model": "local::test", "items": [{"fileName": "a.jpg", "groupedTags": []}]
    })
    assert response.status_code == 200
    assert response.get_json()["contextTokens"] == 4096
    assert response.get_json()["estimatedTokens"] > 2048


def test_set_review_queues_one_job_without_captions(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    folder.mkdir()
    (folder / "a.jpg").write_bytes(b"sample")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", Path(tmp_path))
    received = {}
    def fake_enqueue(client, model, contract, context=None, label=""):
        received.update(client=client, contract=contract, context=context)
        return {"jobId": "one", "status": "queued"}
    monkeypatch.setattr(app_module, "enqueue_llm", fake_enqueue)
    response = app_module.app.test_client().post("/fs/qa/deep-scan", json={
        "folder": "set", "setReview": True, "model": "local::test",
        "items": [{"fileName": "a.jpg", "groupedTags": [{"group": "Shape", "term": "triangle"}]}],
    })
    assert response.status_code == 202
    assert received["contract"]["operation"] == "qa_set_review"
    assert received["context"] == {}


def test_set_review_ui_keeps_concept_check_and_human_edits_separate():
    source = (Path(__file__).resolve().parents[1] / "tool/js/qa_workbench.js").read_text()
    deep_scan = source.split("function qaRunNextDeepScanBatch()", 1)[1].split("function qaConceptCoverageCounts()", 1)[0]
    assert "requestCaptionAssistCandidate" not in deep_scan
    assert "refreshSetIntelligenceItem" not in deep_scan
    assert "setReview: true" in deep_scan
    assert "preflight: true" in deep_scan
    assert "window.confirm(" in deep_scan
    assert "qaStartFocusReview()" in source
    assert "qaRunConceptCheck()" in source
    assert "if (finding.concept) return finding;" in source
