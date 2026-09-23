from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_outer_shell_wraps_existing_workspace_without_replacing_it():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")

    assert 'id="app-frame"' in html
    assert 'id="app-header"' in html
    assert 'id="activity-rail"' in html
    assert 'id="app-header-context"' in html
    assert 'id="app-header-global"' in html

    assert 'class="app shell-revamp workspace-view-single workspace-surface-default"' in html
    assert 'id="sidebar-panel"' in html
    assert 'class="panel preview-panel"' in html
    assert 'class="panel workbench-panel"' in html
    assert 'id="app-overlay-root"' in html


def test_global_shell_controls_are_owned_by_permanent_shell():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")

    assert 'class="activity-rail-spacer"' in html
    assert 'id="shell-settings-btn"' in html
    assert 'id="shell-help-btn"' in html
    assert 'id="status" class="status shell-status-bar"' in html
    assert 'id="status-text"' in html
    assert 'id="console-panel"' in html


def test_shell_geometry_is_outside_the_existing_workspace_grid():
    css = (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")

    assert ".app-frame {" in css
    assert 'grid-template-columns: 42px minmax(0, 1fr);' in css
    assert 'grid-template-rows: 34px minmax(0, 1fr) var(--shell-status-height);' in css
    assert '"header header"' in css
    assert '"rail workspace"' in css
    assert '"rail status"' in css
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


def test_shell_header_uses_workspace_first_clickable_breadcrumb_without_parallel_folder_state():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    ui = (ROOT / "tool" / "js" / "ui.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")

    assert 'id="app-header-workspace-title"' in html
    assert 'id="app-header-breadcrumb"' in html
    assert 'id="app-header-folder"' not in html
    assert html.index('id="app-header-workspace-title"') < html.index('id="app-header-breadcrumb"')
    assert "function renderApplicationHeaderBreadcrumb(navigation)" in shell
    assert "state && Array.isArray(state.dirStack)" in shell
    assert "data-dir-index" in shell
    assert "navigateToDirStackIndex(index);" in shell
    assert "if (index === lastIndex)" in shell
    assert "if (deriveShellNavigationState().activity !== 'prep') openPrepActivity();" in shell
    assert "? 'Test Generations'" in shell
    assert "? 'Focus' : 'Prep'" in shell
    assert ".app-header-breadcrumb-item:hover" in css
    assert "background: transparent;" in css
    assert "window.syncApplicationShellContext = syncApplicationShellContext" in shell
    assert "window.syncApplicationShellContext()" in ui


def test_test_activity_visibility_and_active_state_are_owned_by_new_rail():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "var activityButton = el('activity-test-btn')" in script
    assert "activityButton.classList.toggle('hidden', !visible)" in script
    assert "activityButton.classList.toggle('active', isOpen())" in script


def test_console_has_one_stable_shell_host():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")

    assert html.count('id="console-panel"') == 1
    assert ".app-frame > #console-panel {" in css


def test_training_background_activity_is_mirrored_to_permanent_rail():
    script = (ROOT / "tool" / "js" / "training_runner_ui.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")

    assert "document.getElementById('activity-training-btn')" in script
    assert "activityTrainingBtn.classList.toggle('training-running', running)" in script
    assert ".activity-rail-btn.training-running::after" in css


def test_training_identity_is_owned_by_shell_header():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    workspace = (ROOT / "tool" / "js" / "training_workspace.js").read_text(encoding="utf-8")
    state = (ROOT / "tool" / "js" / "training_workspace_state.js").read_text(encoding="utf-8")

    assert 'id="app-header-workspace-title"' in html
    assert 'id="app-header-workspace-context"' in html
    assert html.count('id="sidebar-collapse-toggle-btn"') == 1
    assert 'id="training-sidebar-collapse-toggle-btn"' not in html
    assert "surface === 'training'" in shell
    assert "? 'Training'" in shell
    assert "entryKind === 'global'" in shell
    assert "contextText = entryKind === 'global' ? 'Global'" in shell


def test_test_workspace_uses_shell_identity_and_prep_exit():
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "testOpen ? 'Test Generations'" in shell
    assert "workspaceContextText = 'Generations'" not in shell
    assert "window.closeTestBenchActivity()" in shell


def test_review_identity_is_owned_by_shell_header():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    review = (ROOT / "tool" / "js" / "review_output.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "workbench.css").read_text(encoding="utf-8")

    assert "surface === 'reviewOutput'" in shell
    assert "? 'Review Set'" in shell
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

    assert "surface === 'grid'" in shell
    assert "? 'Grid'" in shell
    assert "normalizeWorkspaceSurface(workspaceState.surface) === 'grid'" in shell
    assert "closeMediaGridSurface();" in shell
    assert 'id="media-grid-surface-close-btn"' in html


def test_single_item_preview_context_stays_with_the_preview_surface():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    item_details = (ROOT / "tool" / "js" / "item_details.js").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")

    header_start = html.index('id="app-header"')
    header_end = html.index('</header>', header_start)
    preview_start = html.index('id="preview-header"')
    prep_root = html.index('id="prep-workspace-root"')
    preview_shell = html.index('id="preview-shell"')

    assert header_start < prep_root < preview_shell < preview_start
    assert preview_start > header_end
    assert html.count('id="preview-header"') == 1
    assert 'id="preview-header-position"' in html
    assert 'id="preview-header-meta"' in html
    assert 'id="preview-action-rating"' in html
    assert 'id="preview-mutation-indicator"' in html
    assert 'id="preview-open-focused-btn"' in html
    assert ".app.shell-revamp .preview-header {" in css
    assert "previewHeader.classList.toggle('shell-context-hidden', !previewContextRelevant);" in shell
    assert "if (!focusOpen && currentIndex >= 0 && visibleMedia.length > 0)" in item_details


def test_focus_uses_shell_identity_but_keeps_local_cleanup_exit():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    focus = (ROOT / "tool" / "js" / "focused_annotation.js").read_text(encoding="utf-8")
    grid = (ROOT / "tool" / "js" / "media_grid_state.js").read_text(encoding="utf-8")

    assert "surface === 'focus'" in shell
    assert "? 'Focus' : 'Prep'" in shell
    assert "sidebarToggleVisible = !testOpen && (surface === 'default' || surface === 'training');" in shell
    assert "stopFocusedAnnotation();" in shell
    assert "function mediaGridLeaveForWorkspaceTransition()" in grid
    assert "mediaGridHideSurfaceShell();" in grid
    assert "mediaGridResetSessionState();" in grid
    assert "mediaGridLeaveForWorkspaceTransition();" in focus
    assert focus.index("mediaGridLeaveForWorkspaceTransition();") < focus.index("setWorkspaceSurface('focus'")
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
    assert 'id="app-header-model-control" class="app-header-model-control hidden"' in html
    assert '<span class="app-header-model-label">Base Model</span>' in html
    assert 'aria-label="Base Model"' in html
    assert "modelRelevant = navigation.activity === 'training' || navigation.activity === 'test'" in shell
    assert "modelControl.classList.toggle('hidden', !modelRelevant)" in shell
    assert "modelSelect.disabled = navigation.activity === 'test'" in shell
    assert "modelProfileSelect:" not in training_state
    assert "getWorkingModelProfileSelect()" in training
    assert "syncWorkingModelProfileSelect(folder)" in training
    assert "select.disabled = false" not in training
    assert "window.syncApplicationShellContext()" in training
    assert "window.refreshWorkingModelSelector = refreshWorkingModelSelector" in training
    assert "window.refreshWorkingModelSelector()" in ui
    assert "if (isTrainingWorkspaceActive())" in training
    assert "setWorkingModelProfileId(modelProfileSelect.value, state.folder);" in training
    assert "app-header-model-profile-select" not in test_bench
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


def test_grid_and_focus_view_mode_is_derived_from_surface_not_parallel_state():
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    grid_actions = (ROOT / "tool" / "js" / "media_grid_actions.js").read_text(encoding="utf-8")
    grid_state = (ROOT / "tool" / "js" / "media_grid_state.js").read_text(encoding="utf-8")
    main = (ROOT / "tool" / "js" / "main.js").read_text(encoding="utf-8")

    assert "function getWorkspaceViewMode()" in shell
    assert "surface === 'grid' || surface === 'focus'" in shell
    assert "normalizeWorkspaceViewMode" not in shell
    assert "getWorkspaceViewMode() !== 'single'" in main


def test_major_workspaces_have_explicit_stable_roots():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")

    assert 'id="prep-workspace-root"' in html
    assert 'data-workspace-root="prep"' in html
    assert 'id="review-output-surface"' in html and 'data-workspace-root="review"' in html
    assert 'id="training-navigator"' in html and 'data-workspace-root="training"' in html
    assert 'id="test-generations-workspace"' in html and 'data-workspace-root="test"' in html


def test_checklist_visibility_has_one_class_based_owner_without_grid_overrides():
    checklist_state = (ROOT / "tool" / "js" / "checklist_state.js").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    grid_state = (ROOT / "tool" / "js" / "media_grid_state.js").read_text(encoding="utf-8")
    annotate = (ROOT / "tool" / "js" / "caption_helpers_annotate.js").read_text(encoding="utf-8")
    grid_css = (ROOT / "tool" / "css" / "media_grid.css").read_text(encoding="utf-8")

    assert "checklistPanelEl.classList.toggle('hidden', !visible);" in checklist_state
    assert "checklistPanelEl.style.display" not in checklist_state
    assert "style.display = 'none'" not in shell
    assert "style.display = 'flex'" not in grid_state
    assert "!panelEl.classList.contains('hidden')" in annotate
    assert "!important" not in grid_css


def test_shell_initialization_has_no_reparent_or_rebuild_fossils():
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    main = (ROOT / "tool" / "js" / "main.js").read_text(encoding="utf-8")
    console = (ROOT / "tool" / "js" / "console_panel.js").read_text(encoding="utf-8")

    assert "function initializeWorkspaceShell()" in shell
    assert "initializeWorkspaceShell();" in main
    assert "style.display" not in console


def test_shell_immersive_mode_is_shell_owned_and_escape_exits():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")

    assert 'id="shell-immersive-btn"' in html
    assert 'id="shell-immersive-exit-btn"' in html
    assert "function setShellImmersive(nextImmersive)" in shell
    assert "event.key !== 'Escape' || event.defaultPrevented" in shell
    assert "shellNavigationState.immersive" in shell
    assert ".app-frame.shell-immersive" in css
    assert ".app-frame.shell-immersive > .app-header" in css
    assert ".app-frame.shell-immersive > .activity-rail" in css


def test_responsive_shell_compresses_header_without_dropping_permanent_rail():
    css = (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")
    workbench = (ROOT / "tool" / "css" / "workbench.css").read_text(encoding="utf-8")

    assert "@media (max-width: 1180px)" in css
    assert "@media (max-width: 880px)" in css
    assert ".activity-rail-btn {" in css
    assert "width: 32px;" in css
    assert ".app-header-context {" in css
    assert ".sidebar-edge-toggle-btn" in css
    assert ".app.shell-revamp.workspace-surface-config-editor.left-rail-collapsed" in workbench
    assert 'grid-template-areas: "workbench";' in workbench


def test_console_visibility_is_class_owned_after_shell_cleanup():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    console = (ROOT / "tool" / "js" / "console_panel.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")

    assert 'id="console-panel" class="hidden" aria-hidden="true"' in html
    assert "classList.toggle('hidden', !expanded)" in console
    assert "classList.toggle('console-open', expanded)" in console
    assert "isConsolePanelVisible()" in console
    assert "btn.innerHTML" not in console
    assert "btn.classList.toggle('active', expanded)" in console
    assert "syncWorkspaceConfigEditorUi()" not in console
    assert "syncTrainingConsoleUi()" not in console
    assert "style.display" not in console
    assert ".app-frame > #console-panel {" in css
    assert "height: var(--shell-console-height);" in css
    assert "bottom: calc(var(--shell-status-height) + 8px);" in css
    assert ".shell-status-bar {" in css
    assert "grid-area: status;" in css
    assert ".app-frame.console-open > .shell-status-toast" not in css
    assert "display: flex;" in css


def test_activity_navigation_and_escape_precedence_are_accessible():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")

    assert 'aria-controls="prep-workspace-root"' in html
    assert 'aria-controls="training-navigator"' in html
    assert 'aria-controls="test-generations-workspace"' in html
    assert 'aria-current="page"' in html
    assert "setAttribute('aria-current', prepActive ? 'page' : 'false')" in shell
    assert "setAttribute('aria-current', trainingActive ? 'page' : 'false')" in shell
    assert "setAttribute('aria-current', testActive ? 'page' : 'false')" in shell
    assert "#app-overlay-root > :not(.hidden)[data-escape-close-id]" in shell
    assert "closeBtn.click();" in shell
    assert "isFocusedAnnotationOpen()" in shell
    assert "setShellImmersive(false);" in shell


def test_reload_location_uses_hash_route_not_transient_ui_persistence():
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    main = (ROOT / "tool" / "js" / "main.js").read_text(encoding="utf-8")
    ui = (ROOT / "tool" / "js" / "ui.js").read_text(encoding="utf-8")
    test_bench = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "function parseShellLocationRoute()" in shell
    assert "function syncShellLocationRoute()" in shell
    assert "function applyInitialShellLocationRoute()" in shell
    assert "function restoreInitialShellLocationRoute()" in shell
    assert "window.history.replaceState" in shell
    assert "'#/' + workspace" in shell
    assert "params.set('folder', folder)" in shell
    assert "params.set('scope', 'global')" in shell
    assert "applyInitialShellLocationRoute();" in main
    assert "restoreInitialShellLocationRoute()" in ui
    assert "openTestBenchForCurrentFolder" in test_bench
    assert "syncShellLocationRoute()" in test_bench
    assert "localStorage" not in shell
    assert "shellNavigationState.immersive" in shell
    assert "immersive" not in shell[shell.index("function syncShellLocationRoute()"):shell.index("function applyInitialShellLocationRoute()")]


def test_generic_application_modals_close_on_escape_without_feature_inventory():
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    checklist = (ROOT / "tool" / "js" / "checklist_modals.js").read_text(encoding="utf-8")
    advanced = (ROOT / "tool" / "js" / "advanced_mappings_rules.js").read_text(encoding="utf-8")

    assert "#app-overlay-root > .modal:not(.hidden)" in shell
    assert "genericModal.querySelector('[data-close-modal="" in shell
    assert "ensureWorkspaceOverlayChildren" not in checklist
    assert "ensureWorkspaceOverlayChildren" not in advanced


def test_phase_40_shell_owns_global_presentation_not_training_internals():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    training = (ROOT / "tool" / "js" / "training_workspace.js").read_text(encoding="utf-8")
    runner = (ROOT / "tool" / "js" / "training_runner_ui.js").read_text(encoding="utf-8")
    test_bench = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")

    assert 'class="app-header-brand"' not in html
    assert 'id="status" class="status shell-status-bar"' in html
    assert 'id="console-toggle-btn"' in html
    assert html.index('id="console-toggle-btn"') > html.index('id="activity-rail"')
    assert 'id="shell-gpu-status"' in html
    assert "training-runner-output-view" not in shell
    assert "training-runner-empty" not in shell
    assert "training-editor-empty" not in shell
    assert "training-config-empty" not in shell
    assert "function syncTrainingWorkspaceDetailUi()" in training
    assert "function syncTrainingEntryChrome()" in training
    assert "function syncShellTrainingGpuStatus()" in runner
    assert "renderShellSystemStatus()" in runner
    assert "function refreshShellSystemStatus()" in shell
    assert "fetch('/fs/system_status')" in shell
    assert 'route("/fs/system_status"' in app
    assert "shutil.disk_usage(app_config.FS_ROOT)" in app
    assert "if (trainingWorkspaceState.runnerStatusPending) return;" in runner
    assert ".shell-status-bar {" in css
    assert ".shell-gpu-status {" in css
    assert "function getShellWorkloadStatus()" in shell
    assert "var shellWorkloadState =" in shell
    assert "classList.contains('training-running')" not in shell
    assert "classList.contains('test-running')" not in shell
    assert "function setShellTrainingActive(active)" in shell
    assert "function setShellTestingActive(active)" in shell
    assert "function setShellGeneratingActive(active)" in shell
    assert "shell-workload-status is-" in shell
    assert "window.setShellTrainingActive = setShellTrainingActive" in shell
    assert "window.setShellTestingActive = setShellTestingActive" in shell
    assert "window.setShellGeneratingActive = setShellGeneratingActive" in shell
    assert "window.renderShellSystemStatus" not in shell
    assert "setShellTrainingActive(running);" in runner
    assert "setShellTestingActive(!!active);" in test_bench
    assert "typeof window.renderShellSystemStatus" not in runner
    assert "typeof window.renderShellSystemStatus" not in test_bench
    assert ".shell-workload-status {" in css
    assert ".shell-workload-status.is-generating" in css
    assert "color: var(--accent);" in css
    assert "font-size: 12px;" in css
    assert ".shell-gpu-status .shell-system-disk {" in css
    assert "gap: 4px;" in css
    assert "color-mix(in srgb, var(--warning, #b45309) 58%, white)" in css


def test_phase_audit_retires_duplicate_view_state_and_empty_split_bridge():
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    media = (ROOT / "tool" / "js" / "media.js").read_text(encoding="utf-8")

    assert "setWorkspaceViewMode(" not in media
    assert "updateWorkspaceSplitLayout" not in shell


def test_phase_audit_restores_shared_editor_after_training_and_owns_checklist_visibility():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    workbench = (ROOT / "tool" / "css" / "workbench.css").read_text(encoding="utf-8")

    checklist_state = (ROOT / "tool" / "js" / "checklist_state.js").read_text(encoding="utf-8")
    assert 'id="caption-checklist-panel" class="checklist-panel workbench-card group-tools-card hidden"' in html
    assert 'style="display:none;"' not in html
    assert "checklistPanelEl.classList.toggle('hidden', !visible);" in checklist_state
    assert "checklistPanelEl.style.display" not in checklist_state
    assert "#caption-checklist-panel.group-tools-card.checklist-panel {\n  display: flex;" in workbench
    assert "#caption-checklist-panel.group-tools-card.checklist-panel {\n  display: flex !important;" not in workbench
    assert "ui.appEl.classList.remove('training-config-selected')" in shell
    assert "editorWrapper.classList.remove('hidden')" in shell


def test_background_training_activity_is_discovered_on_app_startup():
    main = (ROOT / "tool" / "js" / "main.js").read_text(encoding="utf-8")
    runner = (ROOT / "tool" / "js" / "training_runner_ui.js").read_text(encoding="utf-8")

    assert "if (typeof refreshTrainingRunnerStatus === 'function') refreshTrainingRunnerStatus();" in main
    assert "function scheduleTrainingRunnerPoll()" in runner
    assert "if (!hasActiveJob) return;" in runner


def test_retired_workflow_mode_does_not_survive_as_parallel_shell_state():
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    grid = (ROOT / "tool" / "js" / "media_grid_state.js").read_text(encoding="utf-8")
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    shell_css = (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")
    workbench_css = (ROOT / "tool" / "css" / "workbench.css").read_text(encoding="utf-8")

    for source in (shell, grid, html, shell_css, workbench_css):
        assert "workflow-annotate" not in source
        assert "workflow-select" not in source
        assert "workflow-review" not in source
    assert "workspaceUiState" not in shell
    assert "setWorkspaceWorkflowMode" not in shell
    assert "workflowMode" not in grid


def test_post_refactor_hygiene_has_one_sidebar_control_and_no_legacy_shell_fossils():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    training = (ROOT / "tool" / "js" / "training_workspace.js").read_text(encoding="utf-8")
    constants = (ROOT / "tool" / "js" / "constants.js").read_text(encoding="utf-8")
    styles = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert html.count('id="sidebar-collapse-toggle-btn"') == 1
    assert "training-sidebar-collapse-toggle-btn" not in html + training + shell
    assert 'class="sidebar-edge-toggle-btn"' in html
    assert 'id="app-header-workspace-controls"' not in html
    assert ".utility-bar" not in styles
    assert "#utility-training-btn" not in styles
    assert "#utility-test-bench-btn" not in styles
    assert ".console-toggle-btn" not in styles
    assert 'id="preview-action-primary-a"' in html
    assert 'id="preview-action-primary-b"' in html
    assert 'id="preview-action-more"' in html
    assert "previewPrimaryActionAEl: document.getElementById('preview-action-primary-a')" in constants
    assert "previewPrimaryActionBEl: document.getElementById('preview-action-primary-b')" in constants
    assert "previewMoreActionsEl: document.getElementById('preview-action-more')" in constants
    assert ">Train Set</button>" in html


def test_single_item_preview_actions_keep_their_runtime_contract():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    constants = (ROOT / "tool" / "js" / "constants.js").read_text(encoding="utf-8")
    media = (ROOT / "tool" / "js" / "media.js").read_text(encoding="utf-8")
    main = (ROOT / "tool" / "js" / "main.js").read_text(encoding="utf-8")

    for element_id in (
        "preview-action-primary-a",
        "preview-action-primary-b",
        "preview-action-more",
    ):
        assert f'id="{element_id}"' in html

    assert "previewPrimaryActionAEl" in constants
    assert "previewPrimaryActionBEl" in constants
    assert "previewMoreActionsEl" in constants
    assert "getPreviewPrimaryActionPlan" in media
    assert "wirePreviewActionControls()" in main
    assert "updatePreviewActionControls()" in main

def test_caption_report_owns_a_large_inspectable_balance_wheel():
    preview = (ROOT / "tool" / "js" / "preview_pane.js").read_text(encoding="utf-8")
    stats = (ROOT / "tool" / "js" / "stats.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "report.css").read_text(encoding="utf-8")

    assert "phraseMatchCounts" in stats
    assert "matchCount: matchCount" in stats
    assert "matchPercent: matchPercent" in stats
    assert "function renderReportBalanceWheel(report)" in preview
    assert 'class="card report-balance-wheel-card"' in preview
    assert 'class="report-balance-wheel-svg"' in preview
    assert "<title>" in preview
    assert "Hover a slice for phrase coverage." in preview
    assert "renderReportBalanceWheel(report)" in preview
    assert "width: 320px" in css
    assert "min-width: 300px" in css
    assert ".report-balance-wheel-slice:hover" in css

