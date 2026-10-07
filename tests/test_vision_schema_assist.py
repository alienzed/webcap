from tool.server import vision_schema_assist, vision_schema_contract


def _sight(description, **inventory):
    base = {
        "viewpoint": [],
        "position": [],
        "things": [],
        "colors": [],
        "setting": [],
        "background": [],
        "lighting": [],
        "surface": [],
        "details": [],
    }
    base.update(inventory)
    return {"description": description, "inventory": base}


def test_structured_mining_counts_unique_media_support_without_prose_ngrams():
    analysis = vision_schema_assist.mine_sight_records([
        {
            "file": "a.jpg",
            **_sight(
                "Front view of a person in a red triangle top with metal ring connectors.",
                viewpoint=["front"],
                things=[{"name": "bikini top", "qualities": ["triangle"]}],
                colors=[{"thing": "bikini top", "color": "red"}],
                details=["metal ring connectors"],
            ),
        },
        {
            "file": "b.jpg",
            **_sight(
                "Front view of a person in a red triangle bikini top with metal ring connectors.",
                viewpoint=["front"],
                things=[{"name": "bikini top", "qualities": ["triangle"]}],
                colors=[{"thing": "bikini top", "color": "red"}],
                details=["metal ring connectors"],
            ),
        },
        {
            "file": "c.jpg",
            **_sight(
                "Side view with a blue bandeau top.",
                viewpoint=["side"],
                things=[{"name": "bikini top", "qualities": ["bandeau"]}],
                colors=[{"thing": "bikini top", "color": "blue"}],
            ),
        },
        {
            "file": "d.jpg",
            **_sight(
                "Front view of a red triangle top.",
                viewpoint=["front"],
                things=[{"name": "bikini top", "qualities": ["triangle"]}],
                colors=[{"thing": "bikini top", "color": "red"}],
            ),
        },
    ])

    by_label = {row["label"]: row for row in analysis["evidence"]}
    assert by_label["front"]["count"] == 3
    assert by_label["bikini top: triangle"]["count"] == 3
    assert by_label["bikini top: red"]["count"] == 3
    assert by_label["metal ring connectors"]["count"] == 2
    assert "person" not in by_label
    assert "depicts" not in by_label


def test_schema_contract_derives_support_from_cited_structured_evidence():
    analysis = {
        "itemCount": 4,
        "evidence": [
            {
                "id": "e001",
                "category": "detail",
                "label": "metal ring connectors",
                "media": ["a.jpg", "b.jpg"],
                "count": 2,
                "examples": ["a.jpg", "b.jpg"],
                "contexts": ["red triangle top with metal ring connectors"],
            },
            {
                "id": "e002",
                "category": "quality",
                "label": "bikini top: ring connectors",
                "media": ["b.jpg", "c.jpg"],
                "count": 2,
                "examples": ["b.jpg", "c.jpg"],
                "contexts": ["ring connectors on bikini top"],
            },
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
                "terms": [{"term": "ring", "evidenceIds": ["e001", "e002", "invented"]}],
            }]
        },
        sight_evidence=contract["sight_evidence"],
        existing_groups=contract["existing_groups"],
    )

    group = result["groups"][0]
    term = group["terms"][0]
    assert contract["operation"] == "vision_schema_suggest"
    assert contract["output"] == "json"
    assert group["action"] == "extend"
    assert group["targetGroup"] == "BT Connector"
    assert term["evidenceIds"] == ["e001", "e002"]
    assert term["support"] == 3
    assert term["examples"] == ["a.jpg", "b.jpg", "c.jpg"]


def test_schema_contract_marks_existing_terms_and_keeps_evidence_grounded():
    analysis = {
        "itemCount": 2,
        "evidence": [{
            "id": "e001",
            "category": "quality",
            "label": "bikini top: triangle",
            "media": ["a.jpg", "b.jpg"],
            "count": 2,
            "examples": ["a.jpg", "b.jpg"],
            "contexts": [],
        }],
    }
    result = vision_schema_contract.normalize_result(
        {
            "groups": [{
                "name": "BT Shape",
                "targetGroup": "",
                "rationale": "Existing dimension.",
                "terms": [{"term": "TRIANGLE", "evidenceIds": ["e001"]}],
            }]
        },
        sight_evidence=analysis["evidence"],
        existing_groups=[{"group": "BT Shape", "terms": ["triangle"]}],
    )

    assert result["groups"][0]["targetGroup"] == "BT Shape"
    assert result["groups"][0]["terms"][0]["alreadyExists"] is True


