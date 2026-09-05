from pathlib import Path


ROOT = Path(__file__).parents[1]


def _read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_focus_set_catalog_keeps_aspect_ratios_independent_of_analysis():
    script = _read("tool/js/focus_sets.js")

    for label, bucket in (
        ("1:1", "square"),
        ("4:3", "4:3"),
        ("3:4", "3:4"),
        ("16:9", "16:9"),
        ("9:16", "9:16"),
    ):
        assert f"label: '{label}'" in script
        assert f"aspectBucket: '{bucket}'" in script

    assert "group: 'Aspect Ratio'" in script
    assert "mapAspectRatioToBucket(metadata && metadata.aspect) === preset.aspectBucket" in script
    assert "if (!preset || preset.aspectBucket) return true;" in script
    assert "<optgroup label=\"' + group + '\">" in script


def test_surface_grid_and_sidebar_use_the_shared_grouped_selector():
    html = _read("tool/tool.html")
    script = _read("tool/js/focus_sets.js")

    assert 'id="focus-set-filter-controls"' in html
    assert 'id="focus-set-grid-controls"' in html
    assert "var containers = [ui.focusSetFilterControlsEl, ui.focusSetGridControlsEl];" in script
    assert "data-focus-set-select" in script
    assert "getFilteredMediaItems(true)" in script


def test_only_the_surface_grid_and_viewer_remain():
    html = _read("tool/tool.html")
    actions = _read("tool/js/media_grid_actions.js")
    state = _read("tool/js/media_grid_state.js")
    filters = _read("tool/js/media_grid_filters.js")
    css = _read("tool/css/media_grid.css")

    assert 'id="media-grid-surface"' in html
    assert 'id="media-grid-viewer-modal"' in html
    assert 'id="media-grid-modal"' not in html
    assert "openMediaGridSurface" in actions
    assert "openMediaGridModal" not in actions
    assert "renderMediaGridModal" not in actions
    assert "mediaGridCreateModal" not in actions
    assert "mediaGridGetViewerEls" in state
    assert "mediaGridBuildFilterControls" not in filters
    assert "media-grid-left-rail" not in css
    assert "media-grid-modal" not in css


def test_single_item_preview_header_renders_existing_media_metadata():
    html = _read("tool/tool.html")
    script = _read("tool/js/item_details.js")
    css = _read("tool/css/workspace_shell.css")

    assert 'id="preview-header-position"' in html
    assert 'id="preview-header-meta"' in html
    assert html.index('id="preview-header-position"') < html.index('id="preview-header-meta"') < html.index('class="preview-header-copy"')
    assert "function renderPreviewHeaderMetadata" in script
    assert "'Item ' + (currentIndex + 1) + ' / ' + visibleMedia.length" in script
    assert "fps.toFixed(2) + ' fps'" in script
    assert "duration.toFixed(2) + 's'" in script
    assert "Math.round(frames) + 'f'" in script
    assert "' MP'" in script
    assert "grid-template-columns: auto minmax(0, 1fr) auto;" in css
    assert ".preview-header-meta-resolution" in css
    assert "overflow: hidden;" in css
