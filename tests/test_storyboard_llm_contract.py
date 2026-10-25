import pytest

from tool.server import storyboard_llm_contract


def _story():
    return {
        "id": "story-1",
        "title": "Storm Hotel",
        "concept": "A woman enters an empty hotel and follows wet footprints through the lobby.",
        "style": "Rain-soaked neo-noir, restrained handheld camera.",
        "invariants": [
            {"kind": "character", "title": "Mara", "text": "Mara has a dark bob and a pale raincoat."},
            {"kind": "sound", "title": "Score", "text": "Low analog synth, no vocals."},
        ],
        "targetSceneCount": 12,
        "sceneOrder": ["scene-1", "scene-2"],
        "scenes": {
            "scene-1": {
                "id": "scene-1",
                "title": "Arrival",
                "summary": "She reaches the hotel entrance.",
                "entryState": "",
                "exitState": "She is just inside the closed front door.",
                "durationSeconds": 10,
                "prompt": "OLD FIRST PROMPT",
            },
            "scene-2": {
                "id": "scene-2",
                "title": "Footprints",
                "summary": "She notices wet footprints crossing the lobby.",
                "entryState": "",
                "exitState": "",
                "durationSeconds": 12,
                "prompt": "EXISTING SECOND PROMPT",
                "references": [{"role": "first_frame", "mediaPath": "references/frame.png"}],
            },
        },
    }


def test_write_prompt_gives_director_context_without_postprocessing_contract():
    request = storyboard_llm_contract.build_request(_story(), "scene-2", "write_prompt")
    prompt = request["prompt"]

    assert request["operation"] == "write_prompt"
    assert request["output"] == "json"
    assert request["response_schema"]["required"] == ["prompt"]
    assert "result_renderer" not in request
    assert "[DIRECTOR CONTEXT]" in prompt
    assert "[STORY CONCEPT / OVERVIEW]" in prompt
    assert "[STORY INVARIANTS]" in prompt
    assert "Mara has a dark bob" in prompt
    assert "[REFERENCE MODE]\nI2VA" in prompt
    assert "State persistent identities and starting conditions once." in prompt
    assert "Treat the supplied Story concept, Visual / Atmosphere, populated Directing Guidelines" in prompt
    assert "--- BEGIN EXAMPLE PROMPT SHAPE ---" in prompt
    assert "Environment / Continuity Anchors:" in prompt
    assert "integrated_multimodal_description:" in prompt
    assert "overall_soundscape:" in prompt
    assert "non_diegetic_music:" in prompt
    assert "exactly as it should be used" in prompt
    assert "integrated_multimodal_description:" not in request["response_schema"]["properties"]


def test_write_prompt_does_not_force_previous_scene_handoff():
    prompt = storyboard_llm_contract.build_request(_story(), "scene-2", "write_prompt")["prompt"]

    assert "[PREVIOUS SCENE HANDOFF]" not in prompt
    assert "Previous exit state:" not in prompt


def test_h3_guidance_uses_one_fenced_authoring_example_without_schema_enforcement():
    request = storyboard_llm_contract.build_request(_story(), "scene-2", "write_prompt")
    prompt = request["prompt"]
    schema = request["response_schema"]

    assert prompt.count("--- BEGIN EXAMPLE PROMPT SHAPE ---") == 1
    assert prompt.count("--- END EXAMPLE PROMPT SHAPE ---") == 1
    assert "[Shot 2] (Xs–Ys)" in prompt
    assert "[Shot 3]" not in prompt
    assert "Timed shots describe actions" in prompt
    assert "Observable action and audiovisual events occurring in this interval." in prompt
    assert schema["required"] == ["prompt"]
    assert set(schema["properties"]) == {"prompt"}


