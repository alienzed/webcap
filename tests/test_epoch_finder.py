"""Small, isolated Epoch Finder contracts; no GPU/ComfyUI needed."""
import pytest

from tool.server import epoch_finder, epoch_test_bench


def test_round_plans_share_frozen_seeds_and_start_with_every_saved_epoch():
    plans = epoch_finder._create_plan([5, 10, 15], "a {red|blue} coat", 3, 2, 50, {"megapixels": 0.4})
    assert len(plans) == 3
    assert plans[0]["epochs"] == [5, 10, 15]
    assert len(plans[0]["seeds"]) == 2
    assert plans[0]["settings"]["megapixels"] == 0.2
    assert plans[1]["settings"]["megapixels"] == pytest.approx(0.3)
    assert plans[2]["settings"]["megapixels"] == pytest.approx(0.4)
    assert plans[1]["epochs"] == []


def test_vl_scoring_excludes_unclear_and_only_counts_observable_attributes():
    groups = [
        {"id": "G1", "label": "Top", "options": ["red", "blue"], "expected": 2},
        {"id": "G2", "label": "Back", "options": ["front", "rear"], "expected": 1},
        {"id": "G3", "label": "Detail", "options": ["ring", "plain"], "expected": None},
    ]
    compared = epoch_finder._compare("G1: 2\nG2: unclear\nG3: 1", groups)
    assert [item["result"] for item in compared] == ["match", "unclear", "unclear"]


def test_ranking_counts_matches_mismatches_not_unclear():
    campaign = {
        "rounds": [{"epochs": [5, 10]}],
        "units": [
            {"round": 1, "epoch": 5, "assessment": {"comparison": [
                {"result": "match"}, {"result": "unclear"}, {"result": "mismatch"}
            ]}},
            {"round": 1, "epoch": 10, "assessment": {"comparison": [
                {"result": "match"}, {"result": "match"}
            ]}},
        ],
    }
    ranked = epoch_finder._rank(campaign, 1)
    assert [entry["epoch"] for entry in ranked] == [10, 5]
    assert ranked[0]["score"] == 1
    assert ranked[1]["score"] == 0.5


def test_temporary_checkpoint_copy_cleanup_preserves_source(tmp_path, monkeypatch):
    source = tmp_path / "source.safetensors"
    source.write_bytes(b"training epoch weights")
    stage = tmp_path / "staged"
    stage.mkdir()
    monkeypatch.setattr(epoch_finder, "_folder_key", lambda _: "sample/set")
    monkeypatch.setattr(epoch_finder, "_candidate_run_snapshot", lambda *_: ("training", {"stages": "h3"}))
    monkeypatch.setattr(epoch_finder, "_candidate_test_directory_for_run", lambda *_args, **_kw: stage)
    monkeypatch.setattr(epoch_finder, "_candidate_safetensors_path", lambda *_args: source)
    campaign = {"id": "abcdef123456", "jobId": "job-1"}
    name = epoch_finder._stage_epoch(tmp_path, campaign, 5)
    assert name == "epoch-finder-abcdef123456/epoch5.safetensors"
    assert (stage / name).read_bytes() == source.read_bytes()
    epoch_finder._clean_staging(tmp_path, campaign)
    assert not (stage / "epoch-finder-abcdef123456").exists()
    assert source.read_bytes() == b"training epoch weights"


def test_campaign_staging_hidden_from_ordinary_test_candidates(tmp_path, monkeypatch):
    stage = tmp_path / "test"
    stage.mkdir()
    temporary = stage / "epoch-finder-abcdef123456"
    temporary.mkdir()
    (temporary / "epoch5.safetensors").write_bytes(b"x")
    (stage / "manual.safetensors").write_bytes(b"y")
    monkeypatch.setattr(epoch_test_bench, "_test_directory", lambda *_: stage)
    ordinary = epoch_test_bench._selected_lora_files_for_set(tmp_path, object())
    assert [path.name for path in ordinary] == ["manual.safetensors"]
    campaign = epoch_test_bench._selected_lora_files_for_set(
        tmp_path, object(), selected_files=["epoch-finder-abcdef123456/epoch5.safetensors"],
        campaign_staging="epoch-finder-abcdef123456",
    )
    assert [path.name for path in campaign] == ["epoch5.safetensors"]
    with pytest.raises(ValueError):
        epoch_test_bench._selected_lora_files_for_set(
            tmp_path, object(), selected_files=["epoch-finder-abcdef123456/epoch5.safetensors"]
        )


def test_cumulative_ranking_keeps_earlier_evidence_and_inactive_epochs():
    campaign = {
        "rounds": [{"epochs": [1, 2, 3]}, {"epochs": [1, 2]}],
        "units": [
            {"round": 1, "epoch": 1, "assessment": {"comparison": [{"result": "match"}]}},
            {"round": 1, "epoch": 2, "assessment": {"comparison": [{"result": "match"}]}},
            {"round": 1, "epoch": 3, "assessment": {"comparison": [{"result": "match"}, {"result": "mismatch"}]}},
            {"round": 2, "epoch": 1, "assessment": {"comparison": [{"result": "mismatch"}]}},
            {"round": 2, "epoch": 2, "assessment": {"comparison": [{"result": "mismatch"}, {"result": "mismatch"}]}},
        ],
    }
    ranking = epoch_finder._rank(campaign, 2)
    assert {row["epoch"] for row in ranking} == {1, 2, 3}
    scores = {row["epoch"]: row["score"] for row in ranking}
    assert scores[1] == 0.5
    assert scores[2] == pytest.approx(1 / 3)
    assert scores[3] == 0.5
    advanced, reentered, cutoff = epoch_finder._select_next_epochs(ranking, [1, 2], 50)
    assert advanced == [1, 3]
    assert reentered == [3]
    assert cutoff == 0.5


