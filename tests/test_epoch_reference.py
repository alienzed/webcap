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
    ("x" * 5001, "a", "b"),
])
def test_paired_vision_rejects_missing_or_oversized_inputs(feature, a, b):
    with pytest.raises(ValueError):
        build_reference_comparison_messages(feature, a, b)


def test_reference_comparison_names_the_correct_component():
    from tool.server.caption_vision import reference_comparison_feature
    top = reference_comparison_feature("BT Back", "simple string straps",
        ["simple string straps", "metal ring"], "Bikini tops")
    bottom = reference_comparison_feature("BB Back", "simple string straps",
        ["simple string straps", "metal ring"], "Bikini bottoms")
    assert '"Bikini tops" with "simple string straps"' in top
    assert "BT Back" in top
    assert '"Bikini bottoms" with "simple string straps"' in bottom
    assert "BB Back" in bottom
    assert top != bottom


def _dataset(tmp_path, monkeypatch, annotations):
    for name in ("a.png", "b.png", "close.png", "clip.mp4"):
        (tmp_path / name).write_bytes(b"example")
    (tmp_path / ".webcap_state.json").write_text(
        json.dumps({"caption_group_tags_by_media": annotations}), encoding="utf-8")
    monkeypatch.setattr(epoch_reference, "_resolve_folder", lambda folder: tmp_path)
    monkeypatch.setattr(epoch_reference, "training_image_members", lambda folder, job_id: {"a.png", "b.png", "close.png"})
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
    matches = epoch_reference.find_reference_candidates("set", "BB Shape", "v-front", "job-1")
    assert [item["media"] for item in matches] == ["a.png"]
    assert matches[0]["size"] == len(b"example")
    assert epoch_reference.find_reference_candidates("set", "BB Shape", "v", "job-1") == []
    assert epoch_reference.find_reference_candidates("set", "BT Shape", "triangle", "job-1")[0]["media"] == "a.png"


def test_same_text_reference_remains_scoped_by_top_and_bottom(tmp_path, monkeypatch):
    _dataset(tmp_path, monkeypatch, {
        "a.png": {"BT Back": ["simple string straps"]},
        "b.png": {"BB Back": ["simple string straps"]},
        "close.png": {"BT Back": ["simple string straps"],
                      "BB Back": ["simple string straps"]},
    })
    assert [item["media"] for item in epoch_reference.find_reference_candidates(
        "set", "BT Back", "simple string straps", "job-1"
    )] == ["a.png", "close.png"]
    assert [item["media"] for item in epoch_reference.find_reference_candidates(
        "set", "BB Back", "simple string straps", "job-1"
    )] == ["b.png", "close.png"]


def test_reference_vocabulary_counts_scoped_options(tmp_path, monkeypatch):
    _dataset(tmp_path, monkeypatch, {
        "a.png": {"BB Shape": ["v-front"]},
        "b.png": {"BB Shape": ["v-front", "micro"]},
    })
    vocabulary = epoch_reference.reference_vocabulary("set", "job-1")
    assert vocabulary == [{"group": "BB Shape", "terms": [
        {"term": "micro", "count": 1}, {"term": "v-front", "count": 2}]}]


def test_ambiguous_or_changed_reference_is_not_silently_accepted(tmp_path, monkeypatch):
    _dataset(tmp_path, monkeypatch, {"a.png": {"BB Shape": ["v-front"]}})
    with pytest.raises(ValueError):
        epoch_reference.verified_reference("set", "BB Shape", "micro", "a.png", "job-1")
    with pytest.raises(ValueError):
        epoch_reference.verified_reference("set", "BB Shape", "v-front", "b.png", "job-1")


def test_invalid_annotation_shape_fails_explicitly(tmp_path, monkeypatch):
    _dataset(tmp_path, monkeypatch, {"a.png": {"BB Shape": "v-front"}})
    with pytest.raises(ValueError, match="Invalid scoped tag"):
        epoch_reference.find_reference_candidates("set", "BB Shape", "v-front", "job-1")


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
        "set", "BT Shape", "micro triangle simple string straps", "job-1") == []
    reference = epoch_reference.verified_reference("set", "BT Shape", "micro triangle", "a.png", "job-1")
    assert reference["term"] == "micro triangle"
    assert reference["media"] == "a.png"




def test_reference_candidates_exclude_images_not_in_selected_training_run(tmp_path, monkeypatch):
    _dataset(tmp_path, monkeypatch, {
        "a.png": {"BT Shape": ["triangle"]},
        "b.png": {"BT Shape": ["triangle"]},
    })
    monkeypatch.setattr(epoch_reference, "training_image_members", lambda folder, job_id: {"b.png"})
    matches = epoch_reference.find_reference_candidates("set", "BT Shape", "triangle", "job-1")
    assert [entry["media"] for entry in matches] == ["b.png"]
    with pytest.raises(ValueError):
        epoch_reference.verified_reference("set", "BT Shape", "triangle", "a.png", "job-1")


def test_suggest_refs_rank_combined_scoped_tags_before_partials(tmp_path, monkeypatch):
    _dataset(tmp_path, monkeypatch, {
        "a.png": {"BT Shape": ["micro triangle"], "BT Straps": ["simple string straps"]},
        "b.png": {"BT Shape": ["micro triangle"]},
        "close.png": {"BT Straps": ["simple string straps"]},
        "clip.mp4": {"BT Shape": ["micro triangle"], "BT Straps": ["simple string straps"]},
    })
    suggestions = epoch_reference.suggest_references(
        "set", "job-1", "simple string straps micro triangle")
    assert [item["media"] for item in suggestions] == ["a.png", "close.png", "b.png"]
    assert suggestions[0]["complete"]
    assert suggestions[0]["matchedWords"] == suggestions[0]["totalWords"] == 5
    assert suggestions[0]["tag"] in {"micro triangle", "simple string straps"}
    assert not suggestions[1]["complete"]
    assert suggestions[1]["matchedWords"] > suggestions[2]["matchedWords"]


def test_suggest_refs_include_only_selected_run_and_allow_partial(tmp_path, monkeypatch):
    _dataset(tmp_path, monkeypatch, {
        "a.png": {"Shape": ["micro triangle"], "Straps": ["simple string straps"]},
        "b.png": {"Shape": ["micro triangle"]},
    })
    monkeypatch.setattr(epoch_reference, "training_image_members", lambda folder, job_id: {"b.png"})
    suggestions = epoch_reference.suggest_references(
        "set", "job-1", "micro triangle simple string straps")
    assert [item["media"] for item in suggestions] == ["b.png"]
    assert suggestions[0]["complete"] is False
    assert epoch_reference.suggest_references("set", "job-1", "unseen feature") == []


def test_suggest_refs_fails_loudly_for_corrupt_annotations(tmp_path, monkeypatch):
    _dataset(tmp_path, monkeypatch, {"a.png": {"BT Shape": "micro triangle"}})
    with pytest.raises(ValueError, match="Invalid scoped tags"):
        epoch_reference.suggest_references("set", "job-1", "micro triangle")
