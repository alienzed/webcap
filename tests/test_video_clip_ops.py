from pathlib import Path

import pytest

import tool.server.app as app_module
import tool.server.video_clip_ops as video_clip_ops


def test_new_clip_export_is_atomic_and_copies_caption(tmp_path, monkeypatch):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source-video")
    source.with_suffix(".txt").write_text("source caption", encoding="utf-8")
    output = tmp_path / "offset.mp4"
    observed = {}

    def fake_run(source_path, temp_path, start_sec, duration_sec, crop_rect):
        observed["source"] = source_path
        observed["temp"] = temp_path
        assert not output.exists()
        temp_path.write_bytes(b"exported-video")

    monkeypatch.setattr(video_clip_ops, "_run_clip_ffmpeg", fake_run)
    monkeypatch.setattr(video_clip_ops, "normalize_path_permissions", lambda path: None)

    video_clip_ops._run_clip_ffmpeg_new_file(
        source,
        output,
        1.0,
        2.0,
        {"x": 0, "y": 0, "width": 320, "height": 240},
    )

    assert observed["source"] == source
    assert observed["temp"] != output
    assert output.read_bytes() == b"exported-video"
    assert output.with_suffix(".txt").read_text(encoding="utf-8") == "source caption"
    assert not observed["temp"].exists()


def test_failed_new_clip_export_leaves_no_destination(tmp_path, monkeypatch):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source-video")
    output = tmp_path / "offset.mp4"
    observed = {}

    def fake_run(source_path, temp_path, start_sec, duration_sec, crop_rect):
        observed["temp"] = temp_path
        temp_path.write_bytes(b"partial-video")
        raise RuntimeError("encode failed")

    monkeypatch.setattr(video_clip_ops, "_run_clip_ffmpeg", fake_run)

    with pytest.raises(RuntimeError, match="encode failed"):
        video_clip_ops._run_clip_ffmpeg_new_file(
            source,
            output,
            1.0,
            2.0,
            {"x": 0, "y": 0, "width": 320, "height": 240},
        )

    assert not output.exists()
    assert not observed["temp"].exists()


def test_named_export_cannot_bypass_reversible_source_overwrite(tmp_path, monkeypatch):
    source_folder = tmp_path / "set"
    source_folder.mkdir()
    (source_folder / "source.mp4").write_bytes(b"source-video")

    monkeypatch.setattr(video_clip_ops, "safe_join_fs_root", lambda folder: source_folder)
    monkeypatch.setattr(
        video_clip_ops,
        "probe_media_metadata",
        lambda path: {"resolution": "320x240", "duration": 4.0},
    )

    response = app_module.app.test_client().post(
        "/media/video_clip",
        json={
            "folder": "set",
            "fileName": "source.mp4",
            "outputName": "source.mp4",
            "startSec": 0,
            "durationSec": 2,
            "crop": {"x": 0, "y": 0, "width": 320, "height": 240},
            "overwrite": True,
            "overwriteSource": False,
        },
    )

    assert response.status_code == 400
    assert "source overwrite mode" in response.get_json()["error"]
    assert (source_folder / "source.mp4").read_bytes() == b"source-video"


def test_queued_clip_reserves_non_overwrite_output_path(tmp_path, monkeypatch):
    source_folder = tmp_path / "set"
    source_folder.mkdir()
    (source_folder / "source.mp4").write_bytes(b"source-video")
    monkeypatch.setattr(video_clip_ops, "safe_join_fs_root", lambda _folder: source_folder)
    monkeypatch.setattr(video_clip_ops, "probe_media_metadata", lambda _path: {"resolution": "320x240", "duration": 10.0})
    monkeypatch.setattr(video_clip_ops, "_ensure_clip_worker_started", lambda: None)
    with video_clip_ops._video_clip_lock:
        video_clip_ops._video_clip_jobs.clear()
        video_clip_ops._video_clip_signatures.clear()

    client = app_module.app.test_client()
    base = {
        "folder": "set",
        "fileName": "source.mp4",
        "outputName": "same.mp4",
        "durationSec": 2,
        "crop": {"x": 0, "y": 0, "width": 320, "height": 240},
        "overwrite": False,
        "overwriteSource": False,
    }
    first = client.post("/media/video_clip", json={**base, "startSec": 0})
    second = client.post("/media/video_clip", json={**base, "startSec": 3})

    assert first.status_code == 202
    assert second.status_code == 409
    assert second.get_json()["outputName"] == "same.mp4"


