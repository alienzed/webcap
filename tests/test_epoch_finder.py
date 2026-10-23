"""Small, isolated Epoch Finder contracts; no GPU/ComfyUI needed."""
import pytest

from tool.server import epoch_finder, epoch_test_bench


def test_manual_screening_test_status_reuses_checkpoint_provenance_across_runs(tmp_path, monkeypatch):
    """Test membership is independent of Keep selection and displayed round."""
    from pathlib import Path

    campaign = {
        "id": "abcdef123456", "mode": "manual", "jobId": "run-a", "modelId": "h3",
        "kept": [2], "rounds": [{"epochs": [1, 2, 3]}, {"epochs": [2]}],
        "candidateMap": {
            "2": {"jobId": "run-b", "epoch": 9},
            "3": {"sourceType": "staged", "fileName": "existing.safetensors"},
        },
    }
    monkeypatch.setattr(epoch_finder, "_load", lambda *_: campaign)
    monkeypatch.setattr(epoch_finder, "_candidate_run_snapshot",
                        lambda folder, job: (str(tmp_path), {"id": job}))
    monkeypatch.setattr(epoch_finder, "candidate_run_folder_path", lambda *_: tmp_path)
    monkeypatch.setattr(epoch_finder, "saved_artifacts_for_run",
                        lambda *args: [
                            {"epoch": 1, "status": "available", "fileName": "one.safetensors"},
                            {"epoch": 9, "status": "available", "fileName": "nine.safetensors"},
                        ])
    monkeypatch.setattr(epoch_finder, "get_test_model", lambda *_: object())
    monkeypatch.setattr(epoch_finder.test_bench, "_staged_loras_for_set",
                        lambda *_: [Path("existing.safetensors")])
    checked = []
    def annotate(run, analysis):
        checked.append(run["id"])
        for artifact in analysis["savedArtifacts"]:
            artifact["inTestFolder"] = run["id"] == "run-a" and artifact["epoch"] == 1
        analysis["testFolderStatus"] = {"state": "available"}
    monkeypatch.setattr(epoch_finder, "_annotate_candidate_test_folder_status", annotate)

    response = epoch_finder.command(tmp_path, "screening_test_status",
                                    {"campaignId": "abcdef123456"})
    assert response["inTest"] == {"1": True, "2": False, "3": True}
    assert checked == ["run-a", "run-b"]
    assert campaign["kept"] == [2]  # Copy status never changes selection.


def test_manual_screening_unknown_test_destination_fails_explicitly(tmp_path, monkeypatch):
    campaign = {"id": "abcdef123456", "mode": "manual", "jobId": "run-a",
                "rounds": [{"epochs": [1]}], "candidateMap": {}}
    monkeypatch.setattr(epoch_finder, "_load", lambda *_: campaign)
    monkeypatch.setattr(epoch_finder, "_candidate_run_snapshot",
                        lambda *_: (str(tmp_path), {}))
    monkeypatch.setattr(epoch_finder, "candidate_run_folder_path", lambda *_: tmp_path)
    monkeypatch.setattr(epoch_finder, "saved_artifacts_for_run",
                        lambda *_: [{"epoch": 1, "status": "available"}])
    def unavailable(_run, analysis):
        analysis["testFolderStatus"] = {"state": "unknown", "error": "offline"}
    monkeypatch.setattr(epoch_finder, "_annotate_candidate_test_folder_status", unavailable)
    with pytest.raises(RuntimeError, match="Could not verify Test staging"):
        epoch_finder.screening_test_status(tmp_path, "abcdef123456")


def test_epoch_picker_run_header_reuses_training_candidates_navigation():
    """The per-run link opens its exact source without changing the epoch selection."""
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    js = (root / "tool/js/epoch_finder.js").read_text(encoding="utf-8")
    css = (root / "tool/css/epoch_finder.css").read_text(encoding="utf-8")
    assert 'class="epoch-finder-run-epochs-heading"' in js
    assert 'data-epoch-training-run' in js
    handler = js[js.index("if (event.target.closest('[data-epoch-training-run]')) {"):
                 js.index("var choice = event.target.closest('[data-epoch-choice]');")]
    assert "openTrainingCandidates({id:String(run.jobId),folder:folder}" in handler
    assert "refreshScreeningTestStatus(campaignState,true)" in handler
    assert "return;" in handler
    assert "runEpochSelections" not in handler
    assert ".epoch-finder-run-epochs-heading{display:flex" in css
    assert "justify-content:space-between" in css


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
    monkeypatch.setattr(epoch_finder, "get_test_model_for_staging_key", lambda stage: object())
    monkeypatch.setattr(epoch_finder.test_bench, "_test_directory", lambda *args: stage)
    monkeypatch.setattr(epoch_finder, "_candidate_safetensors_path", lambda *_args: source)
    campaign = {"id": "abcdef123456", "jobId": "job-1", "stage": "h3"}
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
    # Nested wildcards are intentionally supported by Test Generations and
    # Epoch Finder uses the same expanded, top-level vocabulary.
    expanded = normalize_dimensions("A {red|{blue|green}} hat")
    assert expanded[0]["options"] == ["red", "blue", "green"]


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
                             "options": ["triangle", "micro triangle"], "role": "primary",
                             "referenceTags": [{"group": "BT Shape", "tag": "triangle"}, {"group": "BT Shape", "tag": "micro triangle"}]}],
    })
    assert result["variationGroups"][0]["role"] == "primary"
    with pytest.raises(ValueError, match="match"):
        normalize_proposal({
            "concept": "Swimwear",
            "wildcard": "a {triangle|micro triangle} top",
            "stableTerms": [],
            "variationGroups": [{"label": "Shape", "options": ["micro triangle", "triangle"], "role": "primary"}],
        })


def test_campaign_director_keeps_exact_tag_group_when_text_occurs_twice():
    from tool.server.epoch_finder_plan import normalize_proposal
    result = normalize_proposal({
        "concept": "Micro bikini construction",
        "wildcard": "A {simple string straps|ring connectors} top and "
                    "{simple string straps|ring connectors} bottom.",
        "stableTerms": ["bikini"],
        "variationGroups": [
            {"label": "Top straps", "annotationGroup": "BT Back",
             "role": "primary", "options": ["simple string straps", "ring connectors"]},
            {"label": "Bottom straps", "annotationGroup": "BB Back",
             "role": "primary", "options": ["simple string straps", "ring connectors"]},
        ],
    })
    assert [group["annotationGroup"] for group in result["variationGroups"]] == [
        "BT Back", "BB Back"
    ]
    assert [group["role"] for group in result["variationGroups"]] == [
        "primary", "primary"
    ]


def test_reference_vl_does_not_conflate_identical_labels_and_tags(tmp_path, monkeypatch):
    frame_dir = tmp_path / "frames"
    frame_dir.mkdir()
    (frame_dir / "render.png").write_bytes(b"render")
    (tmp_path / "top.png").write_bytes(b"top")
    (tmp_path / "bottom.png").write_bytes(b"bottom")
    monkeypatch.setattr(epoch_finder, "_directory", lambda *_: tmp_path)
    monkeypatch.setattr(epoch_finder, "_folder_key", lambda *_: "set")
    monkeypatch.setattr(epoch_finder, "vision_resized_image_data_url",
                        lambda *_: "data:image/png;base64,AAAA")
    monkeypatch.setattr("tool.server.epoch_reference.verified_reference",
                        lambda *_: {"size": 3, "mtimeNs": 4})
    monkeypatch.setattr(epoch_finder, "enqueue_llm",
                        lambda *_args, **_kwargs: {"jobId": "llm-1"})
    monkeypatch.setattr(epoch_finder, "llm_job_status",
                        lambda *_args, **_kwargs: {
                            "status": "completed",
                            "result": {"text": "OPTION: 1\nVERDICT: MATCH"},
                        })
    monkeypatch.setattr(epoch_finder, "_save", lambda *_args: None)

    options = ["simple string straps", "ring connectors"]
    campaign = {
        "id": "campaign", "jobId": "run1", "visionModel": "vision1",
        "referenceEvaluation": {"rvn": True},
        "referencePlan": [
            {"dimensionId": "G1", "attribute": "Straps",
             "option": options[0], "group": "BT Back", "media": "top.png",
             "size": 3, "mtimeNs": 4},
            {"dimensionId": "G2", "attribute": "Straps",
             "option": options[0], "group": "BB Back", "media": "bottom.png",
             "size": 3, "mtimeNs": 4},
        ],
    }
    unit = {
        "frame": "render.png",
        "groups": [{"id": ident, "label": "Straps", "role": "primary",
                    "expected": 1, "options": options}
                   for ident in ("G1", "G2")],
    }
    epoch_finder._evaluate_reference_unit(tmp_path, campaign, unit)
    assert [row["group"] for row in unit["referenceAssessments"]] == [
        "BT Back", "BB Back"
    ]
    assert [row["reference"] for row in unit["referenceAssessments"]] == [
        "top.png", "bottom.png"
    ]


