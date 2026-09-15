import io
from types import SimpleNamespace

from PIL import Image

import tool.server.visual_hash as visual_hash


def _png_bytes(color):
    image = Image.new("RGB", (24, 16), color)
    image.putpixel((4, 4), (255, 255, 255))
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def test_image_fingerprint_is_deterministic_and_keeps_sha(tmp_path):
    source = tmp_path / "photo.png"
    source.write_bytes(_png_bytes((20, 80, 180)))

    first = visual_hash.fingerprint_media(source, "image")
    second = visual_hash.fingerprint_media(source, "image")

    assert first == second
    assert first["version"] == visual_hash.VISUAL_HASH_VERSION
    assert len(first["sha256"]) == 64
    assert len(first["dhash"]) == 16
    assert first["bits"] == 64
    assert first["source_size"] == source.stat().st_size
    assert first["source_mtime_ns"] == source.stat().st_mtime_ns


def test_video_fingerprint_uses_one_first_frame(tmp_path, monkeypatch):
    source = tmp_path / "clip.mp4"
    source.write_bytes(b"video bytes")
    commands = []

    def fake_run(command, capture_output):
        commands.append(command)
        return SimpleNamespace(returncode=0, stdout=_png_bytes((30, 120, 90)), stderr=b"")

    monkeypatch.setattr(visual_hash.subprocess, "run", fake_run)
    result = visual_hash.fingerprint_media(source, "video")

    command = commands[0]
    assert command[0] == "ffmpeg"
    assert command[command.index("-map") + 1] == "0:v:0"
    assert command[command.index("-frames:v") + 1] == "1"
    assert result["dhash"]


def test_fuzzy_failure_keeps_exact_hash(tmp_path, monkeypatch):
    source = tmp_path / "broken.png"
    source.write_bytes(b"not an image")
    monkeypatch.setattr(visual_hash, "image_dhash", lambda _path: (_ for _ in ()).throw(RuntimeError("decode failed")))

    result = visual_hash.fingerprint_media(source, "image")

    assert len(result["sha256"]) == 64
    assert result["dhash"] is None
    assert result["dhash_error"] == "decode failed"