def test_refine_prompt_preserves_existing_prompt_and_keeps_scene_fields_optional():
    request = storyboard_llm_contract.build_request(
        _story(),
        "scene-2",
        "refine_prompt",
        "Keep the camera behind her until she notices the footprints.",
    )
    prompt = request["prompt"]
    schema = request["response_schema"]

    assert "EXISTING SECOND PROMPT" in prompt
    assert "[PREVIOUS SCENE" not in prompt
    assert "OLD FIRST PROMPT" not in prompt
    assert "[STORY CONCEPT / OVERVIEW]" not in prompt
    assert "full MiniMax H3 prompt" not in prompt
    assert "Make the smallest necessary edit" in prompt
    assert "Keep the camera behind her" in prompt
    assert schema["required"] == ["changed", "prompt"]
    assert {"summary", "entryState", "exitState", "durationSeconds"}.issubset(schema["properties"])
    assert "summary" not in schema["required"]
    assert "entryState" not in schema["required"]
    assert "exitState" not in schema["required"]
    assert schema["properties"]["durationSeconds"]["minimum"] == 6
    assert schema["properties"]["durationSeconds"]["maximum"] == 15
    assert "result_renderer" not in request


def test_h3_mode_is_derived_from_reference_roles():
    story = _story()
    scene = story["scenes"]["scene-2"]

    scene["references"] = []
    assert "[REFERENCE MODE]\nT2VA" in storyboard_llm_contract.build_request(
        story, "scene-2", "write_prompt"
    )["prompt"]

    scene["references"] = [{"role": "last_frame"}]
    assert "[REFERENCE MODE]\nL2VA" in storyboard_llm_contract.build_request(
        story, "scene-2", "write_prompt"
    )["prompt"]

    scene["references"] = [{"role": "first_frame"}, {"role": "last_frame"}]
    assert "[REFERENCE MODE]\nFL2VA" in storyboard_llm_contract.build_request(
        story, "scene-2", "write_prompt"
    )["prompt"]


def test_develop_story_uses_simple_scene_schema_and_dense_scene_guidance():
    request = storyboard_llm_contract.build_request(_story(), "", "develop_story")
    prompt = request["prompt"]
    scene_schema = request["response_schema"]["properties"]["scenes"]["items"]

    assert request["response_schema"]["required"] == ["scenes"]
    assert set(scene_schema["required"]) == {"title", "summary", "prompt", "suggestedDurationSeconds"}
    assert scene_schema["properties"]["prompt"]["type"] == "string"
    assert "entryState" in scene_schema["properties"]
    assert "exitState" in scene_schema["properties"]
    assert "entryState" not in scene_schema["required"]
    assert "exitState" not in scene_schema["required"]
    assert "continuity" not in scene_schema["properties"]
    assert "invariantRefs" not in scene_schema["properties"]
    assert "sharedContextRefs" not in scene_schema["properties"]
    assert "Create exactly 12 Scenes." in prompt
    assert "GENERATION UNIT." in prompt
    assert "at most 15 seconds." in prompt
    assert "Use the supplied concept, Directing Guidelines" in prompt
    assert "when continuity matters" not in prompt
    assert "Use evolving state between connected Scenes" not in prompt
    assert "exactly as it should be used" in prompt
    assert "200-400 words" not in prompt
    assert "--- BEGIN EXAMPLE PROMPT SHAPE ---" in prompt
    assert "Environment / Continuity Anchors:" in prompt


def test_develop_story_auto_scene_count_leaves_count_to_director():
    story = _story()
    story["targetSceneCount"] = None

    prompt = storyboard_llm_contract.build_request(story, "", "develop_story")["prompt"]

    assert "Choose the Scene count that best serves the concept" in prompt
    assert "Create exactly 12 Scenes." not in prompt



