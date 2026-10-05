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
        })

    assert response.status_code == 202
    assert captured["client"] == "caption"
    assert "runtimeOverrides" not in captured["context"]
    assert "Write one fluent caption" in captured["contract"]["messages"][0]["content"]
    payload = json.loads(captured["contract"]["messages"][1]["content"].split("\n\n", 1)[1])
    assert payload["captionTemplate"] == "{position, }{background}"
    assert payload["renderedPrimer"] == "standing, plain wall"
    assert payload["groupedAnnotations"][0]["key"] == "position"


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


def test_caption_assist_prompt_preserves_group_order():
    messages = caption_ops.build_caption_assist_messages(
        assignments=[
            {"group": "Position", "term": "standing"},
            {"group": "View", "term": "front"},
            {"group": "Lighting", "term": "soft"},
        ],
        tags=["studio"],
        required_phrase="subject",
        draft="standing studio, soft lighting, front view",
    )

    assert messages[0]["role"] == "system"
    assert messages[1]["role"] == "user"
    assert '"groupOrder": [' in messages[1]["content"]
    assert messages[1]["content"].index('"Position"') < messages[1]["content"].index('"View"') < messages[1]["content"].index('"Lighting"')
    assert "include it verbatim exactly once" in messages[0]["content"]
    assert "compact photographic phrases" in messages[0]["content"]
    assert "high-angle three-quarter rear view" in messages[0]["content"]
    assert "viewed from the front" in messages[0]["content"]


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