def test_campaign_one_image_question_prefers_exact_source_group():
    groups = [{"id": "G3", "label": "Attribute 3", "annotationGroup": "BT Back",
               "options": ["simple string straps", "metal ring"]}]
    question = epoch_finder._question(groups)
    assert "G3 (BT Back)" in question
    assert "Attribute 3" not in question


def test_campaign_director_uses_compiled_tags_and_default_roles():
    from tool.server.epoch_finder_plan import build_proposal
    contract = build_proposal(
        ["A woman in a black bikini with simple string straps and blonde hair."],
        annotations=[{"BT Back": ["simple string straps"],
                      "BB Back": ["simple string straps"],
                      "Hair": ["blonde"], "Background": ["studio"]}],
        vocabulary=[{"group": "BT Back", "alias": "Bikini top straps"},
                    {"group": "BB Back", "alias": "Bikini bottom straps"}],
        focus="micro bikini",
    )
    prompt = contract["prompt"]
    assert "Observed concept tags" in prompt
    assert '"group":"BT Back"' in prompt and '"group":"BB Back"' in prompt
    assert '"group":"Hair"' not in prompt and '"group":"Background"' not in prompt
    assert "Default Leakage: Position, Hair, Body, Clothing" in prompt
    assert "Default Vary only: Viewpoint, Background, Lighting" in prompt
    assert "annotationGroup" in prompt
    assert "[ACTUAL SET REFERENCE TAGS]" not in prompt


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


def test_retire_media_only_after_durable_vl(tmp_path, monkeypatch):
    deleted = []
    saves = []
    monkeypatch.setattr(epoch_finder.test_bench, "delete_session", lambda folder, session: deleted.append(session))
    monkeypatch.setattr(epoch_finder, "_save", lambda folder, campaign: saves.append(campaign["units"][0]["session"]))
    unit = {"session": "source-video", "assessment": None}
    campaign = {"units": [unit]}
    epoch_finder._retire_scored_session(tmp_path, campaign, unit)
    assert deleted == []
    assert unit["session"] == "source-video"
    unit["assessment"] = {"comparison": []}
    epoch_finder._retire_scored_session(tmp_path, campaign, unit)
    assert deleted == ["source-video"]
    assert unit["session"] == "" and saves == [""]


def test_prune_keeps_finalists_and_unscored_failure_frames(tmp_path, monkeypatch):
    directory = tmp_path / "campaign"
    frames = directory / "frames"
    frames.mkdir(parents=True)
    for name in ("a.png", "b.png", "c.png"):
        (frames / name).write_bytes(b"frame")
    monkeypatch.setattr(epoch_finder, "_directory", lambda folder, campaign_id: directory)
    monkeypatch.setattr(epoch_finder, "_save", lambda folder, campaign: None)
    units = [
        {"epoch": 1, "frame": "a.png", "assessment": {"comparison": []}},
        {"epoch": 2, "frame": "b.png", "assessment": {"comparison": []}},
        {"epoch": 3, "frame": "c.png", "assessment": None, "error": "VL failed"},
    ]
    campaign = {"id": "abcdef123456", "rounds": [{"epochs": [1, 2, 3]}, {"epochs": [2]}], "units": units}
    epoch_finder._prune_screening_frames(tmp_path, campaign)
    assert not (frames / "a.png").exists()
    assert (frames / "b.png").exists() and (frames / "c.png").exists()
    assert units[0]["frame"] == "" and units[0]["framePruned"] is True
    assert units[1]["frame"] == "b.png" and units[2]["frame"] == "c.png"


def test_resume_does_not_delete_source_session_just_because_frame_exists(monkeypatch, tmp_path):
    owned = {"campaignStaging": "epoch-finder-abcdef123456", "inferenceJobs": []}
    monkeypatch.setattr(epoch_finder.test_bench, "open_session", lambda folder, name: owned)
    removed = []
    monkeypatch.setattr(epoch_finder.test_bench, "delete_session",
                        lambda folder, name: removed.append(name))
    campaign = {
        "id": "abcdef123456",
        "units": [{"session": "retained-video", "frame": "first.png", "assessment": None}],
    }
    epoch_finder._resume_saved_work(tmp_path, campaign)
    assert removed == []
    assert campaign["units"][0]["session"] == "retained-video"


def test_krea_round_dimensions_follow_each_selected_preset():
    plans = epoch_finder._create_plan(
        [5, 10], "a {red|blue} top", 2, 2, 50,
        {"dimensions": "512 x 512"},
        [{"dimensions": "512 x 512"}, {"dimensions": "768 x 768"}],
    )
    assert [row["settings"]["dimensions"] for row in plans] == ["512 x 512", "768 x 768"]
    assert all("megapixels" not in row["settings"] for row in plans)


def test_krea_round_rejects_mp_and_h3_rejects_dimension_presets():
    with pytest.raises(ValueError, match="megapixels"):
        epoch_finder._create_plan([5], "a {red|blue} top", 1, 1, 50,
                                  {"dimensions": "512 x 512"}, [{"megapixels": 0.2}])
    with pytest.raises(ValueError, match="dimension presets"):
        epoch_finder._create_plan([5], "a {red|blue} top", 1, 1, 50,
                                  {"megapixels": 0.2}, [{"dimensions": "512 x 512"}])


def test_discover_queued_resume_run_with_saved_epochs(tmp_path, monkeypatch):
    from types import SimpleNamespace
    job = {"id": "queued-1", "folder": "set/a"}
    monkeypatch.setattr(epoch_finder, "_folder_key", lambda _: "set/a")
    monkeypatch.setattr(epoch_finder, "passive_status_snapshot",
                        lambda: ({"ok": True, "jobs": [job]}, 200))
    monkeypatch.setattr(epoch_finder, "all_history_payload",
                        lambda folder: {"jobs": [job, {"id": "other-set", "folder": "set/b"}]})
    monkeypatch.setattr(epoch_finder, "_candidate_run_snapshot",
                        lambda folder, job_id: (None, {"runName": "Waiting H3", "stages": "h3"}))
    monkeypatch.setattr(epoch_finder, "get_test_model_for_staging_key",
                        lambda stage: SimpleNamespace(PROFILE_ID="minimax_h3", STAGING_KEY=stage))
    monkeypatch.setattr(epoch_finder, "candidate_run_folder_path", lambda *args: tmp_path)
    monkeypatch.setattr(epoch_finder, "saved_artifacts_for_run",
                        lambda path: [{"epoch": 60, "status": "available"},
                                      {"epoch": 65, "status": "missing"}])
    runs = epoch_finder._runs(tmp_path)
    assert len(runs) == 1
    assert {key: runs[0][key] for key in ("jobId", "runName", "modelId", "stage", "epochs")} == {
        "jobId": "queued-1", "runName": "Waiting H3", "modelId": "minimax_h3",
        "stage": "h3", "epochs": [60],
    }
    assert runs[0]["folder"] == "set/a"
    assert runs[0]["setName"] == "a"


