from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_focused_annotation_navigation_is_dom_free_and_loaded_before_its_controller():
    navigator = _read("tool/js/focused_annotation_navigation.js")
    html = _read("tool/tool.html")

    assert "function start(input, preferredItemKey)" in navigator
    assert "function advance(input, cursor)" in navigator
    assert "function reconcile(input, cursor)" in navigator
    assert "document." not in navigator
    assert "selectPathMedia" not in navigator
    assert "checklistItems" not in navigator
    assert html.index('src="/static/js/focused_annotation_navigation.js"') < html.index('src="/static/js/focused_annotation.js"')


def test_focus_uses_the_single_item_preview_and_replaces_only_the_groups_pane():
    html = _read("tool/tool.html")
    css = _read("tool/css/workspace_shell.css")

    assert 'id="focused-annotation-modal"' not in html
    assert 'id="focused-annotation-workbench"' in html
    assert html.index('id="focused-annotation-workbench"') < html.index('class="workbench-bottom"')
    assert html.count('id="preview"') == 1
    assert html.count('id="preview-action-rating"') == 1
    assert html.count('id="preview-actions"') == 1
    assert '.workspace-surface-focus .groups-card' in css
    assert '.workspace-surface-focus .workbench-side-stack' in css
    assert '.workspace-surface-focus .workbench-rail-toggle-btn' in css
    assert '.workspace-surface-focus .workbench-top' in css
    assert '#focused-annotation-workbench' in css

    focus_css = _read("tool/css/modals.css")
    assert ".focused-annotation-axis-nav .focused-annotation-nav-btn" in focus_css
    assert "background: rgba(15, 23, 42, 0.76);" in focus_css


def test_focus_controller_uses_navigator_and_exposes_workflow_entry_points():
    script = _read("tool/js/focused_annotation.js")
    callers = "\n".join(
        _read(path)
        for path in (
            "tool/js/common.js",
            "tool/js/main.js",
            "tool/js/media_context_actions.js",
            "tool/js/ui_event_wiring.js",
        )
    )

    assert "FocusedAnnotationNavigation.start" in script
    assert "FocusedAnnotationNavigation.advance" in script
    assert "FocusedAnnotationNavigation.reconcile" in script
    assert "function startFocusedAnnotation(" in script
    assert "function startFocusedAnnotationForMediaItem(" in script
    assert "function stopFocusedAnnotation(" in script
    assert "function renderFocusedAnnotationSurface(" in script
    assert "openFocusedAnnotationModal" not in script + callers
    assert "renderFocusedAnnotationModal" not in script + callers
    assert "if (state.currentItem && state.currentItem.key === targetItem.key)" in script
    assert "renderFocusedAnnotationSurface();\n    return;\n  }\n  selectPathMedia(targetItem)" in script


def test_focus_reuses_shared_actions_and_disables_single_item_iframe_gestures():
    focus = _read("tool/js/focused_annotation.js")
    media = _read("tool/js/media.js")
    details = _read("tool/js/item_details.js")
    main = _read("tool/js/main.js")

    assert "function decorateFocusedAnnotationPreviewActions(actions, mediaItem)" in focus
    assert "String(action.label || '') !== 'Focused Annotate...'" in focus
    assert "mappedRender = function flagRowRenderer(value)" in focus
    assert "action.run({ selectReplacement: false })" in focus
    assert "action.label === 'Paste Tags' && operation" in focus
    assert "actions = decorateFocusedAnnotationPreviewActions(actions, item);" in media
    assert media.count("if (isFocusedAnnotationOpen()) return;") >= 3
    assert "handleFocusedAnnotationKeydown(e);" in media
    assert "syncFocusedAnnotationQueue({ anchorMediaKey: mediaKey });" in details
    assert "runPreviewActionByLabel('Prune');" in main


