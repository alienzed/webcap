import json
from pathlib import Path

import pytest

from tool.server import lora_library


def test_catalogue_discovers_only_enriched_sidecars(tmp_path, monkeypatch):
    root = tmp_path / "models"
    root.mkdir()
    (root / "identity.safetensors").write_bytes(b"unused")
    (root / "identity.webcap.json").write_text(json.dumps({"modelProfile": {
        "schemaVersion": 1, "enrichment": {"description": "Identity", "trainedWords": ["identity-key"]}
    }}), encoding="utf-8")
    (root / "other.safetensors").write_bytes(b"unused")
    monkeypatch.setattr(lora_library, "roots", lambda: {"h3": root})
    items = lora_library.catalogue()
    assert len(items) == 2
    assert items[0]["enriched"] is True
    assert items[1]["enriched"] is False


def test_profile_write_keeps_unrelated_sidecar_keys(tmp_path, monkeypatch):
    root = tmp_path / "models"
    root.mkdir()
    (root / "demo.safetensors").write_bytes(b"unused")
    sidecar = root / "demo.webcap.json"
    sidecar.write_text(json.dumps({"sourceActionId": "keep"}), encoding="utf-8")
    monkeypatch.setattr(lora_library, "roots", lambda: {"h3": root})
    lora_library.profile("h3", "demo.safetensors", {"description": "New"})
    saved = json.loads(sidecar.read_text(encoding="utf-8"))
    assert saved["sourceActionId"] == "keep"
    assert saved["modelProfile"]["enrichment"]["description"] == "New"


def test_profile_rejects_path_traversal(tmp_path, monkeypatch):
    monkeypatch.setattr(lora_library, "roots", lambda: {"h3": tmp_path})
    with pytest.raises(ValueError):
        lora_library.profile("h3", "../other.safetensors")


def test_resolve_catalogue_name_to_comfy_selection(monkeypatch):
    from tool.server import inference_runtime, generate_generation
    from tool.server import lora_library
    monkeypatch.setattr(lora_library, "catalogue", lambda: [
        {"stage": "h3", "name": "Run/identity.safetensors", "enriched": True},
    ])
    monkeypatch.setattr(generate_generation, "_public_model", lambda model: {
        "loras": ["identity.safetensors", "other.safetensors"]
    })
    assert lora_library.resolve_for_inference("h3", ["Run/identity.safetensors"]) == {
        "Run/identity.safetensors": "identity.safetensors"
    }


def test_resolve_rejects_missing_or_ambiguous_comfy_name(monkeypatch):
    from tool.server import generate_generation
    monkeypatch.setattr(lora_library, "catalogue", lambda: [
        {"stage": "h3", "name": "Run/identity.safetensors", "enriched": True},
    ])
    monkeypatch.setattr(generate_generation, "_public_model", lambda model: {
        "loras": ["one/identity.safetensors", "two/identity.safetensors"]
    })
    with pytest.raises(RuntimeError, match="ambiguous"):
        lora_library.resolve_for_inference("h3", ["Run/identity.safetensors"])
    with pytest.raises(ValueError, match="not enriched"):
        lora_library.resolve_for_inference("h3", ["unknown.safetensors"])