def test_discover_history_run_and_queue_only_once(tmp_path, monkeypatch):
    from types import SimpleNamespace
    monkeypatch.setattr(epoch_finder, "_folder_key", lambda _: "set/a")
    monkeypatch.setattr(epoch_finder, "passive_status_snapshot",
                        lambda: ({"ok": True, "jobs": [{"id": "same", "folder": "set/a"}]}, 200))
    monkeypatch.setattr(epoch_finder, "all_history_payload",
                        lambda folder: {"jobs": [{"id": "same", "folder": "set/a"}]})
    monkeypatch.setattr(epoch_finder, "_candidate_run_snapshot",
                        lambda folder, job_id: (None, {"runName": "H3", "stages": "h3"}))
    monkeypatch.setattr(epoch_finder, "get_test_model_for_staging_key",
                        lambda stage: SimpleNamespace(PROFILE_ID="minimax_h3", STAGING_KEY=stage))
    monkeypatch.setattr(epoch_finder, "candidate_run_folder_path", lambda *args: tmp_path)
    monkeypatch.setattr(epoch_finder, "saved_artifacts_for_run",
                        lambda path: [{"epoch": 60, "status": "available"}])
    assert len(epoch_finder._runs(tmp_path)) == 1


def test_wizard_primary_wildcard_allows_descriptive_concatenated_tag_phrases():
    from tool.server.epoch_finder_plan import normalize_proposal
    proposal = normalize_proposal({
        "concept": "Bikini top construction",
        "wildcard": "a {micro triangle simple string straps|teardrop top} bikini",
        "stableTerms": ["bikini"],
        "variationGroups": [{"label": "Top construction", "role": "primary",
                             "options": ["micro triangle simple string straps", "teardrop top"]}],
    })
    assert proposal["variationGroups"][0]["options"][0] == "micro triangle simple string straps"
    assert proposal["variationGroups"][0]["role"] == "primary"


def test_epoch_primary_prompt_instructions_require_exact_single_group_tags():
    from tool.server.epoch_finder_plan import build_proposal
    contract = build_proposal(
        ["a triangle top with string straps"], set_name="Bikini",
        vocabulary=[{"group": "BT Shape", "terms": ["triangle", "teardrop"]}],
        reference_vocabulary=[{"group": "BT Shape", "terms": [
            {"term": "triangle", "count": 3}, {"term": "teardrop", "count": 2}]}],
    )
    assert "exact text of one tag" in contract["prompt"]
    assert "never combine, rephrase, or infer tags" in contract["prompt"]
    assert "ACTUAL SET REFERENCE TAGS" in contract["prompt"]


def test_campaign_run_choices_use_saved_sequence_and_training_details():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    js = (root / "tool/js/epoch_finder.js").read_text(encoding="utf-8")
    backend = (root / "tool/server/epoch_finder.py").read_text(encoding="utf-8")
    history = (root / "tool/server/training_history.py").read_text(encoding="utf-8")
    assert 'run.get("sequence") or job.get("sequence")' in backend
    assert '"runSummary": run.get("runSummary")' in backend
    assert '"currentEpoch": run.get("currentEpoch")' in backend
    assert 'summary["rank"] = rank' in history
    assert "function runIdentity(run)" in js
    assert "function runDetails(run)" in js
    assert "escape(runDetails(run))" in js


def test_campaign_accepts_selected_test_loras_without_a_training_run(tmp_path, monkeypatch):
    """Staged candidates are valid campaign sources even without History or Queue."""
    from types import SimpleNamespace
    from tool.server import storyboard_llm_runtime

    source = tmp_path / "test"
    source.mkdir()
    first = source / "manual.safetensors"
    second = source / "copied.safetensors"
    first.write_bytes(b"manual LoRA")
    second.write_bytes(b"recorded LoRA")

    model = SimpleNamespace(
        PROFILE_ID="minimax_h3", STAGING_KEY="h3", settings=("megapixels",),
        load_template=lambda: {},
        normalize_settings=lambda *args: {},
    )
    monkeypatch.setattr(epoch_finder, "_folder_key", lambda _: "sets/demo")
    monkeypatch.setattr(epoch_finder, "_runs", lambda *_a, **_kw: pytest.fail("Staged campaign queried Training runs"))
    monkeypatch.setattr(epoch_finder, "get_test_model", lambda identity: model)
    monkeypatch.setattr(epoch_finder, "get_test_model_for_staging_key", lambda stage: model)
    monkeypatch.setattr(epoch_finder.test_bench, "_test_directory", lambda *_args: source)
    monkeypatch.setattr(epoch_finder.test_bench, "_selected_lora_files_for_set",
                        lambda folder, selected_model, selected_files=None: [
                            path for path in (first, second)
                            if selected_files is None or path.name in selected_files
                        ])
    monkeypatch.setattr(epoch_finder.test_bench, "_staged_lora_provenance",
                        lambda path: ({
                            "version": 1, "sourceFolder": "sets/demo", "stage": "h3",
                            "sourceJobId": "job42", "sourceEpoch": 20,
                            "sourceFileName": "epoch20.safetensors",
                            "sourceRunName": "Training 42",
                        } if path == second else {}))
    monkeypatch.setattr(epoch_finder.test_bench, "_has_webcap_staged_provenance",
                        lambda path, selected_model, provenance: path == second)
    monkeypatch.setattr(epoch_finder, "normalize_dimensions",
                        lambda prompt, raw: [{"role": "primary", "id": "G1", "label": "Color",
                                              "options": ["blue", "red"]}])
    monkeypatch.setattr(storyboard_llm_runtime, "list_vision_models", lambda: [{"id": "vision-1"}])
    monkeypatch.setattr(epoch_finder, "_directory", lambda folder, cid: tmp_path / cid)
    monkeypatch.setattr(epoch_finder, "_launch", lambda folder, cid: None)
    criteria = {
        "selectedFiles": ["copied.safetensors", "manual.safetensors"],
        "modelId": "minimax_h3", "prompt": "a {blue|red} bikini", "visionModel": "vision-1",
        "rounds": 2, "cases": 2, "keepPercent": 50,
        "settings": {"megapixels": 0.3}, "referencePlan": [],
        "referenceEvaluation": {"rvn": False, "dino": False},
    }
    campaign = epoch_finder.create_campaign(tmp_path, criteria)
    assert campaign["version"] == 3
    assert campaign["jobId"] == ""
    assert campaign["runSelections"] == []
    assert campaign["selectedFiles"] == ["manual.safetensors", "copied.safetensors"]
    assert campaign["rounds"][0]["epochs"] == [1, 2]
    assert campaign["candidateMap"]["1"]["fileName"] == "manual.safetensors"
    assert campaign["candidateMap"]["1"]["jobId"] == ""
    assert campaign["candidateMap"]["1"]["epoch"] is None
    assert campaign["candidateMap"]["2"]["fileName"] == "copied.safetensors"
    assert campaign["candidateMap"]["2"]["jobId"] == "job42"
    assert campaign["candidateMap"]["2"]["epoch"] == 20

    staged = epoch_finder._stage_epoch(tmp_path, campaign, 1)
    assert (source / staged).read_bytes() == first.read_bytes()
    epoch_finder._clean_staging(tmp_path, campaign)
    staged = epoch_finder._stage_epoch(tmp_path, campaign, 2)
    assert (source / staged).read_bytes() == second.read_bytes()
    epoch_finder._clean_staging(tmp_path, campaign)

    matching = dict(criteria, selectedFiles=campaign["selectedFiles"],
                    parentCampaignId=campaign["id"])
    followup = epoch_finder.create_campaign(tmp_path, matching)
    assert followup["parentCampaignId"] == campaign["id"]
    with pytest.raises(ValueError, match="original selected Test LoRAs"):
        epoch_finder.create_campaign(tmp_path, dict(criteria,
            selectedFiles=["manual.safetensors"], parentCampaignId=campaign["id"]))


