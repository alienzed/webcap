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
                "terms": [{"term": "ring", "evidenceIds": ["e001", "e002"]}],
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



def test_context_sight_normalizes_exact_supplied_matches_and_keeps_caption():
    payload = vision_schema_assist.normalize_vision_vocabulary_sight_payload(
        {
            "caption": "Front view of a person in a tiny triangle top.",
            "matches": [
                {"group": "BT Shape", "terms": ["TRIANGLE", "micro triangle"]},
                {"group": "Viewpoint", "terms": ["front"]},
                {"group": "Invented Dimension", "terms": ["metal rings"]},
            ],
        },
        [
            {"group": "BT Shape", "terms": ["triangle"]},
            {"group": "Viewpoint", "terms": ["front", "side"]},
        ],
    )

    assert payload["caption"].startswith("Front view")
    by_group = {row["group"]: row["terms"] for row in payload["matches"]}
    assert by_group["BT Shape"] == ["triangle"]
    assert by_group["Viewpoint"] == ["front"]
    assert "Invented Dimension" not in by_group
    assert payload["diagnostics"]["unmatchedCount"] == 2
    reasons = {row["reason"] for row in payload["diagnostics"]["unmatched"]}
    assert reasons == {"unknown_group", "unknown_term"}


def test_context_sight_preserves_full_supplied_vocabulary():
    terms = ["term-{}".format(index) for index in range(48)]
    messages = vision_schema_assist.build_vision_vocabulary_sight_messages(
        "file://image.jpg",
        [{"group": "Position", "terms": terms}],
        "{position}.",
    )
    prompt = messages[1]["content"][0]["text"]
    assert "term-0" in prompt
    assert "term-47" in prompt


def test_context_sight_signature_tracks_terms_and_caption_template():
    first = vision_schema_assist.vision_vocabulary_group_signature(
        [{"group": "BT Shape", "terms": ["triangle"]}],
        "A {bt_shape} caption.",
    )
    term_changed = vision_schema_assist.vision_vocabulary_group_signature(
        [{"group": "BT Shape", "terms": ["triangle", "micro triangle"]}],
        "A {bt_shape} caption.",
    )
    template_changed = vision_schema_assist.vision_vocabulary_group_signature(
        [{"group": "BT Shape", "terms": ["triangle"]}],
        "{bt_shape} with {viewpoint}.",
    )
    assert first != term_changed
    assert first != template_changed


def test_context_sight_mining_keeps_exact_matches_and_caption_evidence():
    analysis = vision_schema_assist.mine_vocabulary_sight_records([
        {
            "file": "a.jpg",
            "caption": "Front view of a tiny triangle top with metal rings.",
            "matches": [
                {"group": "BT Shape", "terms": ["triangle"]},
                {"group": "Viewpoint", "terms": ["front"]},
            ],
        },
        {
            "file": "b.jpg",
            "caption": "Front view of a triangle top.",
            "matches": [
                {"group": "BT Shape", "terms": ["triangle"]},
                {"group": "Viewpoint", "terms": ["front"]},
            ],
        },
        {
            "file": "c.jpg",
            "caption": "Side view of a bandeau top with metal rings.",
            "matches": [
                {"group": "BT Shape", "terms": ["bandeau"]},
                {"group": "Viewpoint", "terms": ["side"]},
            ],
            "diagnostics": {
                "unmatched": [
                    {"group": "BT Shape", "terms": ["halter"], "reason": "unknown_term"},
                    {"group": "Connector", "terms": ["ring"], "reason": "unknown_group"},
                ],
                "unmatchedCount": 2,
            },
        },
    ])
    labels = {(row["suggestedGroup"], row["label"], row["count"], row["source"]) for row in analysis["evidence"]}
    assert ("BT Shape", "triangle", 2, "context") in labels
    assert ("Viewpoint", "front", 2, "context") in labels
    assert ("BT Shape", "bandeau", 1, "context") in labels
    assert ("BT Shape", "halter", 1, "context_unmatched") in labels
    assert ("Connector", "ring", 1, "context_unmatched") in labels
    assert analysis["captions"][0]["file"] == "a.jpg"


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



def test_schema_contract_rejects_unknown_evidence_ids_loudly():
    analysis = {
        "itemCount": 2,
        "evidence": [{
            "id": "e001",
            "category": "detail",
            "label": "metal ring",
            "media": ["a.jpg", "b.jpg"],
            "count": 2,
            "examples": ["a.jpg", "b.jpg"],
            "contexts": [],
        }],
    }
    try:
        vision_schema_contract.normalize_result(
            {
                "groups": [{
                    "name": "Connector",
                    "targetGroup": "",
                    "rationale": "Hardware.",
                    "terms": [{"term": "ring", "evidenceIds": ["e001", "invented"]}],
                }]
            },
            sight_evidence=analysis["evidence"],
            existing_groups=[],
        )
    except ValueError as exc:
        assert "unknown evidence ID" in str(exc)
        assert "invented" in str(exc)
    else:
        raise AssertionError("Unknown evidence IDs must fail loudly.")


def test_schema_contract_merges_duplicate_groups_and_terms_without_dropping_evidence():
    evidence = [
        {
            "id": "e001",
            "category": "detail",
            "label": "metal ring",
            "media": ["a.jpg"],
            "count": 1,
            "examples": ["a.jpg"],
            "contexts": [],
        },
        {
            "id": "e002",
            "category": "detail",
            "label": "round connector",
            "media": ["b.jpg"],
            "count": 1,
            "examples": ["b.jpg"],
            "contexts": [],
        },
    ]
    result = vision_schema_contract.normalize_result(
        {
            "groups": [
                {
                    "name": "Connector",
                    "targetGroup": "",
                    "rationale": "Hardware.",
                    "terms": [{"term": "ring", "evidenceIds": ["e001"]}],
                },
                {
                    "name": "Connector",
                    "targetGroup": "",
                    "rationale": "Repeated connector form.",
                    "terms": [{"term": "RING", "evidenceIds": ["e002"]}],
                },
            ]
        },
        sight_evidence=evidence,
        existing_groups=[],
    )
    assert len(result["groups"]) == 1
    assert len(result["groups"][0]["terms"]) == 1
    assert result["groups"][0]["terms"][0]["evidenceIds"] == ["e001", "e002"]
    assert result["groups"][0]["terms"][0]["support"] == 2


def test_context_sight_keeps_valid_matches_and_reports_malformed_entries():
    payload = vision_schema_assist.normalize_vision_vocabulary_sight_payload(
        {
            "caption": "A triangle top with front view.",
            "matches": [
                {"group": "Shape", "terms": ["triangle", ""]},
                {"group": "View", "terms": "front"},
                {"group": "View", "terms": ["front"]},
                "invalid",
                {"group": "", "terms": ["ignored"]},
            ],
        },
        [
            {"group": "Shape", "terms": ["triangle"]},
            {"group": "View", "terms": ["front"]},
        ],
    )
    assert payload["matches"] == [
        {"group": "Shape", "terms": ["triangle"]},
        {"group": "View", "terms": ["front"]},
    ]
    assert len(payload["diagnostics"]["parseWarnings"]) == 4


def test_context_sight_keeps_caption_when_all_optional_matches_are_malformed():
    payload = vision_schema_assist.normalize_vision_vocabulary_sight_payload(
        {"caption": "A triangle top.", "matches": [{"group": "Shape", "terms": "triangle"}]},
        [{"group": "Shape", "terms": ["triangle"]}],
    )
    assert payload["caption"] == "A triangle top."
    assert payload["matches"] == []
    assert payload["diagnostics"]["parseWarnings"]


