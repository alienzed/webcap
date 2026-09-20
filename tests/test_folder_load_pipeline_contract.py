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
