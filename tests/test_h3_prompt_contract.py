import pytest

from tool.server import h3_prompt_contract


def _fields():
    return {
        "integrated_multimodal_description": "A woman closes the hotel door and turns toward wet footprints.",
        "overall_soundscape": "Rain against glass, soft footsteps, distant HVAC hum.",
        "non_diegetic_music": "N/A",
    }


def test_h3_base_renderer_owns_exact_field_order_and_shot_one_prefix():
    prompt = h3_prompt_contract.render_base_prompt(_fields(), mode="T2VA", duration=8)

    assert prompt == (
        "integrated_multimodal_description: [Shot 1] A woman closes the hotel door and turns toward wet footprints.\n\n"
        "overall_soundscape: Rain against glass, soft footsteps, distant HVAC hum.\n\n"
        "non_diegetic_music: N/A"
    )


def test_h3_renderer_strips_redundant_labels_from_structured_values():
    prompt = h3_prompt_contract.render_base_prompt({
        "integrated_multimodal_description": "integrated_multimodal_description: [Shot 1] She waits.",
        "overall_soundscape": "overall_soundscape: Quiet room tone.",
        "non_diegetic_music": "non_diegetic_music: N/A",
    })

    assert prompt.count("integrated_multimodal_description:") == 1
    assert prompt.count("overall_soundscape:") == 1
    assert prompt.count("non_diegetic_music:") == 1


def test_h3_renderer_owns_reference_alignment_syntax():
    prompt = h3_prompt_contract.render_base_prompt(
        _fields(),
        mode="FL2VA",
        duration=8,
    )

    assert prompt.startswith(
        "How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns "
        "with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the "
        "8.00-second mark of the target video.\n\n"
    )


def test_h3_story_plan_renderer_converts_structured_prompt_objects_without_mutating_input():
    plan = {
        "sharedContext": {
            "subjects": [{
                "id": "mara",
                "label": "Mara",
                "description": "Mara has a dark bob and a guarded expression.",
            }],
            "wardrobes": [{
                "id": "mara-raincoat",
                "label": "Mara wardrobe",
                "description": "Mara wears the same pale yellow raincoat over black trousers.",
            }],
            "locations": [{
                "id": "hotel-lobby",
                "label": "Hotel lobby",
                "description": "The lobby has dark terrazzo floors, brass fixtures, and rain-streaked glass.",
            }],
            "persistentFacts": [],
        },
        "scenes": [{
            "title": "Lobby",
            "summary": "She notices footprints.",
            "entryState": "She is inside.",
            "exitState": "She is staring at the floor.",
            "prompt": _fields(),
            "sharedContextRefs": ["mara", "mara-raincoat", "hotel-lobby"],
            "suggestedDurationSeconds": 6,
            "continuity": {"continuesPreviousScene": False, "carryForward": []},
        }]
    }

    rendered = h3_prompt_contract.render_story_plan_prompts(plan)

    assert isinstance(plan["scenes"][0]["prompt"], dict)
    assert rendered["scenes"][0]["prompt"].startswith(
        "integrated_multimodal_description: [Shot 1]"
    )
    assert "Continuity anchors — Mara: Mara has a dark bob" in rendered["scenes"][0]["prompt"]
    assert "Mara wardrobe: Mara wears the same pale yellow raincoat" in rendered["scenes"][0]["prompt"]
    assert "Hotel lobby: The lobby has dark terrazzo floors" in rendered["scenes"][0]["prompt"]


def test_h3_story_plan_renderer_injects_only_referenced_story_invariants_verbatim():
    plan = {
        "scenes": [{
            "title": "Funeral",
            "summary": "Elena stands apart from the mourners.",
            "entryState": "At the cemetery.",
            "exitState": "She watches the mourners leave.",
            "prompt": _fields(),
            "invariantRefs": [
                {"kind": "character", "title": "Elena"},
                {"kind": "location", "title": "Cemetery"},
            ],
            "suggestedDurationSeconds": 6,
            "continuity": {"continuesPreviousScene": False, "carryForward": []},
        }]
    }
    invariants = [
        {"kind": "character", "title": "Elena", "text": "White woman in her early 30s, fair skin, hazel eyes, shoulder-length dark brown wavy hair."},
        {"kind": "character", "title": "Jon", "text": "Black man in his late 30s with a shaved head."},
        {"kind": "location", "title": "Cemetery", "text": "Old hillside cemetery with weathered gray markers and mature maples."},
    ]

    rendered = h3_prompt_contract.render_story_plan_prompts(plan, invariants)
    prompt = rendered["scenes"][0]["prompt"]

    assert "Character Elena: White woman in her early 30s" in prompt
    assert "Location Cemetery: Old hillside cemetery" in prompt
    assert "Black man in his late 30s" not in prompt


def test_h3_story_plan_renderer_does_not_require_shared_context():
    plan = {
        "scenes": [{
            "title": "Lobby",
            "summary": "She enters.",
            "entryState": "Outside.",
            "exitState": "Inside.",
            "prompt": _fields(),
            "suggestedDurationSeconds": 6,
            "continuity": {"continuesPreviousScene": False, "carryForward": []},
        }]
    }

    rendered = h3_prompt_contract.render_story_plan_prompts(plan)

    assert len(rendered["scenes"]) == 1
    assert rendered["scenes"][0]["prompt"].startswith(
        "integrated_multimodal_description: [Shot 1]"
    )
    assert "Continuity anchors —" not in rendered["scenes"][0]["prompt"]


def test_h3_renderer_rejects_missing_structured_fields():
    with pytest.raises(ValueError, match="overall_soundscape"):
        h3_prompt_contract.render_base_prompt({
            "integrated_multimodal_description": "[Shot 1] A room.",
            "non_diegetic_music": "N/A",
        })


def test_story_plan_prompt_renderer_canonicalizes_common_llm_scene_shapes():
    plan = {
        "storyPlan": {
            "SharedContext": {
                "subjects": [],
                "wardrobes": [],
                "locations": [],
                "persistentFacts": [],
            },
            "Scenes": {
                "scene_1": {
                    "title": "Opening",
                    "summary": "A woman enters.",
                    "entryState": "Outside.",
                    "exitState": "Inside.",
                    "prompt": {
                        "integrated_multimodal_description": "A woman enters.",
                        "overall_soundscape": "Room tone.",
                        "non_diegetic_music": "N/A",
                    },
                    "sharedContextRefs": [],
                    "suggestedDurationSeconds": 6,
                    "continuity": {"continuesPreviousScene": False, "carryForward": []},
                }
            },
        }
    }

    rendered = h3_prompt_contract.render_story_plan_prompts(plan)

    assert isinstance(rendered["scenes"], list)
    assert len(rendered["scenes"]) == 1
    assert rendered["scenes"][0]["title"] == "Opening"
    assert "integrated_multimodal_description:" in rendered["scenes"][0]["prompt"]