def test_tag_assignment_contract_prefers_existing_terms_and_allows_new_terms_in_existing_groups():
    records = [
        {
            "file": "a.jpg",
            **_sight(
                "Front view of a red triangle top with gold ring connectors.",
                viewpoint=["front"],
                things=[{"name": "bikini top", "qualities": ["triangle"]}],
                colors=[{"thing": "bikini top", "color": "red"}],
                details=["gold ring connectors"],
            ),
        },
        {
            "file": "b.jpg",
            **_sight(
                "Side view of a black bandeau top.",
                viewpoint=["side"],
                things=[{"name": "bikini top", "qualities": ["bandeau"]}],
                colors=[{"thing": "bikini top", "color": "black"}],
            ),
        },
    ]
    groups = [
        {"group": "Viewpoint", "terms": ["front", "side"]},
        {"group": "BT Shape", "terms": ["triangle", "bandeau"]},
        {"group": "BT Detail", "terms": ["chain"]},
    ]
    current = {"a.jpg": [{"group": "Viewpoint", "term": "front"}]}
    contract = vision_schema_contract.build_assignment_request(records, groups, current)
    result = vision_schema_contract.normalize_assignment_result(
        {
            "items": [
                {
                    "file": "a.jpg",
                    "candidates": [
                        {"group": "Viewpoint", "term": "front", "confidence": "high", "why": "Visible front view."},
                        {"group": "BT Shape", "term": "TRIANGLE", "confidence": "high", "why": "Triangle cups."},
                        {"group": "BT Detail", "term": "ring connector", "confidence": "high", "why": "Gold ring hardware."},
                    ],
                }
            ]
        },
        existing_groups=contract["existing_groups"],
        allowed_files=contract["source_files"],
        current_assignments=contract["current_assignments"],
    )

    assert contract["operation"] == "vision_tag_suggest"
    assert [row["file"] for row in result["items"]] == ["a.jpg", "b.jpg"]
    candidates = result["items"][0]["candidates"]
    assert [(row["group"], row["term"], row["existing"]) for row in candidates] == [
        ("BT Detail", "ring connector", False),
        ("BT Shape", "triangle", True),
    ]
    assert result["items"][1]["candidates"] == []




def test_guided_assignment_contract_rejects_new_terms():
    records = [{
        "file": "a.jpg",
        **_sight(
            "Front view of a red triangle top with ring connectors.",
            viewpoint=["front"],
            things=[{"name": "bikini top", "qualities": ["triangle"]}],
            details=["ring connectors"],
        ),
    }]
    groups = [
        {"group": "Viewpoint", "terms": ["front"]},
        {"group": "BT Shape", "terms": ["triangle"]},
        {"group": "BT Detail", "terms": ["chain"]},
    ]
    contract = vision_schema_contract.build_assignment_request(
        records,
        groups,
        existing_only=True,
    )
    result = vision_schema_contract.normalize_assignment_result(
        {
            "items": [{
                "file": "a.jpg",
                "candidates": [
                    {"group": "Viewpoint", "term": "front", "confidence": "high", "why": "Visible front view."},
                    {"group": "BT Detail", "term": "ring connector", "confidence": "high", "why": "Visible ring hardware."},
                ],
            }]
        },
        existing_groups=contract["existing_groups"],
        allowed_files=contract["source_files"],
        current_assignments=contract["current_assignments"],
        existing_only=contract["existing_only"],
    )

    assert contract["existing_only"] is True
    assert "Do not propose new terms or groups." in contract["prompt"]
    assert [(row["group"], row["term"], row["existing"]) for row in result["items"][0]["candidates"]] == [
        ("Viewpoint", "front", True),
    ]


def test_vision_status_preserves_legacy_cache_but_requires_structured_sight_for_phase1(tmp_path, monkeypatch):
    import json
    from tool.server import config as app_config

    set_root = tmp_path / "set"
    set_root.mkdir()
    media_path = set_root / "a.jpg"
    media_path.write_bytes(b"a")
    stat = media_path.stat()
    monkeypatch.setattr(app_config, "FS_ROOT", tmp_path)

    (set_root / "media_metadata.json").write_text(json.dumps({
        "a.jpg": {
            "vision_sight": {
                "version": 1,
                "model": "vl",
                "description": "legacy prose sight",
                "mtime": int(stat.st_mtime),
                "size": stat.st_size,
            }
        }
    }), encoding="utf-8")

    status = vision_schema_assist.vision_sight_status("set", "vl")
    assert status["items"][0]["cached"] is True
    assert status["items"][0]["structured"] is False
    assert status["structured"] == 0


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

    vision_schema_assist.save_vision_sight(
        "set",
        "a.jpg",
        "vl",
        _sight(
            "Red triangle top.",
            things=[{"name": "bikini top", "qualities": ["triangle"]}],
            colors=[{"thing": "bikini top", "color": "red"}],
        ),
    )

    payload = json.loads((set_root / "media_metadata.json").read_text(encoding="utf-8"))
    assert payload["a.jpg"]["color_suggestions"] == {"version": 9, "colors": ["red"]}
    assert payload["a.jpg"]["vision_sight"]["version"] == 2
    assert payload["a.jpg"]["vision_sight"]["description"] == "Red triangle top."
    assert payload["a.jpg"]["vision_sight"]["inventory"]["colors"][0] == {
        "thing": "bikini top",
        "color": "red",
    }



