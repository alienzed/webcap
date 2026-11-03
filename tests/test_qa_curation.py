import pytest

from tool.server.qa_curation import build_curation_request, normalize_curation_result
from tool.server.llm_runner import _client_result


def concepts():
    return [
        {"id": "c001", "group": "BB Shape", "term": "v-front", "count": 80},
        {"id": "c002", "group": "BB Shape", "term": "micro", "count": 15},
        {"id": "c003", "group": "Viewpoint", "term": "rear", "count": 8},
        {"id": "c004", "group": "Construction", "term": "connector", "count": 4},
    ]


def test_curation_contract_uses_compact_inventory_and_not_per_image_captions():
    contract = build_curation_request(concepts(), "Bikini construction", item_count=150)
    assert contract["operation"] == "qa_curate_set"
    assert contract["max_tokens"] == 2048
    assert "Bikini construction" in contract["prompt"]
    assert "c003" in contract["prompt"]
    assert "rear" in contract["prompt"]
    assert "equal quotas" in contract["prompt"]
    assert contract["concept_ids"] == ["c001", "c002", "c003", "c004"]
    assert contract["response_schema"]["additionalProperties"] is False


def test_curation_normalization_keeps_rare_core_and_supporting_viewpoint():
    answer = {"summary": "Construction first", "coreIds": ["c002", "c004", "c001"],
              "supportingIds": ["c003"]}
    assert normalize_curation_result(answer, ["c001", "c002", "c003", "c004"]) == answer
    payload = _client_result("qa", {}, {
        "data": answer, "model": "director-1", "text": "",
    }, frozen_contract={"operation": "qa_curate_set",
                        "concept_ids": ["c001", "c002", "c003", "c004"]})
    assert payload["analysis"]["coreIds"] == ["c002", "c004", "c001"]


@pytest.mark.parametrize("response", [
    {"summary": "x", "coreIds": [], "supportingIds": ["c003"]},
    {"summary": "x", "coreIds": ["c001"], "supportingIds": ["c001"]},
    {"summary": "x", "coreIds": ["invented"], "supportingIds": []},
    {"summary": "x", "coreIds": "c001", "supportingIds": []},
])
def test_curation_rejects_empty_invalid_or_conflicting_director_priorities(response):
    with pytest.raises(ValueError):
        normalize_curation_result(response, ["c001", "c002", "c003"])


def test_curation_rejects_duplicate_or_unknown_aggregate_ids():
    entries = concepts()
    entries[1]["id"] = entries[0]["id"]
    with pytest.raises(ValueError):
        build_curation_request(entries, item_count=150)
    with pytest.raises(ValueError):
        build_curation_request(concepts(), item_count=0)


def test_qa_curate_route_queues_only_compact_inventory_for_selected_set(tmp_path, monkeypatch):
    from pathlib import Path
    from tool.server import app as app_module
    folder = tmp_path / "set"
    folder.mkdir()
    (folder / "one.jpg").write_bytes(b"one")
    (folder / "two.jpg").write_bytes(b"two")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", Path(tmp_path))
    recorded = {}
    def enqueue(client, model_id, contract, context=None, label=""):
        recorded.update(client=client, model=model_id, contract=contract,
                        context=context, label=label)
        return {"jobId": "qa-curation-1", "status": "queued"}
    monkeypatch.setattr(app_module, "enqueue_llm", enqueue)
    result = app_module.app.test_client().post("/fs/qa/curate", json={
        "folder": "set", "files": ["one.jpg", "two.jpg"],
        "model": "local::model", "trainingFocus": "Detailed construction",
        "concepts": [{"id": "c001", "group": "Shape", "term": "triangle",
                       "count": 2, "example": "triangle construction"}],
    })
    assert result.status_code == 202
    assert recorded["client"] == "qa"
    assert recorded["label"] == "QA · Curate Training Set"
    assert recorded["contract"]["operation"] == "qa_curate_set"
    assert "Detailed construction" in recorded["contract"]["prompt"]
    assert "one.jpg" not in recorded["contract"]["prompt"]
    assert recorded["context"] == {}