def test_campaign_list_still_offers_staged_loras_when_training_catalog_fails(tmp_path, monkeypatch):
    from types import SimpleNamespace

    source = tmp_path / "test"
    source.mkdir()
    (source / "manual.safetensors").write_bytes(b"data")
    model = SimpleNamespace(PROFILE_ID="minimax_h3", STAGING_KEY="h3")
    monkeypatch.setattr(epoch_finder, "_root", lambda folder: tmp_path / "absent-campaigns")
    monkeypatch.setattr(epoch_finder, "get_test_model", lambda model_id: model)
    monkeypatch.setattr(epoch_finder.test_bench, "_staged_loras_for_set",
                        lambda folder, selected_model: [source / "manual.safetensors"])
    monkeypatch.setattr(epoch_finder, "_runs",
                        lambda folder: (_ for _ in ()).throw(RuntimeError("Training queue corrupt")))
    result = epoch_finder.list_campaigns(tmp_path, "minimax_h3")
    assert result["stagedFiles"] == ["manual.safetensors"]
    assert result["runs"] == []
    assert result["warnings"] == ["Training runs unavailable: Training queue corrupt"]


def test_campaign_staged_source_wizard_contract():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    wizard = (root / "tool/js/epoch_finder.js").read_text(encoding="utf-8")
    tests = (root / "tool/js/test_generations.js").read_text(encoding="utf-8")
    html = (root / "tool/tool.html").read_text(encoding="utf-8")
    assert "window.getTestGenerationSelectedCandidateFiles" in tests
    assert 'name="epoch-finder-source" value="staged"' in html
    assert 'data-staged-file=' in wizard
    assert "criteria.selectedFiles = selectedStagedFiles()" in wizard
    assert "sourceMode === 'staged'" in wizard
    assert "stagedOrigin(campaign, unit.epoch)" in wizard


def test_file_campaign_gallery_preserves_filename_without_inventing_run_identity(tmp_path, monkeypatch):
    cid = "abcdef123456"
    directory = tmp_path / cid
    directory.mkdir()
    campaign = {
        "id": cid, "modelId": "minimax_h3", "jobId": "",
        "runName": "Selected Test LoRAs",
        "candidateMap": {"1": {"sourceType": "staged", "fileName": "manual.safetensors",
                                "jobId": "", "epoch": None}},
        "units": [{"round": 1, "epoch": 1, "case": 0, "frame": "render.png"}],
    }
    monkeypatch.setattr(epoch_finder.test_bench, "_session_directories", lambda folder: [])
    monkeypatch.setattr(epoch_finder, "_root", lambda folder: tmp_path)
    monkeypatch.setattr(epoch_finder, "_load", lambda folder, campaign_id: campaign)
    monkeypatch.setattr(epoch_finder, "_runs", lambda folder: [])
    gallery = epoch_finder.workspace_gallery(tmp_path, generated_only=True, include_epoch_index=True)
    assert gallery["total"] == 1
    item = gallery["media"][0]
    assert item["candidate"] == "manual.safetensors"
    assert item["candidateFile"] == "manual.safetensors"
    assert item["sourceType"] == "staged"
    assert item["jobId"] == ""
    assert item["epoch"] is None
    assert gallery["resultEpochs"] == []


def test_manual_screening_expands_selected_group_and_freezes_each_case(monkeypatch):
    seeds = iter([101, 202, 303])
    monkeypatch.setattr(epoch_finder.secrets, "randbelow", lambda _limit: next(seeds))
    plan = epoch_finder._screening_plan(
        "a {red|blue|brown} glove on {grass|table}", 0,
        {"megapixels": 0.3}, 1, [1, 2, 3])
    assert plan["epochs"] == [1, 2, 3]
    assert plan["columnLabels"] == ["red", "blue", "brown"]
    assert plan["seeds"] == [101, 202, 303]
    assert len(plan["casePrompts"]) == 3
    for index, color in enumerate(("red", "blue", "brown")):
        assert plan["casePrompts"][index].startswith("a " + color + " glove on ")
        assert plan["caseSelections"][index][0]["option"] == color
        assert plan["caseSelections"][index][1]["option"] in {"grass", "table"}
    assert plan["settings"] == {"megapixels": 0.3}


def test_screening_manual_scope_can_reintroduce_and_add_epochs(monkeypatch):
    monkeypatch.setattr(epoch_finder, "_runs", lambda _folder: [{
        "jobId": "run-a", "epochs": [1, 2, 3], "stage": "h3", "modelId": "minimax_h3"}])
    monkeypatch.setattr(epoch_finder, "_save", lambda *args, **kwargs: None)
    campaign = {"status": "complete", "mode": "manual", "modelId": "minimax_h3", "stage": "h3",
                "candidateMap": {"1": {"jobId": "run-a", "epoch": 1}},
                "kept": [1], "runSelections": []}
    result = epoch_finder._screening_selection(None, campaign, [
        {"jobId": "run-a", "epochs": [2, 3]}])
    assert result["kept"] == [2, 3]
    assert result["candidateMap"]["1"] == {"jobId": "run-a", "epoch": 1}
    assert result["candidateMap"]["2"]["epoch"] == 2
    assert result["candidateMap"]["3"]["epoch"] == 3
    result = epoch_finder._screening_selection(None, campaign, [
        {"jobId": "run-a", "epochs": [1, 3]}])
    assert result["kept"] == [1, 3]


def test_screening_next_round_is_explicit_and_preserves_previous_round(monkeypatch):
    class Model:
        settings = ("megapixels", "duration")
        def load_template(self):
            return {}
        def normalize_settings(self, template, seed_fn, settings):
            return settings
    monkeypatch.setattr(epoch_finder, "get_test_model", lambda _id: Model())
    monkeypatch.setattr(epoch_finder, "_save", lambda *_args, **_kwargs: None)
    launched = []
    monkeypatch.setattr(epoch_finder, "_launch", lambda _folder, ident: launched.append(ident))
    campaign = {
        "id": "abcdef123456", "modelId": "minimax_h3", "status": "complete",
        "kept": [2], "round": 1,
        "rounds": [epoch_finder._screening_plan("a {red|blue} glove", 0,
                                               {"megapixels": 0.3}, 1, [1, 2])],
    }
    original = dict(campaign["rounds"][0])
    epoch_finder._screening_next_round(None, campaign, {
        "prompt": "a {red|blue} glove on {grass|table}",
        "groupIndex": 0, "settings": {"megapixels": 0.4}})
    assert len(campaign["rounds"]) == 2
    assert campaign["rounds"][0] == original
    assert campaign["rounds"][1]["epochs"] == [2]
    assert campaign["rounds"][1]["settings"]["megapixels"] == 0.4
    assert campaign["round"] == 2
    assert launched == ["abcdef123456"]