def test_schema_aware_vocabulary_sight_normalizes_known_groups_and_keeps_unknown_dimensions():
    payload = vision_schema_assist.normalize_vision_vocabulary_sight_payload(
        {
            "groups": [
                {"group": "BT Shape", "observations": ["tiny triangle", "narrow cups"]},
                {"group": "Viewpoint", "observations": ["front"]},
                {"group": "Invented Dimension", "observations": ["metal rings"]},
            ],
            "other": [
                {"suggestedGroup": "BT Shape", "observations": ["micro triangle"]},
                {"suggestedGroup": "Connector", "observations": ["gold ring"]},
            ],
        },
        [
            {"group": "BT Shape", "terms": ["triangle"]},
            {"group": "Viewpoint", "terms": ["front", "side"]},
        ],
    )

    by_group = {row["group"]: row["observations"] for row in payload["groups"]}
    assert by_group["BT Shape"] == ["tiny triangle", "narrow cups", "micro triangle"]
    assert by_group["Viewpoint"] == ["front"]
    assert {row["suggestedGroup"] for row in payload["other"]} == {"Invented Dimension", "Connector"}


def test_vocabulary_sight_signature_changes_when_group_vocabulary_changes():
    first = vision_schema_assist.vision_vocabulary_group_signature([
        {"group": "BT Shape", "terms": ["triangle"]},
    ])
    same = vision_schema_assist.vision_vocabulary_group_signature([
        {"group": "BT Shape", "terms": ["triangle"]},
    ])
    changed = vision_schema_assist.vision_vocabulary_group_signature([
        {"group": "BT Shape", "terms": ["triangle", "micro triangle"]},
    ])
    assert first == same
    assert first != changed


def test_schema_aware_mining_keeps_bounded_singletons_for_semantic_consolidation():
    analysis = vision_schema_assist.mine_vocabulary_sight_records([
        {
            "file": "a.jpg",
            "groups": [{"group": "BT Shape", "observations": ["tiny triangle"]}],
            "other": [],
        },
        {
            "file": "b.jpg",
            "groups": [{"group": "BT Shape", "observations": ["micro triangle"]}],
            "other": [],
        },
        {
            "file": "c.jpg",
            "groups": [{"group": "BT Shape", "observations": ["tiny triangle"]}],
            "other": [{"suggestedGroup": "Connector", "observations": ["metal ring"]}],
        },
    ])
    labels = {(row["suggestedGroup"], row["label"], row["count"]) for row in analysis["evidence"]}
    assert ("BT Shape", "tiny triangle", 2) in labels
    assert ("BT Shape", "micro triangle", 1) in labels
    assert ("Connector", "metal ring", 1) in labels


def test_vocabulary_challenge_contract_stays_grounded_and_orders_existing_groups_first():
    analysis = {
        "itemCount": 3,
        "evidence": [
            {
                "id": "g001",
                "source": "schema",
                "category": "group",
                "suggestedGroup": "BT Shape",
                "label": "micro triangle",
                "media": ["a.jpg", "b.jpg"],
                "count": 2,
                "examples": ["a.jpg", "b.jpg"],
                "contexts": [],
            },
            {
                "id": "g002",
                "source": "other",
                "category": "other",
                "suggestedGroup": "Connector",
                "label": "metal ring",
                "media": ["b.jpg", "c.jpg"],
                "count": 2,
                "examples": ["b.jpg", "c.jpg"],
                "contexts": [],
            },
        ],
    }
    existing = [{"group": "BT Shape", "terms": ["triangle"]}]
    challenge = vision_schema_contract.build_challenge_request(
        analysis,
        existing,
        {"groups": []},
    )
    result = vision_schema_contract.normalize_result(
        {
            "groups": [
                {
                    "name": "Connector",
                    "targetGroup": "",
                    "rationale": "Recurring hardware.",
                    "terms": [{"term": "ring", "evidenceIds": ["g002"]}],
                },
                {
                    "name": "BT Shape",
                    "targetGroup": "BT Shape",
                    "rationale": "Recurring shape distinction.",
                    "terms": [{"term": "micro triangle", "evidenceIds": ["g001"]}],
                },
            ]
        },
        sight_evidence=challenge["sight_evidence"],
        existing_groups=challenge["existing_groups"],
    )
    assert challenge["operation"] == "vision_schema_challenge"
    assert [row["name"] for row in result["groups"]] == ["BT Shape", "Connector"]
