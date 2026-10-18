"""Read-only checkpoint evidence contracts."""
from tool.server import epoch_finder


def test_separates_campaigns_and_training_runs(tmp_path, monkeypatch):
    root = tmp_path / "campaigns"
    root.mkdir()
    campaigns = {}
    for key, run, verdict in [
        ("aaaaaaaaaaaa", "run-a", "match"),
        ("bbbbbbbbbbbb", "run-a", "mismatch"),
        ("cccccccccccc", "run-b", "match"),
    ]:
        (root / key).mkdir()
        campaigns[key] = {
            "id": key, "jobId": run, "name": key,
            "rounds": [{"epochs": [5]}],
            "units": [{"round": 1, "epoch": 5, "assessment": {
                "comparison": [{"result": verdict}]}}],
        }
    monkeypatch.setattr(epoch_finder, "_root", lambda _: root)
    monkeypatch.setattr(epoch_finder, "_load", lambda _folder, key: campaigns[key])
    result = epoch_finder.checkpoint_evidence(tmp_path, "run-a")
    entries = result["checkpoints"][0]["campaigns"]
    assert len(entries) == 2
    assert [row["score"] for row in entries] == [1.0, 0.0]
    assert all(row["weightedObservations"] == 1 for row in entries)
    assert all(row["dinoComparisons"] == 0 for row in entries)


def test_missing_evaluation_is_not_failure(tmp_path, monkeypatch):
    root = tmp_path / "campaigns"
    (root / "aaaaaaaaaaaa").mkdir(parents=True)
    monkeypatch.setattr(epoch_finder, "_root", lambda _: root)
    monkeypatch.setattr(epoch_finder, "_load", lambda *_: {
        "id": "aaaaaaaaaaaa", "jobId": "run",
        "rounds": [{"epochs": [1]}],
        "units": [{"round": 1, "epoch": 1, "assessment": None}],
    })
    item = epoch_finder.checkpoint_evidence(tmp_path, "run")["checkpoints"][0]["campaigns"][0]
    assert item["score"] is None
    assert item["evaluatedRenders"] == 0
    assert item["failedUnits"] == 0
