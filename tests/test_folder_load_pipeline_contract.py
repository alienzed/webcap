from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_folder_load_refreshes_deterministic_status_without_originals_sync():
    script = (ROOT / "tool" / "js" / "ui.js").read_text(encoding="utf-8")
    pipeline = script[script.index("function completeFolderLoadPipeline"):script.index("// Directory listing now uses backend /fs/describe.")]

    assert "/fs/originals/sync" not in pipeline
    assert pipeline.index("applyFocusSetMetadataRows") < pipeline.index("ensurePruneCandidatesForCurrentFolder") < pipeline.index("refreshDeterministicMutationStatus();")
    assert "if (folderLoadSequence !== loadSequence || String(state.folder || '') !== String(path || '')) return;\n      refreshDeterministicMutationStatus();" in pipeline
    assert pipeline.index("failFocusSetMetadataForCurrentFolder(path);") < pipeline.rindex("refreshDeterministicMutationStatus();")



def test_test_generation_candidate_selection_is_part_of_folder_state():
    state = (ROOT / "tool" / "js" / "folder_state.js").read_text(encoding="utf-8")

    assert "testGenerationSettings.selectedFiles" in state
    assert "selectedFiles: testGenerationSelectedFiles" in state
    assert "state.testGenerationSettings" in state


def test_folder_navigation_does_not_scan_training_history_for_badges():
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")
    runner = (ROOT / "tool" / "server" / "training_runner.py").read_text(encoding="utf-8")
    media = (ROOT / "tool" / "js" / "media.js").read_text(encoding="utf-8")
    runner_ui = (ROOT / "tool" / "js" / "training_runner_ui.js").read_text(encoding="utf-8")

    describe = app[app.index("def _build_fs_describe_payload"):app.index(" # Media metadata endpoint")]
    assert "training_runner_folder_statuses" not in app
    assert "trainingStatus" not in describe
    assert "def folder_statuses_for_folders" not in runner
    assert "completed_stages" not in runner

    badge_logic = media[media.index("function liveFolderTrainingStatus"):media.index("async function renderFileList")]
    assert "status === 'queued'" in badge_logic
    assert "['starting', 'running', 'stopping']" in badge_logic
    assert "Trained" not in badge_logic
    assert "Partially trained" not in badge_logic
    assert "Ready to train" not in badge_logic
    assert "Caption review needed" not in badge_logic
    assert "refreshFolderQueueStatusBadges();" in runner_ui