def test_focus_header_hides_entry_and_sidebar_controls_while_active():
    html = _read("tool/tool.html")
    details = _read("tool/js/item_details.js")
    ui = _read("tool/js/ui.js")
    shell = _read("tool/js/workspace_shell.js")
    focus = _read("tool/js/focused_annotation.js")

    assert 'id="preview-open-focused-btn"' in html
    assert "sidebar-open-focused-btn" not in html + details + ui + shell
    assert "sidebarFocusBtnEl" not in details + ui
    assert "ui.sidebarCollapseToggleBtn.classList.toggle('hidden', focusOpen ||" not in details
    assert "ui.previewFocusBtnEl.classList.toggle('hidden', !hasItem || focusOpen);" in details
    assert "ui.previewFocusBtnEl.classList.toggle('hidden', !hasCurrentItem || focusOpen);" in ui
    assert focus.count("renderPreviewHeaderMeta();") >= 2
    assert "'Item ' + (focusedAnnotationState.itemIndex + 1) + ' / ' + itemKeys.length" in focus
    assert "'Group ' + (groupIndex + 1) + ' / ' + requirements.length" in focus


def test_focus_has_no_duplicate_surface_remnants_and_restores_group_keys_on_undo():
    tool_sources = "\n".join(
        path.read_text(encoding="utf-8")
        for path in (ROOT / "tool").rglob("*")
        if path.suffix in {".html", ".js", ".css"}
    )
    obsolete_tokens = (
        "focused-annotation-modal",
        "focused-annotation-preview-media",
        "focused-annotation-rating",
        "focused-annotation-preview-actions",
        "openFocusedAnnotationModal",
        "renderFocusedAnnotationModal",
        "closeFocusedAnnotationModal",
        "sidebarFocusBtnEl",
        "sidebar-open-focused-btn",
        "focused-annotation-secondary-action-btn",
    )
    for token in obsolete_tokens:
        assert token not in tool_sources

    common = _read("tool/js/common.js")
    assert "focusedAnnotationState.groupKey = String(op.requirementLabel || '').trim();" in common
    assert "if (undone && isFocusedAnnotationOpen())" in _read("tool/js/main.js")


def test_focus_shell_identity_and_activity_exit_preserve_real_focus_cleanup():
    html = _read("tool/tool.html")
    shell = _read("tool/js/workspace_shell.js")
    focus = _read("tool/js/focused_annotation.js")

    assert "surface === 'focus' ? 'Focus'" in shell
    assert "prepSidebarToggle.classList.toggle('hidden', !!testOpen || surface !== 'default');" in shell
    assert "surface === 'focus'" in shell
    assert "stopFocusedAnnotation();" in shell
    assert 'id="focused-annotation-close-btn"' in html
    assert "els.closeBtn.addEventListener('click', stopFocusedAnnotation);" in focus
    assert "e.key === 'Escape'" in focus
    assert "focusedAnnotationState.open = false;" in focus
    assert "exitWorkspaceSurface();" in focus


def test_focus_modal_suppression_uses_central_overlay_state_not_feature_inventory():
    focus = _read("tool/js/focused_annotation.js")
    shell = _read("tool/js/workspace_shell.js")

    assert "return typeof isApplicationOverlayOpen === 'function' && isApplicationOverlayOpen();" in focus
    for modal_id in (
        "checklist-group-terms-modal",
        "checklist-term-affixes-modal",
        "checklist-keywords-modal",
        "review-rules-modal",
        "crop-modal",
        "video-clip-modal",
    ):
        assert modal_id not in focus
    assert "function isApplicationOverlayOpen()" in shell


def test_focus_does_not_expose_rare_group_delete_action():
    html = _read("tool/tool.html")
    focus = _read("tool/js/focused_annotation.js")
    workbench = _read("tool/js/group_workbench.js")

    assert 'id="focused-annotation-group-delete-btn"' not in html
    assert "groupDeleteBtn" not in focus
    assert "deleteFocusedAnnotationCurrentGroup" not in focus
    assert "deleteChecklistGroupByIndex" in workbench


def test_focus_does_not_depend_on_retired_workflow_mode_state():
    focus = _read("tool/js/focused_annotation.js")

    assert "setWorkspaceSurface('focus', { sidebarHidden: true });" in focus
    assert "setWorkspaceWorkflowMode" not in focus


def test_focus_requires_a_valid_group_before_opening():
    focus = (ROOT / "tool" / "js" / "focused_annotation.js").read_text(encoding="utf-8")

    assert "if (!itemKey || !requirementLabel || requirements.indexOf(requirementLabel) < 0)" in focus
    assert "Focused annotation could not open because no annotation group is selected." in focus
    assert "if (!showFocusedAnnotationSurface()) return;" in focus
