import json

import pytest

from tool.server.prompt_assist import (build_context, build_contract, review_context, source_fingerprint, scene_source_fingerprint, build_deep_qa_scene_contract, build_deep_qa_project_contract, validate_deep_qa_scene, validate_deep_qa_project)


def _story():
    first = (
        "Subject:\nA courier in a dark-blue raincoat.\n\n"
        "Scene Overview:\nThe courier enters the lobby after heavy rain.\n\n"
        "Environment / Continuity Anchors:\nThe lobby is dry; rain remains outside.\n\n"
        "Style / Visual Treatment:\nGrounded realism.\n\n"
        "overall_soundscape:\nRain patters against the glass.\n\n"
        "non_diegetic_music:\nA restrained piano motif.\n\n"
        "integrated_multimodal_description:\n"
        "[Shot 1] The courier enters, coat and bag soaked.\n"
        "[Shot 2] The courier pauses by the glass door, still dripping.\n"
        "[Shot 3] The courier removes the raincoat and hangs it on a hook.\n"
    )
    second = (
        "Subject:\nThe same courier.\n\n"
        "Scene Overview:\nThe courier meets a colleague the next morning.\n\n"
        "integrated_multimodal_description:\n"
        "[Shot 1] The courier greets the colleague in a dry lobby.\n"
    )
    return {
        "id": "project-1",
        "title": "Rainy Arrival",
        "concept": "A courier arrives after a storm.",
        "style": "Grounded realism.",
        "invariants": [{"kind": "character", "title": "Courier", "text": "A dark-blue raincoat."}],
        "updatedAt": "rev-1",
        "sceneOrder": ["scene-1", "scene-2"],
        "scenes": {
            "scene-1": {"title": "Arrival", "durationSeconds": 8, "prompt": first},
            "scene-2": {"title": "Morning", "durationSeconds": 6, "prompt": second},
        },
    }


def test_scene_scope_extracts_timed_cuts_and_keeps_exact_source_prompt():
    story = _story()
    context = build_context(story, "scene", "scene-1")
    assert [shot["shotNumber"] for shot in context["scenes"][0]["shots"]] == [1, 2, 3]
    assert "still dripping" in context["scenes"][0]["shots"][1]["text"]
    assert context["sourcePrompts"]["scene-1"] == story["scenes"]["scene-1"]["prompt"]
    assert "sourcePrompts" not in review_context(context)


def test_project_scope_preserves_scene_order_without_comparing_rendered_identity():
    context = build_context(_story(), "project")
    assert [scene["sceneId"] for scene in context["scenes"]] == ["scene-1", "scene-2"]
    assert context["scenes"][0]["shots"][2]["shotNumber"] == 3
    assert context["scenes"][1]["shots"][0]["shotNumber"] == 1


def test_scene_scope_requires_a_valid_scene():
    with pytest.raises(ValueError, match="Select an existing Scene"):
        build_context(_story(), "scene", "missing")


def test_review_contracts_have_distinct_role_instructions_and_structured_findings():
    context = build_context(_story(), "project")
    visual = build_contract("review", context, role="visual")
    continuity = build_contract("review", context, role="continuity")
    sequence = build_contract("review", context, role="sequence")
    assert "focal element" in visual["messages"][0]["content"]
    assert "reverts" in continuity["messages"][0]["content"]
    assert "ceiling-fan" in sequence["messages"][0]["content"]
    assert visual["response_schema"]["required"] == ["summary", "findings"]


def test_revision_contract_includes_only_scenes_with_accepted_recommendations():
    context = build_context(_story(), "project")
    contract = build_contract(
        "revise",
        context,
        role="editor",
        accepted=[{
            "sceneId": "scene-1",
            "shotNumber": 3,
            "recommendation": "Preserve the raincoat removal in subsequent cuts.",
        }],
    )
    payload = contract["messages"][1]["content"]
    assert "scene-1" in payload
    assert "scene-2" not in payload
    assert "complete replacement prompt" in contract["messages"][0]["content"]


def test_followup_keeps_selected_specialist_and_conversation_history():
    context = build_context(_story(), "scene", "scene-1")
    contract = build_contract(
        "followup",
        context,
        role="continuity",
        findings=[{"issue": "State regression"}],
        conversation=[{"role": "user", "content": "Why?"}, {"role": "assistant", "content": "Because..."}],
        question="Would you still flag this if the coat is intentionally removed?",
    )
    assert contract["messages"][0]["content"].startswith("You are Continuity")
    assert contract["messages"][-3]["content"] == "Why?"
    assert contract["messages"][-1]["content"].startswith("Would you still flag")


def test_source_fingerprint_changes_when_reviewed_prompt_changes():
    story = _story()
    original = source_fingerprint(build_context(story, "project"))
    story["scenes"]["scene-1"]["prompt"] += "\n[Shot 4] A new action."
    revised = source_fingerprint(build_context(story, "project"))
    assert revised != original
    assert source_fingerprint(build_context(_story(), "project")) == original


