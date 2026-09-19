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
    assert 'id="workspace-overlays"' in html


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
    assert ".app.shell-revamp.workspace-test-open" in css
    assert 'grid-template-areas: "test";' in css
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
    assert "surface === 'training' ? 'Training' : ''" in shell
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
