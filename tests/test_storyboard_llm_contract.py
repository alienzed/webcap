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
    assert "[DIRECTOR CONTEXT]" in prompt
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
    assert "materially changes how much screen time" in prompt
    assert "durationSeconds" in request["response_schema"]["properties"]
    assert request["response_schema"]["properties"]["durationSeconds"]["minimum"] == 9
    assert request["response_schema"]["properties"]["durationSeconds"]["maximum"] == 15
    assert "durationSeconds" not in request["response_schema"]["required"]
    assert request["result_renderer"]["duration_field"] == "durationSeconds"
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
    assert request["response_schema"]["required"] == ["scenes"]
    assert "sharedContext" not in request["response_schema"]["properties"]
    assert "minItems" not in request["response_schema"]["properties"]["scenes"]
    assert "maxItems" not in request["response_schema"]["properties"]["scenes"]
    scene_schema = request["response_schema"]["properties"]["scenes"]["items"]
    assert "sharedContextRefs" not in scene_schema["required"]
    assert "sharedContextRefs" not in scene_schema["properties"]
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
    assert "Aim for 12 Scenes" in prompt
    assert "recurring character identity, wardrobe, location" in prompt
    assert "sharedContext" not in prompt
    assert "4 to 8 Scenes" not in prompt
    assert "at least two Scenes" not in prompt
    assert "between 9 and 15 seconds" in prompt
    assert "normally aiming for 10-15 seconds" in prompt
    assert "prioritize coherent, substantial Scenes over mechanically hitting the count" in prompt
    assert "Combine small related beats when they fit naturally" in prompt
    assert "multiple meaningful shots, cuts, or distinct visual beats when the material supports them" in prompt
    assert scene_schema["properties"]["suggestedDurationSeconds"]["minimum"] == 9
    assert scene_schema["properties"]["suggestedDurationSeconds"]["maximum"] == 15
    assert "none is mandatory" in prompt
    assert "EXISTING SECOND PROMPT" not in prompt


def test_repair_scenes_is_sparse_whole_story_patch_not_redevelopment():
    story = _story()
    request = storyboard_llm_contract.build_request(
        story,
        "",
        "repair_scenes",
        "Use perspective appropriate to each beat; stop defaulting to front-facing portrait coverage.",
    )
    prompt = request["prompt"]
    schema = request["response_schema"]

    assert request["operation"] == "repair_scenes"
    assert request["output"] == "json"
    assert schema["required"] == ["changes"]
    assert set(schema["properties"]["changes"]["items"]["properties"]["fields"]["properties"]) == {
        "summary", "entryState", "exitState", "prompt"
    }
    assert "[CURRENT SCENE PLAN]" in prompt
    assert "Use perspective appropriate to each beat" in prompt
    assert "sparse repair pass, not Story redevelopment" in prompt
    assert "exact Scene count, order, titles, durations, references, LoRAs, seeds" in prompt
    assert "Do not add, remove, merge, split, or reorder Scenes." in prompt
    assert "return each Scene at most once" in prompt
    assert "WebCap will render those itself" in prompt
    assert '"sceneNumber": 1' in prompt
    assert "TAKE DATA MUST NOT LEAK" not in prompt


def test_repair_scenes_requires_instruction_and_existing_scenes():
    with pytest.raises(ValueError, match="instruction"):
        storyboard_llm_contract.build_request(_story(), "", "repair_scenes", "")

    story = _story()
    story["sceneOrder"] = []
    story["scenes"] = {}
    with pytest.raises(ValueError, match="must have Scenes"):
        storyboard_llm_contract.build_request(story, "", "repair_scenes", "Check perspective.")


def test_develop_story_requires_concept():
    story = _story()
    story["concept"] = ""
    with pytest.raises(ValueError, match="concept / overview"):
        storyboard_llm_contract.build_request(story, "", "develop_story")


def test_define_invariants_is_a_small_character_location_pass():
    story = _story()
    story["concept"] = "Elena loses her husband, grieves at a cemetery, then gradually bonds with a stray dog."

    request = storyboard_llm_contract.build_request(story, "", "define_invariants")
    prompt = request["prompt"]
    schema = request["response_schema"]

    assert request["operation"] == "define_invariants"
    assert request["output"] == "json"
    assert schema["required"] == ["invariants"]
    item = schema["properties"]["invariants"]["items"]
    assert item["properties"]["kind"]["enum"] == ["character", "location"]
    assert "recurring characters and recurring locations" in prompt
    assert "stable visible traits that materially help reproduce" in prompt
    assert "do not fill every category mechanically" in prompt
    assert "Do not plan Scenes." in prompt
    assert '"kind":"character"' in prompt
    assert '"kind":"location"' in prompt
    assert "[EXISTING STORY INVARIANTS]" in prompt


