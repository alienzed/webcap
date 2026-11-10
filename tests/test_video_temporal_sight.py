import io
from pathlib import Path

from PIL import Image

from tool.server import caption_vision, video_frame_ops, vision_schema_assist


def test_video_frame_sampling_is_early_bounded_and_distinct(monkeypatch):
    monkeypatch.setattr(video_frame_ops, "_cached_frame_timestamps", lambda path: (
        "source", [i / 10 for i in range(31)]
    ))
    monkeypatch.setattr(video_frame_ops, "_extract_frame_png", lambda path, index: bytes([index]))
    frames = video_frame_ops.sample_video_sight_frames(Path("long.mp4"))
    assert [round(t, 2) for t, _ in frames] == [0, 0.5, 1.0, 1.5]
    assert [data for _, data in frames] == [bytes([0]), bytes([5]), bytes([10]), bytes([15])]


def test_video_frame_sampling_short_clip_does_not_repeat_last_frame(monkeypatch):
    monkeypatch.setattr(video_frame_ops, "_cached_frame_timestamps", lambda path: (
        "source", [0.0, 0.2, 0.4, 0.6, 0.8]
    ))
    monkeypatch.setattr(video_frame_ops, "_extract_frame_png", lambda path, index: bytes([index]))
    frames = video_frame_ops.sample_video_sight_frames(Path("short.mp4"))
    assert [t for t, _ in frames] == [0.0, 0.6]


def test_video_sight_images_are_resized_and_no_files_are_written(monkeypatch, tmp_path):
    source = tmp_path / "clip.mp4"
    source.write_bytes(b"placeholder")
    original = Image.new("RGB", (3840, 2160))
    buffer = io.BytesIO()
    original.save(buffer, format="PNG")
    monkeypatch.setattr(caption_vision, "_resolve_folder", lambda folder: tmp_path)
    monkeypatch.setattr(caption_vision.app_config, "FS_ROOT", str(tmp_path))
    monkeypatch.setattr(caption_vision, "sample_video_sight_frames", lambda path: [
        (0.0, buffer.getvalue()), (0.5, buffer.getvalue())
    ])
    frames = caption_vision.vision_video_sight_frames("set", "clip.mp4")
    assert len(frames) == 2
    from base64 import b64decode
    for _, url in frames:
        assert url.startswith("data:image/jpeg;base64,")
        with Image.open(io.BytesIO(b64decode(url.split(",", 1)[1]))) as image:
            assert image.width * image.height <= 450000
    assert sorted(path.name for path in tmp_path.iterdir()) == ["clip.mp4"]


def test_video_sight_prompt_has_one_ordered_multiframe_response():
    frames = [(0.0, "data:image/jpeg;base64,AA=="), (0.5, "data:image/jpeg;base64,BB==")]
    messages = vision_schema_assist.build_vision_schema_sight_messages(
        None, video_frames=frames
    )
    user_parts = messages[1]["content"]
    assert [part["type"] for part in user_parts] == [
        "text", "text", "image_url", "text", "image_url"
    ]
    assert "0.000s" in user_parts[1]["text"]
    assert "0.500s" in user_parts[3]["text"]
    assert "video" in messages[0]["content"].lower()
    image_messages = vision_schema_assist.build_vision_schema_sight_messages("data:image/png;base64,AA==")
    assert len(image_messages[1]["content"]) == 2
    assert "one image" in image_messages[0]["content"]


def test_only_legacy_video_sight_is_stale(monkeypatch, tmp_path):
    for name in ("clip.mp4", "photo.png"):
        (tmp_path / name).write_bytes(b"test")
    metadata = {}
    for name in ("clip.mp4", "photo.png"):
        stat = (tmp_path / name).stat()
        metadata[name] = {"vision_sights": {"model": {
            "model": "model", "version": 2, "mtime": int(stat.st_mtime),
            "size": stat.st_size, "description": "Previously scanned",
            "inventory": {"details": []},
        }}}
    assert vision_schema_assist._cached_sight_block(tmp_path, "clip.mp4", metadata, "model") is None
    assert vision_schema_assist._cached_sight_block(tmp_path, "photo.png", metadata, "model")
    metadata["clip.mp4"]["vision_sights"]["model"]["version"] = 3
    assert vision_schema_assist._cached_sight_block(tmp_path, "clip.mp4", metadata, "model")
