import json
from io import BytesIO
from types import SimpleNamespace

import pytest

from tool.server import storyboard_assembly
from tool.server import storyboard_store


@pytest.fixture
def storyboard_fs(tmp_path, monkeypatch):
    monkeypatch.setattr(storyboard_store.app_config, "FS_ROOT", str(tmp_path))
    return tmp_path


def _story_with_selected_videos():
    story = storyboard_store.create_story({"title": "Story"})
    story, first_scene = storyboard_store.add_scene(story["id"], {"title": "First"})
    story, second_scene = storyboard_store.add_scene(story["id"], {"title": "Second"})
    story, first_take = storyboard_store.add_take_upload(
        story["id"], first_scene["id"], "first.mp4", BytesIO(b"first-video")
    )
    story, second_take = storyboard_store.add_take_upload(
        story["id"], second_scene["id"], "second.mp4", BytesIO(b"second-video")
    )
    story = storyboard_store.select_take(story["id"], first_scene["id"], first_take["id"])
    story = storyboard_store.select_take(story["id"], second_scene["id"], second_take["id"])
    return story, first_scene, second_scene, first_take, second_take


def test_selected_sequence_follows_scene_order(storyboard_fs):
    story, first_scene, second_scene, first_take, second_take = _story_with_selected_videos()

    _loaded, items = storyboard_assembly.selected_sequence(story["id"])

    assert [(item["sceneId"], item["takeId"]) for item in items] == [
        (first_scene["id"], first_take["id"]),
        (second_scene["id"], second_take["id"]),
    ]


def test_assemble_losslessly_splices_matching_selected_takes(storyboard_fs, monkeypatch):
    story, _first_scene, _second_scene, first_take, second_take = _story_with_selected_videos()
    _loaded, items = storyboard_assembly.selected_sequence(story["id"])
    monkeypatch.setattr(
        storyboard_assembly,
        "_probe_stream_signature",
        lambda _path: [{"codec_type": "video", "codec_name": "h264", "width": 768, "height": 768}],
    )
    monkeypatch.setattr(storyboard_assembly, "normalize_path_permissions", lambda _path: None)

    observed = {}

    def fake_run(command, capture_output, text):
        observed["command"] = command
        output = command[-1]
        with open(output, "wb") as handle:
            handle.write(b"joined-video")
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(storyboard_assembly.subprocess, "run", fake_run)

    output = storyboard_assembly._assemble(story["id"], items)

    story_dir = storyboard_fs / "output" / "storyboards" / story["id"]
    assert (story_dir / "exports" / "selected-sequence.mp4").read_bytes() == b"joined-video"
    manifest = json.loads((story_dir / "exports" / "selected-sequence.json").read_text(encoding="utf-8"))
    assert [item["takeId"] for item in manifest["items"]] == [first_take["id"], second_take["id"]]
    assert output["itemCount"] == 2
    assert "-c" in observed["command"]
    assert "copy" in observed["command"]


def test_assemble_rejects_mismatched_streams_instead_of_reencoding(storyboard_fs, monkeypatch):
    story, _first_scene, _second_scene, _first_take, _second_take = _story_with_selected_videos()
    _loaded, items = storyboard_assembly.selected_sequence(story["id"])
    signatures = iter([
        [{"codec_type": "video", "codec_name": "h264", "width": 768, "height": 768}],
        [{"codec_type": "video", "codec_name": "h264", "width": 1280, "height": 720}],
    ])
    monkeypatch.setattr(storyboard_assembly, "_probe_stream_signature", lambda _path: next(signatures))

    with pytest.raises(RuntimeError, match="lossless splice"):
        storyboard_assembly._assemble(story["id"], items)


def test_selected_sequence_rejects_non_video_take(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, scene = storyboard_store.add_scene(story["id"], {"title": "Still"})
    story, take = storyboard_store.add_take_upload(
        story["id"], scene["id"], "still.png", BytesIO(b"image")
    )
    storyboard_store.select_take(story["id"], scene["id"], take["id"])

    with pytest.raises(RuntimeError, match="video Takes only"):
        storyboard_assembly.selected_sequence(story["id"])