def test_insert_scene_uses_adjacent_scene_facts_not_prompt_templates():
    request = storyboard_llm_contract.build_request(_story(), "scene-1", "insert_scene")
    prompt = request["prompt"]
    schema = request["response_schema"]

    assert request["operation"] == "insert_scene"
    assert schema["required"] == ["scene"]
    scene_schema = schema["properties"]["scene"]
    assert set(scene_schema["required"]) == {"title", "summary", "prompt", "suggestedDurationSeconds"}
    assert "[SCENE BEFORE - PLACEMENT CONTEXT]" in prompt
    assert "[SCENE AFTER - PLACEMENT CONTEXT]" in prompt
    assert "[STORY CONCEPT]" in prompt
    assert "[EXISTING SCENE OUTLINE]" in prompt
    assert "OLD FIRST PROMPT" not in prompt
    assert "EXISTING SECOND PROMPT" not in prompt
    assert "Use neighbouring Scene descriptions as placement context" in prompt
    assert "GENERATION UNIT." in prompt


def test_insert_scene_can_append_after_last_scene():
    request = storyboard_llm_contract.build_request(_story(), "scene-2", "insert_scene")
    assert "[SCENE AFTER - PLACEMENT CONTEXT]" not in request["prompt"]
    assert "at the end of the Story" in request["prompt"]


def test_insert_custom_scene_direction_drives_without_story_or_other_prompts():
    story = _story()
    instruction = "Introduce a new employee doing a completely different task."
    request = storyboard_llm_contract.build_request(
        story, "scene-1", "insert_scene", instruction=instruction
    )
    prompt = request["prompt"]
    assert prompt.startswith("[USER DIRECTION - PRIMARY CREATIVE BRIEF]\n" + instruction)
    assert "[STORY CONCEPT]" not in prompt
    assert "A woman enters an empty hotel" not in prompt
    assert "[EXISTING SCENE OUTLINE]" not in prompt
    assert "OLD FIRST PROMPT" not in prompt
    assert "EXISTING SECOND PROMPT" not in prompt
    assert "She is just inside the closed front door." in prompt
    assert "[STORY VISUAL / ATMOSPHERE - CONSTRAINT]" in prompt
    assert "[STORY INVARIANTS - CONSTRAINTS]" in prompt


def test_extend_story_preserves_distinction_from_redevelopment():
    request = storyboard_llm_contract.build_request(
        _story(), "", "extend_story", instruction="Different cubicle vignettes.", scene_count=3
    )
    assert request["operation"] == "extend_story"
    assert "Append exactly 3 new Scenes" in request["prompt"]
    assert "[EXISTING SCENE OUTLINE]" in request["prompt"]
    assert "[LAST SCENE GENERATION PROMPT]" not in request["prompt"]
    assert "OLD FIRST PROMPT" not in request["prompt"]
    assert "EXISTING SECOND PROMPT" not in request["prompt"]
    assert "[LAST SCENE EXIT STATE]" not in request["prompt"]
    assert "Use the supplied concept, Directing Guidelines" in request["prompt"]
    assert "[USER DIRECTION]\nDifferent cubicle vignettes." in request["prompt"]
    assert "new Scenes as JSON" in request["prompt"]


def test_extend_story_rejects_invalid_scene_count():
    with pytest.raises(ValueError, match="positive integer"):
        storyboard_llm_contract.build_request(_story(), "", "extend_story", scene_count=0)

def test_repair_scenes_is_sparse_and_prompt_is_complete_string():
    request = storyboard_llm_contract.build_request(
        _story(),
        "",
        "repair_scenes",
        "Use perspective appropriate to each beat.",
    )
    prompt = request["prompt"]
    fields = request["response_schema"]["properties"]["changes"]["items"]["properties"]["fields"]

    assert set(fields["properties"]) == {"summary", "entryState", "exitState", "prompt"}
    assert fields["properties"]["prompt"]["type"] == "string"
    assert "complete revised H3 prompt string" in prompt
    assert "following the supplied Director and H3 guidance" in prompt
    assert "--- BEGIN EXAMPLE PROMPT SHAPE ---" in prompt
    assert "Environment / Continuity Anchors:" in prompt


