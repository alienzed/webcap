from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_single_vl_context_action_with_shared_media_entrypoint():
    actions = read("tool/js/media_context_actions.js")
    group = actions.split("label: 'Focus Caption'", 1)[1].split("label: 'Copy Tags'", 1)[0]
    assert group.count("label: 'VL Workspace...'") == 1
    assert "openVlWorkspace(mediaItem, 'sight');" in group
    for old in ("label: 'Describe with VL'", "label: 'Ask VL...'", "label: 'View Saved Intelligence'"):
        assert old not in group
    scan = read("tool/js/set_scan.js")
    assert "window.openVlWorkspace = openSavedIntelligenceForMedia;" in scan
    assert "window.closeVlWorkspace = closeSavedIntelligence;" in scan
    assert "function openSavedIntelligenceForMedia(mediaItem, initialTab)" in scan


def test_single_modal_owns_existing_ask_and_describe_controls():
    html = read("tool/tool.html")
    start = html.index('id="saved-intelligence-modal"')
    end = html.index('id="vision-schema-modal"', start)
    workspace = html[start:end]
    assert workspace.count('id="ask-vision-modal"') == 1
    assert workspace.count('id="vision-image-caption-modal"') == 1
    for part in ("sight", "ask", "describe"):
        assert f'id="vl-workspace-tab-{part}"' in workspace
    assert 'id="ask-vision-question"' in workspace
    assert 'id="ask-vision-send"' in workspace
    assert 'id="ask-vision-cancel"' in workspace
    assert 'id="vision-image-caption-copy"' in workspace
    assert 'id="vision-image-caption-use"' in workspace
    assert 'id="vision-image-caption-cancel"' in workspace
    assert 'id="vl-workspace-describe-run"' in workspace
    assert html.count('id="ask-vision-modal"') == 1
    assert html.count('id="vision-image-caption-modal"') == 1


def test_qa_caption_assist_and_prepare_set_reuse_same_modal():
    html = read("tool/tool.html")
    vision = read("tool/js/caption_vision.js")
    scan = read("tool/js/set_scan.js")
    assert 'id="editor-caption-vl-workspace"' in html
    assert "openVlWorkspace(state.currentItem, 'sight');" in vision
    assert "openSightReviewForFile(el('set-scan-item-select').value)" in scan
    assert "selectVlWorkspaceTab(initialTab || 'sight')" in scan
    assert "function selectVlWorkspaceTab(tab)" in scan
    assert "runVisionImageCaption(setScanState.reviewMediaItem)" in scan
    assert "openAskVisionQuestion(setScanState.reviewMediaItem)" in scan


def test_ask_and_describe_retain_own_job_lifecycle_with_explicit_media():
    vision = read("tool/js/caption_vision.js")
    assert "function openAskVisionQuestion(mediaOverride)" in vision
    assert "var media = mediaOverride || (state && state.currentItem)" in vision
    assert "var item = askVisionState.mediaItem" in vision
    assert "folder: askVisionState.folder" in vision
    assert "function runVisionImageCaption(mediaItemOverride)" in vision
    assert "requestVisionImageCaptionDescription(mediaItem" in vision
    assert "cancelAskVisionJob()" in vision
    assert "cancelVisionImageCaptionRequest()" in vision
    assert "copyVisionImageCaption()" in vision
    assert "useVisionImageCaptionInEditor()" in vision
    assert "closeVlWorkspace();" in vision
    assert "runVisionImageCaption();" not in read("tool/js/media_context_actions.js")
    assert "openAskVisionQuestion();" not in read("tool/js/media_context_actions.js")


def test_vl_workspace_header_groups_tabs_with_title_and_keeps_narrow_navigation():
    html = read("tool/tool.html")
    section = html.split('id="saved-intelligence-modal"', 1)[1].split('id="saved-intelligence-status"', 1)[0]
    title = section.index('id="saved-intelligence-title"')
    tabs = section.index('<nav class="vl-workspace-tabs"')
    navigation = section.index('class="vl-workspace-item-navigation"')
    close = section.index('id="saved-intelligence-close-btn"')
    assert title < tabs < navigation < close
    assert section.count('<nav class="vl-workspace-tabs"') == 1
    assert section.count('</nav>') == 1
    for button_id in ("vl-workspace-prev", "vl-workspace-next"):
        button_markup = next(line for line in section.splitlines() if f'id="{button_id}"' in line)
        assert 'review-captions-btn' not in button_markup

    css = read("tool/css/modals.css")
    nav_button_css = css.split('.vl-workspace-item-navigation > button {', 1)[1].split('}', 1)[0]
    assert 'display:grid;' in nav_button_css
    assert 'place-items:center;' in nav_button_css
    assert 'border:1px solid var(--border-soft);' in nav_button_css
    assert 'min-width:9ch;' in css
    assert 'flex-wrap:nowrap;' in css
    assert 'grid-template-areas:"heading navigation close" "tabs tabs tabs";' in css
    assert '#saved-intelligence-modal .vl-workspace-tabs { grid-area:tabs; overflow-x:auto;' in css
    assert '#saved-intelligence-file { display:block; overflow:hidden; text-overflow:ellipsis;' in css
    assert "el('saved-intelligence-file').title = file;" in read("tool/js/set_scan.js")
