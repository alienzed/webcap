"""Tests for checkpoint metadata import and WebCap overlay persistence."""
import json
import struct

import pytest

from tool.server.model_epoch_profile import (
    embedded_metadata, read_sources, save_enrichment, validate_enrichment,
)


def make_checkpoint(path, metadata=None):
    header = json.dumps({"__metadata__": metadata or {}}).encode("utf-8")
    path.write_bytes(struct.pack("<Q", len(header)) + header)


def test_reads_all_sources_without_loading_weights(tmp_path):
    model = tmp_path / "epoch90.safetensors"
    make_checkpoint(model, {"ss_epoch": "90"})
    model.with_suffix(".json").write_text('{"description": "SD WebUI"}')
    model.with_suffix(".civitai.info").write_text('{"trainedWords": ["trigger"]}')
    model.with_suffix(".webcap.json").write_text('{"version": 1, "sourceEpoch": 90}')
    sources = read_sources(model)
    assert sources["embedded"]["ss_epoch"] == "90"
    assert sources["sidecar"]["description"] == "SD WebUI"
    assert sources["civitai"]["trainedWords"] == ["trigger"]
    assert sources["webcap"]["sourceEpoch"] == 90


def test_save_preserves_existing_provenance_and_unknown_fields(tmp_path):
    model = tmp_path / "epoch90.safetensors"
    make_checkpoint(model, {"ss_epoch": "90"})
    sidecar = model.with_suffix(".webcap.json")
    sidecar.write_text(json.dumps({"version": 1, "sourceEpoch": 90,
                                   "assessments": {"manual": {"sum": 2}},
                                   "modelProfile": {"futureField": True}}))
    before = model.read_bytes()
    save_enrichment(model, {"description": "Portrait LoRA", "trainedWords": ["trigger"],
                            "promptOptions": {"viewpoint": ["front", "rear"]}})
    data = json.loads(sidecar.read_text())
    assert data["sourceEpoch"] == 90
    assert data["assessments"]["manual"]["sum"] == 2
    assert data["modelProfile"]["futureField"] is True
    assert data["modelProfile"]["enrichment"]["promptOptions"]["viewpoint"] == ["front", "rear"]
    assert model.read_bytes() == before


def test_invalid_edit_never_replaces_sidecar(tmp_path):
    model = tmp_path / "epoch90.safetensors"
    make_checkpoint(model)
    sidecar = model.with_suffix(".webcap.json")
    sidecar.write_text('{"version": 1}')
    with pytest.raises(ValueError):
        save_enrichment(model, {"trainedWords": "bad"})
    assert sidecar.read_text() == '{"version": 1}'


def test_rejects_malformed_header(tmp_path):
    model = tmp_path / "bad.safetensors"
    model.write_bytes(struct.pack("<Q", 999999999))
    with pytest.raises(ValueError):
        embedded_metadata(model)


def test_named_options_must_be_arrays():
    with pytest.raises(ValueError):
        validate_enrichment({"promptOptions": {"view": "rear"}})
