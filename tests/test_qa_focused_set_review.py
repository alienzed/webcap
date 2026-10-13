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
    assert contract["max_tokens"] == 4096
    assert "Keep the response compact" in contract["prompt"]
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
            "dismissIf": "Sight finds no meaningful construction variation.",
            "priority": "high", "confidence": "medium", "trainingValue": "high",
            "candidates": [], "evidence": ["Tags cover color and shape but not construction."]
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
        "why": "Relevant", "dismissIf": "No visual distinction", "priority": "high", "confidence": "medium",
        "trainingValue": "high", "candidates": [{"file": "invented.jpg", "reason": "Tag pattern"}], "evidence": [],
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


def test_set_review_preserves_reasons_and_falsifier():
    result = normalize_set_review_result({
        "summary": "One possible gap.", "findings": [{
            "concept": "Are fastening details missing from tags?",
            "title": "Fastenings", "summary": "Potential gap.",
            "why": "Fastenings may distinguish training concepts.",
            "dismissIf": "Sight and approved tags already capture significant fastenings.",
            "priority": "high", "confidence": "medium", "trainingValue": "high",
            "candidates": [{"file": "a.jpg", "reason": "Tagged by shape only."}],
            "evidence": ["Construction isn't represented in the listed vocabulary."]
        }]
    }, ["a.jpg"])
    finding = result["findings"][0]
    assert finding["files"] == ["a.jpg"]
    assert finding["candidates"][0]["reason"] == "Tagged by shape only."
    assert "Sight and approved tags" in finding["dismissIf"]
    assert finding["tagActions"] == []
    assert finding["patches"] == []


def test_scoped_investigation_reuses_concept_check_and_no_automatic_vision():
    source = (Path(__file__).resolve().parents[1] / "tool/js/qa_workbench.js").read_text()
    assert "selectedFiles: items.map(function (item)" in source
    assert "candidateFiles.indexOf(item.fileName) !== -1" in source
    assert "qaBuildConceptItems(items)" in source
    assert "question.textContent = 'Investigate: ' + finding.concept" in source
    assert "condition.textContent = 'Dismiss if: '" in source
    assert "reason.textContent = candidate.reason" in source
    assert "qaWorkbenchState.investigation.finished = true" in source


def test_set_review_consumes_compact_sight_including_single_item_properties():
    from tool.server.vision_schema_assist import mine_sight_records
    records = [{
        "file": "a.jpg", "description": "A garment with a distinctive connector.",
        "inventory": {
            "viewpoint": [], "position": [],
            "things": [{"name": "top", "qualities": ["metal ring connector"]}],
            "colors": [{"thing": "top", "color": "red"}],
            "setting": [], "background": [], "lighting": [], "surface": [],
            "details": ["dual ring hardware"],
        },
    }]
    evidence = mine_sight_records(records, limit=160, minimum_support=1)
    assert any("ring connector" in row["label"] for row in evidence["evidence"])
    contract = build_set_review_request(_items(), sight_evidence=evidence)
    assert "metal ring connector" in contract["prompt"]
    assert "savedVisualObservations" in contract["prompt"]


def test_investigation_verdict_requires_affirmative_evidence_and_keeps_legacy_concept_contract():
    from tool.server.qa_llm_contract import build_concept_request, normalize_result
    item = {"fileName": "a.jpg", "caption": "A top.", "groupedTags": [], "tags": [],
            "analysis": {"visionSight": {"description": "Garment with ring hardware",
                                        "inventory": {"details": ["ring hardware"]}}}}
    contract = build_concept_request([item], "Are ring fastenings omitted?",
                                     dismiss_if="No relevant ring fastenings are visually supported.")
    assert "investigationStatus" in contract["response_schema"]["required"]
    assert "FALSIFICATION CRITERION" in contract["prompt"]
    with pytest.raises(ValueError, match="status or evidence"):
        normalize_result({"summary": "No edits.", "findings": [], "captionQuality": []},
                         allowed_files=["a.jpg"], investigate=True)
    legacy = build_concept_request([item], "Check ring")
    assert "investigationStatus" not in legacy["response_schema"]["required"]


def test_deep_qa_does_not_cancel_other_sight_scan_and_keeps_prior_concept_actions():
    qa = (Path(__file__).resolve().parents[1] / "tool/js/qa_workbench.js").read_text()
    stop = qa.split("function qaCancelDeepScan()", 1)[1].split("function qaBuildGroupStats(", 1)[0]
    assert "cancelItemSightRefresh" not in stop
    concept = qa.split("function qaBeginConceptCheck(", 1)[1].split("function qaWaitForConceptJob(", 1)[0]
    assert "finding.conceptQuestion !== concept" in concept
    assert "session.signatures[row.fileName] !== signature ? 'unchecked'" in concept
    assert "conceptPreflightToken" in qa
    assert "check-finding-full" in qa
