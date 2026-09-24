import pytest

from tool.server import storyboard_llm_contract


def _story():
    return {
        "id": "story-1",
        "title": "Storm Hotel",
        "concept": "A long concept that should not be sent for a local prompt-writing operation.",
        "style": "Rain-soaked neo-noir horror, sodium-vapor highlights, restrained handheld camera.",
        "invariants": [
            {"kind": "character", "title": "Mara", "text": "Mara has a dark bob, pale raincoat, and a guarded demeanor."},
            {"kind": "sound", "title": "Score", "text": "Low analog synth, no vocals."},
        ],
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
    assert request["output"] == "json"
    assert "Rain-soaked neo-noir horror" in prompt
    assert "[STORY INVARIANTS]" in prompt
    assert "Character: Mara" in prompt
    assert "dark bob, pale raincoat" in prompt
    assert "Sound: Score" in prompt
    assert "Low analog synth, no vocals." in prompt
    assert "Footprints" in prompt
    assert "notices wet footprints" in prompt
    assert "Duration seconds: 8" in prompt
    assert "first_frame exact visual anchor supplied" in prompt
    assert "Previous exit state: She is just inside the closed front door" in prompt
    assert "integrated_multimodal_description" in prompt
    assert "[H3 MODE]\nI2VA" in prompt
    assert "at 0.00 seconds into the target video" in prompt
    assert request["response_schema"]["required"] == [
        "integrated_multimodal_description",
        "overall_soundscape",
        "non_diegetic_music",
    ]
    assert request["result_renderer"] == {
        "type": "h3_base",
        "mode": "I2VA",
        "duration": 8,
        "shared_context": "",
    }

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


def test_h3_mode_is_derived_from_reference_roles():
    story = _story()
    scene = story["scenes"]["scene-2"]

    scene["references"] = []
    prompt = storyboard_llm_contract.build_request(story, "scene-2", "write_prompt")["prompt"]
    assert "[H3 MODE]\nT2VA" in prompt
    assert "How the reference pictures align" not in prompt
    assert "at 0.00 seconds into the target video" not in prompt

    scene["references"] = [{"role": "last_frame"}]
    prompt = storyboard_llm_contract.build_request(story, "scene-2", "write_prompt")["prompt"]
    assert "[H3 MODE]\nL2VA" in prompt
    assert "aligns with the 8.00-second mark" in prompt

    scene["references"] = [{"role": "first_frame"}, {"role": "last_frame"}]
    prompt = storyboard_llm_contract.build_request(story, "scene-2", "write_prompt")["prompt"]
    assert "[H3 MODE]\nFL2VA" in prompt
    assert "0.00-second mark" in prompt
    assert "8.00-second mark" in prompt


def test_runtime_request_uses_compact_h3_context_not_full_guidance():
    prompt = storyboard_llm_contract.build_request(_story(), "scene-2", "write_prompt")["prompt"]

    assert "MINIMAX H3 STORYBOARD WRITING RULES" in prompt
    assert "Full-reference / Ref2VA" not in prompt
    assert "Official source of truth" not in prompt


def test_develop_story_uses_full_concept_and_structured_scene_plan():
    story = _story()
    request = storyboard_llm_contract.build_request(story, "", "develop_story")
    prompt = request["prompt"]

    assert request["operation"] == "develop_story"
    assert request["output"] == "json"
    assert request["response_schema"]["required"] == ["sharedContext", "scenes"]
    assert set(request["response_schema"]["properties"]["sharedContext"]["required"]) == {
        "subjects", "wardrobes", "locations", "persistentFacts"
    }
    assert "minItems" not in request["response_schema"]["properties"]["scenes"]
    assert "maxItems" not in request["response_schema"]["properties"]["scenes"]
    scene_schema = request["response_schema"]["properties"]["scenes"]["items"]
    assert "sharedContextRefs" in scene_schema["required"]
    prompt_schema = scene_schema["properties"]["prompt"]
    assert prompt_schema["type"] == "object"
    assert prompt_schema["required"] == [
        "integrated_multimodal_description",
        "overall_soundscape",
        "non_diegetic_music",
    ]
    assert "A long concept that should not be sent for a local prompt-writing operation." in prompt
    assert "Rain-soaked neo-noir horror" in prompt
    assert "[STORY INVARIANTS]" in prompt
    assert "Character: Mara" in prompt
    assert "Low analog synth, no vocals." in prompt
    assert "complete structured H3 content for every Scene now" in prompt
    assert "establish sharedContext for recurring subjects, wardrobe states, locations" in prompt
    assert "Reuse the same sharedContext IDs in every Scene where they still apply" in prompt
    assert "WebCap will inject the referenced descriptions into the final H3 prompt mechanically" in prompt
    assert "Produce exactly 12 Scenes" in prompt
    assert "4 to 8 Scenes" not in prompt
    assert "at least two Scenes" not in prompt
    assert "between 4 and 15 seconds" in prompt
    assert "invent natural dialogue" in prompt
    assert "EXISTING SECOND PROMPT" not in prompt


def test_develop_story_requires_concept():
    story = _story()
    story["concept"] = ""
    with pytest.raises(ValueError, match="concept / overview"):
        storyboard_llm_contract.build_request(story, "", "develop_story")


def test_expand_concept_is_creative_but_not_scene_planning():
    story = _story()
    story["concept"] = "Rise and fall of a New York gangster."

    request = storyboard_llm_contract.build_request(story, "", "expand_concept")
    prompt = request["prompt"]

    assert request["operation"] == "expand_concept"
    assert request["output"] == "text"
    assert "Rise and fall of a New York gangster." in prompt
    assert "Develop the narrative arc" in prompt
    assert "do not break the Story into Scenes yet" in prompt
    assert "do not write MiniMax H3 prompts" in prompt


def test_develop_story_h3_rules_do_not_conflict_with_structured_creative_task():
    request = storyboard_llm_contract.build_request(_story(), "", "develop_story")
    prompt = request["prompt"]

    assert "current Director task explicitly permits inventing it" in prompt
    assert "structured whole-Story tasks" in prompt
    assert "Return only the final H3 model-facing prompt." not in prompt


def test_character_continuity_is_authoritative_without_lora_or_media_reasoning():
    prompt = storyboard_llm_contract.build_request(_story(), "", "develop_story")["prompt"]

    assert prompt.count("RECURRING CHARACTERS STAY THE SAME PEOPLE.") == 1
    assert "Preserve established identity across independent Scenes." in prompt
    assert "ethnicity/heritage" not in prompt
    assert "no LoRA" not in prompt
    assert "LoRA or exact" not in prompt


def test_scene_local_prompt_reuses_developed_shared_continuity():
    story = _story()
    story["development"] = {
        "plan": {
            "sharedContext": {
                "subjects": [{"id": "mara", "label": "Mara", "description": "Mara has a dark bob."}],
                "wardrobes": [{"id": "coat", "label": "Wardrobe", "description": "Mara wears a pale raincoat."}],
                "locations": [{"id": "lobby", "label": "Lobby", "description": "Dark terrazzo lobby with brass fixtures."}],
                "persistentFacts": [],
            }
        }
    }
    story["scenes"]["scene-2"]["sharedContextRefs"] = ["mara", "coat", "lobby"]

    request = storyboard_llm_contract.build_request(story, "scene-2", "write_prompt")

    assert "[SHARED CONTINUITY FOR THIS SCENE]" in request["prompt"]
    assert "Mara: Mara has a dark bob." in request["prompt"]
    assert "Wardrobe: Mara wears a pale raincoat." in request["prompt"]
    assert "Lobby: Dark terrazzo lobby with brass fixtures." in request["prompt"]
    assert request["result_renderer"]["shared_context"].startswith("Mara: Mara has a dark bob.")


def test_scene_local_prompt_does_not_solicit_unsolicited_advice():
    prompt = storyboard_llm_contract.build_request(_story(), "scene-2", "write_prompt")["prompt"]

    assert "recommend a natural Scene split" not in prompt
    assert "state the missing fact" not in prompt
    assert "Do not add unsolicited advice or commentary." in prompt
