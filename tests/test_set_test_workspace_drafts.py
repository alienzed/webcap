"""Regression coverage for Set-owned Test/Campaign drafts and Test-history deletion."""
import json
from pathlib import Path
from types import SimpleNamespace

from tool.server import epoch_test_bench as bench
from tool.server import folder_state_store as store


def test_set_prompt_migrates_legacy_without_overwriting_newer_draft(tmp_path, monkeypatch):
    state_path = tmp_path / ".webcap_state.json"
    legacy = {"promptByModel": {"minimax_h3": "carefully refined {red|blue}"}}
    monkeypatch.setattr(bench, "_set_prompt_path", lambda folder: state_path)
    monkeypatch.setattr(bench, "_read_workspace_state", lambda folder: legacy)
    monkeypatch.setattr(bench, "get_test_model", lambda model_id=None: SimpleNamespace(PROFILE_ID="minimax_h3"))

    first = bench.workspace_prompt(tmp_path, "minimax_h3")
    assert first == {"modelId": "minimax_h3", "present": True,
                     "prompt": "carefully refined {red|blue}"}
    assert store.read_folder_state(state_path)["test_workspace_prompts"]["minimax_h3"] == first["prompt"]
    bench.save_workspace_prompt(tmp_path, "minimax_h3", "improved {cyan|magenta}")
    assert bench.workspace_prompt(tmp_path)["prompt"] == "improved {cyan|magenta}"


def test_folder_snapshots_do_not_erase_independently_autosaved_drafts(tmp_path):
    path = tmp_path / ".webcap_state.json"
    store.set_test_workspace_prompt(path, "minimax_h3", "precious {one|two}")
    store.set_test_manual_settings(path, "minimax_h3", {"duration": "3", "groupIndex": 1})
    store.set_test_campaign_settings(path, "minimax_h3", {"rounds": "3"})
    store.write_folder_state_with_owned_drafts(path, {"stats": {"phrases": "updated"}})
    saved = store.read_folder_state(path)
    assert saved["test_workspace_prompts"]["minimax_h3"] == "precious {one|two}"
    assert saved["test_manual_screening_by_model"]["minimax_h3"]["groupIndex"] == 1
    assert saved["test_campaign_by_model"]["minimax_h3"]["rounds"] == "3"
    assert saved["stats"]["phrases"] == "updated"


def test_clear_test_history_preserves_campaigns_and_set_workspace(tmp_path, monkeypatch):
    workspace = tmp_path / "workspace"
    sessions = workspace / "sessions"
    regular = sessions / "regular"
    private = sessions / "private"
    for directory, campaign_staging in ((regular, ""), (private, "epoch-finder-abcdef123456")):
        directory.mkdir(parents=True)
        (directory / "test.json").write_text(json.dumps({"campaignStaging": campaign_staging}))
    campaign = workspace / "epoch-finder" / "abcdef123456"
    campaign.mkdir(parents=True)
    (campaign / "campaign.json").write_text('{"id":"abcdef123456"}')
    (workspace / "workspace.json").write_text('{"promptByModel":{"minimax_h3":"legacy"}}')

    monkeypatch.setattr(bench, "_all_owned_session_directories", lambda folder: [regular, private])
    monkeypatch.setattr(bench, "_workspace_root", lambda folder: workspace)
    monkeypatch.setattr(bench, "_session_has_nonterminal_jobs", lambda session: False)
    monkeypatch.setattr(bench, "_snapshot_session_assessments", lambda folder, entries: None)
    monkeypatch.setattr(bench, "_cancel_test_auto_vl_jobs", lambda session: None)
    monkeypatch.setattr(bench, "_invalidate_recent_session_caches", lambda: None)

    assert bench.clear_sessions(tmp_path) == 1
    assert not regular.exists()
    assert private.exists()
    assert (campaign / "campaign.json").is_file()
    assert (workspace / "workspace.json").is_file()
