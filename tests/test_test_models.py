import copy

from tool.server.test_models import get_test_model, supported_models


def test_supported_test_models_come_from_profile_policy():
    models = {item["id"]: item for item in supported_models()}

    assert models["minimax_h3"]["mediaKind"] == "video"
    assert models["minimax_h3"]["settings"] == ["aspectRatio", "megapixels", "duration", "seed"]
    assert models["minimax_h3"]["default"] is True
    assert models["krea2_raw"]["mediaKind"] == "image"
    assert models["krea2_raw"]["settings"] == ["dimensions", "seed"]
    assert models["krea2_raw"]["default"] is False


def test_registered_test_models_satisfy_shared_runner_contract():
    for item in supported_models():
        model = get_test_model(item["id"])
        template = model.load_template()
        prompt = model.default_prompt(template)
        settings = model.normalize_settings(template, lambda: 12345, model.template_settings(template))

        assert isinstance(prompt, str) and prompt.strip()
        assert settings["seed"] == 12345
        assert isinstance(model.build_workflow(
            template,
            prompt,
            None,
            settings=settings,
            filename_prefix="webcap-tests/contract/base",
        ), dict)
        assert isinstance(model.build_workflow(
            template,
            prompt,
            "webcap-contract-test.safetensors",
            settings=settings,
            filename_prefix="webcap-tests/contract/candidate",
        ), dict)
        assert model.MEDIA_KIND in ("image", "video")


def test_test_model_without_setting_options_uses_empty_choices():
    model = get_test_model("minimax_h3")
    template = model.load_template()

    assert model.setting_options(template, lambda *_args: []) == {}


def test_registered_test_models_reject_seeds_outside_shared_range():
    for item in supported_models():
        model = get_test_model(item["id"])
        template = model.load_template()
        values = model.template_settings(template)
        values["seed"] = 4294967296

        try:
            model.normalize_settings(template, lambda: 1, values)
        except ValueError as exc:
            assert "4294967295" in str(exc)
        else:
            raise AssertionError(item["id"] + " accepted an oversized Test seed")


def test_krea_candidate_replaces_only_candidate_slot_and_test_bindings():
    model = get_test_model("krea2_raw")
    template = model.load_template()
    original_fixed_loras = copy.deepcopy(template["315"]["inputs"])
    workflow = model.build_workflow(
        template,
        "controlled prompt",
        "krea2/run-03__epoch24.safetensors",
        settings={
            "dimensions": " 832 x 1216  (portrait)",
            "seed": 123456,
        },
        filename_prefix="webcap-tests/session/candidate/render",
    )

    assert workflow["334"]["inputs"]["lora_name"] == "krea2/run-03__epoch24.safetensors"
    assert workflow["334"]["inputs"]["strength_model"] == 1
    assert workflow["334"]["inputs"]["strength_clip"] == 1
    assert workflow["315"]["inputs"] == original_fixed_loras
    assert workflow["332"]["inputs"]["wildcard_text"] == "controlled prompt"
    assert workflow["332"]["inputs"]["populated_text"] == "controlled prompt"
    assert workflow["332"]["inputs"]["mode"] == "fixed"
    assert workflow["276"]["inputs"]["seed"] == 123456
    assert workflow["328"]["inputs"]["dimensions"] == " 832 x 1216  (portrait)"
    assert workflow["213"]["inputs"]["filename_prefix"] == "webcap-tests/session/candidate/render"


def test_krea_base_bypasses_only_candidate_slot():
    model = get_test_model("krea2_raw")
    template = model.load_template()
    original_fixed_loras = {
        key: copy.deepcopy(value)
        for key, value in template["315"]["inputs"].items()
        if key.startswith("lora_")
    }

    workflow = model.build_workflow(
        template,
        "controlled prompt",
        None,
        settings={
            "dimensions": " 832 x 1216  (portrait)",
            "seed": 789,
        },
    )

    assert "334" not in workflow
    assert workflow["315"]["inputs"]["model"] == ["316", 0]
    assert workflow["315"]["inputs"]["clip"] == ["317", 0]
    for key, value in original_fixed_loras.items():
        assert workflow["315"]["inputs"][key] == value


def test_krea_output_contract_is_image_media():
    model = get_test_model("krea2_raw")
    output = model.find_output_ref({
        "213": {
            "images": [
                {
                    "filename": "render_00001_.png",
                    "subfolder": "webcap-tests/session/candidate",
                    "type": "output",
                }
            ]
        }
    })

    assert model.MEDIA_KIND == "image"
    assert output == {
        "filename": "render_00001_.png",
        "subfolder": "webcap-tests/session/candidate",
        "type": "output",
        "fullpath": "",
    }


def test_krea_default_settings_come_from_supplied_workflow():
    model = get_test_model("krea2_raw")
    template = model.load_template()

    assert model.default_prompt(template) == template["332"]["inputs"]["wildcard_text"]
    assert model.template_settings(template) == {
        "dimensions": template["328"]["inputs"]["dimensions"],
    }
