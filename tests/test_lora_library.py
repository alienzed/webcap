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