def test_expand_concept_still_preserves_story_context_without_scene_planning():
    request = storyboard_llm_contract.build_request(_story(), "", "expand_concept")

    assert request["output"] == "text"
    assert "[CURRENT CONCEPT]" in request["prompt"]
    assert "[STORY VISUAL / ATMOSPHERE]" in request["prompt"]
    assert "[STORY INVARIANTS]" in request["prompt"]
    assert "Expand the author\'s concept into a useful creative overview" in request["prompt"]
    assert "Preserve established Story facts" in request["prompt"]
    assert "variation-based" not in request["prompt"]


def test_define_invariants_remains_context_generation_not_scene_authoring():
    request = storyboard_llm_contract.build_request(_story(), "", "define_invariants")

    assert request["output"] == "json"
    assert request["response_schema"]["required"] == ["invariants"]
    assert "Define stable visual identities for recurring characters and locations" in request["prompt"]


def test_write_prompt_requires_scene_intent():
    story = _story()
    story["scenes"]["scene-2"]["summary"] = ""

    with pytest.raises(ValueError, match="summary / intent"):
        storyboard_llm_contract.build_request(story, "scene-2", "write_prompt")


def test_refine_prompt_requires_prompt_and_instruction():
    story = _story()
    story["scenes"]["scene-2"]["prompt"] = ""

    with pytest.raises(ValueError, match="generation prompt"):
        storyboard_llm_contract.build_request(
            story, "scene-2", "refine_prompt", "Change camera."
        )

    with pytest.raises(ValueError, match="refinement instruction"):
        storyboard_llm_contract.build_request(_story(), "scene-2", "refine_prompt", "")


def test_develop_story_requires_concept():
    story = _story()
    story["concept"] = ""

    with pytest.raises(ValueError, match="concept / overview"):
        storyboard_llm_contract.build_request(story, "", "develop_story")


def test_unknown_llm_operation_fails_loudly():
    with pytest.raises(ValueError, match="Unsupported"):
        storyboard_llm_contract.build_request(_story(), "scene-2", "chat")



def test_individual_development_outline_keeps_story_context_and_defers_prompts():
    story = _story()
    request = storyboard_llm_contract.build_request(
        story,
        "",
        "develop_story_outline",
    )
    prompt = request["prompt"]
    scene_schema = request["response_schema"]["properties"]["scenes"]["items"]

    assert request["operation"] == "develop_story_outline"
    assert request["output"] == "json"
    assert request["response_schema"]["properties"]["scenes"]["minItems"] == 12
    assert request["response_schema"]["properties"]["scenes"]["maxItems"] == 12
    assert set(scene_schema["required"]) == {"title", "summary", "suggestedDurationSeconds"}
    assert "prompt" not in scene_schema["properties"]
    assert "[STORY CONCEPT]" in prompt
    assert "[STORY VISUAL / ATMOSPHERE]" in prompt
    assert "[STORY INVARIANTS]" in prompt
    assert "without writing generation prompts yet" in prompt
    assert "This outline will be used to author each full H3 Scene separately" in prompt


def test_individual_development_scene_uses_whole_outline_and_previous_authored_scene():
    story = _story()
    outline = {
        "scenes": [
            {
                "title": "Arrival",
                "summary": "She reaches the station.",
                "entryState": "",
                "exitState": "She sees the platform.",
                "suggestedDurationSeconds": 10,
            },
            {
                "title": "Platform",
                "summary": "She crosses the empty platform.",
                "entryState": "She sees the platform.",
                "exitState": "A train appears.",
                "suggestedDurationSeconds": 10,
            },
        ]
    }
    previous = {
        "title": "Arrival",
        "summary": "She reaches the station.",
        "entryState": "",
        "exitState": "She sees the platform.",
        "prompt": "PREVIOUS FULL H3 PROMPT",
        "suggestedDurationSeconds": 10,
    }

    request = storyboard_llm_contract.build_request(
        story,
        "",
        "develop_story_scene",
        development={
            "outline": outline,
            "sceneIndex": 1,
            "previousScene": previous,
        },
    )
    prompt = request["prompt"]
    scene_schema = request["response_schema"]["properties"]["scene"]

    assert request["operation"] == "develop_story_scene"
    assert request["output"] == "json"
    assert set(scene_schema["required"]) == {"title", "summary", "prompt", "suggestedDurationSeconds"}
    assert "[STORY CONCEPT / OVERVIEW]" in prompt
    assert "[STORY VISUAL / ATMOSPHERE]" in prompt
    assert "[STORY INVARIANTS]" in prompt
    assert "[COMPLETE SCENE OUTLINE]" in prompt
    assert "[CURRENT PLANNED SCENE]" in prompt
    assert "[PREVIOUS AUTHORED SCENE - RELATIONSHIP CONTEXT]" in prompt
    assert "She reaches the station." in prompt
    assert "PREVIOUS FULL H3 PROMPT" not in prompt
    assert "Scene 2 of 2" in prompt
    assert "Author exactly this one planned Scene" in prompt


