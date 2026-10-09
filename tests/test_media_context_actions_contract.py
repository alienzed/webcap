from pathlib import Path


def test_duplicate_action_is_generic_for_image_and_video_context_menus():
    root = Path(__file__).parents[1]
    script = (root / "tool" / "js" / "media_context_actions.js").read_text(encoding="utf-8")

    assert "if (isImageFile || isVideoFile)" in script
    assert "label: 'Duplicate'" in script
    assert "duplicateMediaItem(mediaItem);" in script


def test_video_context_actions_include_fps_conversion():
    root = Path(__file__).parents[1]
    script = (root / "tool" / "js" / "media_context_actions.js").read_text(encoding="utf-8")
    video_block_start = script.index("if (isVideoFile) {")
    convert_action = script.index("label: 'Convert to...'")

    assert convert_action > video_block_start
    assert "/media/convert_fps" in script[convert_action:]


def test_webp_context_action_exposes_png_conversion_without_menu_grouping():
    root = Path(__file__).parents[1]
    script = (root / "tool" / "js" / "media_context_actions.js").read_text(encoding="utf-8")

    assert "if (ext === 'webp')" in script
    assert "label: 'Convert to PNG'" in script
    assert "runConvertWebpToPng(mediaItem);" in script
    assert "'/media/convert_webp_png'" in script
    assert "children:" not in script

def test_context_menu_places_focus_caption_after_focused_annotate():
    root = Path(__file__).parents[1]
    script = (root / "tool" / "js" / "media_context_actions.js").read_text(encoding="utf-8")

    annotate_action = script.index("label: 'Focused Annotate'")
    caption_action = script.index("label: 'Focus Caption'")

    assert caption_action > annotate_action
    assert "startFocusedCaptionForMediaItem(mediaItem);" in script[caption_action:]

