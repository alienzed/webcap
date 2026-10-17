"""Read-only evidence aggregation without score mixing or GPU dependencies."""
from tool.server import epoch_finder


def test_checkpoint_evidence_isolates_run_and_keeps_campaign_scores_separate(tmp_path, monkeypatch):
    root = tmp_path / "campaigns"
    root.mkdir()
    monkeypatch.setattr(epoch_finder, "_root", lambda _: root)
    campaigns = {
        "aaaaaaaaaaaa": {
            "id": "aaaaaaaaaaaa", "jobId": "run-a", "name": "First",
            "status": "complete", "rounds": [{"epochs": [1, 2]}],
            "units": [
                {"round": 1, "epoch": 1, "assessment": {"comparison": [
                    {"result": "match", "weight": 2}, {"result": "mismatch", "weight": 1}]},
                 "referenceAssessments": [{"verdict": "MATCH"}], "dinoAssessments": [{"similarity": 0.9}]},
                {"round": 1, "epoch": 2, "assessment": None, "error": "render failed"},
            ],
        },
        "bbbbbbbbbbbb": {
            "id": "bbbbbbbbbbbb", "jobId": "run-a", "name": "Different protocol",
            "status": "paused", "rounds": [{"epochs": [1]}],
            "units": [{"round": 1, "epoch": 1, "assessment": {
                "comparison": [{"result": "mismatch"}]}, "referenceAssessments": []}],
        },
        "cccccccccccc": {
            "id": "cccccccccccc", "jobId": "run-b", "name": "Other run",
            "status": "complete", "rounds": [{"epochs": [1]}],
            "units": [{"round": 1, "epoch": 1, "assessment": {
                "comparison": [{"result": "match"}]}}],
        },
    }
    for campaign_id in campaigns:
        (root / campaign_id).mkdir()
    monkeypatch.setattr(epoch_finder, "_load", lambda _folder, key: campaigns[key])
    result = epoch_finder.checkpoint_evidence(tmp_path, "run-a")
    assert [entry["epoch"] for entry in result["checkpoints"]] == [1, 2]
    first = result["checkpoints"][0]["campaigns"]
    assert len(first) == 2
    assert [item["score"] for item in first] == [2 / 3, 0.0]
    assert first[0]["evaluatedRenders"] == 1
    assert first[0]["weightedObservations"] == 3
    assert first[0]["rvnVerdicts"]["MATCH"] == 1
    assert first[0]["dinoComparisons"] == 1
    assert first[1]["dinoComparisons"] == 0
    second = result["checkpoints"][1]["campaigns"][0]
    assert second["score"] is None
    assert second["failedRenders"] == 1
    assert second["evaluatedRenders"] == 0


def test_checkpoint_evidence_empty_run_and_no_campaigns(tmp_path, monkeypatch):
    monkeypatch.setattr(epoch_finder, "_root", lambda _: tmp_path / "absent")
    assert epoch_finder.checkpoint_evidence(tmp_path, "run") == {
        "jobId": "run", "checkpoints": []}