def test_qa_curate_route_rejects_unknown_and_duplicate_media(tmp_path, monkeypatch):
    from pathlib import Path
    from tool.server import app as app_module
    folder = tmp_path / "set"
    folder.mkdir()
    (folder / "one.jpg").write_bytes(b"one")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", Path(tmp_path))
    client = app_module.app.test_client()
    payload = {
        "folder": "set", "files": ["outside.jpg"], "model": "local::model",
        "concepts": [{"id": "c001", "group": "Shape", "term": "triangle", "count": 1}],
    }
    result = client.post("/fs/qa/curate", json=payload)
    assert result.status_code == 400
    assert "outside the current Set" in result.get_json()["error"]
    result = client.post("/fs/qa/curate", json=dict(payload, files=["one.jpg", "one.jpg"]))
    assert result.status_code == 400
    assert "duplicate" in result.get_json()["error"]


@pytest.mark.parametrize("version", [1, 2])
def test_curate_draft_route_roundtrips_compatible_versions(tmp_path, monkeypatch, version):
    from pathlib import Path
    from tool.server import app as app_module
    folder = tmp_path / "set"
    folder.mkdir()
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", Path(tmp_path))
    client = app_module.app.test_client()
    draft = {"version": version, "choices": ["photo.jpg"]}
    if version == 2:
        draft["snapshot"] = {"concepts": [], "rows": [], "evidence": {}}
    saved = client.post("/fs/qa/curate/draft", json={"folder": "set", "draft": draft})
    assert saved.status_code == 200
    restored = client.get("/fs/qa/curate/draft?folder=set")
    assert restored.status_code == 200
    assert restored.get_json()["draft"] == draft
    assert (folder / ".webcap_curate.json").exists()


def test_caption_curate_contract_is_bounded_and_grounded():
    from tool.server.qa_curation import build_caption_curation_request, normalize_caption_curation_result

    captions = [
        {"fileName": "a.png", "caption": "A garment with crossed straps, hands are up."},
        {"fileName": "b.png", "caption": "Hands raised above the head, straight straps."},
    ]
    contract = build_caption_curation_request(
        captions, "Unusual strap construction", ["raised hands"]
    )
    assert contract["operation"] == "qa_curate_caption"
    assert contract["max_tokens"] == 3072
    assert "crossed straps" in contract["prompt"]
    assert "raised hands" in contract["prompt"]
    assert contract["response_schema"]["additionalProperties"] is False
    answer = {"observations": [
        {"fileName": "a.png", "concept": "crossed straps", "quote": "crossed straps"},
        {"fileName": "a.png", "concept": "crossed straps", "quote": "crossed straps"},
        {"fileName": "b.png", "concept": "raised hands", "quote": "Hands raised"},
    ]}
    assert normalize_caption_curation_result(answer, contract["caption_sources"]) == [
        answer["observations"][0], answer["observations"][2]
    ]
    with pytest.raises(ValueError, match="not supported"):
        normalize_caption_curation_result({"observations": [
            {"fileName": "a.png", "concept": "phantom buckle", "quote": "metal buckle"}
        ]}, contract["caption_sources"])
    with pytest.raises(ValueError, match="context budget"):
        build_caption_curation_request([{"fileName": "a.png", "caption": "a" * 7900},
                                        {"fileName": "b.png", "caption": "b" * 7900}])
    with pytest.raises(ValueError, match="1-24"):
        build_caption_curation_request([])


def test_qa_curate_caption_route_reuses_same_director_queue(tmp_path, monkeypatch):
    from pathlib import Path
    from tool.server import app as app_module
    folder = tmp_path / "set"
    folder.mkdir()
    (folder / "one.jpg").write_bytes(b"one")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", Path(tmp_path))
    recorded = {}
    def enqueue(client, model_id, contract, context=None, label=""):
        recorded.update(client=client, model=model_id, contract=contract,
                        context=context, label=label)
        return {"jobId": "curate-caption-1", "status": "queued"}
    monkeypatch.setattr(app_module, "enqueue_llm", enqueue)
    payload = {
        "folder": "set", "files": ["one.jpg"], "operation": "captions",
        "model": "local::model", "trainingFocus": "Novel geometry",
        "captions": [{"fileName": "one.jpg", "caption": "Unusual crossed straps"}],
    }
    client = app_module.app.test_client()
    response = client.post("/fs/qa/curate", json=payload)
    assert response.status_code == 202
    assert recorded["contract"]["operation"] == "qa_curate_caption"
    assert recorded["label"] == "QA · Curate Caption Evidence"
    assert recorded["context"] == {}
    payload["captions"][0]["fileName"] = "outside.jpg"
    rejected = client.post("/fs/qa/curate", json=payload)
    assert rejected.status_code == 400
    assert "belong to the selected Set" in rejected.get_json()["error"]
