import json

from tool.server.caption_ops import build_caption_template_assist_messages, build_caption_assist_messages


def test_template_discussion_and_authoring_share_schema_and_approved_examples():
    evidence = {
        "groups": [{"label": "View", "key": "view", "terms": [{"value": "front view"}]}],
        "current_template": "{view}",
        "training_focus": "camera view",
        "set_variables": [{"group": "View", "terms": ["front view"], "exclusive": True}],
        "reference_captions": [{"fileName": "ref.png", "caption": "bright lighting, front view"}],
        "conversation": [{"role": "user", "content": "Prefer terse phrases."}],
    }
    discussion = build_caption_template_assist_messages(**evidence, discuss=True)
    author = build_caption_template_assist_messages(**evidence)
    assert "Return only the template text" not in discussion[0]["content"]
    assert "Return only the template text" in author[0]["content"]
    assert "Prefer terse phrases." == discussion[-1]["content"]
    assert author[-2]["content"] == discussion[-1]["content"]
    assert json.loads(discussion[1]["content"].split("\n\n", 1)[1]) == json.loads(author[1]["content"].split("\n\n", 1)[1])
    context = json.loads(author[1]["content"].split("\n\n", 1)[1])
    assert context["approvedStyleExamples"] == ["bright lighting, front view"]
    assert context["setVariables"][0]["exclusive"]


def test_caption_assist_uses_only_explicit_style_examples_and_independent_item_inputs():
    references = [{"caption": "bright lighting, front view"}]
    first = build_caption_assist_messages(
        assignments=[{"group": "View", "term": "side view"}],
        template="{view}", rendered_primer="side view", reference_captions=references,
    )
    second = build_caption_assist_messages(
        assignments=[{"group": "View", "term": "rear view"}],
        template="{view}", rendered_primer="rear view", reference_captions=references,
    )
    assert first[0] == second[0]
    first_payload = json.loads(first[1]["content"].split("\n\n", 1)[1])
    second_payload = json.loads(second[1]["content"].split("\n\n", 1)[1])
    assert first_payload["approvedStyleExamples"] == second_payload["approvedStyleExamples"]
    assert first_payload["renderedPrimer"] == "side view"
    assert second_payload["renderedPrimer"] == "rear view"
    assert "side view" not in second[1]["content"]
    assert "expression and structure only" in first[0]["content"]