def test_cutoff_keeps_all_ties_and_does_not_score_unclear():
    ranking = [
        {"epoch": 1, "score": 0.8},
        {"epoch": 2, "score": 0.5},
        {"epoch": 3, "score": 0.5},
        {"epoch": 4, "score": None},
    ]
    advance, reenter, cutoff = epoch_finder._select_next_epochs(ranking, [1, 2, 3, 4], 50)
    assert advance == [1, 2, 3]
    assert reenter == []
    assert cutoff == 0.5


def test_failed_observation_remains_unscored_and_saved(tmp_path, monkeypatch):
    saved = []
    monkeypatch.setattr(epoch_finder, "_save", lambda folder, payload: saved.append(payload["units"][0].copy()))
    unit = {"round": 1, "epoch": 5, "case": 0, "assessment": None, "error": "", "errorStage": ""}
    campaign = {"id": "abcdef123456", "units": [unit]}
    epoch_finder._mark_unit_error(tmp_path, campaign, unit, "vision", RuntimeError("server offline"))
    assert saved and saved[0]["error"] == "server offline"
    assert unit["assessment"] is None
    assert unit["errorStage"] == "vision"


def test_wizard_dimensions_freeze_scoring_roles_and_values():
    from tool.server.epoch_finder_plan import normalize_dimensions
    prompt = "A {red|blue} garment with {ring|plain} sides, {garden|studio} background"
    result = normalize_dimensions(prompt, [
        {"label": "Colour", "options": ["red", "blue"], "role": "primary"},
        {"label": "Hardware", "options": ["ring", "plain"], "role": "leakage"},
        {"label": "Background", "options": ["garden", "studio"], "role": "vary"},
    ])
    assert [row["weight"] for row in result] == [2.0, 1.0, 0.0]
    assert [row["id"] for row in result] == ["G1", "G2", "G3"]


def test_wizard_rejects_misaligned_prompt_or_unscored_only():
    from tool.server.epoch_finder_plan import normalize_dimensions
    with pytest.raises(ValueError, match="match"):
        normalize_dimensions("A {red|blue} hat", [
            {"label": "Colour", "options": ["black", "blue"], "role": "primary"}
        ])
    with pytest.raises(ValueError, match="at least one"):
        normalize_dimensions("A {red|blue} hat", [
            {"label": "Colour", "options": ["red", "blue"], "role": "vary"}
        ])
    with pytest.raises(ValueError, match="flat"):
        normalize_dimensions("A {red|{blue|green}} hat")


def test_wizard_proposal_contract_reuses_captions_with_role_schema():
    from tool.server.epoch_finder_plan import build_proposal
    contract = build_proposal(
        ["person wearing a blue triangle bikini"],
        set_name="Bikini",
        focus="bikini construction",
        vocabulary=[{"group": "Bikini top", "terms": ["triangle", "micro triangle"]}],
    )
    assert contract["operation"] == "propose_epoch_finder_plan"
    assert contract["response_schema"]["properties"]["variationGroups"]["items"]["properties"]["role"]["enum"] == ["primary", "leakage", "vary"]
    assert "micro triangle" in contract["prompt"]


def test_wizard_proposal_normalization_enforces_alignment():
    from tool.server.epoch_finder_plan import normalize_proposal
    result = normalize_proposal({
        "concept": "Swimwear construction",
        "wildcard": "a {triangle|micro triangle} top",
        "stableTerms": ["top"],
        "variationGroups": [{"label": "Top shape",
                             "options": ["triangle", "micro triangle"], "role": "primary"}],
    })
    assert result["variationGroups"][0]["role"] == "primary"
    with pytest.raises(ValueError, match="match"):
        normalize_proposal({
            "concept": "Swimwear",
            "wildcard": "a {triangle|micro triangle} top",
            "stableTerms": [],
            "variationGroups": [{"label": "Shape", "options": ["micro triangle", "triangle"], "role": "primary"}],
        })


def test_wizard_cumulative_score_uses_primary_and_leakage_weights():
    campaign = {
        "rounds": [{"epochs": [1, 2]}],
        "units": [
            {"round": 1, "epoch": 1, "assessment": {"comparison": [
                {"result": "match", "weight": 2}, {"result": "mismatch", "weight": 1},
                {"result": "mismatch", "weight": 0},
            ]}},
            {"round": 1, "epoch": 2, "assessment": {"comparison": [
                {"result": "mismatch", "weight": 2}, {"result": "match", "weight": 1},
            ]}},
        ],
    }
    ranked = epoch_finder._rank(campaign, 1)
    assert ranked[0]["score"] == pytest.approx(2 / 3)
    assert ranked[1]["score"] == pytest.approx(1 / 3)
