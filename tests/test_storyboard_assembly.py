import json
from io import BytesIO
from types import SimpleNamespace

import pytest

from tool.server import storyboard_assembly
from tool.server import storyboard_store


@pytest.fixture
def storyboard_fs(tmp_path, monkeypatch):
    monkeypatch.setattr(storyboard_store.app_config, "FS_ROOT", str(tmp_path))
    monkeypatch.setattr(storyboard_store.app_config, "output_root", lambda: tmp_path / "output")
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
    assert "0:v:0" in observed["command"]


def test_mismatched_streams_return_warnings_until_encoding_is_explicit(storyboard_fs, monkeypatch):
    story, _first_scene, second_scene, _first_take, second_take = _story_with_selected_videos()
    signatures = [
        [{"codec_type": "video", "codec_name": "h264", "width": 768, "height": 768, "pix_fmt": "yuv420p", "r_frame_rate": "24/1"}],
        [{"codec_type": "video", "codec_name": "h264", "width": 1280, "height": 720, "pix_fmt": "yuv420p", "r_frame_rate": "24/1"}],
    ]
    monkeypatch.setattr(storyboard_assembly, "_probe_stream_signature", lambda path: signatures[0] if path.name == "first.mp4" else signatures[1])

    result = storyboard_assembly.export_selected_sequence(story["id"])

    assert result["requiresEncoding"] is True
    assert len(result["warnings"]) == 1
    assert result["warnings"][0]["sceneId"] == second_scene["id"]
    assert result["warnings"][0]["takeId"] == second_take["id"]
    assert result["warnings"][0]["differences"] == ["resolution 1280x720 (expected 768x768)"]


def test_explicit_encoding_normalizes_then_splices_mismatched_streams(storyboard_fs, monkeypatch):
    story, _first_scene, _second_scene, _first_take, _second_take = _story_with_selected_videos()
    signatures = [
        [{"codec_type": "video", "codec_name": "h264", "width": 768, "height": 768, "pix_fmt": "yuv420p", "r_frame_rate": "24/1"}],
        [{"codec_type": "video", "codec_name": "h264", "width": 1280, "height": 720, "pix_fmt": "yuv420p", "r_frame_rate": "24/1"}],
    ]
    monkeypatch.setattr(storyboard_assembly, "_probe_stream_signature", lambda path: signatures[0] if path.name == "first.mp4" else signatures[1])
    monkeypatch.setattr(storyboard_assembly, "normalize_path_permissions", lambda _path: None)

    commands = []

    def fake_run(command, capture_output, text):
        commands.append(command)
        with open(command[-1], "wb") as handle:
            handle.write(b"video")
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(storyboard_assembly.subprocess, "run", fake_run)

    output = storyboard_assembly.export_selected_sequence(story["id"], encode=True)

    assert output["encoded"] is True
    assert sum("libx264" in command for command in commands) == 2
    assert commands[-1][commands[-1].index("-c") + 1] == "copy"


def test_selected_sequence_rejects_non_video_take(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, scene = storyboard_store.add_scene(story["id"], {"title": "Still"})
    story, take = storyboard_store.add_take_upload(
        story["id"], scene["id"], "still.png", BytesIO(b"image")
    )
    storyboard_store.select_take(story["id"], scene["id"], take["id"])

    with pytest.raises(RuntimeError, match="video Takes only"):
        storyboard_assembly.selected_sequence(story["id"])


def test_current_export_survives_process_state_and_detects_selection_changes(storyboard_fs, monkeypatch):
    story, first_scene, second_scene, first_take, second_take = _story_with_selected_videos()
    _loaded, items = storyboard_assembly.selected_sequence(story["id"])
    monkeypatch.setattr(
        storyboard_assembly,
        "_probe_stream_signature",
        lambda _path: [{"codec_type": "video", "codec_name": "h264", "width": 768, "height": 768}],
    )
    monkeypatch.setattr(storyboard_assembly, "normalize_path_permissions", lambda _path: None)

    def fake_run(command, capture_output, text):
        with open(command[-1], "wb") as handle:
            handle.write(b"joined-video")
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(storyboard_assembly.subprocess, "run", fake_run)
    storyboard_assembly._assemble(story["id"], items)

    current = storyboard_assembly.current_export(story["id"])
    assert current["current"] is True
    assert current["selection"] == [
        {"sceneId": first_scene["id"], "takeId": first_take["id"]},
        {"sceneId": second_scene["id"], "takeId": second_take["id"]},
    ]

    storyboard_store.select_take(story["id"], first_scene["id"], "")
    stale = storyboard_assembly.current_export(story["id"])
    assert stale["current"] is False
