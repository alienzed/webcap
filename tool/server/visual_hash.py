import io
import subprocess
from pathlib import Path

from PIL import Image, ImageOps

from .originals import file_hash


VISUAL_HASH_VERSION = 1
DHASH_BITS = 64


def _dhash_image(image):
    normalized = ImageOps.exif_transpose(image).convert("L")
    resized = normalized.resize((9, 8), Image.Resampling.LANCZOS)
    value = 0
    for y in range(8):
        for x in range(8):
            value = (value << 1) | int(resized.getpixel((x, y)) > resized.getpixel((x + 1, y)))
    return format(value, "016x")


def image_dhash(source):
    with Image.open(source) as image:
        return _dhash_image(image)


def _first_video_frame_png(source):
    command = [
        "ffmpeg",
        "-v", "error",
        "-i", str(source),
        "-map", "0:v:0",
        "-frames:v", "1",
        "-f", "image2pipe",
        "-vcodec", "png",
        "pipe:1",
    ]
    proc = subprocess.run(command, capture_output=True)
    if proc.returncode != 0 or not proc.stdout:
        error = (proc.stderr or b"").decode("utf-8", "replace").strip()
        raise RuntimeError("ffmpeg first-frame extraction failed: " + error)
    return proc.stdout


def video_dhash(source):
    frame = _first_video_frame_png(source)
    with Image.open(io.BytesIO(frame)) as image:
        return _dhash_image(image)


def fingerprint_media(path, kind):
    source = Path(path)
    result = {
        "version": VISUAL_HASH_VERSION,
        "sha256": file_hash(source),
        "dhash": None,
        "bits": DHASH_BITS,
    }
    try:
        result["dhash"] = video_dhash(source) if kind == "video" else image_dhash(source)
    except Exception as exc:
        result["dhash_error"] = str(exc)
    return result
