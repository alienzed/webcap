from pathlib import Path


def test_duplicate_action_is_generic_for_image_and_video_context_menus():
    root = Path(__file__).parents[1]
    script = (root / "tool" / "js" / "media_context_actions.js").read_text(encoding="utf-8")

    assert "if (isImageFile || isVideoFile)" in script
    assert "label: 'Duplicate'" in script
    assert "duplicateMediaItem(mediaItem);" in script
    assert "Duplicate Image" not in script


def test_video_context_actions_include_fps_conversion():
    root = Path(__file__).parents[1]
    script = (root / "tool" / "js" / "media_context_actions.js").read_text(encoding="utf-8")
    video_block_start = script.index("if (isVideoFile) {")
    convert_action = script.index("label: 'Convert to...'")

    assert convert_action > video_block_start
    assert "/media/convert_fps" in script[convert_action:]
