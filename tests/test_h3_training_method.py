"""Run-captured H3 guidance methods must be exclusive and checkpoint-stable."""
import tomllib
from pathlib import Path

import pytest

from tool.server import config as app_config
from tool.server.training_config_files import (
    apply_h3_training_method, apply_h3_resumed_model, h3_ostris_training_adapter_path,
)
from tool.server.training_history import _h3_training_method


SOURCE = '[model]\\ntype = "minimax_h3"\\ndiffusion_model = "/models/standard_h3.safetensors"\\nshift = 8\\ncfg = 4\\n'


def test_cfg_method_removes_any_previous_adapter_and_keeps_guidance():
    original = SOURCE + 'merge_adapters = ["/models/old.safetensors"]\\n'
    saved = tomllib.loads(apply_h3_training_method(original, "cfg"))
    assert saved["model"]["cfg"] == 4
    assert "merge_adapters" not in saved["model"]
    assert saved["model"]["shift"] == 8


def test_ostris_method_replaces_cfg_with_one_fixed_model_file(tmp_path, monkeypatch):
    monkeypatch.setitem(app_config.config["filesystem"], "models", str(tmp_path / "models"))
    captured = apply_h3_training_method(SOURCE, "ostris")
    saved = tomllib.loads(captured)
    assert "cfg" not in saved["model"]
    assert saved["model"]["diffusion_model"] == "/models/standard_h3.safetensors"
    assert saved["model"]["merge_adapters"] == [h3_ostris_training_adapter_path()]
    assert saved["model"]["shift"] == 8
    assert _h3_training_method(saved) == "ostris"
    assert tomllib.loads(SOURCE)["model"]["cfg"] == 4


def test_resume_inherits_exact_saved_adapter_path_and_cfg():
    saved = {
        "diffusion_model": "/models/standard_h3.safetensors",
        "merge_adapters": ["/models/old-v2.safetensors"],
        "cfg": None,
    }
    captured = tomllib.loads(apply_h3_resumed_model(SOURCE, saved))
    assert captured["model"]["merge_adapters"] == ["/models/old-v2.safetensors"]
    assert "cfg" not in captured["model"]
    assert captured["model"]["shift"] == 8


def test_unrecognized_training_method_fails_loudly():
    with pytest.raises(ValueError, match="Unknown H3 training method"):
        apply_h3_training_method(SOURCE, "mixed")


def test_wrong_model_type_fails_loudly():
    with pytest.raises(ValueError, match="MiniMax H3 config"):
        apply_h3_training_method(SOURCE.replace('minimax_h3', 'krea2'), "ostris")
