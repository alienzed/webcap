"""Conservative media-detail measurement tests; no real model or GPU required."""
import threading

from PIL import Image, ImageDraw, ImageFilter

from tool.server import media_quality


def _checker():
    image = Image.new("L", (512, 512), 128)
    draw = ImageDraw.Draw(image)
    for y in range(0, 512, 32):
        for x in range(0, 512, 32):
            draw.rectangle((x, y, x + 15, y + 15), fill=30 if (x + y) // 32 % 2 else 225)
    return image


def test_sharp_detail_exceeds_blurred_same_scene():
    sharp = _checker()
    blurred = sharp.filter(ImageFilter.GaussianBlur(5))
    sharp_score = media_quality._signal(sharp)
    blurred_score = media_quality._signal(blurred)
    assert sharp_score is not None and blurred_score is not None
    assert sharp_score > blurred_score


def test_flat_frame_is_unknown_not_bad():
    assert media_quality._signal(Image.new("L", (512, 512), 128)) is None


def test_versioned_block_requires_valid_detail():
    source = {"version": media_quality.QUALITY_VERSION, "method": "multiscale-detail",
              "detailSignal": 17.3, "sampleCount": 4}
    assert media_quality.current_quality({"quality": source})
    assert not media_quality.current_quality({"quality": {**source, "version": 0}})
    assert not media_quality.current_quality({"quality": {**source, "detailSignal": float("nan")}})
    assert media_quality.current_quality({"quality": {**source, "detailSignal": None}})


def test_video_samples_spread_across_short_clip_without_full_decode(monkeypatch, tmp_path):
    path = tmp_path / "movie.mp4"
    path.write_bytes(b"fake")
    times = []
    def fake_decode(_path, when, width, height):
        times.append(when)
        return _checker()
    monkeypatch.setattr(media_quality, "_video_frame", fake_decode)
    result = media_quality.analyze_media_quality(
        path, {"resolution": "3840x2160", "duration": 1.0})
    assert len(times) == 6
    assert 0 < times[0] < 0.2 and 0.8 < times[-1] < 1
    assert result["sampleCount"] == 6 and result["measurableCount"] == 6
    assert all(x["detailSignal"] is not None for x in result["samples"])


def test_video_partial_decode_keeps_useful_samples(monkeypatch, tmp_path):
    path = tmp_path / "movie.mp4"
    path.write_bytes(b"fake")
    def fake_decode(_path, when, width, height):
        if when < 0.5:
            raise RuntimeError("bad first half")
        return _checker()
    monkeypatch.setattr(media_quality, "_video_frame", fake_decode)
    result = media_quality.analyze_media_quality(
        path, {"resolution": "1280x720", "duration": 1.0})
    assert result["sampleCount"] == 3 and result["failedSamples"] == 3
    assert result["detailSignal"] is not None


def test_cancellation_does_not_decode(monkeypatch, tmp_path):
    path = tmp_path / "movie.mp4"
    path.write_bytes(b"fake")
    canceled = threading.Event()
    canceled.set()
    monkeypatch.setattr(media_quality, "_video_frame",
                        lambda *args: (_ for _ in ()).throw(AssertionError("decoded after stop")))
    try:
        media_quality.analyze_media_quality(
            path, {"resolution": "1920x1080", "duration": 4}, cancel=canceled)
    except InterruptedError:
        pass
    else:
        raise AssertionError("Expected canceled scan to stop before decode")
