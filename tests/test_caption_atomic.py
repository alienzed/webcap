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
    assert "You write concise, information-dense natural-language training captions" in captured["contract"]["messages"][0]["content"]
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
        preferred_sequence="subject\npose\nclothing\nhair",
        open_sight={"summary": "a person standing"},
        context_sight={"summary": "a person standing"},
    )
    system = messages[0]["content"]
    user = messages[1]["content"]
    payload = json.loads(user.split("\n\n", 1)[1])
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

def test_semantic_group_alias_reaches_caption_and_template_assist_without_changing_key():
    caption = caption_ops.build_caption_assist_messages(
        assignments=[{"group": "BB Back", "alias": "Bikini Bottom Back", "key": "bb_back", "term": "thong"}],
    )
    payload = json.loads(caption[1]["content"].split("\n\n", 1)[1])
    assert payload["groupedAnnotations"][0] == {
        "group": "BB Back", "alias": "Bikini Bottom Back", "key": "bb_back", "tag": "thong"
    }
    groups = [{"label": "BB Back", "alias": "Bikini Bottom Back", "key": "bb_back",
               "terms": [{"value": "thong"}]}]
    template = caption_ops.build_caption_template_assist_messages(groups=groups)
    data = json.loads(template[1]["content"].split("\n\n", 1)[1])
    assert data["groupsInOrder"][0]["alias"] == "Bikini Bottom Back"
    assert data["availableKeys"] == ["bb_back"]


def test_caption_assist_sight_led_only_adds_guidance_when_requested():
    sight = {"model": "vl-a", "description": "A teal jacket with reinforced seams.",
             "inventory": {"things": [{"name": "jacket", "qualities": ["reinforced seams"]}]}}
    base = dict(open_sight=sight, draft="", rendered_primer="Subject, clothing, background.")
    ordinary = caption_ops.build_caption_assist_messages(**base)
    assert ordinary == caption_ops.build_caption_assist_messages(**base, sight_led=False)
    sight_led = caption_ops.build_caption_assist_messages(**base, sight_led=True)
    assert sight_led[0]["content"] == ordinary[0]["content"], "Mature system prompt must stay unchanged."
    assert "Compose a substantive new training caption" in sight_led[1]["content"]
    assert "Compose a substantive new training caption" not in ordinary[1]["content"]
    assert "reinforced seams" in sight_led[1]["content"]


def test_tagged_caption_assist_path_does_not_enable_sight_led():
    primer = Path("tool/js/primer_settings.js").read_text(encoding="utf-8")
    app = Path("tool/server/app.py").read_text(encoding="utf-8")
    assert "if (!assignments.length && !request.tags.length" in primer
    assert "!String(mediaItem.caption || '').trim()" in primer
    assert "request.draft.trim() === autoPrimer" in primer
    assert "request.sightLed = true;" in primer
    assert 'sight_led=data.get("sightLed") is True' in app


def test_caption_assist_tag_mismatch_hints_are_advisory_not_verified_errors():
    messages = caption_ops.build_caption_assist_messages(
        assignments=[{"group": "Hair", "term": "braid"}],
        tags=["earrings"],
        draft="A person with a braided hairstyle.",
        tag_mismatches=[
            {"group": "Hair", "term": "braid"},
            {"group": "", "term": "earrings"},
            {"group": "Hair", "term": "braid"},
            {"term": ""},
            "invalid",
        ],
    )
    content = messages[1]["content"]
    payload = json.loads(content.split("\n\n", 1)[1])
    assert payload["tagMismatches"] == [
        {"group": "Hair", "term": "braid"}, {"group": "", "term": "earrings"}
    ]
    assert payload["currentDraft"] == "A person with a braided hairstyle."
    assert "review hints, not confirmed errors" in content
    assert "preserve adequately expressed details" in content
    assert "targeted repair of currentDraft" not in content


def test_caption_assist_no_tag_mismatch_has_no_extra_guidance():
    messages = caption_ops.build_caption_assist_messages(
        assignments=[{"group": "Hair", "term": "braid"}],
        draft="A person with a braid.",
    )
    content = messages[1]["content"]
    assert "tagMismatches" not in content
    assert "review hints, not confirmed errors" not in content


def test_explicit_caption_candidate_repairs_supersede_tag_mismatch_hints():
    messages = caption_ops.build_caption_assist_messages(
        assignments=[{"group": "Hair", "term": "braid"}],
        draft="A person posing.",
        tag_mismatches=[{"group": "Hair", "term": "braid"}],
        corrections=[{"group": "Hair", "term": "braid", "note": "Confirmed omission."}],
    )
    content = messages[1]["content"]
    payload = json.loads(content.split("\n\n", 1)[1])
    assert "tagMismatches" not in payload
    assert payload["corrections"][0]["note"] == "Confirmed omission."
    assert "targeted repair of currentDraft" in content


def test_caption_assist_route_forwards_tag_mismatch_hints(monkeypatch):
    from tool.server import app as app_module

    captured = {}

    def enqueue(client, model, contract, context=None, label=""):
        captured["contract"] = contract
        return {"jobId": "caption-mismatch"}

    monkeypatch.setattr(app_module, "enqueue_llm", enqueue)
    with app_module.app.test_client() as client:
        response = client.post("/caption/assist", json={
            "model": "remote-1::qwen",
            "assignments": [{"group": "Hair", "term": "braid"}],
            "draft": "A person posing.",
            "tagMismatches": [{"group": "Hair", "term": "braid"}],
        })
    assert response.status_code == 202
    content = captured["contract"]["messages"][1]["content"]
    payload = json.loads(content.split("\n\n", 1)[1])
    assert payload["tagMismatches"] == [{"group": "Hair", "term": "braid"}]
