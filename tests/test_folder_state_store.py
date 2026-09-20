import pytest

from tool.server.folder_state_store import FolderStateUnsafeWriteError, reject_wholesale_state_map_clear


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
