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
        "scenes": [{
            "title": "Lobby",
            "summary": "She notices footprints.",
            "entryState": "She is inside.",
            "exitState": "She is staring at the floor.",
            "prompt": _fields(),
            "suggestedDurationSeconds": 6,
            "continuity": {"continuesPreviousScene": False, "carryForward": []},
        }]
    }

    rendered = h3_prompt_contract.render_story_plan_prompts(plan)

    assert isinstance(plan["scenes"][0]["prompt"], dict)
    assert rendered["scenes"][0]["prompt"].startswith(
        "integrated_multimodal_description: [Shot 1]"
    )


def test_h3_renderer_rejects_missing_structured_fields():
    with pytest.raises(ValueError, match="overall_soundscape"):
        h3_prompt_contract.render_base_prompt({
            "integrated_multimodal_description": "[Shot 1] A room.",
            "non_diegetic_music": "N/A",
        })
