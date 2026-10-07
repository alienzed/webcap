import json

import pytest

from tool.server import caption_vision


def test_standalone_vision_caption_prompt_uses_image_only_without_annotation_ontology():
    messages = caption_vision.build_vision_image_caption_messages("bikini/item.jpg")

    assert "visual evidence alone" in caption_vision.VISION_IMAGE_CAPTION_SYSTEM_PROMPT
    assert "annotation" not in caption_vision.VISION_IMAGE_CAPTION_SYSTEM_PROMPT.lower()
    assert "tag" not in caption_vision.VISION_IMAGE_CAPTION_SYSTEM_PROMPT.lower()
    assert messages[1]["content"][1]["image_url"]["url"] == "file://bikini/item.jpg"
    assert "groups" not in messages[1]["content"][0]["text"].lower()


def test_vision_message_builders_preserve_first_frame_data_urls():
    data_url = "data:image/png;base64,Zmlyc3QtZnJhbWU="

    standalone = caption_vision.build_vision_image_caption_messages(data_url)
    qa, _groups = caption_vision.build_caption_vision_messages("caption", [], data_url)

    assert standalone[1]["content"][1]["image_url"]["url"] == data_url
    assert qa[1]["content"][1]["image_url"]["url"] == data_url


def test_resolve_caption_vision_media_uses_first_video_frame(tmp_path, monkeypatch):
    from tool.server import config as app_config

    source = tmp_path / "clip.mp4"
    source.write_bytes(b"video")
    monkeypatch.setattr(app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr(caption_vision, "extract_boundary_frame_png", lambda path, boundary: b"first-frame")

    resolved = caption_vision.resolve_caption_vision_media("", "clip.mp4")

    assert resolved == "data:image/png;base64,Zmlyc3QtZnJhbWU="


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


def test_standalone_vision_caption_route_queues_plain_multimodal_caption_job(monkeypatch):
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
        return {"jobId": "vision-caption-test"}

    monkeypatch.setattr(app_module, "enqueue_llm", enqueue)

    with app_module.app.test_client() as client:
        response = client.post("/caption/vision-caption", json={
            "model": "local::vision",
            "folder": "bikini",
            "media": "item.jpg",
        })

    assert response.status_code == 202
    assert captured["client"] == "caption"
    assert captured["model"] == "local::vision"
    assert captured["contract"]["operation"] == "vision_image_caption"
    assert captured["contract"]["messages"][1]["content"][1]["image_url"]["url"] == "file://bikini/item.jpg"
    assert captured["context"]["runtimeOverrides"]["maxTokens"] == 384
    assert captured["label"] == "Vision Caption"


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


def test_caption_vision_prompt_verifies_before_reporting_and_accepts_empty_success():
    from tool.server.caption_vision import CAPTION_VISION_SYSTEM_PROMPT, build_caption_vision_messages

    assert "check both the image and the current caption before reporting it" in CAPTION_VISION_SYSTEM_PROMPT
    assert "Treat semantically equivalent wording as present" in CAPTION_VISION_SYSTEM_PROMPT
    assert "Use each annotation group as semantic context" in CAPTION_VISION_SYSTEM_PROMPT
    assert "An empty findings list is a successful result" in CAPTION_VISION_SYSTEM_PROMPT

    messages, _ = build_caption_vision_messages(
        "a blue floral bikini with crossover-straps and a v-front bottom",
        [{"group": "BT Shape", "options": ["crossover-straps"], "selected": ["crossover-straps"]}],
        "set/item.jpg",
    )
    assert 'Returning {"findings": []} is correct' in messages[1]["content"][0]["text"]


def test_caption_assist_prompt_targets_natural_semantic_prose():
    from tool.server.caption_ops import CAPTION_ASSIST_SYSTEM_PROMPT, build_caption_assist_messages

    assert "Write complete, natural sentences" in CAPTION_ASSIST_SYSTEM_PROMPT
    assert "Interpret each selected value through its annotation group" in CAPTION_ASSIST_SYSTEM_PROMPT
    assert "what the value modifies or describes" in CAPTION_ASSIST_SYSTEM_PROMPT
    assert "comma-separated tag dump" not in CAPTION_ASSIST_SYSTEM_PROMPT

    messages = build_caption_assist_messages(
        assignments=[{"group": "BT Shape", "term": "crossover-straps"}],
        draft="a blue floral bikini",
    )
    assert "Use annotation group names as semantic context" in messages[1]["content"]
