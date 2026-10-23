import pytest

from tool.server.inference_models import get_inference_model
from tool.server.test_models import get_test_model
from tool.server.h3_sampling import normalize_mode, submitted_sampling
from tool.server.inference_models import h3 as inference_h3
from tool.server.test_models import h3 as test_h3


@pytest.mark.parametrize("mode,steps,turbo,sampler,scheduler", [
    ("turbo", 8, 1.0, "euler", "beta"),
    ("quality", 20, None, "res_multistep", "simple"),
])
def test_inference_sampling_workflow_is_explicit(mode, steps, turbo, sampler, scheduler):
    model = get_inference_model("minimax_h3")
    workflow = model.load_template(mode)
    assert workflow["124"]["inputs"]["steps"] == steps
    assert workflow["123"]["inputs"]["sampler_name"] == sampler
    assert workflow["124"]["inputs"]["scheduler"] == scheduler
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


@pytest.mark.parametrize("mode,steps,turbo_on,sampler,scheduler", [
    ("turbo", 8, True, "euler", "beta"),
    ("quality", 20, False, "res_multistep", "simple"),
])
def test_test_sampling_workflow_keeps_candidate_separate(mode, steps, turbo_on, sampler, scheduler):
    model = get_test_model("minimax_h3")
    template = model.load_template(mode)
    assert template["124"]["inputs"]["steps"] == steps
    assert template["123"]["inputs"]["sampler_name"] == sampler
    assert template["124"]["inputs"]["scheduler"] == scheduler
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
    assert created["131"]["inputs"]["clip"] == ["138", 1]
    assert created["138"]["inputs"]["lora_1"]["on"] is turbo_on
    assert template["148"]["inputs"]["lora_name"] != "candidate.safetensors"
    without_candidate = test_h3.build_workflow(
        template, "A prompt", None,
        settings={"aspectRatio": "4:3 (Standard)", "megapixels": 0.2,
                  "duration": 6, "seed": 123, "samplingMode": mode},
    )
    assert "148" not in without_candidate
    assert without_candidate["138"]["inputs"]["model"] == ["161", 0]
    assert without_candidate["131"]["inputs"]["clip"] == ["138", 1]


def test_invalid_modes_fail_loudly_and_legacy_mode_is_current():
    model = get_inference_model("minimax_h3")
    legacy = model.normalize_settings(model.load_template(), lambda: 5,
                                      {"duration": 6})
    assert legacy["samplingMode"] == "turbo"
    with pytest.raises(ValueError, match="sampling mode"):
        model.normalize_settings(model.load_template(), lambda: 5,
                                 {"samplingMode": "typo"})
    with pytest.raises(ValueError, match="sampling mode"):
        get_test_model("minimax_h3").load_template("typo")


@pytest.mark.parametrize("raw,expected", [
    (None, "turbo"), ("current", "turbo"), ("single", "turbo"),
    ("no_turbo", "quality"), ("turbo", "turbo"), ("quality", "quality"),
])
def test_legacy_aliases_normalize_without_a_third_execution_mode(raw, expected):
    assert normalize_mode(raw) == expected
    assert get_inference_model("minimax_h3").template_path(raw) == get_inference_model("minimax_h3").template_path(expected)
    assert get_test_model("minimax_h3").template_path(raw) == get_test_model("minimax_h3").template_path(expected)


@pytest.mark.parametrize("mode,steps,has_turbo", [
    ("turbo", 8, True), ("quality", 20, False),
])
def test_actual_generate_graph_contains_correct_turbo(mode, steps, has_turbo):
    model = get_inference_model("minimax_h3")
    template = model.load_template(mode)
    values = model.normalize_settings(template, lambda: 99, {"samplingMode": mode})
    graph = inference_h3.build_workflow(
        template, "H3 sample", values, [{"name": "my-candidate.safetensors", "strength": 0.7}],
        {}, "test", lambda *_: [], lambda name, *_: name,
    )
    evidence = submitted_sampling(graph, mode)
    assert evidence["steps"] == steps
    assert evidence["sampler"] == ("euler" if mode == "turbo" else "res_multistep")
    assert evidence["scheduler"] == ("beta" if mode == "turbo" else "simple")
    assert evidence["turboEnabled"] is has_turbo
    assert evidence["conditioningUsesLoraClip"] is True
    assert evidence["turboStrength"] == (1.0 if has_turbo else None)
    assert len(evidence["loras"]) == (2 if has_turbo else 1)
    assert any(entry["name"] == "my-candidate.safetensors" and entry["strength"] == 0.7
               for entry in evidence["loras"])