def test_storyboard_clip_opens_registered_take_and_sequence(tmp_path, monkeypatch):
    from io import BytesIO
    from tool.server import storyboard_store
    from tool.server.video_frame_ops import resolve_storyboard_clip_source

    monkeypatch.setattr(storyboard_store.app_config, "output_root", lambda: tmp_path / "output")
    story = storyboard_store.create_story({"title": "Clip sources"})
    story, scene = storyboard_store.add_scene(story["id"], {"title": "Scene"})
    story, take = storyboard_store.add_take_upload(
        story["id"], scene["id"], "source.mp4", BytesIO(b"video")
    )
    payload = {
        "storyId": story["id"],
        "mediaPath": take["mediaPath"],
        "fileName": Path(take["mediaPath"]).name,
    }
    source = resolve_storyboard_clip_source(payload)
    assert source.read_bytes() == b"video"

    exports = source.parents[2] / "exports"
    exports.mkdir(exist_ok=True)
    sequence = exports / "selected-sequence.mp4"
    sequence.write_bytes(b"joined")
    assert resolve_storyboard_clip_source({
        "storyId": story["id"], "mediaPath": "exports/selected-sequence.mp4",
        "fileName": "selected-sequence.mp4",
    }) == sequence

    with pytest.raises(RuntimeError, match="not registered"):
        resolve_storyboard_clip_source({
            "storyId": story["id"], "mediaPath": "takes/" + scene["id"] + "/unregistered.mp4",
        })
    with pytest.raises(RuntimeError, match="supports Storyboard"):
        resolve_storyboard_clip_source({
            "storyId": story["id"], "mediaPath": "../other.mp4",
        })


def test_storyboard_clip_queues_validated_overwrite_and_save_as(tmp_path, monkeypatch):
    from io import BytesIO
    from tool.server import storyboard_store

    monkeypatch.setattr(storyboard_store.app_config, "output_root", lambda: tmp_path / "output")
    story = storyboard_store.create_story({"title": "Clip queue"})
    story, scene = storyboard_store.add_scene(story["id"], {"title": "Scene"})
    story, take = storyboard_store.add_take_upload(
        story["id"], scene["id"], "source.mp4", BytesIO(b"video")
    )
    monkeypatch.setattr(video_clip_ops, "probe_media_metadata", lambda _path: {"resolution": "320x240", "duration": 10.0})
    monkeypatch.setattr(video_clip_ops, "_ensure_clip_worker_started", lambda: None)
    with video_clip_ops._video_clip_lock:
        video_clip_ops._video_clip_jobs.clear()
        video_clip_ops._video_clip_signatures.clear()

    original = Path(take["mediaPath"]).name
    request = {
        "storyId": story["id"],
        "mediaPath": take["mediaPath"],
        "fileName": original,
        "outputName": original,
        "startSec": 1,
        "durationSec": 2,
        "crop": {"x": 0, "y": 0, "width": 320, "height": 240},
        "overwriteSource": True,
    }
    client = app_module.app.test_client()
    overwrite = client.post("/media/video_clip", json=request)
    assert overwrite.status_code == 202
    assert overwrite.get_json()["overwriteSource"] is True

    named = client.post("/media/video_clip", json={
        **request, "outputName": "alternate.mp4", "overwriteSource": False,
    })
    assert named.status_code == 202
    assert named.get_json()["outputName"] == "alternate.mp4"
    assert not (tmp_path / "output" / "storyboards" / story["id"] / "takes" / scene["id"] / "alternate.mp4").exists()
