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
    assert "Establish stable and current facts at scene level" in prompt
    assert "Let the concept determine the structure" in prompt
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
    assert "[Shot 3] ... and additional shots as appropriate for the Scene." in prompt
    assert "shots inherit that setup" in prompt
    assert "what occurs at particular times" in prompt
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
    assert "[PREVIOUS SCENE - RELATIONSHIP CONTEXT]" in prompt
    assert "judge the appropriate relationship and distinctness" in prompt
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
    assert "USE EACH GENERATION UNIT WELL." in prompt
    assert "Simplify or abstract elements when added specificity creates more drift than value." in prompt
    assert "Choose the relationship that best serves the concept" in prompt
    assert "evolving state when continuity matters" in prompt
    assert "When Scenes are connected" in prompt
    assert "Use entry and exit state only when a specific handoff or visible state is genuinely useful" in prompt
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



def test_insert_scene_uses_adjacent_scenes_as_relationship_context_not_bridge_requirement():
    request = storyboard_llm_contract.build_request(_story(), "scene-1", "insert_scene")
    prompt = request["prompt"]
    schema = request["response_schema"]

    assert request["operation"] == "insert_scene"
    assert schema["required"] == ["scene"]
    scene_schema = schema["properties"]["scene"]
    assert set(scene_schema["required"]) == {"title", "summary", "prompt", "suggestedDurationSeconds"}
    assert "[SCENE BEFORE]" in prompt
    assert "[SCENE AFTER]" in prompt
    assert "Treat neighbouring Scenes as relationship and contrast context, not templates to copy" in prompt
    assert "contrast, vary a repeated format with fresh content, jump, or remain independent" in prompt
    assert "meaningfully distinct from both adjacent Scenes" in prompt
    assert "USE EACH GENERATION UNIT WELL." in prompt


def test_insert_scene_can_append_after_last_scene():
    request = storyboard_llm_contract.build_request(_story(), "scene-2", "insert_scene")
    assert "[SCENE AFTER]" not in request["prompt"]
    assert "at the end of the Story" in request["prompt"]


def test_insert_scene_can_use_optional_direction():
    request = storyboard_llm_contract.build_request(
        _story(), "scene-1", "insert_scene", instruction="Introduce a new employee."
    )
    assert "[USER DIRECTION]\\nIntroduce a new employee." in request["prompt"]


def test_extend_story_preserves_distinction_from_redevelopment():
    request = storyboard_llm_contract.build_request(
        _story(), "", "extend_story", instruction="Different cubicle vignettes.", scene_count=3
    )
    assert request["operation"] == "extend_story"
    assert "Append exactly 3 new Scenes" in request["prompt"]
    assert "[EXISTING SCENE OUTLINE]" in request["prompt"]
    assert "[USER DIRECTION]\\nDifferent cubicle vignettes." in request["prompt"]
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
    assert "Do not break the concept into Scenes yet" in request["prompt"]
    assert "rather than assuming a narrative arc" in request["prompt"]
    assert "variation-based" in request["prompt"]


def test_define_invariants_remains_context_generation_not_scene_authoring():
    request = storyboard_llm_contract.build_request(_story(), "", "define_invariants")

    assert request["output"] == "json"
    assert request["response_schema"]["required"] == ["invariants"]
    assert "Do not plan Scenes" in request["prompt"]


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
    assert "PREVIOUS FULL H3 PROMPT" in prompt
    assert "Scene 2 of 2" in prompt
    assert "Author exactly this one planned Scene" in prompt


def test_director_guidance_resolves_cross_scene_references_without_changing_h3_structure():
    request = storyboard_llm_contract.build_request(_story(), "", "develop_story")
    prompt = request["prompt"]
    assert "Resolve references to other Scenes into concrete current visual facts" in prompt
    assert "Comparisons between subjects visible within this Scene remain useful" in prompt
    assert "Do not invent unsupported detail" in prompt
    assert "--- BEGIN EXAMPLE PROMPT SHAPE ---" in prompt
    assert "Environment / Continuity Anchors:" in prompt
    assert "integrated_multimodal_description:" in prompt
    assert "without restating unchanged facts" in prompt
    assert "Treat invariants as authoritative facts" in prompt


def test_existing_relationship_context_remains_available():
    story = _story()
    assert "OLD FIRST PROMPT" in storyboard_llm_contract.build_request(
        story, "scene-2", "refine_prompt", "Adjust the action."
    )["prompt"]
    assert "OLD FIRST PROMPT" in storyboard_llm_contract.build_request(
        story, "scene-1", "insert_scene"
    )["prompt"]
    outline = {"scenes": [
        {"title": "Arrival", "summary": "Mara arrives.", "suggestedDurationSeconds": 10},
        {"title": "Footprints", "summary": "Mara notices prints.", "suggestedDurationSeconds": 12},
    ]}
    prompt = storyboard_llm_contract.build_request(story, "", "develop_story_scene", development={
        "outline": outline, "sceneIndex": 1,
        "previousScene": {"title": "Arrival", "prompt": "PREVIOUS FULL H3 PROMPT"},
    })["prompt"]
    assert "PREVIOUS FULL H3 PROMPT" in prompt
    assert '"suggestedDurationSeconds": 12' in prompt


def test_check_coherence_only_sees_existing_prompt():
    story = _story()
    prompt = storyboard_llm_contract.build_request(story, "scene-2", "check_coherence")
    text = prompt["prompt"]
    assert "Review this H3 text-to-video prompt for coherence." in text
    assert "Favor details that can be conveyed visually or audibly." in text
    assert "Consolidate repeated descriptions." in text
    assert "original unchanged if no meaningful improvement is needed" in text
    assert "STORY CONCEPT" not in text
    assert "STORY INVARIANTS" not in text
    assert "PREVIOUS SCENE" not in text
    assert "OLD FIRST PROMPT" not in text
    assert "EXISTING SECOND PROMPT" in text
    assert prompt["response_schema"]["required"] == ["prompt"]
