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
    assert filter_graph.index("trim=start_frame=7") < filter_graph.index("setpts=PTS-STARTPTS") < filter_graph.index("crop=320:240:4:8")
    assert "atrim=start=0.291667:duration=2.000000" in filter_graph
    assert "crop=320:240:4:8" in filter_graph
    assert "aac" in command


def test_extract_frame_writes_native_png_and_copies_source_caption(tmp_path, monkeypatch):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    source.with_suffix(".txt").write_text("source caption", encoding="utf-8")
    output = tmp_path / "source-frame-0001.png"
    fingerprint = video_frame_ops._source_fingerprint(source)
    video_frame_ops._frame_cache[fingerprint] = {"timestamps": [0.0, 0.1], "usedAt": 0}
    monkeypatch.setattr(video_frame_ops, "_extract_frame_png", lambda path, index: b"native-png")
    monkeypatch.setattr(video_frame_ops, "normalize_path_permissions", lambda path: None)

    resolved = video_frame_ops.extract_video_frame(source, 1, fingerprint, output)

    assert resolved["frameIndex"] == 1
    assert output.read_bytes() == b"native-png"
    assert output.with_suffix(".txt").read_text(encoding="utf-8") == "source caption"


def test_extract_frame_rejects_stale_fingerprint_and_existing_output(tmp_path, monkeypatch):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"before")
    stale_fingerprint = video_frame_ops._source_fingerprint(source)
    source.write_bytes(b"after")
    output = tmp_path / "frame.png"

    with pytest.raises(RuntimeError, match="changed after frame inspection"):
        video_frame_ops.extract_video_frame(source, 0, stale_fingerprint, output)

    fingerprint = video_frame_ops._source_fingerprint(source)
    video_frame_ops._frame_cache[fingerprint] = {"timestamps": [0.0], "usedAt": 0}
    output.write_bytes(b"existing")
    monkeypatch.setattr(video_frame_ops, "_extract_frame_png", lambda path, index: b"new-png")

    with pytest.raises(RuntimeError, match="already exists"):
        video_frame_ops.extract_video_frame(source, 0, fingerprint, output)


def test_extract_frame_uses_parent_set_folder_for_src_videos(tmp_path):
    set_folder = tmp_path / "set"
    source_folder = set_folder / "src_videos"
    source_folder.mkdir(parents=True)

    assert video_frame_ops._set_media_folder(source_folder) == set_folder


def test_exact_frame_controls_and_payload_are_wired_for_clip_modal():
    root = Path(__file__).parents[1]
    html = (root / "tool" / "templates" / "video_clip_modal.html").read_text(encoding="utf-8")
    script = (root / "tool" / "js" / "video_clip.js").read_text(encoding="utf-8")
    styles = (root / "tool" / "css" / "modals.css").read_text(encoding="utf-8")

    assert "'/media/video_clip_frame'" in script
    assert "payload.exactStart" in script
    assert 'id="video-clip-check-frame-btn"' not in html
    assert 'id="video-clip-use-exact-start-btn"' not in html
    assert 'id="video-clip-frame-back-btn"' not in html
    assert 'id="video-clip-frame-forward-btn"' not in html
    assert 'id="video-clip-preview-frame-btn"' not in html
    assert 'id="video-clip-current-frame-status"' not in html
    assert '+30s' not in html
    assert '+15s' not in html
    assert 'video-clip-time-pill' not in html
    assert 'video-clip-rate-btn' not in html
    assert 'id="video-clip-rate-select"' in html
    assert '>Loop<' in html
    assert '>-5s<' in html
    assert '>+5s<' in html
    assert 'id="video-clip-extract-frame-btn"' in html
    assert 'id="video-clip-extract-frame-candidate"' in html
    assert 'id="video-clip-timeline-start-label"' in html
    assert 'id="video-clip-timeline-end-label"' in html
    assert '◀ 1f' in html
    assert '1f ▶' in html

    stage_start = html.index('id="video-clip-preview-stage"')
    exact_preview = html.index('id="video-clip-exact-frame-preview"')
    crop_layer = html.index('id="video-clip-crop-edit-layer"')
    assert stage_start < exact_preview < crop_layer

    assert "function stepVideoClipExactFrame(direction)" in script
    assert "frameIndex: videoClipExactFrame.frameIndex + stepDirection" in script
    assert "if (!changed) {\n    updateVideoClipTimelineUi();\n    return;\n  }" in script
    assert "}, { align: false });" in script
    assert "function updateVideoClipSourceTransport()" in script
    assert "isVideoClipInSrcVideosFolder()" in script
    assert "function stepVideoClipFrame(direction)" not in script
    assert "requestVideoClipExactFrame(null, function () { commitVideoClipExactStart(); })" in script
    assert "function commitVideoClipExactStart()" in script
    assert "'/media/video_clip_extract_frame'" in script
    assert "videoClipFrameExtractionOpen" in script
    assert "frameIndex: frame.frameIndex" in script
    assert "extractBtn.disabled = videoClipExactFrameRequestPending || !videoClipTargetItem;" in script
    assert "function beginVideoClipFrameExtraction() {\n  requestVideoClipExactFrame(null" in script
    assert "getVideoClipDefaultExtractName()" in script

    exact_frame_setter = script[script.index("function setVideoClipExactFrame"):script.index("function requestVideoClipExactFrame")]
    assert "videoClipExactStart = null" not in exact_frame_setter
    assert "resetVideoClipFrameExtraction()" not in exact_frame_setter
    assert "startEl.addEventListener('change', function () {\n      videoClipExactStart = null;" in script
    assert "function finishVideoClipCropEdit()" in script
    assert "function yieldVideoClipCropEdit()" in script
    assert "yieldVideoClipCropEdit();\n  stopVideoClipLoopPreview();" in script
    assert "yieldVideoClipCropEdit();\n  var sourceDuration" in script
    assert "yieldVideoClipCropEdit();\n  stopVideoClipLoopPreview();\n  try { videoEl.pause(); }" in script
    assert "videoClipInlineCropper.getData(true)" in script
    assert "setVideoClipRatio(getVideoClipNativeRatio(), { preserveCrop: true });" in script
    assert "function getVideoClipNativeRatio()" in script
    assert "btn.classList.toggle('native-match', nativeMatch);" in script
    assert "btn.disabled = videoClipCropBusy || unchanged;" in script
    assert "videoClipCropEditActive || videoClipExactFrame" in script
    assert "video-clip-crop-apply" not in html
    assert "video-clip-crop-cancel" not in html
    assert "Full frame" not in html
    assert "video-clip-skip-forward-15-btn" not in script
    assert "video-clip-rate-btn" not in script
    assert "video-clip-crop-apply" not in script
    assert "video-clip-crop-cancel" not in script
    assert "video-clip-crop-apply" not in styles
    assert "video-clip-crop-cancel" not in styles
    assert "video-clip-extract-name-input" not in styles
    assert html.index('class="video-clip-transport-extract"') < html.index('class="video-clip-settings-panel"')
