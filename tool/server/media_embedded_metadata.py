import json
import os
import shutil
import struct
import subprocess
import tempfile
import zlib
from pathlib import Path


METADATA_VERSION = 1
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_PNG_KEY = b"webcap"
_JPEG_PREFIX = b"WebCap\x00"
_WEBP_CHUNK = b"WCAP"
_WEBP_PREFIX = b"WebCap\x00"
_MP4_TAG = "webcap"


def normalize_webcap_metadata(payload):
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        raise TypeError("WebCap media metadata must be a JSON object.")
    normalized = dict(payload)
    version = normalized.get("version", METADATA_VERSION)
    if not isinstance(version, int) or version <= 0:
        raise ValueError("WebCap media metadata version must be a positive integer.")
    normalized["version"] = version
    return normalized


def _encode_payload(payload):
    normalized = normalize_webcap_metadata(payload)
    return json.dumps(normalized, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")


def _decode_payload(raw):
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Embedded WebCap media metadata is unreadable.") from exc
    return normalize_webcap_metadata(payload)


def read_webcap_metadata(path):
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix == ".png":
        raw = _read_png(path)
    elif suffix in {".jpg", ".jpeg"}:
        raw = _read_jpeg(path)
    elif suffix == ".webp":
        raw = _read_webp(path)
    elif suffix == ".mp4":
        raw = _read_mp4(path)
    else:
        raise ValueError("Unsupported embedded metadata media format: " + suffix)
    return _decode_payload(raw) if raw is not None else None


def write_webcap_metadata(path, payload):
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError("Media file does not exist: " + str(path))
    raw = _encode_payload(payload)
    suffix = path.suffix.lower()
    if suffix == ".png":
        _write_bytes_atomic(path, _write_png(path.read_bytes(), raw))
    elif suffix in {".jpg", ".jpeg"}:
        _write_bytes_atomic(path, _write_jpeg(path.read_bytes(), raw))
    elif suffix == ".webp":
        _write_bytes_atomic(path, _write_webp(path.read_bytes(), raw))
    elif suffix == ".mp4":
        _write_mp4(path, raw)
    else:
        raise ValueError("Unsupported embedded metadata media format: " + suffix)
    return normalize_webcap_metadata(payload)


def update_webcap_metadata(path, patch):
    if not isinstance(patch, dict):
        raise TypeError("WebCap media metadata patch must be a JSON object.")
    current = read_webcap_metadata(path) or {"version": METADATA_VERSION}
    current.update(patch)
    return write_webcap_metadata(path, current)


def _write_bytes_atomic(path, data):
    stat = path.stat()
    fd, temp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp_name, stat.st_mode)
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def _png_chunks(data):
    if not data.startswith(_PNG_SIGNATURE):
        raise RuntimeError("Invalid PNG file.")
    offset = len(_PNG_SIGNATURE)
    while offset < len(data):
        if offset + 12 > len(data):
            raise RuntimeError("Truncated PNG chunk.")
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        end = offset + 12 + length
        if end > len(data):
            raise RuntimeError("Truncated PNG chunk payload.")
        chunk_type = data[offset + 4:offset + 8]
        chunk_data = data[offset + 8:offset + 8 + length]
        yield offset, end, chunk_type, chunk_data
        offset = end
    if offset != len(data):
        raise RuntimeError("Invalid PNG trailing data.")


def _png_itxt_chunk(raw):
    chunk_data = _PNG_KEY + b"\x00\x00\x00\x00\x00" + raw
    chunk_type = b"iTXt"
    crc = zlib.crc32(chunk_type)
    crc = zlib.crc32(chunk_data, crc) & 0xFFFFFFFF
    return struct.pack(">I", len(chunk_data)) + chunk_type + chunk_data + struct.pack(">I", crc)