def test_expand_concept_is_creative_but_not_scene_planning():
    story = _story()
    story["concept"] = "Rise and fall of a New York gangster."
    story["style"] = "High-fashion runway editorial."

    request = storyboard_llm_contract.build_request(story, "", "expand_concept")
    prompt = request["prompt"]

    assert request["operation"] == "expand_concept"
    assert request["output"] == "text"
    assert "Rise and fall of a New York gangster." in prompt
    assert "[STORY VISUAL / ATMOSPHERE]" in prompt
    assert "High-fashion runway editorial." in prompt
    assert "[DIRECTOR CONTEXT]" not in prompt
    assert "Treat the supplied Visual / Atmosphere as authoritative" in prompt
    assert "do not replace it, reinterpret it into a different style, or introduce a competing visual atmosphere" in prompt
    assert "do not force conventional plot, conflict, or character arcs" in prompt
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

    assert prompt.count("PRESERVE FACTS AND CONTINUITY.") == 1
    assert "Recurring characters and locations must remain visually reproducible" in prompt
    assert "Do not vary established identity or continuity merely for novelty." in prompt
    assert "no LoRA" not in prompt
    assert "LoRA or exact" not in prompt


def test_develop_story_schema_keeps_scene_planning_independent_of_shared_context():
    schema = storyboard_llm_contract.build_request(_story(), "", "develop_story")["response_schema"]

    assert schema["required"] == ["scenes"]
    assert "sharedContext" not in schema["properties"]
    scene = schema["properties"]["scenes"]["items"]
    assert "sharedContextRefs" not in scene["properties"]
    assert "invariantRefs" in scene["required"]
    assert scene["properties"]["invariantRefs"]["items"]["required"] == ["kind", "title"]


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


def test_scene_local_prompt_uses_only_relevant_story_invariants_as_authoritative_anchors():
    story = _story()
    story["invariants"] = [
        {"kind": "character", "title": "Mara", "text": "White woman, early 30s, hazel eyes, shoulder-length dark brown hair."},
        {"kind": "character", "title": "Jon", "text": "Black man, late 30s, shaved head, brown eyes."},
        {"kind": "location", "title": "Lobby", "text": "Dark terrazzo floor, brass desk, rain-streaked windows."},
    ]
    story["scenes"]["scene-2"]["invariantRefs"] = [
        {"kind": "character", "title": "Mara"},
        {"kind": "location", "title": "Lobby"},
    ]

    request = storyboard_llm_contract.build_request(story, "scene-2", "write_prompt")

    assert "[SCENE INVARIANTS]" in request["prompt"]
    assert "White woman, early 30s, hazel eyes" in request["prompt"]
    assert "Dark terrazzo floor, brass desk" in request["prompt"]
    assert "Black man, late 30s" not in request["prompt"]
    assert "White woman, early 30s, hazel eyes" in request["result_renderer"]["shared_context"]
    assert "Black man, late 30s" not in request["result_renderer"]["shared_context"]


def test_scene_local_prompt_does_not_solicit_unsolicited_advice():
    prompt = storyboard_llm_contract.build_request(_story(), "scene-2", "write_prompt")["prompt"]

    assert "recommend a natural Scene split" not in prompt
    assert "state the missing fact" not in prompt
    assert "return no unsolicited commentary" in prompt


def test_director_context_prioritizes_filmmaking_without_forcing_classical_coverage():
    prompt = storyboard_llm_contract.build_request(_story(), "", "develop_story")["prompt"]

    assert "DIRECT THE FILM FIRST." in prompt
    assert "Creative intent outranks default film grammar" in prompt
    assert "montage, abstraction, static tableaux, discontinuity" in prompt
    assert "USE EACH GENERATION UNIT WELL." in prompt
    assert "A single continuous shot is valid when uninterrupted time better serves the Scene." in prompt
    assert "Do not default to portrait-style coverage or a fixed master/medium/close-up recipe." in prompt
