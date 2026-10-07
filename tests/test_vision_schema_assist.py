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


def test_vision_status_keeps_progress_payload_light_but_mining_reads_descriptions(tmp_path, monkeypatch):
    from tool.server import config as app_config

    set_root = tmp_path / "set"
    set_root.mkdir()
    (set_root / "a.jpg").write_bytes(b"a")
    monkeypatch.setattr(app_config, "FS_ROOT", tmp_path)

    vision_schema_assist.save_vision_sight("set", "a.jpg", "vl", "red triangle top")

    status = vision_schema_assist.vision_sight_status("set", "vl")
    assert status["items"][0] == {"file": "a.jpg", "cached": True}

    analysis = vision_schema_assist.mine_vision_sight("set", "vl")
    assert analysis["itemCount"] == 1
    assert analysis["patterns"]


def test_save_vision_sight_preserves_existing_media_analysis_blocks(tmp_path, monkeypatch):
    import json
    from tool.server import config as app_config

    set_root = tmp_path / "set"
    set_root.mkdir()
    media_path = set_root / "a.jpg"
    media_path.write_bytes(b"a")
    stat = media_path.stat()
    (set_root / "media_metadata.json").write_text(json.dumps({
        "a.jpg": {
            "mtime": int(stat.st_mtime),
            "size": stat.st_size,
            "color_suggestions": {"version": 9, "colors": ["red"]},
        }
    }), encoding="utf-8")
    monkeypatch.setattr(app_config, "FS_ROOT", tmp_path)

    vision_schema_assist.save_vision_sight("set", "a.jpg", "vl", "red triangle top")

    payload = json.loads((set_root / "media_metadata.json").read_text(encoding="utf-8"))
    assert payload["a.jpg"]["color_suggestions"] == {"version": 9, "colors": ["red"]}
    assert payload["a.jpg"]["vision_sight"]["description"] == "red triangle top"
