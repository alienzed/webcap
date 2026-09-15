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
    assert '.workspace-surface-focus.workflow-annotate .workbench-top' in css
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
    assert "action.run({ selectReplacement: false })" in focus
    assert "action.label === 'Paste Tags' && operation" in focus
    assert "actions = decorateFocusedAnnotationPreviewActions(actions, item);" in media
    assert media.count("if (isFocusedAnnotationOpen()) return;") >= 3
    assert "handleFocusedAnnotationKeydown(e);" in media
    assert "syncFocusedAnnotationQueue({ anchorMediaKey: mediaKey });" in details
    assert "runPreviewActionByLabel('Prune');" in main
