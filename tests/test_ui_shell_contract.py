from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_outer_shell_wraps_existing_workspace_without_replacing_it():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")

    assert 'id="app-frame"' in html
    assert 'id="app-header"' in html
    assert 'id="activity-rail"' in html
    assert 'id="app-header-context"' in html
    assert 'id="app-header-workspace-controls"' in html
    assert 'id="app-header-global"' in html

    # The existing inner workspace remains intact during the first migration slice.
    assert 'class="app shell-revamp workspace-view-single workflow-annotate workspace-surface-default"' in html
    assert 'id="sidebar-panel"' in html
    assert 'class="panel preview-panel"' in html
    assert 'class="panel workbench-panel"' in html
    assert 'id="app-overlay-root"' in html


def test_global_shell_controls_are_owned_by_permanent_shell():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")

    assert 'id="utility-bar"' not in html
    assert 'id="utility-current-path-btn"' not in html
    assert 'id="utility-training-btn"' not in html
    assert 'id="utility-test-bench-btn"' not in html
    assert 'class="activity-rail-spacer"' in html
    assert 'id="shell-settings-btn"' in html
    assert 'id="shell-help-btn"' in html
    assert 'class="status status-bar app-header-status"' in html
    assert 'id="status-text"' in html
    assert 'id="console-panel"' in html


