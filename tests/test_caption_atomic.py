from pathlib import Path

import pytest

import tool.server.caption_ops as caption_ops


def test_failed_caption_replace_keeps_existing_caption(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    folder.mkdir()
    caption = folder / "clip.txt"
    caption.write_text("existing caption", encoding="utf-8")
    monkeypatch.setattr(caption_ops, "_resolve_folder", lambda _folder: folder)
    monkeypatch.setattr(caption_ops.os, "replace", lambda _temporary, _target: (_ for _ in ()).throw(OSError("replace failed")))

    with pytest.raises(OSError, match="replace failed"):
        caption_ops.save_caption_text("set", "clip.mp4", "new caption")

    assert caption.read_text(encoding="utf-8") == "existing caption"
    assert not list(folder.glob(".clip.txt.*.tmp"))


def test_caption_assist_prompt_preserves_group_order():
    messages = caption_ops.build_caption_assist_messages(
        assignments=[
            {"group": "Position", "term": "standing"},
            {"group": "View", "term": "front"},
            {"group": "Lighting", "term": "soft"},
        ],
        tags=["studio"],
        required_phrase="subject",
        draft="standing studio, soft lighting, front view",
    )

    assert messages[0]["role"] == "system"
    assert messages[1]["role"] == "user"
    assert '"groupOrder": [' in messages[1]["content"]
    assert messages[1]["content"].index('"Position"') < messages[1]["content"].index('"View"') < messages[1]["content"].index('"Lighting"')
    assert "include it verbatim exactly once" in messages[0]["content"]