def _read_png(path):
    data = path.read_bytes()
    found = None
    for _, _, chunk_type, chunk_data in _png_chunks(data):
        if chunk_type != b"iTXt":
            continue
        parts = chunk_data.split(b"\x00", 5)
        if len(parts) == 6 and parts[0] == _PNG_KEY:
            if parts[1] != b"\x00":
                raise RuntimeError("Compressed WebCap PNG metadata is unsupported.")
            found = parts[5]
    return found


def _write_png(data, raw):
    output = bytearray(_PNG_SIGNATURE)
    wrote = False
    for start, end, chunk_type, chunk_data in _png_chunks(data):
        if chunk_type == b"iTXt":
            parts = chunk_data.split(b"\x00", 1)
            if parts and parts[0] == _PNG_KEY:
                continue
        if chunk_type == b"IEND" and not wrote:
            output.extend(_png_itxt_chunk(raw))
            wrote = True
        output.extend(data[start:end])
    if not wrote:
        raise RuntimeError("PNG has no IEND chunk.")
    return bytes(output)


def _jpeg_segments(data):
    if not data.startswith(b"\xff\xd8"):
        raise RuntimeError("Invalid JPEG file.")
    offset = 2
    while offset < len(data):
        if data[offset] != 0xFF:
            raise RuntimeError("Invalid JPEG marker stream.")
        marker_start = offset
        while offset < len(data) and data[offset] == 0xFF:
            offset += 1
        if offset >= len(data):
            raise RuntimeError("Truncated JPEG marker.")
        marker = data[offset]
        offset += 1
        if marker == 0xDA:
            if offset + 2 > len(data):
                raise RuntimeError("Truncated JPEG SOS marker.")
            length = struct.unpack(">H", data[offset:offset + 2])[0]
            header_end = offset + length
            if length < 2 or header_end > len(data):
                raise RuntimeError("Invalid JPEG SOS marker.")
            yield marker_start, len(data), marker, data[offset + 2:header_end]
            return
        if marker in {0xD8, 0xD9} or 0xD0 <= marker <= 0xD7 or marker == 0x01:
            yield marker_start, offset, marker, b""
            continue
        if offset + 2 > len(data):
            raise RuntimeError("Truncated JPEG segment.")
        length = struct.unpack(">H", data[offset:offset + 2])[0]
        end = offset + length
        if length < 2 or end > len(data):
            raise RuntimeError("Invalid JPEG segment length.")
        payload = data[offset + 2:end]
        yield marker_start, end, marker, payload
        offset = end
    raise RuntimeError("JPEG has no image data.")


def _jpeg_comment_segments(raw):
    # JPEG segment length is 16-bit and includes its own two-byte length field.
    chunk_size = 60000
    chunks = [raw[i:i + chunk_size] for i in range(0, len(raw), chunk_size)] or [b""]
    if len(chunks) > 65535:
        raise ValueError("WebCap metadata is too large for JPEG chunk numbering.")
    segments = []
    total = len(chunks)
    for index, chunk in enumerate(chunks):
        payload = _JPEG_PREFIX + struct.pack(">HH", index, total) + chunk
        length = len(payload) + 2
        segments.append(b"\xff\xfe" + struct.pack(">H", length) + payload)
    return b"".join(segments)


def _read_jpeg(path):
    chunks = {}
    total = None
    for _, _, marker, payload in _jpeg_segments(path.read_bytes()):
        if marker != 0xFE or not payload.startswith(_JPEG_PREFIX):
            continue
        header = len(_JPEG_PREFIX)
        if len(payload) < header + 4:
            raise RuntimeError("Embedded WebCap JPEG metadata is truncated.")
        index, item_total = struct.unpack(">HH", payload[header:header + 4])
        if total is None:
            total = item_total
        elif total != item_total:
            raise RuntimeError("Embedded WebCap JPEG metadata chunks disagree.")
        chunks[index] = payload[header + 4:]
    if total is None:
        return None
    if total <= 0 or set(chunks) != set(range(total)):
        raise RuntimeError("Embedded WebCap JPEG metadata is incomplete.")
    return b"".join(chunks[index] for index in range(total))


