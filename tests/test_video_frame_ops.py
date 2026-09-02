import json
from pathlib import Path
from types import SimpleNamespace

import pytest

import tool.server.video_clip_ops as video_clip_ops
import tool.server.video_frame_ops as video_frame_ops


def test_frame_inspection_caches_timestamps_and_returns_decoded_preview(tmp_path, monkeypatch):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    calls = []
    video_frame_ops._frame_cache.clear()

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        if cmd[0] == "ffprobe":
            return SimpleNamespace(
                returncode=0,
                stdout=json.dumps({"frames": [
                    {"best_effort_timestamp_time": "0.000000"},
                    {"best_effort_timestamp_time": "0.041667"},
                    {"best_effort_timestamp_time": "0.083333"},
                ]}),
                stderr="",
            )
        assert cmd[0] == "ffmpeg"
        assert any(value.startswith("select=eq(n\\,") for value in cmd)
        return SimpleNamespace(returncode=0, stdout=b"png-bytes", stderr=b"")

    monkeypatch.setattr(video_frame_ops.subprocess, "run", fake_run)

    checked = video_frame_ops.inspect_video_frame(source, approximate_time=0.05)
    adjacent = video_frame_ops.inspect_video_frame(source, frame_index=1)

    assert checked["frameIndex"] == 2
    assert checked["timestampSec"] == pytest.approx(0.083333)
    assert checked["previewDataUrl"] == "data:image/png;base64,cG5nLWJ5dGVz"
    assert adjacent["frameIndex"] == 1
    assert len([call for call in calls if call[0] == "ffprobe"]) == 1


def test_exact_start_rejects_a_changed_source(tmp_path, monkeypatch):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"before")
    video_frame_ops._frame_cache.clear()

    checked_fingerprint = video_frame_ops._source_fingerprint(source)
    source.write_bytes(b"after changed")

    with pytest.raises(RuntimeError, match="changed after frame inspection"):
        video_frame_ops.resolve_exact_start(source, 0, checked_fingerprint)


def test_exact_export_uses_frame_trim_and_aligned_reencoded_audio(tmp_path, monkeypatch):
    source = tmp_path / "source.mp4"
    output = tmp_path / "clip.mp4"
    source.write_bytes(b"video")
    commands = []

    monkeypatch.setattr(video_clip_ops, "_source_has_audio", lambda path: True)
    monkeypatch.setattr(video_clip_ops, "normalize_path_permissions", lambda path: None)
    monkeypatch.setattr(
        video_clip_ops.subprocess,
        "run",
        lambda cmd, **kwargs: commands.append(cmd) or SimpleNamespace(returncode=0, stdout="", stderr=""),
    )

    video_clip_ops._run_exact_clip_ffmpeg(
        source, output, 7, 0.291667, 2.0, {"x": 4, "y": 8, "width": 320, "height": 240},
    )

    command = commands[0]
    filter_graph = command[command.index("-filter_complex") + 1]
    assert "trim=start_frame=7:duration=2.000000" in filter_graph
    assert "atrim=start=0.291667:duration=2.000000" in filter_graph
    assert "crop=320:240:4:8" in filter_graph
    assert "aac" in command


def test_exact_frame_controls_and_payload_are_wired():
    root = Path(__file__).parents[1]
    html = (root / "tool" / "templates" / "video_clip_modal.html").read_text(encoding="utf-8")
    script = (root / "tool" / "js" / "video_clip.js").read_text(encoding="utf-8")

    assert 'id="video-clip-check-frame-btn"' in html
    assert 'id="video-clip-use-exact-start-btn"' in html
    assert "'/media/video_clip_frame'" in script
    assert "payload.exactStart" in script
