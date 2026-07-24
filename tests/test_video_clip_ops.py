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
