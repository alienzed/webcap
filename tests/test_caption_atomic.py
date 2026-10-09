from pathlib import Path
import json

import pytest

import tool.server.caption_ops as caption_ops


def test_caption_assist_leaves_room_for_runtime_reasoning(monkeypatch):
    from tool.server import app as app_module

    captured = {}

    def enqueue(client, model, contract, context=None, label=""):
        captured.update(client=client, model=model, contract=contract, context=context)
        return {"jobId": "caption-test"}

    monkeypatch.setattr(app_module, "enqueue_llm", enqueue)
    with app_module.app.test_client() as client:
        response = client.post("/caption/assist", json={
            "model": "remote-1::qwen",
            "assignments": [{"group": "Position", "key": "position", "term": "standing"}],
            "template": "{position, }{background}",
            "renderedPrimer": "standing, plain wall",
            "preferredCaptionSequence": "subject\nposition / action\nbackground\nlighting\nview",
        })

    assert response.status_code == 202
    assert captured["client"] == "caption"
    assert "runtimeOverrides" not in captured["context"]
    assert "Write one fluent caption" in captured["contract"]["messages"][0]["content"]
    payload = json.loads(captured["contract"]["messages"][1]["content"].split("\n\n", 1)[1])
    assert payload["captionTemplate"] == "{position, }{background}"
    assert payload["renderedPrimer"] == "standing, plain wall"
    assert payload["preferredCaptionSequence"].startswith("subject\nposition / action")
    assert payload["groupedAnnotations"][0]["key"] == "position"
    assert "groupOrder" not in payload


def test_template_assist_receives_custom_group_meaning_and_uses_runtime_budget(monkeypatch):
    from tool.server import app as app_module

    captured = {}
    def enqueue(client, model, contract, context=None, label=""):
        captured.update(contract=contract, context=context)
        return {"jobId": "template-test"}

    monkeypatch.setattr(app_module, "enqueue_llm", enqueue)
    groups = [{"label": "BT Shape", "key": "bt_shape", "terms": [
        {"value": "triangle", "renderedDefault": "triangle top"},
        {"value": "bandeau", "renderedDefault": "bandeau top"},
    ]}]
    with app_module.app.test_client() as client:
        response = client.post("/caption/template-assist", json={
            "model": "remote-1::gemma", "groups": groups, "currentTemplate": "{bt_shape}",
        })
    assert response.status_code == 202
    assert "runtimeOverrides" not in captured["context"]
    payload = json.loads(captured["contract"]["messages"][1]["content"].split("\n\n", 1)[1])
    assert payload["availableKeys"] == ["bt_shape"]
    assert payload["groupsInOrder"][0]["terms"][1]["renderedDefault"] == "bandeau top"
    assert payload["currentTemplate"] == "{bt_shape}"


