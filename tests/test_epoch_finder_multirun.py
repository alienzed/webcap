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


def test_candidates_curve_lists_available_queue_and_history_runs_without_saved_epochs(monkeypatch):
    from types import SimpleNamespace

    monkeypatch.setattr(epoch_finder, "_folder_key", lambda _: "sets/subject")
    monkeypatch.setattr(epoch_finder, "passive_status_snapshot", lambda: ({
        "ok": True, "jobs": [
            {"id": "run-live", "folder": "sets/subject", "stages": "h3", "runName": "Live"},
            {"id": "wrong-set", "folder": "sets/other", "stages": "h3"},
        ],
    }, 200))
    monkeypatch.setattr(epoch_finder, "all_history_payload", lambda **_kwargs: {"jobs": [
        {"id": "run-live", "folder": "sets/subject", "stages": "h3"},
        {"id": "run-old", "folder": "sets/subject", "stages": "h3", "runName": "Older"},
    ]})
    monkeypatch.setattr(epoch_finder, "_candidate_run_snapshot", lambda _folder, job_id: (
        "/training/" + job_id, {"stages": "h3", "runName": job_id, "runSequence": "1"},
    ))
    monkeypatch.setattr(epoch_finder, "get_test_model_for_staging_key", lambda _: SimpleNamespace(
        PROFILE_ID="minimax_h3", STAGING_KEY="h3",
    ))
    monkeypatch.setattr(epoch_finder, "candidate_run_folder_path", lambda _folder, job_id: "/training/" + job_id)
    monkeypatch.setattr(epoch_finder, "saved_artifacts_for_run", lambda _path: [])

    assert epoch_finder._runs("set-folder") == []
    result = epoch_finder.candidate_runs("set-folder")
    assert [(run["folder"], run["jobId"]) for run in result] == [
        ("sets/subject", "run-live"), ("sets/subject", "run-old"),
    ]


def test_campaign_run_discovery_uses_recorded_training_sequence(monkeypatch):
    from types import SimpleNamespace

    monkeypatch.setattr(epoch_finder, "_folder_key", lambda _: "sets/bikini")
    monkeypatch.setattr(epoch_finder, "passive_status_snapshot", lambda: ({
        "ok": True, "jobs": [{"id": "job-12", "folder": "sets/bikini",
                             "runName": "Run train", "sequence": "012"}],
    }, 200))
    monkeypatch.setattr(epoch_finder, "all_history_payload", lambda **kwargs: {"jobs": []})
    monkeypatch.setattr(epoch_finder, "_candidate_run_snapshot", lambda *_: (
        "/training/12", {"stages": "h3", "runName": "Run train", "sequence": "012"},
    ))
    monkeypatch.setattr(epoch_finder, "get_test_model_for_staging_key", lambda _: SimpleNamespace(
        PROFILE_ID="minimax_h3", STAGING_KEY="h3",
    ))
    monkeypatch.setattr(epoch_finder, "candidate_run_folder_path", lambda *_: "/training/12")
    monkeypatch.setattr(epoch_finder, "saved_artifacts_for_run", lambda *_: [
        {"epoch": 50, "status": "available"},
    ])
    runs = epoch_finder._runs("unused")
    assert len(runs) == 1
    assert runs[0]["runSequence"] == "012"
    assert runs[0]["runName"] == "Run train"
    assert runs[0]["epochs"] == [50]
