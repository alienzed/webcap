import json
from pathlib import Path

import pytest

from tool.server.h3_premerge_export import model_paths, quantized_layers, selected_digests


def test_model_paths_reject_non_h3(tmp_path):
    import toml
    config = tmp_path / "config.toml"
    config.write_text(toml.dumps({"model": {"type": "krea2", "diffusion_model": "irrelevant", "merge_adapters": ["adapter"]}}))
    with pytest.raises(ValueError, match="only supports MiniMax H3"):
        model_paths(str(config))


def test_model_paths_reads_existing_adapter_paths(tmp_path):
    import toml
    source = tmp_path / "base.safetensors"
    adapter = tmp_path / "image.safetensors"
    source.touch()
    adapter.touch()
    config = tmp_path / "config.toml"
    config.write_text(toml.dumps({"model": {"type": "minimax_h3", "diffusion_model": str(source), "merge_adapters": [str(adapter)]}}))
    parsed, source_path, adapters = model_paths(config)
    assert source_path == source
    assert adapters == [adapter]


def test_int8_convrot_quant_marker_and_sample_digests():
    torch = pytest.importorskip("torch")
    layer = "blocks.0.proj"
    marker = {"format": "int8_tensorwise", "convrot": True, "convrot_groupsize": 256}
    state = {
        layer + ".weight": torch.ones((2, 2), dtype=torch.int8),
        layer + ".weight_scale": torch.ones(2, dtype=torch.float32),
        layer + ".comfy_quant": torch.tensor(list(json.dumps(marker).encode()), dtype=torch.uint8),
    }
    assert quantized_layers(state) == {layer + ".comfy_quant": marker}
    digests = selected_digests(state, {"diffusion_model." + layer + ".weight"})
    assert digests
    assert all(len(value) == 64 for value in digests.values())