def _live_screening_fixture(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    folder.mkdir()
    directory = tmp_path / "campaign"
    directory.mkdir()
    monkeypatch.setattr(epoch_finder, "_directory", lambda _folder, _identity: directory)
    monkeypatch.setattr(epoch_finder, "_folder_key", lambda _folder: "set")
    campaign = {
        "id": "abcdef123456", "folder": "set", "mode": "manual",
        "status": "running", "round": 1,
        "rounds": [{"number": 1, "epochs": [1, 2], "seeds": [11, 22]}],
        "candidateMap": {"1": {"jobId": "train", "epoch": 1}, "2": {"jobId": "train", "epoch": 2}},
        "runSelections": [{"jobId": "train", "epochs": [1, 2]}],
        "kept": [1, 2],
        "units": [
            {"round": 1, "epoch": 1, "case": 0, "frame": "r1-e1-c0.png", "rating": 0,
             "assessment": None},
        ],
    }
    epoch_finder._save(folder, campaign, preserve_manual=False)
    return folder, campaign


def test_live_screening_can_rate_finished_frame_and_deselect_during_rendering(tmp_path, monkeypatch):
    folder, campaign = _live_screening_fixture(tmp_path, monkeypatch)
    rating = epoch_finder.command(folder, "screening_rate", {
        "campaignId": campaign["id"], "round": 1, "epoch": 1, "case": 0, "rating": 5,
    })
    assert rating == {"rating": 5}
    choice = epoch_finder.command(folder, "screening_keep", {
        "campaignId": campaign["id"], "round": 1, "epoch": 1, "keep": False,
    })
    assert choice["kept"] == [2]
    latest = epoch_finder._load(folder, campaign["id"])
    assert latest["units"][0]["rating"] == 5
    assert latest["kept"] == [2]
    assert latest["status"] == "running"


def test_render_progress_cannot_erase_live_manual_review_or_vl(tmp_path, monkeypatch):
    folder, stale_render_worker = _live_screening_fixture(tmp_path, monkeypatch)
    epoch_finder.command(folder, "screening_rate", {
        "campaignId": stale_render_worker["id"], "round": 1,
        "epoch": 1, "case": 0, "rating": 4,
    })
    epoch_finder.command(folder, "screening_keep", {
        "campaignId": stale_render_worker["id"], "round": 1, "epoch": 1, "keep": False,
    })
    vl_result = epoch_finder._load(folder, stale_render_worker["id"])
    vl_result["units"][0]["assessment"] = {"text": "G1: 1", "comparison": []}
    epoch_finder._save(folder, vl_result, preserve_manual=False)

    # Simulate the in-flight render worker completing the next image from its
    # older snapshot. Rating, VL and selection must survive that save.
    stale_render_worker["units"].append({
        "round": 1, "epoch": 1, "case": 1, "frame": "r1-e1-c1.png",
        "assessment": None,
    })
    epoch_finder._save(folder, stale_render_worker)
    latest = epoch_finder._load(folder, stale_render_worker["id"])
    assert latest["units"][0]["rating"] == 4
    assert latest["units"][0]["assessment"]["text"] == "G1: 1"
    assert latest["kept"] == [2]
    assert latest["units"][1]["frame"] == "r1-e1-c1.png"


def test_live_screening_does_not_allow_rating_unrendered_images(tmp_path, monkeypatch):
    folder, campaign = _live_screening_fixture(tmp_path, monkeypatch)
    with pytest.raises(ValueError, match="does not exist"):
        epoch_finder.command(folder, "screening_rate", {
            "campaignId": campaign["id"], "round": 1, "epoch": 2, "case": 0, "rating": 5,
        })
    with pytest.raises(ValueError, match="shown in this screening round"):
        epoch_finder.command(folder, "screening_keep", {
            "campaignId": campaign["id"], "round": 2, "epoch": 1, "keep": False,
        })


def test_manual_vl_allows_live_rendered_frames_without_waiting_for_round(monkeypatch):
    campaign = {
        "id": "abcdef123456", "status": "running", "mode": "manual",
        "units": [{"round": 1, "epoch": 1, "case": 0, "frame": "r1-e1-c0.png",
                   "assessment": None, "error": ""}],
    }
    class FakeWorker:
        def start(self):
            pass
    monkeypatch.setattr(epoch_finder.threading, "Thread", lambda **_kwargs: FakeWorker())
    monkeypatch.setattr("tool.server.storyboard_llm_runtime.list_vision_models",
                        lambda: [{"id": "remote::vl"}])
    result = epoch_finder._screening_vision(None, campaign, {
        "visionModel": "remote::vl", "round": 1, "epoch": 1,
    })
    assert result == {"queued": 1}
    epoch_finder._screening_vision_workers.pop(campaign["id"], None)



def test_manual_vl_uses_frozen_wildcard_options_not_resolved_prompt():
    """A concrete per-column prompt still needs its original comparison vocabulary."""
    plan = epoch_finder._screening_plan(
        "a {red|blue|brown} glove on {table|grass}", 0,
        {"megapixels": 0.3}, 1, [16, 20])
    assert len(plan["casePrompts"]) == 3
    for index, colour in enumerate(("red", "blue", "brown")):
        groups = epoch_finder._screening_groups(plan, index)
        assert [row["id"] for row in groups] == ["G1", "G2"]
        assert groups[0]["options"] == ["red", "blue", "brown"]
        assert groups[0]["expected"] == index + 1
        assert groups[1]["expected"] == plan["caseSelections"][index][1]["selected"]
        question = epoch_finder._question(groups)
        assert "G1" in question and "G2" in question
        comparison = epoch_finder._compare("G1: " + str(index + 1), groups)
        assert comparison[0]["result"] == "match"


def test_manual_selection_remains_editable_while_rendering(monkeypatch):
    monkeypatch.setattr(epoch_finder, "_runs", lambda _folder: [{
        "jobId": "run-a", "epochs": [1, 2, 3], "stage": "h3", "modelId": "minimax_h3"}])
    monkeypatch.setattr(epoch_finder, "_save", lambda *_args, **_kwargs: None)
    campaign = {"status": "running", "mode": "manual", "modelId": "minimax_h3", "stage": "h3",
                "candidateMap": {"1": {"jobId": "run-a", "epoch": 1}},
                "kept": [1], "runSelections": []}
    result = epoch_finder._screening_selection(None, campaign, [
        {"jobId": "run-a", "epochs": [2, 3]}])
    assert result["kept"] == [2, 3]
    assert campaign["candidateMap"]["1"]["epoch"] == 1


def test_manual_review_scrolls_without_pagination_and_logs_per_card_vl_failures():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    html = (root / "tool/tool.html").read_text(encoding="utf-8")
    css = (root / "tool/css/epoch_finder.css").read_text(encoding="utf-8")
    js = (root / "tool/js/epoch_finder.js").read_text(encoding="utf-8")
    assert 'id="epoch-finder-manual-matrix"' in html
    assert 'aria-label="Scroll through epoch comparisons"' in html
    assert 'max-height: max(320px, calc(100dvh - 265px));' in css
    assert "overscroll-behavior: contain;" in css
    assert "screeningLogVisionErrors(campaign);" in js
    assert "label:'VL failed'" in js
    assert "label:'VL error'" in js
    assert "u&&u.visionError" in js
    assert "window.reportConsoleError('Manual Screening Ask VL'" in js
    assert "screeningPage" not in js


def test_only_manual_stopped_campaigns_can_resume(monkeypatch):
    campaign = {"id": "abcdef123456", "mode": "manual", "status": "stopped"}
    calls = []
    monkeypatch.setattr(epoch_finder, "status", lambda *_: campaign)
    monkeypatch.setattr(epoch_finder, "_resume_saved_work", lambda *_: calls.append("reconcile"))
    monkeypatch.setattr(epoch_finder, "_launch", lambda *_: calls.append("launch"))
    response = epoch_finder.command(None, "resume", {"campaignId": campaign["id"]})
    assert response["campaign"] is campaign
    assert calls == ["reconcile", "launch"]
    campaign["mode"] = "auto"
    with pytest.raises(ValueError):
        epoch_finder.command(None, "resume", {"campaignId": campaign["id"]})


def test_manual_keep_toggle_uses_the_picker_selection_and_native_scrolling():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    js = (root / "tool/js/epoch_finder.js").read_text(encoding="utf-8")
    css = (root / "tool/css/epoch_finder.css").read_text(encoding="utf-8")
    keep = js[js.index("keepToggle.addEventListener('click',function () {"):
              js.index("head.appendChild(keepToggle);")]
    assert "runEpochSelections[origin.jobId]" in keep
    assert "drawEpochPicker();" in keep
    assert "screeningSaveSelection();" in keep
    assert "screening_keep" not in keep  # No split persistence path for live/finished rounds.
    assert "keepToggle.setAttribute('aria-pressed',String(kept.has(epoch)))" in js
    assert "selected instanceof Set && selected.has(origin.epoch)" in js
    assert "revision!==screeningSelectionRevision" in js
    assert "content-visibility: auto;" in css
    assert "contain-intrinsic-size: auto" in css



def test_manual_round_can_queue_during_active_render_without_losing_it(tmp_path, monkeypatch):
    from types import SimpleNamespace
    folder, campaign = _live_screening_fixture(tmp_path, monkeypatch)
    plan = epoch_finder._screening_plan("a {red|blue} glove", 0, {"megapixels": 0.3}, 1, [1, 2])
    campaign.update(modelId="minimax_h3", rounds=[plan])
    epoch_finder._save(folder, campaign, preserve_manual=False)
    stale_worker = epoch_finder._load(folder, campaign["id"])
    monkeypatch.setattr(epoch_finder, "get_test_model", lambda _: SimpleNamespace(
        settings=("megapixels",), load_template=lambda: {},
        normalize_settings=lambda *_: None))
    monkeypatch.setattr(epoch_finder, "_workers", {campaign["id"]: SimpleNamespace(is_alive=lambda: True)})
    response = epoch_finder.command(folder, "screening_next_round", {
        "campaignId": campaign["id"], "prompt": "a {green|yellow} glove",
        "groupIndex": 0, "settings": {"megapixels": 0.4}})
    assert response["campaign"]["round"] == 1
    assert response["campaign"]["status"] == "running"
    assert response["campaign"]["rounds"][1]["casePrompts"] == [
        "a green glove", "a yellow glove"]
    # Old worker progress saving its own snapshot cannot erase a newly queued plan.
    stale_worker["units"].append({"round": 1, "epoch": 2, "case": 0,
                                   "frame": "r1-e2-c0.png", "assessment": None})
    epoch_finder._save(folder, stale_worker)
    saved = epoch_finder._load(folder, campaign["id"])
    assert len(saved["rounds"]) == 2
    assert saved["rounds"][1]["status"] == "queued"
    assert saved["rounds"][1]["epochs"] == [1, 2]


def test_manual_round_stop_and_cancel_are_independent(tmp_path, monkeypatch):
    import threading
    from types import SimpleNamespace
    folder, campaign = _live_screening_fixture(tmp_path, monkeypatch)
    campaign["rounds"].append({"number": 2, "epochs": [2], "seeds": [30],
                                "status": "queued"})
    epoch_finder._save(folder, campaign, preserve_manual=False)
    signal = threading.Event()
    monkeypatch.setattr(epoch_finder, "_workers", {
        campaign["id"]: SimpleNamespace(is_alive=lambda: True)})
    monkeypatch.setattr(epoch_finder, "_controls", {
        campaign["id"]: {"stop_round": signal}})
    answer = epoch_finder.command(folder, "screening_round_action", {
        "campaignId": campaign["id"], "round": 2, "action": "cancel"})
    assert answer["campaign"]["rounds"][1]["status"] == "cancelled"
    assert answer["campaign"]["status"] == "running"
    answer = epoch_finder.command(folder, "screening_round_action", {
        "campaignId": campaign["id"], "round": 1, "action": "stop"})
    assert signal.is_set()
    assert answer["campaign"]["rounds"][0]["status"] == "stopping"
    assert answer["campaign"]["rounds"][1]["status"] == "cancelled"


def test_manual_rounds_use_one_worker_and_advance_after_submission(tmp_path, monkeypatch):
    import threading
    from types import SimpleNamespace
    from tool.server import workflow_gate
    folder, campaign = _live_screening_fixture(tmp_path, monkeypatch)
    campaign.update(modelId="minimax_h3", rounds=[
        epoch_finder._screening_plan("a {red|blue} glove", 0, {"megapixels": 0.3}, 1, [1])],
        units=[], kept=[1])
    epoch_finder._save(folder, campaign, preserve_manual=False)
    monkeypatch.setattr(epoch_finder, "get_test_model", lambda _: SimpleNamespace(
        settings=("megapixels",), load_template=lambda: {},
        normalize_settings=lambda *_: None))
    monkeypatch.setattr(epoch_finder, "_workers", {
        campaign["id"]: SimpleNamespace(is_alive=lambda: True)})
    monkeypatch.setattr(epoch_finder, "_stage_epoch", lambda *_: "staged.safetensors")
    monkeypatch.setattr(epoch_finder, "_retire_scored_session", lambda *_: None)
    monkeypatch.setattr(epoch_finder, "_campaign_has_active_sessions", lambda *_: False)
    monkeypatch.setattr(epoch_finder, "_clean_staging", lambda *_: None)
    monkeypatch.setattr(workflow_gate, "wait_for_epoch", lambda *_: True)
    monkeypatch.setattr(workflow_gate, "release", lambda *_: None)
    submitted = []
    def fake_render(folder_key, worker, plan, unit, _stage, enqueue_only=False, stop_queuing=None):
        if enqueue_only:
            return
        if plan["number"] == 1 and not submitted:
            epoch_finder.command(folder_key, "screening_next_round", {
                "campaignId": worker["id"], "prompt": "a {green|yellow} glove",
                "groupIndex": 0, "settings": {"megapixels": 0.4}})
            submitted.append(True)
        unit["frame"] = "r%d-e%d-c%d.png" % (unit["round"], unit["epoch"], unit["case"])
        epoch_finder._save(folder_key, worker)
    monkeypatch.setattr(epoch_finder, "_render_unit", fake_render)
    control = {"pause": threading.Event(), "stop": threading.Event(),
               "stop_round": threading.Event()}
    epoch_finder._run(folder, campaign["id"], control)
    result = epoch_finder._load(folder, campaign["id"])
    assert len(result["rounds"]) == 2
    assert [plan["status"] for plan in result["rounds"]] == ["complete", "complete"]
    assert result["status"] == "complete"
    assert result["round"] == 2
    assert {(u["round"],u["case"]) for u in result["units"]} == {
        (1,0),(1,1),(2,0),(2,1)}


def test_manual_round_ui_supports_prompt_review_collapse_and_live_submission():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    js = (root / "tool/js/epoch_finder.js").read_text(encoding="utf-8")
    css = (root / "tool/css/epoch_finder.css").read_text(encoding="utf-8")
    assert "screening_round_action" in js
    assert "data-screening-round-action" in js
    assert "screeningExpandedExcluded" in js
    assert "epoch-screening-row.is-collapsed" in css
    assert "Submitted prompts" in js
    assert "Queue Round " in js
    assert "campaign.status!=='complete'" not in js[js.index("function screeningMatrix("):
                                                     js.index("function screeningRender(")]


def test_stopping_one_manual_round_preserves_and_runs_queued_next(tmp_path, monkeypatch):
    import threading
    from types import SimpleNamespace
    from tool.server import workflow_gate

    folder, campaign = _live_screening_fixture(tmp_path, monkeypatch)
    campaign.update(modelId="minimax_h3", rounds=[
        epoch_finder._screening_plan("a {red|blue} glove", 0, {"megapixels": 0.3}, 1, [1, 2])],
        units=[], kept=[1])
    epoch_finder._save(folder, campaign, preserve_manual=False)
    control = {"pause": threading.Event(), "stop": threading.Event(),
               "stop_round": threading.Event()}
    monkeypatch.setattr(epoch_finder, "_workers", {
        campaign["id"]: SimpleNamespace(is_alive=lambda: True)})
    monkeypatch.setattr(epoch_finder, "_controls", {campaign["id"]: control})
    monkeypatch.setattr(epoch_finder, "get_test_model", lambda _: SimpleNamespace(
        settings=("megapixels",), load_template=lambda: {},
        normalize_settings=lambda *_: None))
    monkeypatch.setattr(epoch_finder, "_stage_epoch", lambda *_: "staged.safetensors")
    monkeypatch.setattr(epoch_finder, "_retire_scored_session", lambda *_: None)
    monkeypatch.setattr(epoch_finder, "_campaign_has_active_sessions", lambda *_: False)
    monkeypatch.setattr(epoch_finder, "_clean_staging", lambda *_: None)
    monkeypatch.setattr(workflow_gate, "wait_for_epoch", lambda *_: True)
    monkeypatch.setattr(workflow_gate, "release", lambda *_: None)

    requested = []
    def fake_render(folder_key, worker, plan, unit, _stage, enqueue_only=False, stop_queuing=None):
        if enqueue_only:
            return
        if plan["number"] == 1 and not requested:
            epoch_finder.command(folder_key, "screening_next_round", {
                "campaignId": worker["id"], "prompt": "a {green|yellow} glove",
                "groupIndex": 0, "settings": {"megapixels": 0.4}})
            epoch_finder.command(folder_key, "screening_round_action", {
                "campaignId": worker["id"], "round": 1, "action": "stop"})
            requested.append(True)
        unit["frame"] = "r%d-e%d-c%d.png" % (unit["round"], unit["epoch"], unit["case"])
        epoch_finder._save(folder_key, worker)
    monkeypatch.setattr(epoch_finder, "_render_unit", fake_render)
    epoch_finder._run(folder, campaign["id"], control)
    result = epoch_finder._load(folder, campaign["id"])
    assert [p["status"] for p in result["rounds"]] == ["stopped", "complete"]
    assert result["status"] == "complete"
    assert {(u["round"], u["epoch"]) for u in result["units"]} == {(1, 1), (2, 1)}


def test_stop_queuing_cancels_only_queued_test_session(monkeypatch):
    import threading
    event = threading.Event()
    event.set()
    unit = {"round": 1, "epoch": 1, "case": 0, "session": "pending-job",
            "frame": "", "cancelled": False}
    calls = []
    monkeypatch.setattr(epoch_finder.test_bench, "open_session",
                        lambda *_args: {"status": "queued"})
    monkeypatch.setattr(epoch_finder.test_bench, "cancel_queued",
                        lambda *_args: calls.append("cancel"))
    monkeypatch.setattr(epoch_finder, "_save", lambda *_args, **_kwargs: None)
    result = epoch_finder._wait_for_session(None, {"mode": "manual"}, unit, stop_queuing=event)
    assert result is None
    assert calls == ["cancel"]
    assert unit["session"] == ""
    assert unit["cancelled"] is True
    assert not unit["frame"]


def test_stop_queuing_leaves_running_test_to_complete(monkeypatch):
    import threading
    event = threading.Event()
    event.set()
    unit = {"round": 1, "epoch": 1, "case": 0, "session": "running-job",
            "frame": ""}
    monkeypatch.setattr(epoch_finder.test_bench, "open_session",
                        lambda *_args: {"status": "complete", "results": [{"mediaFile": "finished.png"}]})
    monkeypatch.setattr(epoch_finder.test_bench, "cancel_queued",
                        lambda *_args: pytest.fail("A completed Test must never be cancelled"))
    result = epoch_finder._wait_for_session(None, {"mode": "manual"}, unit, stop_queuing=event)
    assert result["results"][0]["mediaFile"] == "finished.png"


def test_stop_queuing_never_submits_new_render(monkeypatch):
    import threading
    event = threading.Event()
    event.set()
    unit = {"round": 1, "epoch": 1, "case": 0, "session": "", "frame": ""}
    monkeypatch.setattr(epoch_finder.test_bench, "enqueue",
                        lambda *_args, **_kwargs: pytest.fail("No new Test jobs after Stop Queuing"))
    monkeypatch.setattr(epoch_finder, "_save", lambda *_args, **_kwargs: None)
    epoch_finder._render_unit(None, {}, {}, unit, "staged", enqueue_only=True, stop_queuing=event)
    assert unit["cancelled"] is True


def test_review_header_uses_frozen_run_without_restoring_form():
    from pathlib import Path
    js = (Path(__file__).resolve().parents[1] / "tool/js/epoch_finder.js").read_text(encoding="utf-8")
    remember = js[js.index("function screeningRememberSelection("):js.index("function screeningSaveSelection(")]
    assert "screeningApplySettings(campaign);" not in remember
    run_info = js[js.index("function screeningRunInfo("):js.index("function screeningUpdateAverage(")]
    matrix = js[js.index("function screeningMatrix("):js.index("function screeningRender(")]
    assert "plan.casePrompts[index]" in run_info
    assert "plan.settings" in run_info
    assert "plan.seeds[index]" in run_info
    assert "epoch-screening-case-labels" in matrix
    assert "screeningRunInfo(campaign,plan);" in matrix
    assert "stop_queuing" in (Path(__file__).resolve().parents[1] /
                              "tool/server/epoch_finder.py").read_text(encoding="utf-8")


def test_stop_queuing_keeps_active_frame_cancels_queued_case_and_skips_later_epochs(tmp_path, monkeypatch):
    import threading
    from tool.server import workflow_gate

    folder, campaign = _live_screening_fixture(tmp_path, monkeypatch)
    campaign["rounds"] = [epoch_finder._screening_plan(
        "a {red|blue} glove", 0, {"megapixels": 0.3}, 1, [1, 2])]
    campaign["modelId"] = "minimax_h3"
    campaign["dimensions"] = []
    campaign["units"] = []
    epoch_finder._save(folder, campaign, preserve_manual=False)
    frames = epoch_finder._directory(folder, campaign["id"]) / "frames"
    frames.mkdir()
    media = tmp_path / "finished.png"
    media.write_bytes(b"fake-png-bytes")
    control = {"pause": threading.Event(), "stop": threading.Event(),
               "stop_round": threading.Event()}
    submitted, cancelled = [], []

    def enqueue(*_args, **_kwargs):
        name = "unit-" + str(len(submitted) + 1)
        submitted.append(name)
        return {"job": {"id": name}}

    def inspect(_folder, name):
        if name == "unit-1":
            control["stop_round"].set()
            return {"status": "complete", "results": [{"mediaFile": "finished.png"}]}
        return {"status": "queued"}

    monkeypatch.setattr(epoch_finder.test_bench, "enqueue", enqueue)
    monkeypatch.setattr(epoch_finder.test_bench, "open_session", inspect)
    monkeypatch.setattr(epoch_finder.test_bench, "cancel_queued",
                        lambda _folder, name: cancelled.append(name))
    monkeypatch.setattr(epoch_finder.test_bench, "resolve_result_media", lambda *_args: media)
    monkeypatch.setattr(epoch_finder, "_stage_epoch", lambda *_args: "staged.safetensors")
    monkeypatch.setattr(epoch_finder, "_retire_scored_session", lambda *_args: None)
    monkeypatch.setattr(epoch_finder, "_campaign_has_active_sessions", lambda *_args: False)
    monkeypatch.setattr(epoch_finder, "_clean_staging", lambda *_args: None)
    monkeypatch.setattr(workflow_gate, "wait_for_epoch", lambda *_args: True)
    monkeypatch.setattr(workflow_gate, "release", lambda *_args: None)

    epoch_finder._run(folder, campaign["id"], control)
    result = epoch_finder._load(folder, campaign["id"])
    assert submitted == ["unit-1", "unit-2"]
    assert cancelled == ["unit-2"]
    assert result["rounds"][0]["status"] == "stopped"
    assert result["status"] == "complete"
    assert len(result["units"]) == 2
    assert result["units"][0]["frame"] == "r1-e1-c0.png"
    assert result["units"][1]["cancelled"] is True
    assert not result["units"][1]["error"]
    assert (frames / "r1-e1-c0.png").read_bytes() == b"fake-png-bytes"


def test_stop_queuing_cancels_pending_test_jobs_immediately(tmp_path, monkeypatch):
    import threading
    from types import SimpleNamespace

    folder, campaign = _live_screening_fixture(tmp_path, monkeypatch)
    campaign["units"] = [
        {"round": 1, "epoch": 1, "case": 0, "frame": "", "session": "active"},
        {"round": 1, "epoch": 1, "case": 1, "frame": "", "session": "pending"},
        {"round": 1, "epoch": 2, "case": 0, "frame": "", "session": "another-pending"},
    ]
    epoch_finder._save(folder, campaign, preserve_manual=False)
    worker_snapshot = epoch_finder._load(folder, campaign["id"])
    stopped = threading.Event()
    monkeypatch.setattr(epoch_finder, "_workers", {
        campaign["id"]: SimpleNamespace(is_alive=lambda: True)})
    monkeypatch.setattr(epoch_finder, "_controls", {
        campaign["id"]: {"stop_round": stopped}})
    monkeypatch.setattr(epoch_finder.test_bench, "open_session", lambda _folder, name: {
        "status": "running" if name == "active" else "queued"})
    cancelled = []
    monkeypatch.setattr(epoch_finder.test_bench, "cancel_queued",
                        lambda _folder, name: cancelled.append(name))

    result = epoch_finder.command(folder, "screening_round_action", {
        "campaignId": campaign["id"], "round": 1, "action": "stop"})["campaign"]
    assert stopped.is_set()
    assert cancelled == ["pending", "another-pending"]
    assert result["rounds"][0]["status"] == "stopping"
    assert result["units"][0]["session"] == "active"
    assert [u["cancelled"] for u in result["units"][1:]] == [True, True]
    # An in-flight render may save an old snapshot; it cannot bring cancelled jobs back.
    epoch_finder._save(folder, worker_snapshot)
    stored = epoch_finder._load(folder, campaign["id"])
    assert all(u["cancelled"] and not u["session"] for u in stored["units"][1:])


def test_missing_screening_test_session_needs_explicit_cancel_marker(tmp_path, monkeypatch):
    import threading
    folder, campaign = _live_screening_fixture(tmp_path, monkeypatch)
    campaign["units"] = [{"round": 1, "epoch": 1, "case": 0, "frame": "",
                          "session": "", "cancelled": True}]
    epoch_finder._save(folder, campaign, preserve_manual=False)
    stale = {"round": 1, "epoch": 1, "case": 0, "frame": "", "session": "pending"}
    monkeypatch.setattr(epoch_finder.test_bench, "open_session",
                        lambda *_: (_ for _ in ()).throw(FileNotFoundError("removed")))
    signal = threading.Event()
    signal.set()
    assert epoch_finder._wait_for_session(folder, campaign, stale, stop_queuing=signal) is None
    assert stale["cancelled"] is True
    assert stale["session"] == ""
    with pytest.raises(FileNotFoundError):
        epoch_finder._wait_for_session(folder, campaign,
            {"round": 1, "epoch": 2, "case": 0, "frame": "", "session": "missing"},
            stop_queuing=threading.Event())


def test_manual_epoch_sweep_ux_preserves_rated_card_and_run_header():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    html = (root / "tool/tool.html").read_text(encoding="utf-8")
    js = (root / "tool/js/epoch_finder.js").read_text(encoding="utf-8")
    assert 'id="epoch-finder-manual-run-info"' in html
    assert "screeningRunInfo(campaign,plan)" in js
    assert "plan.casePrompts[index]" in js
    assert "screeningUpdateAverage(previous,rated[epoch],units.filter(function(u){" in js
    assert "window.updateTestPreviewCardRating(oldCard" in js
    assert "window.updateTestPreviewCardRating(card,value)" in js
    assert "screeningSelectionFailure" in js
    assert "host.dataset.signature!==signature" in js
    assert "region.querySelectorAll('[data-epoch-choice]').forEach" in js
    # Row-wide ratings use the same per-render endpoint without changing individual controls.
    assert "screeningRateEpoch(campaign,plan.number,epoch,value)" in js
    assert "task=task.then(function(){" in js
    assert "api('screening_rate',{campaignId:id,round:round,epoch:epoch,case:unit.case,rating:rating},folder)" in js
    assert "u.round===round&&u.epoch===epoch&&u.frame&&!u.framePruned&&!u.error" in js
    assert "var mixed=values.length>0&&values.some(" in js
    assert "screeningRatingPending.delete(key)" in js
    # Copy reuses Test Generations staging; no move or queue change.
    assert "fetch('/fs/training_candidates/copy_to_test'" in js
    assert "Copy to Test" in js


def test_delete_finished_screening_round_keeps_active_round_and_frames(tmp_path, monkeypatch):
    from types import SimpleNamespace

    folder, campaign = _live_screening_fixture(tmp_path, monkeypatch)
    directory = epoch_finder._directory(folder, campaign["id"])
    frames = directory / "frames"
    frames.mkdir()
    first = frames / "r1-e1-c0.png"
    current = frames / "r2-e2-c0.png"
    first.write_bytes(b"old preview")
    current.write_bytes(b"current preview")
    campaign["round"] = 2
    campaign["status"] = "running"
    campaign["rounds"][0]["status"] = "complete"
    campaign["rounds"].append({"number": 2, "status": "running",
                                "epochs": [2], "seeds": [22]})
    campaign["units"].append({"round": 2, "epoch": 2, "case": 0,
                              "frame": current.name, "session": "", "rating": 5})
    epoch_finder._save(folder, campaign, preserve_manual=False)
    stale_worker = epoch_finder._load(folder, campaign["id"])
    monkeypatch.setattr(epoch_finder, "_workers", {
        campaign["id"]: SimpleNamespace(is_alive=lambda: True)})
    result = epoch_finder.command(folder, "screening_round_action", {
        "campaignId": campaign["id"], "round": 1, "action": "delete"})["campaign"]
    assert result["rounds"][0]["status"] == "deleted"
    assert result["rounds"][1]["status"] == "running"
    assert result["round"] == 2
    assert result["status"] == "running"
    assert result["kept"] == [1, 2]
    assert len(result["units"]) == 1 and result["units"][0]["frame"] == current.name
    assert not first.exists()
    assert current.read_bytes() == b"current preview"
    assert (directory / "campaign.json").is_file()
    # Saving an old render snapshot must not resurrect deleted round previews.
    stale_worker["units"][1]["rating"] = 4
    epoch_finder._save(folder, stale_worker)
    saved = epoch_finder._load(folder, campaign["id"])
    assert saved["rounds"][0]["status"] == "deleted"
    assert [unit["round"] for unit in saved["units"]] == [2]
    assert current.exists()


def test_delete_screening_round_rejects_active_or_queued_and_has_no_side_effects(tmp_path, monkeypatch):
    from types import SimpleNamespace

    folder, campaign = _live_screening_fixture(tmp_path, monkeypatch)
    directory = epoch_finder._directory(folder, campaign["id"])
    campaign["rounds"][0]["status"] = "running"
    campaign["round"] = 1
    campaign["rounds"].append({"number": 2, "status": "queued",
                                "epochs": [2], "seeds": [22]})
    epoch_finder._save(folder, campaign, preserve_manual=False)
    monkeypatch.setattr(epoch_finder, "_workers", {
        campaign["id"]: SimpleNamespace(is_alive=lambda: True)})
    for number in (1, 2):
        with pytest.raises(ValueError, match="Only previous finished"):
            epoch_finder.command(folder, "screening_round_action", {
                "campaignId": campaign["id"], "round": number, "action": "delete"})
    with pytest.raises(ValueError, match="worker is active"):
        epoch_finder.command(folder, "delete", {"campaignId": campaign["id"]})
    assert directory.exists()
    assert len(epoch_finder._load(folder, campaign["id"])["rounds"]) == 2


def test_delete_all_screening_rounds_rejects_pending_plans_even_without_worker(tmp_path, monkeypatch):
    folder, campaign = _live_screening_fixture(tmp_path, monkeypatch)
    campaign["status"] = "complete"
    campaign["rounds"][0]["status"] = "complete"
    campaign["rounds"].append({"number": 2, "status": "queued",
                                "epochs": [2], "seeds": [22]})
    epoch_finder._save(folder, campaign, preserve_manual=False)
    monkeypatch.setattr(epoch_finder, "_workers", {})
    with pytest.raises(ValueError, match="pending screening work"):
        epoch_finder.command(folder, "delete", {"campaignId": campaign["id"]})
    assert epoch_finder._directory(folder, campaign["id"]).exists()


def test_manual_delete_ui_separates_round_history_from_delete_all():
    from pathlib import Path
    js = (Path(__file__).resolve().parents[1] / "tool/js/epoch_finder.js").read_text(encoding="utf-8")
    assert "plan.status!=='deleted'" in js
    assert "plan.number<campaign.round" in js
    assert "Delete only this finished round" in js
    assert "'Delete all rounds'" in js
    assert "This is NOT just the selected round" in js


def test_running_screening_round_keeps_space_and_stable_dom_during_polling():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    css = (root / "tool/css/epoch_finder.css").read_text(encoding="utf-8")
    js = (root / "tool/js/epoch_finder.js").read_text(encoding="utf-8")
    action_css = css.split(".epoch-screening-round-item > .review-captions-btn {", 1)[1].split("}", 1)[0]
    assert "width:auto;" in action_css
    assert "flex:0 0 auto;" in action_css
    rounds = js.split("function screeningRoundList(campaign) {", 1)[1].split(
        "function screeningRunInfo(campaign, plan) {", 1)[0]
    assert "data-screening-round-item" in rounds
    assert "host.innerHTML" not in rounds
    assert "button.classList.toggle('active'" in rounds
    assert "host.insertBefore(entry" in rounds
    assert "existing.forEach(function(node){node.remove();});" in rounds
