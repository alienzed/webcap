import json

import pytest

from tool.server import caption_vision


def test_caption_vision_prompt_preserves_known_group_options_and_uses_local_media_url():
    messages, groups = caption_vision.build_caption_vision_messages(
        "snow leopard bikini",
        [{
            "group": "Connector",
            "options": ["metal ring", "keychain loop"],
            "selected": [],
        }],
        "bikini/item.jpg",
    )

    assert groups[0]["group"] == "Connector"
    assert groups[0]["options"] == ["metal ring", "keychain loop"]
    assert messages[1]["content"][1]["image_url"]["url"] == "file://bikini/item.jpg"
    payload = json.loads(messages[1]["content"][0]["text"].split("\n\n", 1)[1])
    assert payload["caption"] == "snow leopard bikini"
    assert payload["groups"][0]["options"][1] == "keychain loop"


def test_caption_vision_result_only_makes_exact_known_tags_actionable():
    groups = [{
        "group": "Connector",
        "options": ["metal ring", "keychain loop"],
        "selected": [],
    }]
    result = caption_vision.normalize_caption_vision_result(json.dumps({
        "findings": [
            {
                "description": "A circular connector is visible.",
                "type": "omitted",
                "confidence": "high",
                "knownTag": {"group": "connector", "term": "METAL RING"},
            },
            {
                "description": "A chain-like detail is visible.",
                "type": "omitted",
                "confidence": "medium",
                "knownTag": {"group": "Connector", "term": "invented chain"},
            },
        ]
    }), groups)

    assert result["findings"][0]["knownTag"] == {
        "group": "Connector",
        "term": "metal ring",
    }
    assert result["findings"][1]["knownTag"] is None


def test_caption_vision_result_accepts_json_code_fence():
    result = caption_vision.normalize_caption_vision_result(
        '```json\n{"findings": []}\n```',
        [],
    )
    assert result == {"findings": []}


def test_caption_vision_route_queues_normalized_multimodal_caption_job(monkeypatch):
    from tool.server import app as app_module

    captured = {}
    monkeypatch.setattr(
        app_module,
        "list_vision_models",
        lambda reload=False: [{"id": "local::vision"}],
    )
    monkeypatch.setattr(
        app_module,
        "resolve_caption_vision_media",
        lambda folder, media: "bikini/" + media,
    )

    def enqueue(client, model, contract, context=None, label=""):
        captured.update(
            client=client,
            model=model,
            contract=contract,
            context=context,
            label=label,
        )
        return {"jobId": "vision-test"}

    monkeypatch.setattr(app_module, "enqueue_llm", enqueue)

    with app_module.app.test_client() as client:
        response = client.post("/caption/vision-check", json={
            "model": "local::vision",
            "folder": "bikini",
            "media": "item.jpg",
            "caption": "a bikini",
            "groups": [{
                "group": "Connector",
                "options": ["metal ring"],
                "selected": [],
            }],
        })

    assert response.status_code == 202
    assert captured["client"] == "caption"
    assert captured["model"] == "local::vision"
    assert captured["contract"]["operation"] == "caption_vision_validate"
    assert captured["contract"]["messages"][1]["content"][1]["image_url"]["url"] == "file://bikini/item.jpg"
    assert captured["context"]["runtimeOverrides"]["maxTokens"] == 320
    assert captured["context"]["visionGroups"][0]["group"] == "Connector"


def test_caption_vision_route_accepts_remote_ollama_vision_model(monkeypatch):
    from tool.server import app as app_module

    captured = {}
    monkeypatch.setattr(
        app_module,
        "list_vision_models",
        lambda reload=False: [
            {"id": "workstation::huihui_ai/qwen3-vl-abliterated:8b"},
        ],
    )
    monkeypatch.setattr(
        app_module,
        "resolve_caption_vision_media",
        lambda folder, media: "bikini/" + media,
    )

    def enqueue(client, model, contract, context=None, label=""):
        captured.update(model=model, contract=contract)
        return {"jobId": "remote-vision-test"}

    monkeypatch.setattr(app_module, "enqueue_llm", enqueue)

    with app_module.app.test_client() as client:
        response = client.post("/caption/vision-check", json={
            "model": "workstation::huihui_ai/qwen3-vl-abliterated:8b",
            "folder": "bikini",
            "media": "item.jpg",
            "caption": "a bikini",
            "groups": [],
        })

    assert response.status_code == 202
    assert captured["model"] == "workstation::huihui_ai/qwen3-vl-abliterated:8b"
    assert captured["contract"]["messages"][1]["content"][1]["image_url"]["url"] == "file://bikini/item.jpg"
