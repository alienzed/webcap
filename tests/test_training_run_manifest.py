import json
from pathlib import Path

import pytest

from tool.server import training_run_manifest


def test_selected_epoch_manifest_is_created_replaced_and_cleared(tmp_path):
    run = tmp_path / "20260923_120000"
    epoch12 = run / "epoch12"
    epoch18 = run / "epoch18"
    epoch12.mkdir(parents=True)
    epoch18.mkdir()
    first = epoch12 / "adapter.safetensors"
    second = epoch18 / "adapter.safetensors"
    first.write_bytes(b"one")
    second.write_bytes(b"two")

    assert training_run_manifest.selected_epoch(run, "001-subject/001-h3") is None

    selected = training_run_manifest.select_epoch(
        run, "001-subject/001-h3", 12, 2400, "epoch12/adapter.safetensors"
    )
    assert selected["epoch"] == 12
    assert selected["step"] == 2400
    assert selected["file"] == "epoch12/adapter.safetensors"
    assert selected["selectedAt"].endswith("Z")

    manifest = json.loads((run / "webcap-run.json").read_text(encoding="utf-8"))
    assert manifest["schemaVersion"] == 1
    assert manifest["runId"] == "001-subject/001-h3"
    assert manifest["selected"]["epoch"] == 12

    replacement = training_run_manifest.select_epoch(
        run, "001-subject/001-h3", 18, 3600, "epoch18/adapter.safetensors"
    )
    assert replacement["epoch"] == 18
    assert training_run_manifest.selected_epoch(run, "001-subject/001-h3")["epoch"] == 18

    assert training_run_manifest.clear_selected_epoch(run, "001-subject/001-h3") is None
    cleared = json.loads((run / "webcap-run.json").read_text(encoding="utf-8"))
    assert "selected" not in cleared
    assert cleared["runId"] == "001-subject/001-h3"


def test_manifest_refuses_wrong_identity_and_unsafe_selected_paths(tmp_path):
    run = tmp_path / "20260923_120000"
    run.mkdir()
    (run / "webcap-run.json").write_text(json.dumps({
        "schemaVersion": 1,
        "runId": "001-subject/002-h3",
    }), encoding="utf-8")

    with pytest.raises(ValueError, match="identity"):
        training_run_manifest.selected_epoch(run, "001-subject/001-h3")

    (run / "webcap-run.json").unlink()
    with pytest.raises(ValueError, match="relative"):
        training_run_manifest.select_epoch(run, "001-subject/001-h3", 12, 2400, "../escape.safetensors")


def test_manifest_refuses_invalid_existing_json_without_overwriting(tmp_path):
    run = tmp_path / "20260923_120000"
    run.mkdir()
    path = run / "webcap-run.json"
    path.write_text("{broken", encoding="utf-8")
    before = path.read_bytes()

    with pytest.raises(ValueError, match="left unchanged"):
        training_run_manifest.select_epoch(run, "001-subject/001-h3", 12, 2400, "epoch12/adapter.safetensors")

    assert path.read_bytes() == before
