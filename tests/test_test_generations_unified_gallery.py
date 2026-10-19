"""Exercise the unified read-only gallery with Test and campaign records."""
from tool.server import epoch_finder, epoch_test_bench


def test_unified_gallery_links_recorded_test_and_campaign_epoch(tmp_path, monkeypatch):
    session = tmp_path / "session-1"
    session.mkdir()
    campaign_root = tmp_path / "campaigns"
    campaign_dir = campaign_root / "abcdef123456"
    campaign_dir.mkdir(parents=True)
    monkeypatch.setattr(epoch_test_bench, "_session_directories", lambda folder: [session])
    monkeypatch.setattr(epoch_test_bench, "_read_status", lambda directory: {
        "session": directory.name, "modelId": "h3", "startedAt": 42,
        "results": [
            {"mediaFile": "linked.png", "rating": 4, "provenance": {
                "sourceFolder": "set-one", "sourceJobId": "run-a", "sourceEpoch": 75}},
            {"mediaFile": "unknown.png", "provenance": {"sourceEpoch": 75}},
        ],
    })
    monkeypatch.setattr(epoch_test_bench, "_session_status_from_payload", lambda directory, payload: payload)
    monkeypatch.setattr(epoch_test_bench, "_with_session_ratings", lambda directory, payload: payload)
    monkeypatch.setattr(epoch_test_bench, "_with_session_vision", lambda directory, payload: payload)
    monkeypatch.setattr(epoch_test_bench, "_relative_set_folder", lambda folder: "set-one")
    monkeypatch.setattr(epoch_finder, "_root", lambda folder: campaign_root)
    monkeypatch.setattr(epoch_finder, "_runs", lambda folder: [])
    monkeypatch.setattr(epoch_finder, "_load", lambda folder, name: {
        "id": name, "name": "Finder test", "modelId": "h3",
        "jobId": "other-run", "candidateMap": {"0": {
            "jobId": "run-a", "epoch": 75, "runName": "Run A"}},
        "units": [{"round": 1, "case": 1, "epoch": 0,
                   "frame": "r1-e0-c1.png", "assessment": {"score": 1}}],
    })
    evidence = epoch_finder.workspace_gallery(tmp_path, "h3")
    assert len(evidence["sessions"]) == 1
    assert len(evidence["campaigns"]) == 1
    assert len(evidence["media"]) == 3
    assert evidence["total"] == 3
    linked = [m for m in evidence["media"] if m["id"] == "test:session-1:linked.png"][0]
    campaign = [m for m in evidence["media"] if m["source"] == "campaign"][0]
    unknown = [m for m in evidence["media"] if m.get("mediaFile") == "unknown.png"][0]
    assert (linked["jobId"], linked["epoch"]) == ("run-a", 75)
    assert (campaign["jobId"], campaign["epoch"]) == ("run-a", 75)
    assert (unknown["jobId"], unknown["epoch"]) == ("", None)
    assert linked["rating"] == 4


def test_unified_gallery_filters_by_model_without_mutating_sessions(tmp_path, monkeypatch):
    session = tmp_path / "session-one"
    monkeypatch.setattr(epoch_test_bench, "_session_directories", lambda folder: [session])
    monkeypatch.setattr(epoch_test_bench, "_read_status", lambda directory: {
        "modelId": "krea2", "results": [{"mediaFile": "frame.png"}],
    })
    monkeypatch.setattr(epoch_finder, "_root", lambda folder: tmp_path / "no-campaigns")
    monkeypatch.setattr(epoch_finder, "_runs", lambda folder: [])
    assert epoch_finder.workspace_gallery(tmp_path, "h3") == {
        "sessions": [], "campaigns": [], "media": [], "total": 0, "offset": 0, "limit": 48, "runs": [], "warnings": [],
    }
