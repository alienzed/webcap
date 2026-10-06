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

    badge_logic = media[media.index("function liveFolderTrainingStatus"):media.index("async function renderFileList")]
    assert "status === 'queued'" in badge_logic
    assert "['starting', 'running', 'stopping']" in badge_logic
    assert "refreshFolderQueueStatusBadges();" in runner_ui


def test_advanced_filter_panel_open_state_is_transient_while_filter_values_persist():
    state = (ROOT / "tool" / "js" / "folder_state.js").read_text(encoding="utf-8")

    assert "missing_captions_only" in state
    assert "reviewed_only" in state
    assert "unreviewed_only" in state
    assert "tag_mismatch_only" in state
    assert "incomplete_only" in state
    assert "invalid_ar_only" in state
    assert "stars:" in state
    assert "flags:" in state
    assert "panel_expanded" not in state


def test_folder_load_reuses_single_sanitized_state_object():
    ui = (ROOT / "tool" / "js" / "ui.js").read_text(encoding="utf-8")
    folder_state = (ROOT / "tool" / "js" / "folder_state.js").read_text(encoding="utf-8")

    assert "var cleanFolderState = applyFolderStateToDom(folderState);" in ui
    assert "loadChecklistFromFolderState(cleanFolderState);" in ui
    assert "loadCaptionHelpersFromFolderState(cleanFolderState);" in ui
    assert "loadItemTagsFromFolderState(cleanFolderState);" in ui
    assert "return clean;" in folder_state


def test_media_selection_does_not_rebuild_entire_file_list():
    media = (ROOT / "tool" / "js" / "media.js").read_text(encoding="utf-8")

    selection = media.split("function selectPathMedia", 1)[1].split(
        "// Move through captionless items", 1
    )[0]
    assert "var visibleMedia = getFilteredMediaItems(false);" in selection
    assert "renderChecklistPanel({ skipItemDetailRefresh: true });" in selection
    assert "renderItemMetadataPanel({ skipHeader: true });" in selection
    assert "syncMediaListActiveRow(mediaItem.key);" in selection
    assert "renderFileList();" not in selection


def test_render_file_list_reuses_filtered_items_for_header_and_grid_visibility():
    media = (ROOT / "tool" / "js" / "media.js").read_text(encoding="utf-8")
    grid = (ROOT / "tool" / "js" / "media_grid_actions.js").read_text(encoding="utf-8")
    details = (ROOT / "tool" / "js" / "item_details.js").read_text(encoding="utf-8")

    render = media.split("async function renderFileList", 1)[1].split(
        "function updateFlagDotForItem", 1
    )[0]
    assert "mediaGridUpdateEntryVisibility(mediaItems, { skipHeader: true });" in render
    assert "updatePreviewActionControls(mediaItems);" in render
    assert "function mediaGridUpdateEntryVisibility(visibleItems, options)" in grid
    assert "function renderPreviewHeaderMeta(visibleMediaOverride)" in details
