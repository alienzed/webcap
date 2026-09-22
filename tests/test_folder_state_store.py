import json

import pytest

from tool.server.folder_state_store import FolderStateUnsafeWriteError, reject_wholesale_state_map_clear, set_media_rating


def test_scoped_assignment_map_cannot_be_wholesale_cleared():
    previous = {
        "caption_group_tags_by_media": {
            "a.jpg": {"Hair": ["brown"]},
            "b.jpg": {"Background": ["blue"]},
        }
    }

    with pytest.raises(FolderStateUnsafeWriteError, match="caption_group_tags_by_media"):
        reject_wholesale_state_map_clear(previous, {"caption_group_tags_by_media": {}})


def test_scoped_assignment_map_allows_specific_edits():
    previous = {
        "caption_group_tags_by_media": {
            "a.jpg": {"Hair": ["brown"]},
            "b.jpg": {"Background": ["blue"]},
        }
    }
    next_state = {
        "caption_group_tags_by_media": {
            "a.jpg": {"Hair": ["black"]},
        }
    }

    reject_wholesale_state_map_clear(previous, next_state)


def test_set_media_rating_preserves_unrelated_folder_state(tmp_path):
    state_path = tmp_path / ".webcap_state.json"
    state_path.write_text(
        json.dumps({
            "flags": {"keep.mp4": "green"},
            "ratings_by_media": {"other.mp4": 2},
            "caption_set_notes": "keep me",
        }),
        encoding="utf-8",
    )

    saved_rating = set_media_rating(state_path, "epoch24.mp4", 4)

    saved = json.loads(state_path.read_text(encoding="utf-8"))
    assert saved_rating == 4
    assert saved["flags"] == {"keep.mp4": "green"}
    assert saved["caption_set_notes"] == "keep me"
    assert saved["ratings_by_media"] == {"other.mp4": 2, "epoch24.mp4": 4}


def test_set_media_rating_can_clear_one_rating(tmp_path):
    state_path = tmp_path / ".webcap_state.json"
    state_path.write_text(
        json.dumps({"ratings_by_media": {"keep.mp4": 5, "clear.mp4": 3}}),
        encoding="utf-8",
    )

    saved_rating = set_media_rating(state_path, "clear.mp4", 0)

    saved = json.loads(state_path.read_text(encoding="utf-8"))
    assert saved_rating == 0
    assert saved["ratings_by_media"] == {"keep.mp4": 5}
