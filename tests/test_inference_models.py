import copy

from tool.server.inference_models import get_inference_model, h3, krea2


def _available(_node_type, _input_name, _label):
    return [
        "model.safetensors",
        "clip.safetensors",
        "video.safetensors",
        "audio.safetensors",
        "base.safetensors",
        "one.safetensors",
        "two.safetensors",
    ]


def _resolve(configured, _available, _label):
    return str(configured).replace("\\", "/")


def test_h3_inference_workflow_supports_multiple_loras_and_frame_anchors():
    template = {
        "115": {"inputs": {"aspect_ratio": "4:3 (Standard)", "megapixels": 0.2}},
        "119": {"inputs": {"vae_name": "video.safetensors"}},
        "120": {"inputs": {"vae_name": "audio.safetensors"}},
        "127": {"inputs": {"unet_name": "model.safetensors"}},
        "128": {"inputs": {"clip_name": "clip.safetensors"}},
        "129": {"inputs": {"noise_seed": 1}},
        "131": {"inputs": {}},
        "133": {"inputs": {"value": 6}},
        "138": {"inputs": {
            "model": ["148", 0],
            "clip": ["148", 1],
        }},
        "141": {"inputs": {"filename_prefix": "old"}},
        "146": {"inputs": {"wildcard_text": "old", "populated_text": "old", "mode": "fixed", "seed": 1}},
        "148": {"inputs": {
            "lora_name": "base.safetensors",
            "strength_model": 0.9,
            "strength_clip": 1,
            "model": ["161", 0],
            "clip": ["128", 0],
        }},
        "161": {"inputs": {"model": ["127", 0]}},
    }
    original = copy.deepcopy(template)

    workflow = h3.build_workflow(
        template,
        "Prompt",
        {"aspectRatio": "16:9 (Widescreen)", "megapixels": 0.3, "duration": 8, "seed": 42},
        [{"name": "one.safetensors", "strength": 0.7}, {"name": "two.safetensors", "strength": 0.5}],
        {"first_frame": "refs/first.png", "last_frame": "refs/last.png"},
        "webcap-generate/job/render",
        _available,
        _resolve,
    )

    assert template == original
    assert "148" in workflow
    assert workflow["148"]["inputs"]["lora_name"] == "base.safetensors"
    assert workflow["138"]["inputs"]["model"] == ["148", 0]
    assert workflow["138"]["inputs"]["clip"] == ["148", 1]
    assert workflow["138"]["inputs"]["lora_1"]["lora"] == "one.safetensors"
    assert workflow["138"]["inputs"]["lora_2"]["lora"] == "two.safetensors"
    assert workflow["131"]["inputs"]["first_frame"] == ["190", 0]
    assert workflow["131"]["inputs"]["last_frame"] == ["191", 0]
    assert workflow["129"]["inputs"]["noise_seed"] == 42
    assert workflow["146"]["inputs"]["wildcard_text"] == "Prompt"
    assert workflow["146"]["inputs"]["populated_text"] == "Prompt"
    assert workflow["146"]["inputs"]["mode"] == "fixed"
    assert workflow["146"]["inputs"]["seed"] == 42

    effective = h3.effective_input(workflow)
    assert effective == {
        "prompt": "Prompt",
        "promptMode": "fixed",
        "seed": 42,
        "aspectRatio": "16:9 (Widescreen)",
        "megapixels": 0.3,
        "durationSeconds": 8,
        "references": {
            "first_frame": "refs/first.png",
            "last_frame": "refs/last.png",
        },
        "loras": [
            {"name": "one.safetensors", "strength": 0.7},
            {"name": "two.safetensors", "strength": 0.5},
        ],
    }


def test_h3_shared_inference_model_uses_dedicated_workflow_with_standalone_turbo():
    model = get_inference_model("minimax_h3")
    assert model.TEMPLATE_PATH.name == "minimax_h3_inference_api.json"

    workflow = model.load_template()
    turbo = workflow["148"]["inputs"]
    power = workflow["138"]["inputs"]

    assert workflow["124"]["inputs"]["steps"] == 8
    assert turbo["lora_name"] == "mh3\\minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors"
    assert turbo["strength_model"] == 0.9
    assert turbo["strength_clip"] == 1
    assert turbo["model"] == ["161", 0]
    assert turbo["clip"] == ["128", 0]
    assert power["model"] == ["148", 0]
    assert power["clip"] == ["148", 1]
    assert workflow["131"]["inputs"]["clip"] == ["138", 1]
    assert not any(
        isinstance(value, dict) and value.get("on") is True and value.get("lora")
        for value in power.values()
    )


def test_h3_rejects_selecting_required_turbo_again():
    model = get_inference_model("minimax_h3")
    template = model.load_template()
    turbo_name = template["148"]["inputs"]["lora_name"]
    assets = {
        ("UNETLoader", "unet_name"): [template["127"]["inputs"]["unet_name"]],
        ("CLIPLoader", "clip_name"): [template["128"]["inputs"]["clip_name"]],
        ("VAELoader", "vae_name"): [
            template["119"]["inputs"]["vae_name"],
            template["120"]["inputs"]["vae_name"],
        ],
        ("LoraLoader", "lora_name"): [turbo_name],
    }

    def available_names(node_type, input_name, _label):
        return assets[(node_type, input_name)]

    def resolve(configured, _available, _label):
        return configured

    import pytest
    with pytest.raises(RuntimeError, match="required H3 workflow"):
        h3.build_workflow(
            template,
            "Prompt",
            {"aspectRatio": "4:3 (Standard)", "megapixels": 0.2, "duration": 7, "seed": 1},
            [{"name": turbo_name, "strength": 0.5}],
            {},
            "webcap-generate/job/render",
            available_names,
            resolve,
        )


def test_krea2_inference_workflow_moves_selected_loras_into_power_loader():
    template = {
        "210": {"inputs": {"vae_name": "video.safetensors"}},
        "213": {"inputs": {"filename_prefix": "old"}},
        "276": {"inputs": {"seed": 1}},
        "315": {"inputs": {
            "model": ["334", 0],
            "clip": ["334", 1],
            "lora_1": {"on": True, "lora": "base.safetensors", "strength": 1},
        }},
        "316": {"inputs": {"unet_name": "model.safetensors"}},
        "317": {"inputs": {"clip_name": "clip.safetensors"}},
        "328": {"inputs": {"dimensions": "832 x 1216"}},
        "332": {"inputs": {"wildcard_text": "old", "populated_text": "old", "mode": "fixed", "seed": 1}},
        "334": {"inputs": {"lora_name": "candidate.safetensors"}},
    }

    workflow = krea2.build_workflow(
        template,
        "Image prompt",
        {"dimensions": "832 x 1216", "seed": 99},
        [{"name": "one.safetensors", "strength": 0.8}],
        {},
        "webcap-generate/job/render",
        _available,
        _resolve,
    )

    assert "334" not in workflow
    assert workflow["315"]["inputs"]["model"] == ["316", 0]
    assert workflow["315"]["inputs"]["clip"] == ["317", 0]
    assert workflow["315"]["inputs"]["lora_2"] == {
        "on": True,
        "lora": "one.safetensors",
        "strength": 0.8,
    }
    assert workflow["276"]["inputs"]["seed"] == 99
