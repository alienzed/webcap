from pathlib import Path

from tool.server import app as app_module
from tool.server.qa_llm_contract import build_concept_request, normalize_result


def _item(name="a.jpg"):
    return {
        "fileName": name,
        "caption": "Black top with a ring connector.",
        "groupedTags": [{"group": "Hardware", "alias": "", "term": "ring connector"}],
        "tags": [],
        "analysis": {
            "visionSight": {
                "description": "Metal rings on the shoulder straps.",
                "inventory": {"details": ["metal ring connector"]},
            }
        },
    }


def test_concept_contract_contains_focused_evidence_not_caption_quality_task():
    contract = build_concept_request([_item()], "Check missing metal ring connectors")
    assert contract["operation"] == "qa_deep_scan"
    assert "metal ring connectors" in contract["prompt"]
    assert "Metal rings on the shoulder straps" in contract["prompt"]
    assert "Set captionQuality to []" in contract["prompt"]\n    assert "[KNOWN VOCABULARY]" in contract["prompt"]
    assert contract["source_files"] == ["a.jpg"]


def test_concept_contract_requires_question():
    try:
        build_concept_request([_item()], "  ")
    except ValueError as exc:
        assert "concept" in str(exc).lower()
    else:
        raise AssertionError("An empty check must not queue")


def test_concept_route_reuses_qa_lane_and_limits_batch(monkeypatch, tmp_path):
    folder = tmp_path / "set"
    folder.mkdir()
    (folder / "a.jpg").write_bytes(b"image")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", Path(tmp_path))
    seen = {}
    def enqueue(client, model, contract, context=None, label=""):
        seen.update(client=client, model=model, contract=contract, context=context, label=label)
        return {"jobId": "test-concept", "status": "queued"}
    monkeypatch.setattr(app_module, "enqueue_llm", enqueue)
    response = app_module.app.test_client().post("/fs/qa/concept-check", json={
        "folder": "set", "model": "director", "concept": "Check ring connectors",
        "items": [_item()],
    })
    assert response.status_code == 202
    assert seen["client"] == "qa"
    assert seen["label"] == "QA Concept Check"
    assert seen["context"]["captionsByFile"]["a.jpg"] == _item()["caption"]
    rejected = app_module.app.test_client().post("/fs/qa/concept-check", json={
        "folder": "set", "model": "director", "concept": "Check ring connectors",
        "items": [_item("missing.jpg")],
    })
    assert rejected.status_code == 400


def test_finding_normalization_rejects_invented_file_and_keeps_exact_action():
    result = normalize_result({
        "summary": "One actionable omission.",
        "captionQuality": [],
        "findings": [{
            "category": "consistency", "priority": "high", "confidence": "high",
            "trainingValue": "high", "title": "Ring connector tag omission",
            "summary": "A metal ring is visible.", "why": "Sight shows the ring.",
            "files": ["a.jpg"], "evidence": ["metal ring connector"],
            "patches": [], "tagActions": [{
                "file": "a.jpg", "action": "add", "group": "Hardware", "term": "ring connector"
            }],
        }],
    }, allowed_files=["a.jpg"], captions_by_file={"a.jpg": _item()["caption"]})
    assert result["captionQuality"] == []
    assert result["findings"][0]["tagActions"][0]["term"] == "ring connector"


def test_known_vocabulary_is_bounded_and_supplied_to_director():
    contract = build_concept_request([_item()], "Check ring connectors", [
        {"group": "Hardware", "alias": "Fasteners", "terms": ["ring connector", "metal ring"]},
    ])
    assert '"group": "Hardware"' in contract["prompt"]
    assert 'ring connector' in contract["prompt"]
    assert '"alias": "Fasteners"' in contract["prompt"]


def test_concept_frontend_uses_canonical_and_complete_cached_sight():
    script = (Path(__file__).resolve().parents[1] / "tool/js/qa_workbench.js").read_text(encoding="utf-8")
    assert "function qaBuildConceptItems(items)" in script
    assert "inventory: sight.inventory" in script
    assert "function qaConceptVocabulary(concept)" in script
    assert "qaStopConceptCheck(true);" in script
    assert "finding.inputSignatures[file] === conceptCurrent[file]" in script
    assert "function qaConceptInputSignatures(items)" in script
    assert "signatures: qaConceptInputSignatures(items)" in script
