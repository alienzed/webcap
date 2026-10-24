import pytest

from tool.server.qa_curation import build_curation_request, normalize_curation_result
from tool.server.llm_runner import _client_result


def concepts():
    return [
        {"id": "c001", "group": "BB Shape", "term": "v-front", "count": 80},
        {"id": "c002", "group": "BB Shape", "term": "micro", "count": 15},
        {"id": "c003", "group": "Viewpoint", "term": "rear", "count": 8},
        {"id": "c004", "group": "Sight · detail", "term": "connector", "count": 4},
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
