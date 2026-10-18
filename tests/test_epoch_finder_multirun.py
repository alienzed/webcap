"""Regression coverage for Set-scoped multi-run Epoch Finder identity."""

from tool.server import epoch_finder


def test_rank_does_not_merge_same_epoch_in_different_runs():
    campaign = {
        "candidateMap": {
            "1": {"jobId": "run-a", "epoch": 40},
            "2": {"jobId": "run-b", "epoch": 40},
        },
        "rounds": [{"epochs": [1, 2]}],
        "units": [
            {"round": 1, "epoch": 1, "assessment": {"comparison": [{"result": "match"}]}},
            {"round": 1, "epoch": 2, "assessment": {"comparison": [{"result": "mismatch"}]}},
        ],
    }
    ranked = epoch_finder._rank(campaign, 1)
    assert [(row["epoch"], row["score"]) for row in ranked] == [(1, 1.0), (2, 0.0)]


def test_multirun_staging_resolves_original_checkpoint(tmp_path, monkeypatch):
    source_a = tmp_path / "run_a.safetensors"
    source_b = tmp_path / "run_b.safetensors"
    source_a.write_bytes(b"first")
    source_b.write_bytes(b"second")
    stage = tmp_path / "test"
    stage.mkdir()
    seen = []

    monkeypatch.setattr(epoch_finder, "_folder_key", lambda folder: "sample/set")
    monkeypatch.setattr(epoch_finder, "get_test_model_for_staging_key", lambda stage: object())
    monkeypatch.setattr(epoch_finder.test_bench, "_test_directory", lambda *args: stage)

    def resolve(folder, job_id, epoch):
        seen.append((job_id, epoch))
        return {"run-a": source_a, "run-b": source_b}[job_id]

    monkeypatch.setattr(epoch_finder, "_candidate_safetensors_path", resolve)
    campaign = {
        "id": "abcdef123456", "jobId": "run-a", "stage": "h3",
        "candidateMap": {
            "1": {"jobId": "run-a", "epoch": 40},
            "2": {"jobId": "run-b", "epoch": 40},
        },
    }
    first = epoch_finder._stage_epoch(tmp_path, campaign, 1)
    second = epoch_finder._stage_epoch(tmp_path, campaign, 2)
    assert seen == [("run-a", 40), ("run-b", 40)]
    assert (stage / first).read_bytes() == b"first"
    assert (stage / second).read_bytes() == b"second"
    assert first != second
    epoch_finder._clean_staging(tmp_path, campaign)
    assert source_a.read_bytes() == b"first"
    assert source_b.read_bytes() == b"second"


def test_legacy_staging_still_uses_original_epoch(tmp_path, monkeypatch):
    source = tmp_path / "original.safetensors"
    source.write_bytes(b"legacy")
    stage = tmp_path / "test"
    stage.mkdir()
    captured = []
    monkeypatch.setattr(epoch_finder, "_folder_key", lambda folder: "sample/set")
    monkeypatch.setattr(epoch_finder, "get_test_model_for_staging_key", lambda stage: object())
    monkeypatch.setattr(epoch_finder.test_bench, "_test_directory", lambda *args: stage)

    def resolver(folder, job_id, epoch):
        captured.append((job_id, epoch))
        return source
    monkeypatch.setattr(epoch_finder, "_candidate_safetensors_path", resolver)
    campaign = {"id": "abcdef123456", "jobId": "old-run", "stage": "h3"}
    name = epoch_finder._stage_epoch(tmp_path, campaign, 40)
    assert captured == [("old-run", 40)]
    assert name.endswith("/epoch40.safetensors")
    epoch_finder._clean_staging(tmp_path, campaign)
