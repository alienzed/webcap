"""Focused dimensional human ratings reuse Test evidence without mutating Overall."""

import json

import pytest

from tool.server import epoch_test_bench as bench
from tool.server import run_analytics
from tool.server.folder_state_store import (
    add_set_rating_dimension,
    read_folder_state,
    set_media_dimension_rating,
    set_media_rating,
    write_folder_state_with_owned_drafts,
)


def make_session(tmp_path):
    session = tmp_path / "test-generations" / "session-1"
    session.mkdir(parents=True)
    (session / "first.mp4").write_bytes(b"preview")
    (session / "second.mp4").write_bytes(b"preview")
    return session


def test_equal_weight_per_preview_and_legacy_overall_preservation(tmp_path):
    session = make_session(tmp_path)
    path = session / ".webcap_state.json"
    set_media_rating(path, "first.mp4", 5)
    set_media_rating(path, "second.mp4", 2)
    assert bench._session_effective_rating_map(session) == {"first.mp4": 5, "second.mp4": 2}
    set_media_dimension_rating(path, "first.mp4", "color", 1)
    set_media_dimension_rating(path, "first.mp4", "motion", 3)
    assert bench._session_rating_map(session) == {"first.mp4": 5, "second.mp4": 2}
    assert bench._session_dimension_rating_map(session) == {
        "first.mp4": {"color": 1, "motion": 3}
    }
    assert bench._session_effective_rating_map(session) == {
        "first.mp4": 3, "second.mp4": 2
    }
    payload = bench._with_session_ratings(session, {
        "results": [{"mediaFile": "first.mp4"}, {"mediaFile": "second.mp4"}]
    })
    assert payload["results"][0]["rating"] == 5
    assert payload["results"][0]["dimensionRatings"] == {"color": 1, "motion": 3}
    assert payload["results"][0]["combinedRating"] == 3


def test_dimension_rating_mutations_preserve_other_scores_and_clear_only_target(tmp_path):
    session = make_session(tmp_path)
    path = session / ".webcap_state.json"
    set_media_rating(path, "first.mp4", 4)
    set_media_dimension_rating(path, "first.mp4", "color", 2)
    set_media_dimension_rating(path, "second.mp4", "color", 5)
    assert set_media_dimension_rating(path, "first.mp4", "color", 0) == 0
    state = read_folder_state(path)
    assert state["ratings_by_media"] == {"first.mp4": 4}
    assert state["ratings_by_dimension"] == {"second.mp4": {"color": 5}}
    with pytest.raises(ValueError, match="between 0 and 5"):
        set_media_dimension_rating(path, "second.mp4", "color", 8)


def test_set_catalog_survives_ordinary_state_snapshot(tmp_path):
    path = tmp_path / ".webcap_state.json"
    add_set_rating_dimension(path, {"id": "color", "label": "Toothbrush Color"})
    write_folder_state_with_owned_drafts(path, {"ratings_by_media": {}, "other": "saved"})
    state = read_folder_state(path)
    assert state["evaluation_rating_dimensions"] == [{"id": "color", "label": "Toothbrush Color"}]
    assert state["other"] == "saved"


def test_global_and_set_dimension_catalog_and_save_route(tmp_path, monkeypatch):
    config = {"evaluation_rating_dimensions": []}
    monkeypatch.setattr(bench.app_config, "load_config_from_disk", lambda: dict(config))
    def save_config(value):
        config.clear()
        config.update(value)
        return value
    monkeypatch.setattr(bench.app_config, "save_config_to_disk", save_config)
    first = bench.add_rating_dimension(tmp_path, "Brushing Motion", "global")
    assert first["dimensions"][0]["label"] == "Brushing Motion"
    second = bench.add_rating_dimension(tmp_path, "Toothbrush Color", "set")
    assert len(second["dimensions"]) == 2
    with pytest.raises(ValueError, match="already exists"):
        bench.add_rating_dimension(tmp_path, "toothbrush color", "set")
    session = make_session(tmp_path)
    monkeypatch.setattr(bench, "_session_directory", lambda _folder, _name: session)
    monkeypatch.setattr(bench, "resolve_result_media", lambda _folder, _session, _name: session / "first.mp4")
    created = second["dimensions"][1]["id"]
    receipt = bench.rate_result(tmp_path, "session-1", "first.mp4", 4, created)
    assert receipt["dimensionId"] == created
    assert bench._session_dimension_rating_map(session) == {"first.mp4": {created: 4}}
    with pytest.raises(ValueError, match="saved rating dimension"):
        bench.rate_result(tmp_path, "session-1", "first.mp4", 5, "other-set")


def test_candidate_and_insights_read_the_same_combined_human_score(tmp_path, monkeypatch):
    session = make_session(tmp_path)
    state = session / ".webcap_state.json"
    set_media_rating(state, "first.mp4", 5)
    set_media_dimension_rating(state, "first.mp4", "color", 1)
    set_media_rating(state, "second.mp4", 3)
    rows = [
        {"kind": "lora", "candidateFile": "epoch.safetensors",
         "mediaFile": "first.mp4", "provenance": {
             "sourceJobId": "run-1", "sourceFolder": "demo", "sourceEpoch": 6}},
        {"kind": "lora", "candidateFile": "epoch.safetensors",
         "mediaFile": "second.mp4", "provenance": {
             "sourceJobId": "run-1", "sourceFolder": "demo", "sourceEpoch": 6}},
    ]
    status = {"results": rows, "modelId": bench.get_test_model().PROFILE_ID}
    candidate = bench._candidate_rating_scores(tmp_path, session_snapshot=[(session, status)], include_saved=False)
    assert candidate["epoch.safetensors"]["average"] == 3
    assert candidate["epoch.safetensors"]["count"] == 2
    monkeypatch.setattr(bench, "_session_directories", lambda _: [session])
    monkeypatch.setattr(bench, "_read_status", lambda _: status)
    monkeypatch.setattr(run_analytics, "_folder_key", lambda _: "demo")
    points, _, _, _ = run_analytics._test_series(tmp_path, "run-1")
    assert points[0]["manual"] == 3
    assert points[0]["manualCount"] == 2
