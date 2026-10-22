import copy

import pytest

from tool.server.inference_models import get_inference_model
from tool.server.test_models import get_test_model
from tool.server.inference_models import h3 as inference_h3
from tool.server.test_models import h3 as test_h3


@pytest.mark.parametrize("mode,steps,turbo", [
    ("current", 8, 0.9),
    ("single", 8, 1.0),
    ("no_turbo", 20, None),
])
def test_inference_sampling_workflow_is_explicit(mode, steps, turbo):
    model = get_inference_model("minimax_h3")
    workflow = model.load_template(mode)
    assert workflow["124"]["inputs"]["steps"] == steps
    power = workflow["138"]["inputs"]
    assert not any(isinstance(v, dict) and v.get("on") is True and
                   "turbo" in str(v.get("lora", "")).lower() for v in power.values())
    if turbo is None:
        assert "148" not in workflow
        assert power["model"] == ["161", 0]
        assert power["clip"] == ["128", 0]
        assert inference_h3.base_loras(workflow) == []
    else:
        assert workflow["148"]["inputs"]["strength_model"] == turbo
        assert power["model"] == ["148", 0]
        assert len(inference_h3.base_loras(workflow)) == 1


@pytest.mark.parametrize("mode,steps,turbo_on", [
    ("current", 8, True),
    ("single", 8, True),
    ("no_turbo", 20, False),
])
def test_test_sampling_workflow_keeps_candidate_separate(mode, steps, turbo_on):
    model = get_test_model("minimax_h3")
    template = model.load_template(mode)
    assert template["124"]["inputs"]["steps"] == steps
    assert template["138"]["inputs"]["lora_1"]["on"] is turbo_on
    if turbo_on:
        assert template["138"]["inputs"]["lora_1"]["strength"] == 1
    created = test_h3.build_workflow(
        template, "A prompt", "candidate.safetensors",
        settings={"aspectRatio": "4:3 (Standard)", "megapixels": 0.2,
                  "duration": 6, "seed": 123, "samplingMode": mode},
        strength_model=0.8,
    )
    assert created["148"]["inputs"]["lora_name"] == "candidate.safetensors"
    assert created["148"]["inputs"]["strength_model"] == 0.8
    assert created["138"]["inputs"]["lora_1"]["on"] is turbo_on
    assert template["148"]["inputs"]["lora_name"] != "candidate.safetensors"
    without_candidate = test_h3.build_workflow(
        template, "A prompt", None,
        settings={"aspectRatio": "4:3 (Standard)", "megapixels": 0.2,
                  "duration": 6, "seed": 123, "samplingMode": mode},
    )
    assert "148" not in without_candidate
    assert without_candidate["138"]["inputs"]["model"] == ["161", 0]


def test_invalid_modes_fail_loudly_and_legacy_mode_is_current():
    model = get_inference_model("minimax_h3")
    legacy = model.normalize_settings(model.load_template(), lambda: 5,
                                      {"duration": 6})
    assert legacy["samplingMode"] == "current"
    with pytest.raises(ValueError, match="sampling mode"):
        model.normalize_settings(model.load_template(), lambda: 5,
                                 {"samplingMode": "typo"})
    with pytest.raises(ValueError, match="sampling mode"):
        get_test_model("minimax_h3").load_template("typo")
