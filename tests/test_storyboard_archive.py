"""Storyboard's destructive archive keeps its movie and reproducible recipes."""
import io

import pytest

from tool.server import storyboard_archive, storyboard_store, storyboard_assembly, config


@pytest.fixture
def archive_root(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "output_root", lambda: tmp_path / "output")
    return tmp_path / "output"


def _story_with_export(root):
    story = storyboard_store.create_story({"title": "Movie"})
    story, scene = storyboard_store.add_scene(story["id"], {"title": "Opening", "prompt": "A storm"})
    story, take = storyboard_store.add_take_upload(
        story["id"], scene["id"], "scene.mp4", io.BytesIO(b"video"),
        generated_provenance={
            "prompt": "A storm", "sourcePrompt": "A storm",
            "seed": 42, "seedMode": "random", "durationSeconds": 6,
            "aspectRatio": "4:3 (Standard)", "megapixels": 0.2,
            "loras": [], "references": [],
            "workflowProfile": "minimax_h3_inference_v1",
        },
    )
    story = storyboard_store.select_take(story["id"], scene["id"], take["id"])
    export_path = root / "storyboards" / story["id"] / "exports"
    export_path.mkdir(parents=True)
    (export_path / "selected-sequence.mp4").write_bytes(b"the complete film")
    (export_path / "selected-sequence.json").write_text(
        '{"storyId":"' + story["id"] + '","createdAt":"2026-10-18T00:00:00+00:00",'
        '"selection":[{"sceneId":"' + scene["id"] + '","takeId":"' + take["id"] + '"}]}',
        encoding="utf-8",
    )
    return story, scene, take


def test_archive_requires_export(archive_root):
    story = storyboard_store.create_story({"title": "Not exported"})
    with pytest.raises(ValueError, match="Export"):
        storyboard_archive.archive_preview(story["id"])


def test_archive_retains_movie_recipe_and_reclaims_generated_media(archive_root):
    story, scene, take = _story_with_export(archive_root)
    preview = storyboard_archive.archive_preview(story["id"])
    assert preview["reclaimableBytes"] == 5
    assert preview["purgeTakeCount"] == 1

    result = storyboard_archive.archive_story(story["id"])
    assert result["reclaimedBytes"] == 5
    saved = storyboard_store.load_story(story["id"])
    archived_take = saved["scenes"][scene["id"]]["takes"][take["id"]]
    assert saved["status"] == "archived"
    assert archived_take["mediaPurged"] is True
    assert archived_take["seed"] == 42
    assert saved["scenes"][scene["id"]]["selectedTakeId"] == take["id"]
    assert not (archive_root / "storyboards" / story["id"] / take["mediaPath"]).exists()
    assert (archive_root / "storyboards" / story["id"] / "exports" / "selected-sequence.mp4").read_bytes() == b"the complete film"
    assert storyboard_assembly.current_export(story["id"])["current"] is True
    assert storyboard_archive.archive_preview(story["id"])["reclaimableBytes"] == 0


def test_archive_keeps_imported_and_referenced_media(archive_root):
    story, scene, take = _story_with_export(archive_root, None)
    story, imported = storyboard_store.add_take_upload(
        story["id"], scene["id"], "import.png", io.BytesIO(b"original"))
    story, source_image = storyboard_store.add_take_upload(
        story["id"], scene["id"], "generated.png", io.BytesIO(b"image"),
        generated_provenance={"seed": 19, "workflowProfile": "minimax_h3_inference_v1"},
    )
    story, another = storyboard_store.add_scene(story["id"], {"prompt": "Next"})
    story, reference = storyboard_store.set_scene_reference_from_take(
        story["id"], another["id"], "first_frame", scene["id"], source_image["id"], "first"
    )
    result = storyboard_archive.archive_story(story["id"])
    assert result["preview"]["retainedImportedCount"] == 1
    assert result["preview"]["retainedReferencedTakeCount"] == 1
    assert result["preview"]["purgeTakeCount"] == 1
    assert (archive_root / "storyboards" / story["id"] / imported["mediaPath"]).is_file()
    assert (archive_root / "storyboards" / story["id"] / reference["mediaPath"]).is_file()