def test_source_fingerprint_is_scope_specific_for_scene_reviews():
    story = _story()
    first = source_fingerprint(build_context(story, "scene", "scene-1"))
    story["scenes"]["scene-2"]["prompt"] += "\n[Shot 2] An unrelated action."
    assert source_fingerprint(build_context(story, "scene", "scene-1")) == first
    assert source_fingerprint(build_context(story, "project")) != source_fingerprint(build_context(_story(), "project"))


def test_project_scope_reports_scenes_without_saved_prompts():
    story = _story()
    story["scenes"]["scene-2"]["prompt"] = ""
    with pytest.raises(ValueError, match="Scene Morning has no saved prompt"):
        build_context(story, "project")


def test_context_preserves_exact_saved_prompt_for_compare_and_apply():
    story = _story()
    story["scenes"]["scene-1"]["prompt"] += "  \n"
    context = build_context(story, "scene", "scene-1")
    assert context["sourcePrompts"]["scene-1"] == story["scenes"]["scene-1"]["prompt"]


def test_scene_context_keeps_soundscape_and_music_direction():
    context = build_context(_story(), "scene", "scene-1")
    scene = context["scenes"][0]
    assert scene["overallSoundscape"] == "Rain patters against the glass."
    assert scene["nonDiegeticMusic"] == "A restrained piano motif."



def _deep_qa_scene_result(scene_id="scene-1"):
    return {
        "sceneId": scene_id,
        "summary": "The courier arrives wet, removes the raincoat, and hangs it by the door.",
        "purpose": "Establish the courier's arrival and transition into the lobby.",
        "keyVisualMoments": ["Wet coat on arrival", "Raincoat removed and hung on hook"],
        "cuts": [
            {
                "shotNumber": 1,
                "visualIntent": "Establish the courier entering the lobby.",
                "focalElement": "Courier and wet delivery bag",
                "action": "Courier enters through the glass door.",
                "stateChanges": ["Coat and bag are wet."],
                "carryForward": ["Courier remains in the same raincoat until it is removed."],
                "physicalInteractions": [],
                "concerns": [],
            },
            {
                "shotNumber": 3,
                "visualIntent": "Show the courier hanging the removed coat.",
                "focalElement": "Raincoat and hook",
                "action": "Courier hangs the raincoat on the hook.",
                "stateChanges": ["Raincoat is no longer being worn."],
                "carryForward": ["Raincoat remains on the hook in subsequent cuts unless moved."],
                "physicalInteractions": ["Courier's hand places coat on hook."],
                "concerns": [],
            },
        ],
    }


def test_deep_qa_scene_contract_prepares_cut_level_state_and_visual_intent():
    context = build_context(_story(), "scene", "scene-1")
    contract = build_deep_qa_scene_contract(context, "scene-1")
    assert contract["operation"] == "prompt_assist_deep_qa_scene"
    assert "regressions" in contract["messages"][0]["content"]
    assert "independently generated Scenes" in contract["messages"][0]["content"]
    assert contract["response_schema"]["required"] == [
        "sceneId", "summary", "purpose", "keyVisualMoments", "cuts"
    ]


def test_deep_qa_project_contract_uses_compact_scene_intelligence_and_order():
    context = build_context(_story(), "project")
    results = [_deep_qa_scene_result("scene-1"), _deep_qa_scene_result("scene-2")]
    contract = build_deep_qa_project_contract(context, results)
    assert contract["operation"] == "prompt_assist_deep_qa_project"
    assert "sceneOrder" in contract["messages"][1]["content"]
    assert "scene-1" in contract["messages"][1]["content"]
    assert "scene-2" in contract["messages"][1]["content"]
    assert "independently generated" in contract["messages"][0]["content"]


def test_deep_qa_requires_every_scene_result_before_project_index():
    context = build_context(_story(), "project")
    with pytest.raises(ValueError, match="every Scene"):
        build_deep_qa_project_contract(context, [_deep_qa_scene_result("scene-1")])


def test_deep_qa_validators_reject_unknown_scene_and_cut_references():
    with pytest.raises(ValueError, match="unknown cut"):
        validate_deep_qa_scene(_deep_qa_scene_result(), "scene-1", [0, 1, 2])
    with pytest.raises(ValueError, match="unknown Scene"):
        validate_deep_qa_project({
            "recurringElements": [{"element": "Courier", "scenes": ["not-a-scene"], "basis": "guess"}],
            "sceneRelationships": [],
        }, ["scene-1", "scene-2"])


def test_scene_deep_qa_fingerprint_isolated_to_scene_and_project_context():
    story = _story()
    context = build_context(story, "scene", "scene-1")
    original = scene_source_fingerprint(context, "scene-1")
    story["scenes"]["scene-2"]["prompt"] += "\n[Shot 2] Unrelated."
    assert scene_source_fingerprint(build_context(story, "scene", "scene-1"), "scene-1") == original
    story["invariants"].append({"kind": "character", "title": "Courier", "text": "Carries a canvas bag."})
    assert scene_source_fingerprint(build_context(story, "scene", "scene-1"), "scene-1") != original
