"""Reference evaluation contracts that do not require GPU/model downloads."""
import json

import pytest

from tool.server.caption_vision import build_reference_comparison_messages
from tool.server import epoch_reference


def test_paired_vision_request_keeps_image_order_and_vocabulary():
    messages = build_reference_comparison_messages(
        "Bottom shape — choose 1=v-front; 2=micro",
        "data:image/png;base64,AAAA", "data:image/png;base64,BBBB")
    content = messages[0]["content"]
    images = [part["image_url"]["url"] for part in content if part["type"] == "image_url"]
    assert images == ["data:image/png;base64,AAAA", "data:image/png;base64,BBBB"]
    assert "Bottom shape" in content[0]["text"]
    assert "OPTION:" in content[0]["text"]
    assert "VERDICT:" in content[0]["text"]


@pytest.mark.parametrize("feature,a,b", [
    ("", "a", "b"), ("bottom", "", "b"), ("bottom", "a", ""),
    ("x" * 241, "a", "b"),
])
def test_paired_vision_rejects_missing_or_oversized_inputs(feature, a, b):
    with pytest.raises(ValueError):
        build_reference_comparison_messages(feature, a, b)


def _dataset(tmp_path, monkeypatch, annotations):
    for name in ("a.png", "b.png", "close.png", "clip.mp4"):
        (tmp_path / name).write_bytes(b"example")
    (tmp_path / ".webcap_state.json").write_text(
        json.dumps({"caption_group_tags_by_media": annotations}), encoding="utf-8")
    monkeypatch.setattr(epoch_reference, "_resolve_folder", lambda folder: tmp_path)
    monkeypatch.setattr(epoch_reference, "list_media_files", lambda folder: [
        "a.png", "b.png", "clip.mp4", "close.png"])
    return tmp_path


def test_exact_tag_lookup_ignores_unrelated_choices_and_videos(tmp_path, monkeypatch):
    _dataset(tmp_path, monkeypatch, {
        "a.png": {"BT Shape": ["triangle"], "BB Shape": ["v-front"]},
        "b.png": {"BT Shape": ["teardrop"]},
        "close.png": {"BB Shape": ["micro"]},
        "clip.mp4": {"BB Shape": ["v-front"]},
    })
    matches = epoch_reference.find_reference_candidates("set", "BB Shape", "v-front")
    assert [item["media"] for item in matches] == ["a.png"]
    assert matches[0]["size"] == len(b"example")
    assert epoch_reference.find_reference_candidates("set", "BB Shape", "v") == []
    assert epoch_reference.find_reference_candidates("set", "BT Shape", "triangle")[0]["media"] == "a.png"


def test_reference_vocabulary_counts_scoped_options(tmp_path, monkeypatch):
    _dataset(tmp_path, monkeypatch, {
        "a.png": {"BB Shape": ["v-front"]},
        "b.png": {"BB Shape": ["v-front", "micro"]},
    })
    vocabulary = epoch_reference.reference_vocabulary("set")
    assert vocabulary == [{"group": "BB Shape", "terms": [
        {"term": "micro", "count": 1}, {"term": "v-front", "count": 2}]}]


def test_ambiguous_or_changed_reference_is_not_silently_accepted(tmp_path, monkeypatch):
    _dataset(tmp_path, monkeypatch, {"a.png": {"BB Shape": ["v-front"]}})
    with pytest.raises(ValueError):
        epoch_reference.verified_reference("set", "BB Shape", "micro", "a.png")
    with pytest.raises(ValueError):
        epoch_reference.verified_reference("set", "BB Shape", "v-front", "b.png")


def test_invalid_annotation_shape_fails_explicitly(tmp_path, monkeypatch):
    _dataset(tmp_path, monkeypatch, {"a.png": {"BB Shape": "v-front"}})
    with pytest.raises(ValueError, match="Invalid scoped tag"):
        epoch_reference.find_reference_candidates("set", "BB Shape", "v-front")


def test_reference_eligibility_only_primary_not_leakage_or_vary():
    from tool.server.epoch_finder import _requires_reference
    assert _requires_reference("primary")
    assert not _requires_reference("leakage")
    assert not _requires_reference("vary")
    assert not _requires_reference(None)


def test_exact_tag_can_differ_from_descriptive_prompt_option(tmp_path, monkeypatch):
    _dataset(tmp_path, monkeypatch, {"a.png": {"BT Shape": ["micro triangle"]}})
    # "micro triangle simple string straps" is a prompt phrase, not a saved tag.
    assert epoch_reference.find_reference_candidates(
        "set", "BT Shape", "micro triangle simple string straps") == []
    reference = epoch_reference.verified_reference("set", "BT Shape", "micro triangle", "a.png")
    assert reference["term"] == "micro triangle"
    assert reference["media"] == "a.png"


def test_reference_suggestions_limit_and_exact_tag_provenance(tmp_path, monkeypatch):
    _dataset(tmp_path, monkeypatch, {
        "a.png": {"BT Shape": ["micro triangle"]},
        "b.png": {"BT Shape": ["micro triangle"]},
        "close.png": {"BT Shape": ["teardrop"]},
    })
    found = epoch_reference.suggest_reference_options(
        "set", "micro triangle simple string straps", limit=2)
    assert [entry["media"] for entry in found] == ["a.png", "b.png"]
    assert all(entry["tag"] == "micro triangle" for entry in found)
    assert epoch_reference.suggest_reference_options("set", "ring connectors") == []
