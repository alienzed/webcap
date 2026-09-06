from pathlib import Path

import pytest

import tool.server.app as app_module
import tool.server.media as media_module


def _response(returncode=0, stdout="", stderr=""):
    class Response:
        pass
    result = Response()
    result.returncode = returncode
    result.stdout = stdout
    result.stderr = stderr
    return result


@pytest.fixture
def fps_set(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    folder.mkdir()
    monkeypatch.setattr(media_module, "safe_join_fs_root", lambda value: folder)
    return folder


@pytest.mark.parametrize("payload, message", [
    ({"folder": "set", "fps": 24}, "Missing media filename"),
    ({"folder": "set", "fileName": "video.mp4"}, "Target FPS must be a number"),
    ({"folder": "set", "fileName": "video.mp4", "fps": "bad"}, "Target FPS must be a number"),
    ({"folder": "set", "fileName": "video.mp4", "fps": 0}, "greater than zero"),
    ({"folder": "set", "fileName": "video.mp4", "fps": -1}, "greater than zero"),
    ({"folder": "set", "fileName": "video.mp4", "fps": "inf"}, "must be finite"),
])
def test_convert_fps_request_validation(fps_set, payload, message):
    response = app_module.app.test_client().post("/media/convert_fps", json=payload)

    assert response.status_code == 400
    assert message in response.get_json()["error"]


def test_convert_fps_rejects_missing_source_and_non_video_file(fps_set):
    client = app_module.app.test_client()
    missing = client.post("/media/convert_fps", json={"folder": "set", "fileName": "missing.mp4", "fps": 24})
    assert missing.status_code == 404

    (fps_set / "note.txt").write_text("not video", encoding="utf-8")
    non_video = client.post("/media/convert_fps", json={"folder": "set", "fileName": "note.txt", "fps": 24})
    assert non_video.status_code == 400
    assert "only available for video files" in non_video.get_json()["error"]


def test_fps_ffmpeg_command_uses_conservative_video_and_audio_policy(tmp_path, monkeypatch):
    source = tmp_path / "source.mp4"
    output = tmp_path / "converted.mp4"
    source.write_bytes(b"source")
    observed = {}

    def fake_run(cmd, capture_output, text):
        observed["cmd"] = cmd
        return _response()

    monkeypatch.setattr(media_module.subprocess, "run", fake_run)
    media_module._run_video_fps_ffmpeg(source, output, 24)

    cmd = observed["cmd"]
    assert ["-map", "0:v:0"] == cmd[cmd.index("-map"):cmd.index("-map") + 2]
    second_map = cmd.index("-map", cmd.index("-map") + 1)
    assert cmd[second_map:second_map + 2] == ["-map", "0:a?"]
    assert cmd[cmd.index("-c:a"):cmd.index("-c:a") + 2] == ["-c:a", "copy"]
    assert cmd[cmd.index("-c:v"):cmd.index("-c:v") + 2] == ["-c:v", "libx264"]
    assert cmd[cmd.index("-preset"):cmd.index("-preset") + 2] == ["-preset", "slow"]
    assert cmd[cmd.index("-crf"):cmd.index("-crf") + 2] == ["-crf", "12"]
    assert cmd[cmd.index("-vf") + 1] == "fps=fps=24:round=near"
    assert all("scale" not in part and "crop" not in part and "minterpolate" not in part for part in cmd)


def test_fps_conversion_is_atomic_and_preserves_original(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    folder.mkdir()
    source = folder / "video.mp4"
    source.write_bytes(b"original-video")
    observed = {}

    monkeypatch.setattr(media_module, "_probe_video_stream", lambda path: {"width": 320, "height": 240, "fps": 24.0 if path == source else 16.0})
    monkeypatch.setattr(media_module, "_media_has_audio", lambda path: False)
    monkeypatch.setattr(media_module, "normalize_path_permissions", lambda path: None)

    def fake_encode(source_path, temp_path, fps):
        observed["temp"] = temp_path
        assert source_path.read_bytes() == b"original-video"
        assert temp_path.parent == source.parent
        assert temp_path != source
        assert temp_path.suffix == ".mp4"
        assert temp_path.name.startswith(".video.convert-")
        temp_path.write_bytes(b"converted-video")

    monkeypatch.setattr(media_module, "_run_video_fps_ffmpeg", fake_encode)
    media_module._convert_video_fps_in_place(source, 16)

    assert source.read_bytes() == b"converted-video"
    assert (folder / "originals" / "video.mp4").read_bytes() == b"original-video"
    assert not observed["temp"].exists()


def test_fps_conversion_failure_leaves_source_untouched_and_cleans_temp(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    folder.mkdir()
    source = folder / "video.mp4"
    source.write_bytes(b"original-video")
    observed = {}

    monkeypatch.setattr(media_module, "_probe_video_stream", lambda path: {"width": 320, "height": 240, "fps": 24.0})
    monkeypatch.setattr(media_module, "_media_has_audio", lambda path: False)

    def failed_encode(source_path, temp_path, fps):
        observed["temp"] = temp_path
        temp_path.write_bytes(b"partial")
        raise RuntimeError("encode failed")

    monkeypatch.setattr(media_module, "_run_video_fps_ffmpeg", failed_encode)
    with pytest.raises(RuntimeError, match="encode failed"):
        media_module._convert_video_fps_in_place(source, 16)

    assert source.read_bytes() == b"original-video"
    assert (folder / "originals" / "video.mp4").read_bytes() == b"original-video"
    assert not observed["temp"].exists()


def test_fps_conversion_rejects_missing_audio_without_replacing_source(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    folder.mkdir()
    source = folder / "video.mp4"
    source.write_bytes(b"original-video")
    observed = {}

    monkeypatch.setattr(media_module, "_probe_video_stream", lambda path: {"width": 320, "height": 240, "fps": 16.0})
    monkeypatch.setattr(media_module, "_media_has_audio", lambda path: path == source)

    def fake_encode(source_path, temp_path, fps):
        observed["temp"] = temp_path
        temp_path.write_bytes(b"video-without-audio")

    monkeypatch.setattr(media_module, "_run_video_fps_ffmpeg", fake_encode)
    with pytest.raises(RuntimeError, match="missing its original audio"):
        media_module._convert_video_fps_in_place(source, 16)

    assert source.read_bytes() == b"original-video"
    assert not observed["temp"].exists()


def test_convert_fps_updates_only_converted_media_metadata(fps_set, monkeypatch):
    source = fps_set / "video.mp4"
    source.write_bytes(b"original-video")
    refreshed = []

    monkeypatch.setattr(media_module, "_convert_video_fps_in_place", lambda path, fps: None)
    monkeypatch.setattr(
        media_module,
        "update_media_metadata",
        lambda folder, scoped_filenames=None: refreshed.append((folder, scoped_filenames)),
    )

    response = app_module.app.test_client().post(
        "/media/convert_fps", json={"folder": "set", "fileName": "video.mp4", "fps": 16},
    )

    assert response.status_code == 200
    assert response.get_json() == {"ok": True, "fps": 16.0}
    assert refreshed == [(fps_set, ["video.mp4"])]


def test_failed_convert_fps_does_not_refresh_metadata(fps_set, monkeypatch):
    (fps_set / "video.mp4").write_bytes(b"original-video")
    refreshed = []

    def fail_convert(path, fps):
        raise RuntimeError("encode failed")

    monkeypatch.setattr(media_module, "_convert_video_fps_in_place", fail_convert)
    monkeypatch.setattr(media_module, "update_media_metadata", lambda *args, **kwargs: refreshed.append(args))

    response = app_module.app.test_client().post(
        "/media/convert_fps", json={"folder": "set", "fileName": "video.mp4", "fps": 16},
    )

    assert response.status_code == 400
    assert response.get_json()["error"] == "encode failed"
    assert refreshed == []