def test_director_guidance_resolves_cross_scene_references_without_changing_h3_structure():
    request = storyboard_llm_contract.build_request(_story(), "", "develop_story")
    prompt = request["prompt"]
    assert "Describe the current Scene with concrete audiovisual facts" in prompt
    assert "Preserve established identities, objects, environments" in prompt
    assert "--- BEGIN EXAMPLE PROMPT SHAPE ---" in prompt
    assert "Environment / Continuity Anchors:" in prompt
    assert "integrated_multimodal_description:" in prompt
    assert "State persistent identities and starting conditions once" in prompt
    assert "invariants" in prompt


def test_refine_scene_is_isolated_unless_continuity_explicitly_requested():
    story = _story()
    instruction = "Add a smile at the end."
    isolated = storyboard_llm_contract.build_request(
        story, "scene-2", "refine_prompt", instruction
    )["prompt"]
    assert "EXISTING SECOND PROMPT" in isolated
    assert "OLD FIRST PROMPT" not in isolated
    assert "[PREVIOUS SCENE" not in isolated
    assert "A woman enters an empty hotel" not in isolated
    assert "[H3 GUIDANCE]" not in isolated
    assert "Preserve all authored material outside the requested scope." in isolated
    continuity = storyboard_llm_contract.build_request(
        story, "scene-2", "refine_prompt", instruction, continuity_context=True
    )["prompt"]
    assert "[PREVIOUS SCENE - CONTINUITY FACTS ONLY]" in continuity
    assert "She reaches the hotel entrance." in continuity
    assert "She is just inside the closed front door." in continuity
    assert "OLD FIRST PROMPT" not in continuity


def test_individual_scene_development_still_uses_previous_authored_scene_when_intended():
    story = _story()
    outline = {"scenes": [
        {"title": "Arrival", "summary": "Mara arrives.", "suggestedDurationSeconds": 10},
        {"title": "Footprints", "summary": "Mara notices prints.", "suggestedDurationSeconds": 12},
    ]}
    prompt = storyboard_llm_contract.build_request(story, "", "develop_story_scene", development={
        "outline": outline, "sceneIndex": 1,
        "previousScene": {"title": "Arrival", "prompt": "PREVIOUS FULL H3 PROMPT"},
    })["prompt"]
    assert "PREVIOUS FULL H3 PROMPT" not in prompt
    assert '"suggestedDurationSeconds": 12' in prompt


def test_check_coherence_sees_author_guidance_without_other_scene_prompts():
    story = _story()
    prompt = storyboard_llm_contract.build_request(story, "scene-2", "check_coherence")
    text = prompt["prompt"]
    assert "Review the H3 prompt for concrete audiovisual contradictions" in text
    assert "Preserve the author\'s subject" in text
    assert "STORY CONCEPT" not in text
    assert "STORY INVARIANTS" in text
    assert "PREVIOUS SCENE" not in text
    assert "OLD FIRST PROMPT" not in text
    assert "EXISTING SECOND PROMPT" in text
    assert prompt["response_schema"]["required"] == ["prompt"]


