import json

import pytest

from tool.server.folder_state_store import FolderStateUnsafeWriteError, reject_wholesale_state_map_clear, set_last_training_archive, set_media_annotation_state, set_media_rating


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



def test_set_last_training_archive_preserves_unrelated_folder_state(tmp_path):
    state_path = tmp_path / ".webcap_state.json"
    state_path.write_text(
        json.dumps({
            "flags": {"keep.mp4": "green"},
            "ratings_by_media": {"other.mp4": 2},
            "caption_set_notes": "keep me",
        }),
        encoding="utf-8",
    )
    marker = {
        "archiveName": "20261002_07-27-29-penny",
        "selectedEpoch": 44,
    }

    saved_marker = set_last_training_archive(state_path, marker)

    saved = json.loads(state_path.read_text(encoding="utf-8"))
    assert saved_marker == marker
    assert saved["last_training_archive"] == marker
    assert saved["flags"] == {"keep.mp4": "green"}
    assert saved["ratings_by_media"] == {"other.mp4": 2}
    assert saved["caption_set_notes"] == "keep me"


def test_set_media_annotation_state_preserves_unrelated_media_and_folder_state(tmp_path):
    state_path = tmp_path / ".webcap_state.json"
    state_path.write_text(
        json.dumps({
            "caption_group_tags_by_media": {
                "target.jpg": {"Hair": ["brown"]},
                "keep.jpg": {"Background": ["blue"]},
            },
            "caption_tags_by_media": {
                "target.jpg": ["old"],
                "keep.jpg": ["keep-tag"],
            },
            "caption_requirements_checked": {
                "target.jpg": {"Hair": True},
                "keep.jpg": {"Background": True},
            },
            "caption_group_term_descriptors_by_media": {
                "keep.jpg": {"Background": {"blue": {"prefix": "deep", "suffix": ""}}},
            },
            "caption_group_term_descriptor_snapshot_media_keys": ["keep.jpg"],
            "reviewedKeys": ["keep.jpg"],
            "caption_set_notes": "keep me",
        }),
        encoding="utf-8",
    )

    saved = set_media_annotation_state(
        state_path,
        "target.jpg",
        group_tags={"Hair": ["black"]},
        unscoped_tags=["new"],
        checked_requirements={"Hair": True, "Traits": True},
        descriptors={"Hair": {"black": {"prefix": "dark", "suffix": ""}}},
        descriptor_snapshot=True,
        reviewed=True,
    )

    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert saved == {"mediaKey": "target.jpg", "reviewed": True}
    assert state["caption_group_tags_by_media"]["target.jpg"] == {"Hair": ["black"]}
    assert state["caption_group_tags_by_media"]["keep.jpg"] == {"Background": ["blue"]}
    assert state["caption_tags_by_media"]["target.jpg"] == ["new"]
    assert state["caption_tags_by_media"]["keep.jpg"] == ["keep-tag"]
    assert state["caption_requirements_checked"]["keep.jpg"] == {"Background": True}
    assert state["caption_group_term_descriptors_by_media"]["keep.jpg"] == {
        "Background": {"blue": {"prefix": "deep", "suffix": ""}}
    }
    assert set(state["caption_group_term_descriptor_snapshot_media_keys"]) == {"keep.jpg", "target.jpg"}
    assert set(state["reviewedKeys"]) == {"keep.jpg", "target.jpg"}
    assert state["caption_set_notes"] == "keep me"


def test_set_media_annotation_state_can_clear_only_target_media_entries(tmp_path):
    state_path = tmp_path / ".webcap_state.json"
    state_path.write_text(
        json.dumps({
            "caption_group_tags_by_media": {
                "target.jpg": {"Hair": ["brown"]},
                "keep.jpg": {"Hair": ["black"]},
            },
            "caption_tags_by_media": {"target.jpg": ["old"], "keep.jpg": ["keep"]},
            "caption_requirements_checked": {"target.jpg": {"Hair": True}, "keep.jpg": {"Hair": True}},
            "caption_group_term_descriptors_by_media": {
                "target.jpg": {"Hair": {"brown": {"prefix": "", "suffix": "hair"}}},
                "keep.jpg": {"Hair": {"black": {"prefix": "", "suffix": "hair"}}},
            },
            "caption_group_term_descriptor_snapshot_media_keys": ["target.jpg", "keep.jpg"],
            "reviewedKeys": ["target.jpg", "keep.jpg"],
        }),
        encoding="utf-8",
    )

    set_media_annotation_state(
        state_path,
        "target.jpg",
        group_tags={},
        unscoped_tags=[],
        checked_requirements={},
        descriptors={},
        descriptor_snapshot=False,
        reviewed=False,
    )

    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert "target.jpg" not in state["caption_group_tags_by_media"]
    assert "target.jpg" not in state["caption_tags_by_media"]
    assert "target.jpg" not in state["caption_requirements_checked"]
    assert "target.jpg" not in state["caption_group_term_descriptors_by_media"]
    assert state["caption_group_tags_by_media"]["keep.jpg"] == {"Hair": ["black"]}
    assert state["caption_tags_by_media"]["keep.jpg"] == ["keep"]
    assert state["caption_requirements_checked"]["keep.jpg"] == {"Hair": True}
    assert state["caption_group_term_descriptors_by_media"]["keep.jpg"] == {
        "Hair": {"black": {"prefix": "", "suffix": "hair"}}
    }
    assert state["caption_group_term_descriptor_snapshot_media_keys"] == ["keep.jpg"]
    assert state["reviewedKeys"] == ["keep.jpg"]
