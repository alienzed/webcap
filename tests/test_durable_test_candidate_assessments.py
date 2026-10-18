"""Candidate assessments survive deleting generated Test sessions."""
import json

from tool.server import epoch_test_bench as bench


class _Model:
    PROFILE_ID = "fake"
    STAGING_KEY = "fake"


def test_snapshot_and_combine_retired_scores(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    folder.mkdir()
    candidates = folder / "candidates"
    candidates.mkdir()
    candidate = candidates / "epoch90.safetensors"
    candidate.write_bytes(b"lora")
    sidecar = candidate.with_suffix(".webcap.json")
    sidecar.write_text(json.dumps({"version": 1, "sourceJobId": "job"}))
    session = folder / "session"
    session.mkdir()
    data = {"modelId": "fake", "results": [{"kind": "candidate", "candidateFile": candidate.name, "mediaFile": "preview.png"}]}
    monkeypatch.setattr(bench, "get_test_model", lambda *args: _Model())
    monkeypatch.setattr(bench, "_test_directory", lambda *args: candidates)
    monkeypatch.setattr(bench, "_staged_loras_for_set", lambda *args: [candidate])
    monkeypatch.setattr(bench, "_read_status", lambda *args: data)
    monkeypatch.setattr(bench, "_session_rating_map", lambda *args: {"preview.png": 4})
    monkeypatch.setattr(bench, "_session_vision_state", lambda *args: {"byMedia": {"preview.png": {"comparison": [
        {"id": "hair", "result": "match"}]}}})
    monkeypatch.setattr(bench, "_session_directories", lambda *args: [])
    bench._snapshot_session_assessments(folder, [session])
    saved = json.loads(sidecar.read_text())["assessments"]
    assert saved["manual"] == {"sum": 4, "count": 1}
    assert saved["vision"] == {"matches": 1.0, "count": 1, "previews": 1}
    assert bench._candidate_rating_scores(folder, "fake")[candidate.name]["average"] == 4
    assert bench._candidate_vision_scores(folder, "fake")[candidate.name]["count"] == 1


def test_reset_only_clears_aggregates(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    folder.mkdir()
    candidate = folder / "epoch90.safetensors"
    candidate.write_bytes(b"lora")
    sidecar = candidate.with_suffix(".webcap.json")
    sidecar.write_text(json.dumps({"version": 1, "sourceJobId": "job", "assessments": {"manual": {"sum": 8, "count": 2}}}))
    monkeypatch.setattr(bench, "get_test_model", lambda *args: _Model())
    monkeypatch.setattr(bench, "_staged_loras_for_set", lambda *args: [candidate])
    monkeypatch.setattr(bench, "rating_summary", lambda *args: {})
    bench.reset_candidate_assessments(folder, "fake", candidate.name)
    assert json.loads(sidecar.read_text()) == {"version": 1, "sourceJobId": "job"}