@pytest.mark.parametrize("mode,steps,has_turbo", [
    ("turbo", 8, True), ("quality", 20, False),
])
def test_actual_test_graph_contains_candidate_separate_from_turbo(mode, steps, has_turbo):
    model = get_test_model("minimax_h3")
    template = model.load_template(mode)
    settings = model.normalize_settings(template, lambda: 3, {"samplingMode": mode})
    graph = test_h3.build_workflow(
        template, "H3 sample", "candidate.safetensors",
        settings=settings, strength_model=0.8,
    )
    evidence = submitted_sampling(graph, mode)
    assert evidence["steps"] == steps
    assert evidence["sampler"] == ("euler" if mode == "turbo" else "res_multistep")
    assert evidence["scheduler"] == ("beta" if mode == "turbo" else "simple")
    assert evidence["turboEnabled"] is has_turbo
    assert evidence["conditioningUsesLoraClip"] is True
    assert evidence["turboStrength"] == (1.0 if has_turbo else None)
    assert len(evidence["loras"]) == (2 if has_turbo else 1)
    assert any(entry["name"] == "candidate.safetensors" and entry["strength"] == 0.8
               for entry in evidence["loras"])


def test_submitted_graph_rejects_wrong_strength_double_turbo_and_steps():
    import copy
    template = get_inference_model("minimax_h3").load_template("turbo")
    assert submitted_sampling(template, "turbo")["turboStrength"] == 1.0
    weak = copy.deepcopy(template)
    weak["148"]["inputs"]["strength_model"] = 0.9
    with pytest.raises(ValueError, match="exactly one Turbo"):
        submitted_sampling(weak, "turbo")
    doubled = copy.deepcopy(template)
    doubled["138"]["inputs"]["lora_1"] = {
        "on": True, "lora": template["148"]["inputs"]["lora_name"], "strength": 1,
    }
    with pytest.raises(ValueError, match="exactly one Turbo"):
        submitted_sampling(doubled, "turbo")
    wrong_steps = copy.deepcopy(template)
    wrong_steps["124"]["inputs"]["steps"] = 20
    with pytest.raises(ValueError, match="requires 8 steps"):
        submitted_sampling(wrong_steps, "turbo")
    disconnected = copy.deepcopy(template)
    disconnected["138"]["inputs"]["model"] = ["161", 0]
    with pytest.raises(ValueError, match="not connected"):
        submitted_sampling(disconnected, "turbo")
    quality = get_inference_model("minimax_h3").load_template("quality")
    quality["138"]["inputs"]["lora_1"] = {
        "on": True, "lora": template["148"]["inputs"]["lora_name"], "strength": 1,
    }
    with pytest.raises(ValueError, match="must not load a Turbo"):
        submitted_sampling(quality, "quality")


@pytest.mark.parametrize("mode,wrong_sampler,wrong_scheduler", [
    ("turbo", "res_multistep", "simple"),
    ("quality", "euler", "beta"),
])
def test_submitted_graph_rejects_wrong_sampler_and_scheduler(mode, wrong_sampler, wrong_scheduler):
    import copy
    original = get_inference_model("minimax_h3").load_template(mode)
    bad_sampler = copy.deepcopy(original)
    bad_sampler["123"]["inputs"]["sampler_name"] = wrong_sampler
    with pytest.raises(ValueError, match="requires sampler"):
        submitted_sampling(bad_sampler, mode)
    bad_scheduler = copy.deepcopy(original)
    bad_scheduler["124"]["inputs"]["scheduler"] = wrong_scheduler
    with pytest.raises(ValueError, match="requires scheduler"):
        submitted_sampling(bad_scheduler, mode)


def test_submitted_graph_rejects_conditioning_bypass_and_preserves_verified_legacy_wiring():
    import copy
    turbo = get_inference_model("minimax_h3").load_template("turbo")
    bypass = copy.deepcopy(turbo)
    bypass["131"]["inputs"]["clip"] = ["128", 0]
    with pytest.raises(ValueError, match="conditioning bypasses"):
        submitted_sampling(bypass, "turbo")
    old_evidence = submitted_sampling(bypass, "turbo", allow_legacy_test_clip=True)
    assert old_evidence["conditioningUsesLoraClip"] is False
    assert old_evidence["turboStrength"] == 1.0
    wrong = copy.deepcopy(turbo)
    wrong["126"]["inputs"]["model"] = ["161", 0]
    with pytest.raises(ValueError, match="guider"):
        submitted_sampling(wrong, "turbo")