def test_model_guidance_only_for_h3_authoring(monkeypatch):
    from tool.server import config as app_config
    monkeypatch.setitem(app_config.config, "generation_model_guidance", {"minimax_h3": "Prefer simple staging."})
    story = _story()
    for operation in ("develop_story", "develop_story_outline", "repair_scenes"):
        instruction = "Adjust staging." if operation == "repair_scenes" else ""
        prompt = storyboard_llm_contract.build_request(story, "", operation, instruction)["prompt"]
        assert prompt.count("Prefer simple staging.") == 1
    for operation in ("insert_scene", "extend_story"):
        prompt = storyboard_llm_contract.build_request(story, "scene-1", operation)["prompt"]
        assert prompt.count("Prefer simple staging.") == 1
    for operation in ("write_prompt", "refine_prompt"):
        prompt = storyboard_llm_contract.build_request(story, "scene-2", operation, "Adjust staging.")["prompt"]
        assert prompt.count("Prefer simple staging.") == 1
    assert "Prefer simple staging." not in storyboard_llm_contract.build_request(story, "scene-2", "check_coherence")["prompt"]



def test_extend_story_uses_only_last_exit_state_as_continuity_handoff():
    story = _story()
    story["scenes"]["scene-2"]["exitState"] = "Mara reaches the locked lift."
    prompt = storyboard_llm_contract.build_request(story, "", "extend_story", scene_count=2)["prompt"]
    assert "[LAST SCENE EXIT STATE]\nMara reaches the locked lift." in prompt
    assert "EXISTING SECOND PROMPT" not in prompt


def test_optional_story_guidelines_in_creative_operations_not_narrow_refinement():
    story = _story()
    story["guidelines"] = {
        "visualFocus": "Athletic movement and compelling visual actions.",
        "variation": "Vary choreography while preserving the shared format.",
        "pacing": "Quick setups and energetic action.",
    }
    for operation in ("develop_story", "develop_story_outline", "expand_concept", "write_prompt", "repair_scenes"):
        request = storyboard_llm_contract.build_request(
            story, "scene-2", operation, instruction="Improve shot movement."
        )
        assert "Athletic movement and compelling visual actions." in request["prompt"], operation
        assert "Vary choreography while preserving the shared format." in request["prompt"], operation
    narrow = storyboard_llm_contract.build_request(
        story, "scene-2", "refine_prompt", instruction="Change the last smile."
    )
    assert "Vary choreography while preserving the shared format." not in narrow["prompt"]


def test_empty_guidelines_do_not_inject_default_narrative_or_variation_rules():
    story = _story()
    story["guidelines"] = {}
    for operation in ("develop_story", "develop_story_outline", "expand_concept", "extend_story"):
        request = storyboard_llm_contract.build_request(story, "", operation, scene_count=2)
        prompt = request["prompt"]
        assert "[STORY DIRECTING GUIDELINES - AUTHOR INTENT]" not in prompt
        assert "A new Scene may progress" not in prompt
        assert "For connected material" not in prompt
        assert "Variation / repetition:" not in prompt


def test_explicit_continuity_refinement_receives_story_guidelines():
    story = _story()
    story["guidelines"] = {"sceneRelationships": "Independent vignettes; share only the location."}
    narrow = storyboard_llm_contract.build_request(
        story, "scene-2", "refine_prompt", instruction="Adjust one movement."
    )["prompt"]
    assert "Independent vignettes" not in narrow
    contextual = storyboard_llm_contract.build_request(
        story, "scene-2", "refine_prompt",
        instruction="Review continuity.", continuity_context=True
    )["prompt"]
    assert "Independent vignettes; share only the location." in contextual


def test_coherence_preserves_populated_author_variation_guidance():
    story = _story()
    story["guidelines"] = {"variation": "Repeat the exact pose as a deliberate motif."}
    text = storyboard_llm_contract.build_request(story, "scene-2", "check_coherence")["prompt"]
    assert "Repeat the exact pose as a deliberate motif." in text
    assert "Consolidate repeated descriptions." not in text