def _write_jpeg(data, raw):
    output = bytearray(data[:2])
    output.extend(_jpeg_comment_segments(raw))
    cursor = 2
    for start, end, marker, payload in _jpeg_segments(data):
        if start < cursor:
            continue
        if marker == 0xDA:
            output.extend(data[start:])
            return bytes(output)
        cursor = end
        if marker == 0xFE and payload.startswith(_JPEG_PREFIX):
            continue
        output.extend(data[start:end])
    raise RuntimeError("JPEG has no SOS marker.")


def _webp_chunks(data):
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise RuntimeError("Invalid WebP file.")
    declared = struct.unpack("<I", data[4:8])[0] + 8
    if declared > len(data):
        raise RuntimeError("Truncated WebP RIFF container.")
    offset = 12
    while offset + 8 <= declared:
        fourcc = data[offset:offset + 4]
        size = struct.unpack("<I", data[offset + 4:offset + 8])[0]
        payload_start = offset + 8
        payload_end = payload_start + size
        chunk_end = payload_end + (size & 1)
        if chunk_end > declared:
            raise RuntimeError("Truncated WebP chunk.")
        yield offset, chunk_end, fourcc, data[payload_start:payload_end]
        offset = chunk_end
    if offset != declared:
        raise RuntimeError("Invalid WebP chunk alignment.")


def _read_webp(path):
    found = None
    for _, _, fourcc, payload in _webp_chunks(path.read_bytes()):
        if fourcc == _WEBP_CHUNK:
            if not payload.startswith(_WEBP_PREFIX):
                raise RuntimeError("Embedded WebCap WebP metadata has an unknown format.")
            found = payload[len(_WEBP_PREFIX):]
    return found


def _write_webp(data, raw):
    chunks = bytearray()
    for start, end, fourcc, _ in _webp_chunks(data):
        if fourcc == _WEBP_CHUNK:
            continue
        chunks.extend(data[start:end])
    payload = _WEBP_PREFIX + raw
    chunks.extend(_WEBP_CHUNK)
    chunks.extend(struct.pack("<I", len(payload)))
    chunks.extend(payload)
    if len(payload) & 1:
        chunks.extend(b"\x00")
    body = b"WEBP" + bytes(chunks)
    if len(body) > 0xFFFFFFFF:
        raise ValueError("WebP file is too large for RIFF.")
    return b"RIFF" + struct.pack("<I", len(body)) + body


def _run_json_command(command, error_prefix):
    proc = subprocess.run(command, capture_output=True, text=True)
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(error_prefix + (": " + detail if detail else ""))
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(error_prefix + ": tool returned invalid JSON.") from exc


def _read_mp4(path):
    payload = _run_json_command(
        [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format_tags",
            "-of", "json",
            str(path),
        ],
        "Could not read MP4 metadata",
    )
    tags = ((payload.get("format") or {}).get("tags") or {})
    value = tags.get(_MP4_TAG)
    if value is None:
        # ffprobe may preserve tag case depending on the muxer.
        for key, candidate in tags.items():
            if str(key).lower() == _MP4_TAG:
                value = candidate
                break
    return str(value).encode("utf-8") if value is not None else None


def _write_mp4(path, raw):
    stat = path.stat()
    fd, temp_name = tempfile.mkstemp(prefix=path.stem + ".", suffix=".mp4", dir=str(path.parent))
    os.close(fd)
    try:
        proc = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-v", "error",
                "-i", str(path),
                "-map", "0",
                "-map_metadata", "0",
                "-c", "copy",
                "-movflags", "+use_metadata_tags",
                "-metadata", _MP4_TAG + "=" + raw.decode("utf-8"),
                temp_name,
            ],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            detail = (proc.stderr or proc.stdout or "").strip()
            raise RuntimeError("Could not write MP4 WebCap metadata" + (": " + detail if detail else ""))
        os.chmod(temp_name, stat.st_mode)
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)
