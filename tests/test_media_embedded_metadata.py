import shutil
import subprocess

import pytest
from PIL import Image

from tool.server.media_embedded_metadata import (
    read_webcap_metadata,
    update_webcap_metadata,
    write_webcap_metadata,
)


@pytest.fixture
def sample_payload():
    return {
        "version": 1,
        "sourcePrompt": "a small red square",
        "resolvedPrompt": "a small red square, studio light",
        "model": "example-model",
        "seed": 42,
        "loras": [{"name": "detail.safetensors", "strength": 0.75}],
        "rating": 4,
        "tags": {"viewpoint": ["front"], "quality": ["keeper"]},
    }


def _decoded_pixels(path):
    with Image.open(path) as image:
        image.load()
        return image.mode, image.size, image.tobytes()


@pytest.mark.parametrize("suffix, save_kwargs", [
    (".png", {}),
    (".jpg", {"quality": 91}),
    (".webp", {"quality": 88}),
])
def test_image_metadata_round_trip_preserves_decoded_pixels(tmp_path, sample_payload, suffix, save_kwargs):
    path = tmp_path / ("sample" + suffix)
    Image.new("RGB", (17, 13), (125, 42, 210)).save(path, **save_kwargs)
    before = _decoded_pixels(path)

    written = write_webcap_metadata(path, sample_payload)

    assert written == sample_payload
    assert read_webcap_metadata(path) == sample_payload
    assert _decoded_pixels(path) == before


@pytest.mark.parametrize("suffix", [".png", ".jpg", ".jpeg", ".webp"])
def test_image_metadata_can_be_replaced_without_stale_payload(tmp_path, suffix):
    path = tmp_path / ("sample" + suffix)
    format_name = "JPEG" if suffix in {".jpg", ".jpeg"} else None
    Image.new("RGB", (9, 7), (20, 40, 60)).save(path, format=format_name)

    write_webcap_metadata(path, {"version": 1, "rating": 1, "sourcePrompt": "first"})
    update_webcap_metadata(path, {"rating": 5, "sourcePrompt": "second"})

    assert read_webcap_metadata(path) == {
        "version": 1,
        "rating": 5,
        "sourcePrompt": "second",
    }


def test_jpeg_metadata_supports_payloads_larger_than_one_comment_segment(tmp_path):
    path = tmp_path / "large.jpg"
    Image.new("RGB", (8, 8), (1, 2, 3)).save(path, quality=90)
    prompt = "x" * 140000

    write_webcap_metadata(path, {"version": 1, "sourcePrompt": prompt})

    assert read_webcap_metadata(path)["sourcePrompt"] == prompt


def test_missing_metadata_returns_none(tmp_path):
    path = tmp_path / "plain.png"
    Image.new("RGB", (4, 4), (3, 2, 1)).save(path)

    assert read_webcap_metadata(path) is None


def test_unsupported_format_fails_loudly(tmp_path):
    path = tmp_path / "sample.txt"
    path.write_text("hello", encoding="utf-8")

    with pytest.raises(ValueError, match="Unsupported embedded metadata"):
        write_webcap_metadata(path, {"version": 1})


def _ffmpeg_available():
    return shutil.which("ffmpeg") and shutil.which("ffprobe")


def _make_mp4(path):
    proc = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v", "error",
            "-f", "lavfi",
            "-i", "color=c=red:s=32x24:d=0.25:r=8",
            "-an",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            str(path),
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        pytest.skip("ffmpeg cannot create the MP4 test fixture: " + (proc.stderr or "").strip())


def _frame_hash(path):
    proc = subprocess.run(
        [
            "ffmpeg",
            "-v", "error",
            "-i", str(path),
            "-map", "0:v:0",
            "-f", "framemd5",
            "-",
        ],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
    return proc.stdout


@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg/ffprobe required")
def test_mp4_metadata_round_trip_uses_stream_copy(tmp_path, sample_payload):
    path = tmp_path / "sample.mp4"
    _make_mp4(path)
    before_frames = _frame_hash(path)

    write_webcap_metadata(path, sample_payload)

    assert read_webcap_metadata(path) == sample_payload
    assert _frame_hash(path) == before_frames


@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg/ffprobe required")
def test_mp4_metadata_updates_replace_the_embedded_payload(tmp_path):
    path = tmp_path / "sample.mp4"
    _make_mp4(path)

    write_webcap_metadata(path, {"version": 1, "rating": 1})
    update_webcap_metadata(path, {"rating": 3, "sourcePrompt": "updated"})

    assert read_webcap_metadata(path) == {
        "version": 1,
        "rating": 3,
        "sourcePrompt": "updated",
    }
