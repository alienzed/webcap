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
    assert "several meaningful cuts, shots, or visual beats" in prompt
    assert "WebCap will not rewrite it" in prompt
    assert "Continuity anchors" not in prompt
    assert "integrated_multimodal_description:" not in request["response_schema"]["properties"]


def test_write_prompt_does_not_force_previous_scene_handoff():
    prompt = storyboard_llm_contract.build_request(_story(), "scene-2", "write_prompt")["prompt"]

    assert "[PREVIOUS SCENE HANDOFF]" not in prompt
    assert "Previous exit state:" not in prompt


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
    assert "[PREVIOUS SCENE - CONTEXT ONLY]" in prompt
    assert "only when it genuinely helps" in prompt
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
    assert "several meaningful shots, cuts, or distinct visual beats" in prompt
    assert "do not force every Scene to behave like a literal continuation" in prompt
    assert "Entry and exit state are optional planning notes" in prompt
    assert "WebCap will store that prompt as written" in prompt
    assert "200-400 words" not in prompt
    assert "Continuity anchors" not in prompt


def test_develop_story_auto_scene_count_leaves_count_to_director():
    story = _story()
    story["targetSceneCount"] = None

    prompt = storyboard_llm_contract.build_request(story, "", "develop_story")["prompt"]

    assert "Choose the Scene count that best fits" in prompt
    assert "Create exactly 12 Scenes." not in prompt


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
    assert "WebCap will not rebuild it" in prompt
    assert "Continuity anchors" not in prompt


def test_expand_concept_still_preserves_story_context_without_scene_planning():
    request = storyboard_llm_contract.build_request(_story(), "", "expand_concept")

    assert request["output"] == "text"
    assert "[CURRENT CONCEPT]" in request["prompt"]
    assert "[STORY VISUAL / ATMOSPHERE]" in request["prompt"]
    assert "[STORY INVARIANTS]" in request["prompt"]
    assert "Do not break the Story into Scenes yet" in request["prompt"]


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
