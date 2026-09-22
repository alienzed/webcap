import pytest

from tool.server import storyboard_llm_contract


def _story():
    return {
        "id": "story-1",
        "title": "Storm Hotel",
        "concept": "A long concept that should not be sent for a local prompt-writing operation.",
        "style": "Rain-soaked neo-noir horror, sodium-vapor highlights, restrained handheld camera.",
        "sceneOrder": ["scene-1", "scene-2", "scene-3"],
        "scenes": {
            "scene-1": {
                "id": "scene-1",
                "title": "Arrival",
                "summary": "She reaches the hotel entrance.",
                "entryState": "",
                "exitState": "She is just inside the closed front door, still holding the handle.",
                "durationSeconds": 6,
                "prompt": "OLD FIRST PROMPT",
                "takes": {"take-1": {"prompt": "TAKE DATA MUST NOT LEAK"}},
            },
            "scene-2": {
                "id": "scene-2",
                "title": "Footprints",
                "summary": "She turns from the door and notices wet footprints crossing the lobby.",
                "entryState": "",
                "exitState": "She is staring at the footprints.",
                "durationSeconds": 8,
                "prompt": "EXISTING SECOND PROMPT",
                "references": [{"role": "first_frame", "mediaPath": "references/frame.png"}],
                "takes": {"take-2": {"prompt": "OTHER TAKE DATA MUST NOT LEAK"}},
            },
            "scene-3": {
                "id": "scene-3",
                "title": "Upstairs",
                "summary": "Unrelated later scene.",
                "entryState": "She is upstairs.",
                "exitState": "",
                "durationSeconds": 8,
                "prompt": "UNRELATED SCENE PROMPT MUST NOT LEAK",
            },
        },
    }


def test_write_prompt_request_is_deliberately_local_and_manual_first():
    request = storyboard_llm_contract.build_request(_story(), "scene-2", "write_prompt")
    prompt = request["prompt"]

    assert request["operation"] == "write_prompt"
    assert request["output"] == "text"
    assert "Rain-soaked neo-noir horror" in prompt
    assert "Footprints" in prompt
    assert "notices wet footprints" in prompt
    assert "Duration seconds: 8" in prompt
    assert "first_frame exact visual anchor supplied" in prompt
    assert "Previous exit state: She is just inside the closed front door" in prompt
    assert "integrated_multimodal_description" in prompt

    assert "A long concept that should not be sent" not in prompt
    assert "UNRELATED SCENE PROMPT MUST NOT LEAK" not in prompt
    assert "OTHER TAKE DATA MUST NOT LEAK" not in prompt
    assert "EXISTING SECOND PROMPT" not in prompt


def test_explicit_entry_state_replaces_previous_scene_handoff():
    story = _story()
    story["scenes"]["scene-2"]["entryState"] = "She stands just inside the hotel entrance with the door closed behind her."

    prompt = storyboard_llm_contract.build_request(story, "scene-2", "write_prompt")["prompt"]

    assert "Entry state: She stands just inside" in prompt
    assert "[PREVIOUS SCENE HANDOFF]" not in prompt


def test_refine_prompt_includes_existing_prompt_and_only_current_correction():
    request = storyboard_llm_contract.build_request(
        _story(),
        "scene-2",
        "refine_prompt",
        "Keep the camera behind her until she notices the footprints.",
    )
    prompt = request["prompt"]

    assert "EXISTING SECOND PROMPT" in prompt
    assert "Keep the camera behind her until she notices the footprints." in prompt
    assert "smallest coherent change" in prompt
    assert "UNRELATED SCENE PROMPT MUST NOT LEAK" not in prompt
    assert "OTHER TAKE DATA MUST NOT LEAK" not in prompt


def test_write_prompt_requires_scene_intent():
    story = _story()
    story["scenes"]["scene-2"]["summary"] = ""

    with pytest.raises(ValueError, match="summary / intent"):
        storyboard_llm_contract.build_request(story, "scene-2", "write_prompt")


def test_refine_prompt_requires_prompt_and_instruction():
    story = _story()
    story["scenes"]["scene-2"]["prompt"] = ""

    with pytest.raises(ValueError, match="generation prompt"):
        storyboard_llm_contract.build_request(story, "scene-2", "refine_prompt", "Change camera.")

    story = _story()
    with pytest.raises(ValueError, match="refinement instruction"):
        storyboard_llm_contract.build_request(story, "scene-2", "refine_prompt", "")


def test_unknown_llm_operation_fails_loudly():
    with pytest.raises(ValueError, match="Unsupported"):
        storyboard_llm_contract.build_request(_story(), "scene-2", "chat")
