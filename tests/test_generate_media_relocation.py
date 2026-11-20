import json
from pathlib import Path

import pytest

from tool.server import config as app_config
from tool.server import external_exports, generate_store, media_explorer, storage_manager


@pytest.fixture
def generation(tmp_path, monkeypatch):
    files = tmp_path / "files"
    files.mkdir()
    output = tmp_path / "output"
    monkeypatch.setattr(app_config, "FS_ROOT", files)
    monkeypatch.setattr(app_config, "output_root", lambda: output)
    monkeypatch.setattr(storage_manager, "_active_generate_job_ids", lambda: set())
    directory = output / "generations" / "2026-11-20" / "job-1"
    directory.mkdir(parents=True)
    original = directory / "result.mp4"
    original.write_bytes(b"original video")
    manifest = directory / "generation.json"
    manifest.write_text(json.dumps({
        "jobId": "job-1", "createdAt": 1000, "modelId": "test",
        "mediaKind": "video", "mediaPath": "generations/2026-11-20/job-1/result.mp4",
        "references": {}, "sourcePrompt": "prompt"
    }))
    (files / "Keepers").mkdir()
    (files / "Archive").mkdir()
    return files, directory, manifest, original


def test_move_preserves_record_and_reuses_existing_destination(generation):
    root, directory, manifest, original = generation
    moved = generate_store.relocate_result_media("2026-11-20/job-1", "Keepers")
    assert moved["ok"]
    assert not original.exists()
    relocated = root / moved["location"]
    assert relocated.read_bytes() == b"original video"
    result = generate_store.load_result("2026-11-20/job-1")
    assert result["storageId"] == "2026-11-20/job-1"
    assert result["rating"] == 0
    assert result["mediaUrl"].endswith("storageId=2026-11-20/job-1")
    assert generate_store.result_for_job("job-1")["organizedMediaPath"] == moved["location"]
    assert generate_store.resolve_owned_result_media("2026-11-20/job-1") == relocated
    assert not (directory / "result.mp4").exists()
    discovered = media_explorer.discover_generate(limit=500)
    assert len(discovered) == 1
    assert discovered[0]["relativePath"] == moved["location"]
    assert discovered[0]["id"] == "generate:generations/2026-11-20/job-1/result.mp4"
    assert media_explorer.list_media(source="generate", curation="unsorted")["total"] == 0


def test_move_again_keeps_one_file_and_tags_work(generation):
    root, directory, manifest, original = generation
    generate_store.relocate_result_media("2026-11-20/job-1", "Keepers")
    second = generate_store.relocate_result_media("2026-11-20/job-1", "Archive")
    assert len(list((root / "Keepers").iterdir())) == 0
    assert len(list((root / "Archive").iterdir())) == 1
    tagged = generate_store.tag_result("2026-11-20/job-1", ["keeper"])
    assert tagged["tags"] == ["keeper"]
    assert generate_store.load_result("2026-11-20/job-1")["tags"] == ["keeper"]
    copied = external_exports.copy_generated_media({
        "storageIds": ["2026-11-20/job-1"], "destination": "Keepers"
    })
    assert copied["copied"][0]["name"].endswith(".mp4")
    assert (root / "Keepers" / copied["copied"][0]["name"]).read_bytes() == b"original video"
    assert (root / second["location"]).exists()


def test_restore_before_trash_preserves_complete_owner_bundle(generation):
    root, directory, manifest, original = generation
    moved = generate_store.relocate_result_media("2026-11-20/job-1", "Keepers")
    generate_store.restore_result_media_for_deletion("2026-11-20/job-1")
    assert original.read_bytes() == b"original video"
    assert not (root / moved["location"]).exists()
    assert "organizedMediaPath" not in json.loads(manifest.read_text())
    assert generate_store.load_result("2026-11-20/job-1")["mediaPath"].endswith("result.mp4")


@pytest.mark.parametrize("destination", ["../escape", "/tmp", "output", "missing"])
def test_relocation_rejects_missing_or_illegal_destinations(generation, destination):
    root, directory, manifest, original = generation
    with pytest.raises((ValueError, FileNotFoundError)):
        generate_store.relocate_result_media("2026-11-20/job-1", destination)
    assert original.exists()
