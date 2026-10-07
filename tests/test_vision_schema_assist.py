from tool.server import vision_schema_assist, vision_schema_contract


def test_mining_counts_unique_media_support_and_filters_singletons_in_real_sets():
    analysis = vision_schema_assist.mine_sight_records([
        {"file": "a.jpg", "description": "red triangle top with metal ring connectors"},
        {"file": "b.jpg", "description": "red triangle bikini top, metal ring connectors"},
        {"file": "c.jpg", "description": "blue bandeau top"},
        {"file": "d.jpg", "description": "red triangle top"},
    ])

    by_label = {row["label"]: row for row in analysis["patterns"]}
    assert by_label["red triangle"]["count"] == 3
    assert by_label["metal ring connectors"]["count"] == 2
    assert "blue bandeau" not in by_label


def test_schema_contract_derives_support_from_cited_patterns():
    analysis = {
        "itemCount": 4,
        "patterns": [
            {"id": "p001", "label": "metal ring", "media": ["a.jpg", "b.jpg"], "count": 2, "examples": ["a.jpg", "b.jpg"]},
            {"id": "p002", "label": "ring connectors", "media": ["b.jpg", "c.jpg"], "count": 2, "examples": ["b.jpg", "c.jpg"]},
        ],
    }
    contract = vision_schema_contract.build_request(
        analysis,
        [{"group": "BT Connector", "terms": ["chain"]}],
    )
    result = vision_schema_contract.normalize_result(
        {
            "groups": [{
                "name": "Connector",
                "targetGroup": "BT Connector",
                "rationale": "Recurring connector construction.",
                "terms": [{"term": "ring", "patternIds": ["p001", "p002", "invented"]}],
            }]
        },
        pattern_evidence=contract["pattern_evidence"],
        existing_groups=contract["existing_groups"],
    )

    group = result["groups"][0]
    term = group["terms"][0]
    assert contract["operation"] == "vision_schema_suggest"
    assert contract["output"] == "json"
    assert group["action"] == "extend"
    assert group["targetGroup"] == "BT Connector"
    assert term["patternIds"] == ["p001", "p002"]
    assert term["support"] == 3
    assert term["examples"] == ["a.jpg", "b.jpg", "c.jpg"]


def test_schema_contract_marks_existing_terms_and_keeps_evidence_grounded():
    analysis = {
        "itemCount": 2,
        "patterns": [{"id": "p001", "label": "triangle", "media": ["a.jpg", "b.jpg"], "count": 2, "examples": ["a.jpg", "b.jpg"]}],
    }
    result = vision_schema_contract.normalize_result(
        {
            "groups": [{
                "name": "BT Shape",
                "targetGroup": "",
                "rationale": "Existing dimension.",
                "terms": [{"term": "TRIANGLE", "patternIds": ["p001"]}],
            }]
        },
        pattern_evidence=analysis["patterns"],
        existing_groups=[{"group": "BT Shape", "terms": ["triangle"]}],
    )

    assert result["groups"][0]["targetGroup"] == "BT Shape"
    assert result["groups"][0]["terms"][0]["alreadyExists"] is True