def test_failed_caption_replace_keeps_existing_caption(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    folder.mkdir()
    caption = folder / "clip.txt"
    caption.write_text("existing caption", encoding="utf-8")
    monkeypatch.setattr(caption_ops, "_resolve_folder", lambda _folder: folder)
    monkeypatch.setattr(caption_ops.os, "replace", lambda _temporary, _target: (_ for _ in ()).throw(OSError("replace failed")))

    with pytest.raises(OSError, match="replace failed"):
        caption_ops.save_caption_text("set", "clip.mp4", "new caption")

    assert caption.read_text(encoding="utf-8") == "existing caption"
    assert not list(folder.glob(".clip.txt.*.tmp"))


def test_caption_assist_prompt_uses_house_sequence_not_annotation_order():
    sequence = "subject\nposition / action\nrequired phrase\nsetting\nbody\ntraits\nclothing\nbackground\nlighting\nview"
    messages = caption_ops.build_caption_assist_messages(
        assignments=[
            {"group": "View", "term": "front"},
            {"group": "Position", "term": "standing"},
            {"group": "Lighting", "term": "soft"},
            {"group": "BT Shape", "term": "triangle"},
        ],
        tags=["studio"],
        required_phrase="subject",
        draft="standing studio, soft lighting, front view",
        preferred_sequence=sequence,
    )

    assert messages[0]["role"] == "system"
    assert messages[1]["role"] == "user"
    payload = json.loads(messages[1]["content"].split("\n\n", 1)[1])
    assert payload["preferredCaptionSequence"] == sequence
    assert "groupOrder" not in payload
    assert "groupedAnnotations also does not define caption order" in messages[0]["content"]
    assert "captionTemplate and renderedPrimer" in messages[0]["content"]
    assert "unlisted groups immediately before the final background, lighting, and view portion" in messages[1]["content"]
    assert "include it verbatim exactly once" in messages[0]["content"]
    assert "compact photographic phrases" in messages[0]["content"]
    assert "high-angle three-quarter rear view" in messages[0]["content"]


def test_caption_assist_prioritizes_every_selected_tag_without_dropping_details():
    messages = caption_ops.build_caption_assist_messages(
        assignments=[
            {"group": "Clothing", "term": "triangle bikini"},
            {"group": "Hair", "term": "braid"},
            {"group": "Pose", "term": "standing"},
        ],
        tags=["bracelet"],
        draft="a person standing",
        preferred_sequence="subject\\npose\\nclothing\\nhair",
        open_sight={"summary": "a person standing"},
        context_sight={"summary": "a person standing"},
    )
    system = messages[0]["content"]
    user = messages[1]["content"]
    payload = json.loads(user.split("\\n\\n", 1)[1])
    assert [entry["tag"] for entry in payload["groupedAnnotations"]] == [
        "triangle bikini", "braid", "standing"
    ]
    assert payload["otherTags"] == ["bracelet"]
    assert "every distinct selected tag's meaning" in system
    assert "never silently omit a nonredundant selected value" in system
    assert "Cover every nonredundant tag in groupedAnnotations and otherTags" in user
    assert "supplemental visual evidence, not replacements" in user
    assert "preferred order for caption content" in user


def test_caption_assist_blank_sequence_uses_natural_order():
    messages = caption_ops.build_caption_assist_messages(
        assignments=[{"group": "Position", "term": "standing"}],
        preferred_sequence="",
    )
    payload = json.loads(messages[1]["content"].split("\n\n", 1)[1])
    assert payload["preferredCaptionSequence"] == ""
    assert "do not impose a house order" in messages[1]["content"]

def test_caption_template_assist_prompt_explains_primer_grammar():
    messages = caption_ops.build_caption_template_assist_messages(
        groups=[{
            "label": "Surface",
            "key": "surface",
            "separator": ", ",
            "precedence": {"bed": {"floor": True}},
            "terms": [{
                "value": "bed",
                "descriptorPrefix": "red",
                "descriptorSuffix": "",
                "wrapperPrefix": "on",
                "wrapperSuffix": "",
                "renderedDefault": "on red bed",
            }],
        }],
        mappings=[{
            "scope": "tag",
            "token": "studio",
            "key": "setting",
            "value": "in a studio",
            "enabled": True,
        }],
        current_template="{surface, }{setting}.",
    )

    system = messages[0]["content"]
    user = messages[1]["content"]
    assert "{prefix|key|suffix}" in system
    assert "descriptorPrefix/descriptorSuffix" in system
    assert "wrapperPrefix/wrapperSuffix" in system
    assert 'scope "tag"' in system
    assert 'scope "file"' in system
    assert '"availableKeys"' in user
    assert '"surface"' in user
    assert '"setting"' in user
    assert '"on red bed"' in user
    assert "groupsInOrder is the user's intended template order" in system
    assert "compact compositional photographic wording" in system
    assert '"[angle] [orientation] view"' in system
    assert "viewed from the front" in system
    assert "keep group placeholders in that relative order" in user
    assert "does not prescribe caption order" not in system


def test_caption_assist_corrections_make_retry_a_targeted_repair():
    messages = caption_ops.build_caption_assist_messages(
        assignments=[{"group": "Bikini Color", "term": "red"}],
        draft="a woman wearing a triangle bikini",
        corrections=[{
            "group": "Bikini Color",
            "term": "red",
            "note": "The current candidate omitted the visible selected color.",
        }],
    )

    payload = json.loads(messages[1]["content"].split("\n\n", 1)[1])
    assert payload["currentDraft"] == "a woman wearing a triangle bikini"
    assert payload["corrections"] == [{
        "group": "Bikini Color",
        "term": "red",
        "note": "The current candidate omitted the visible selected color.",
    }]
    assert "targeted repair of currentDraft" in messages[1]["content"]
    assert "explicitly fix those items" in messages[1]["content"]


def test_caption_assist_route_passes_corrections_to_prompt(monkeypatch):
    from tool.server import app as app_module

    captured = {}

    def enqueue(client, model, contract, context=None, label=""):
        captured["contract"] = contract
        return {"jobId": "caption-repair"}

    monkeypatch.setattr(app_module, "enqueue_llm", enqueue)
    with app_module.app.test_client() as client:
        response = client.post("/caption/assist", json={
            "model": "remote-1::qwen",
            "assignments": [{"group": "Bikini Color", "term": "red"}],
            "draft": "triangle bikini",
            "corrections": [{"group": "Bikini Color", "term": "red"}],
        })

    assert response.status_code == 202
    payload = json.loads(captured["contract"]["messages"][1]["content"].split("\n\n", 1)[1])
    assert payload["corrections"][0]["term"] == "red"