def test_shell_geometry_is_outside_the_existing_workspace_grid():
    css = (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")

    assert ".app-frame {" in css
    assert 'grid-template-columns: 42px minmax(0, 1fr);' in css
    assert 'grid-template-rows: 34px minmax(0, 1fr);' in css
    assert '"header header"' in css
    assert '"rail workspace"' in css
    assert ".app-frame > .app {" in css

    # Existing workspace layout still owns its internal three-column structure.
    assert 'grid-template-areas: "sidebar preview workbench";' in css


def test_test_workspace_is_first_class_inside_permanent_shell():
    css = (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")

    assert 'id="test-generations-workspace"' in html
    assert ".app-frame.workspace-test-open > .app" in css
    assert ".app-frame.workspace-test-open > .test-generations-workspace" in css
    assert "grid-area: workspace;" in css
    assert "test-generations-workspace-open" not in css
    assert "temporarily owns the full workspace" not in css


def test_shell_activity_controls_are_real_navigation_without_replacing_legacy_paths():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")

    assert 'id="activity-prep-btn"' in html
    assert 'id="activity-training-btn"' in html
    assert 'id="activity-test-btn"' in html
    assert "prepActivityBtn.onclick = openPrepActivity" in script
    assert "trainingActivityBtn.onclick" in script
    assert "openTrainingSurface('global')" in script
    assert "window.openTestBenchActivity()" in script
    assert "window.closeTestBenchActivity()" in script


def test_shell_header_tracks_current_folder_without_owning_folder_state():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    ui = (ROOT / "tool" / "js" / "ui.js").read_text(encoding="utf-8")

    assert 'id="app-header-folder"' in html
    assert "String(state && state.folder || '')" in shell
    assert "folderEl.textContent = label" in shell
    assert "window.syncApplicationShellContext = syncApplicationShellContext" in shell
    assert "window.syncApplicationShellContext()" in ui


def test_test_activity_visibility_and_active_state_are_owned_by_new_rail():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "var activityButton = el('activity-test-btn')" in script
    assert "activityButton.classList.toggle('hidden', !visible)" in script
    assert "activityButton.classList.toggle('active', isOpen())" in script
    assert "utility-test-bench-btn" not in script


def test_console_has_one_stable_shell_host():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")

    assert html.count('id="console-panel"') == 1
    assert ".app-frame > #console-panel {" in css
    assert "syncConsolePanelHost" not in shell
    assert "host.appendChild(ui.consolePanelEl)" not in shell


def test_training_background_activity_is_mirrored_to_permanent_rail():
    script = (ROOT / "tool" / "js" / "training_runner_ui.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")

    assert "document.getElementById('activity-training-btn')" in script
    assert "activityTrainingBtn.classList.toggle('training-running', running)" in script
    assert "utility-training-btn" not in script
    assert ".activity-rail-btn.training-running::after" in css


def test_training_identity_is_owned_by_shell_header():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    workspace = (ROOT / "tool" / "js" / "training_workspace.js").read_text(encoding="utf-8")
    state = (ROOT / "tool" / "js" / "training_workspace_state.js").read_text(encoding="utf-8")

    assert 'id="app-header-workspace-title"' in html
    assert 'id="app-header-workspace-context"' in html
    assert 'id="training-workspace-back-btn"' not in html
    assert 'id="training-navigator-title"' not in html
    assert 'id="training-navigator-folder"' not in html
    assert 'id="training-sidebar-collapse-toggle-btn"' in html
    assert "surface === 'training' ? 'Training'" in shell
    assert "entryKind === 'global'" in shell
    assert "navigatorTitle" not in workspace
    assert "navigatorTitle" not in state


def test_test_workspace_uses_shell_identity_and_prep_exit():
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "testOpen ? 'Test'" in shell
    assert "workspaceContextText = 'Generations'" in shell
    assert "window.closeTestBenchActivity()" in shell
    assert "test-generations-close-btn" not in shell
    assert "test-generations-close-btn" not in script


def test_review_identity_is_owned_by_shell_header():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    review = (ROOT / "tool" / "js" / "review_output.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "workbench.css").read_text(encoding="utf-8")

    assert "surface === 'reviewOutput' ? 'Review Set'" in shell
    assert "getReviewWorkspaceShellContext" in shell
    assert "function getReviewWorkspaceShellContext()" in review
    assert 'class="review-output-surface-title"' not in html
    assert 'id="review-output-summary-folder"' not in html
    assert 'id="review-output-summary-visible"' not in html
    assert 'id="review-output-summary-scope"' not in html
    assert ".review-output-context" not in css
    assert ".review-output-surface-title" not in css
    assert 'id="review-output-back-btn"' in html


def test_grid_identity_and_prep_exit_are_owned_by_shell_without_removing_local_back():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")

    assert "surface === 'grid' ? 'Grid'" in shell
    assert "workspaceContextText = mediaGridGetSourceLabel()" in shell
    assert "normalizeWorkspaceSurface(workspaceState.surface) === 'grid'" in shell
    assert "closeMediaGridSurface();" in shell
    assert 'id="media-grid-surface-close-btn"' in html


def test_single_item_preview_header_keeps_item_controls_local_and_moves_shell_toggle_up():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    item_details = (ROOT / "tool" / "js" / "item_details.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")

    header_start = html.index('id="app-header-workspace-controls"')
    preview_start = html.index('id="preview-header"')
    sidebar_toggle = html.index('id="sidebar-collapse-toggle-btn"')

    assert header_start < sidebar_toggle < preview_start
    assert html.count('id="sidebar-collapse-toggle-btn"') == 1
    assert 'id="preview-header-position"' in html
    assert 'id="preview-header-meta"' in html
    assert 'id="preview-action-rating"' in html
    assert 'id="preview-mutation-indicator"' in html
    assert 'id="preview-open-focused-btn"' in html
    assert "ui.previewHeaderEl.classList.add('hidden');" in item_details
    assert "ui.sidebarCollapseToggleBtn.classList.toggle('hidden'" not in item_details
    assert ".app-header-workspace-controls #sidebar-collapse-toggle-btn" in css
    assert ".app.shell-revamp #sidebar-collapse-toggle-btn {" not in css


def test_focus_uses_shell_identity_but_keeps_local_cleanup_exit():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")

    assert "surface === 'focus' ? 'Focus'" in shell
    assert "prepSidebarToggle.classList.toggle('hidden', !!testOpen || surface !== 'default');" in shell
    assert "stopFocusedAnnotation();" in shell
    assert 'id="focused-annotation-close-btn"' in html


def test_working_model_state_is_shared_and_training_no_longer_owns_it():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    context = (ROOT / "tool" / "js" / "working_context.js").read_text(encoding="utf-8")
    state = (ROOT / "tool" / "js" / "training_workspace_state.js").read_text(encoding="utf-8")
    training = (ROOT / "tool" / "js" / "training_workspace.js").read_text(encoding="utf-8")

    assert html.index('src="/static/js/working_context.js"') < html.index('src="/static/js/training_workspace_state.js"')
    assert "modelProfileId: 'wan22_t2v'" in context
    assert "webcap.trainingProfile." in context
    assert "function getWorkingModelProfileId()" in context
    assert "function setWorkingModelProfileId(profileId, folder)" in context
    assert "function syncWorkingModelProfileForFolder(folder, profiles)" in context
    assert "selectedProfileId" not in state
    assert "trainingWorkspaceState.selectedProfileId" not in training
    assert "trainingProfileStorageKey" not in training
    assert "getWorkingModelProfileId()" in training
    assert "setWorkingModelProfileId(profileId, state.folder)" in training
    assert 'id="app-header-model-profile-select"' in html


def test_model_selector_is_single_real_control_in_permanent_header():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    training_state = (ROOT / "tool" / "js" / "training_workspace_state.js").read_text(encoding="utf-8")
    training = (ROOT / "tool" / "js" / "training_workspace.js").read_text(encoding="utf-8")
    test_bench = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    ui = (ROOT / "tool" / "js" / "ui.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")

    header_start = html.index('id="app-header-context"')
    workspace_start = html.index('class="app shell-revamp')
    model_select = html.index('id="app-header-model-profile-select"')

    assert header_start < model_select < workspace_start
    assert html.count('id="app-header-model-profile-select"') == 1
    assert 'id="training-model-profile-select"' not in html
    assert "modelProfileSelect:" not in training_state
    assert "getWorkingModelProfileSelect()" in training
    assert "syncWorkingModelProfileSelect(folder)" in training
    assert "window.refreshWorkingModelSelector = refreshWorkingModelSelector" in training
    assert "window.refreshWorkingModelSelector()" in ui
    assert "if (isTrainingWorkspaceActive())" in training
    assert "setWorkingModelProfileId(modelProfileSelect.value, state.folder);" in training
    assert "app-header-model-profile-select" not in test_bench
    assert "training-model-profile-select" not in test_bench
    assert "getWorkingModelProfileId()" in test_bench
    assert "webcap:working-model-changed" in test_bench
    assert ".app-header-model-control select" in css


def test_true_modals_share_one_static_application_overlay_root():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")

    root_start = html.index('id="app-overlay-root"')
    scripts_start = html.index('<!-- JS load order:')
    for modal_id in (
        'training-review-modal',
        'training-candidates-modal',
        'media-grid-viewer-modal',
        'crop-modal',
        'app-settings-modal',
        'review-rules-modal',
        'checklist-keywords-modal',
        'checklist-group-terms-modal',
        'checklist-term-affixes-modal',
    ):
        position = html.index('id="' + modal_id + '"')
        assert root_start < position < scripts_start

    assert 'id="workspace-overlays"' not in html
    assert "ensureWorkspaceOverlayChildren" not in shell
    assert "ensureWorkspaceOverlayHost" not in shell
    assert "function isApplicationOverlayOpen()" in shell
    assert ".app-overlay-root {" in css


def test_shell_navigation_state_is_derived_from_activity_root_and_context_only():
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")

    assert "var shellNavigationState = {" in shell
    assert "activity: 'prep'" in shell
    assert "workspaceRoot: 'prep'" in shell
    assert "contextKind: 'set'" in shell
    assert "function deriveShellNavigationState()" in shell
    assert "navigation.activity === 'prep'" in shell
    assert "navigation.activity === 'training'" in shell
    assert "navigation.activity === 'test'" in shell
    assert "Grid selection" not in shell
    assert "Focus group" not in shell


def test_grid_and_focus_view_mode_is_derived_from_surface_not_parallel_state():
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    grid_actions = (ROOT / "tool" / "js" / "media_grid_actions.js").read_text(encoding="utf-8")
    grid_state = (ROOT / "tool" / "js" / "media_grid_state.js").read_text(encoding="utf-8")
    main = (ROOT / "tool" / "js" / "main.js").read_text(encoding="utf-8")

    assert "workspaceUiState.viewMode" not in shell
    assert "function getWorkspaceViewMode()" in shell
    assert "surface === 'grid' || surface === 'focus'" in shell
    assert "function setWorkspaceViewMode" not in shell
    assert "setWorkspaceViewMode(" not in grid_actions
    assert "setWorkspaceViewMode(" not in grid_state
    assert "getWorkspaceViewMode() !== 'single'" in main


def test_major_workspaces_have_explicit_stable_roots():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")

    assert 'id="prep-workspace-root"' in html
    assert 'data-workspace-root="prep"' in html
    assert 'id="review-output-surface"' in html and 'data-workspace-root="review"' in html
    assert 'id="training-navigator"' in html and 'data-workspace-root="training"' in html
    assert 'id="test-generations-workspace"' in html and 'data-workspace-root="test"' in html
