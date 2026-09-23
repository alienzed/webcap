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
    assert "preset.aspectBucket || preset.mediaType || preset.sceneBucket || isFocusSetResolutionPreset(preset)" in script
    assert "<optgroup label=\"' + group + '\">" in script


def test_focus_set_catalog_includes_deterministic_media_type_sets():
    script = _read("tool/js/focus_sets.js")

    assert "key: 'media_images', label: 'Images', group: 'Media Type', mediaType: 'image'" in script
    assert "key: 'media_videos', label: 'Videos', group: 'Media Type', mediaType: 'video'" in script
    assert "function focusSetItemMatchesMediaType(item, mediaType)" in script
    assert "isFocusSetImageItem(item)" in script
    assert "isFocusSetVideoItem(item)" in script


def test_focus_set_catalog_reuses_scene_complexity_metadata():
    script = _read("tool/js/focus_sets.js")

    for key, label, bucket in (
        ("scene_simple", "Simple", "simple"),
        ("scene_moderate", "Moderate", "moderate"),
        ("scene_busy", "Busy", "busy"),
    ):
        assert f"key: '{key}'" in script
        assert f"label: '{label}'" in script
        assert f"sceneBucket: '{bucket}'" in script

    assert "function focusSetItemMatchesSceneBucket(item, sceneBucket)" in script
    assert "getSceneComplexityFromMetadata(metadata)" in script
    assert "normalizeSceneComplexityBucket(complexity.bucket) === sceneBucket" in script
    assert "['Selection', 'Media Type', 'Aspect Ratio', 'Resolution', 'Scene Complexity']" in script


def test_focus_set_catalog_groups_images_by_actual_short_side_resolution():
    script = _read("tool/js/focus_sets.js")

    for key, label, minimum, maximum in (
        ("resolution_768_plus", "768+", "768", None),
        ("resolution_512_767", "512–767", "512", "767"),
        ("resolution_384_511", "384–511", "384", "511"),
        ("resolution_below_384", "Below 384", None, "383"),
    ):
        assert f"key: '{key}'" in script
        assert f"label: '{label}'" in script
        if minimum is not None:
            assert f"minShortSide: {minimum}" in script
        if maximum is not None:
            assert f"maxShortSide: {maximum}" in script

    assert "group: 'Resolution'" in script
    assert "Math.min(dimensions.width, dimensions.height)" in script
    assert "isFocusSetImageItem(item)" in script
    assert "focusSetItemMatchesResolutionPreset(item, preset)" in script
    assert "['Selection', 'Media Type', 'Aspect Ratio', 'Resolution', 'Scene Complexity']" in script


def test_resolution_focus_sets_reuse_existing_folder_metadata_without_new_analysis():
    script = _read("tool/js/focus_sets.js")
    details = _read("tool/js/item_details.js")

    assert "var metadata = item.metadata || getMetadataForMedia(item.fileName);" in script
    assert "metadata && metadata.resolution" in script
    assert "'/fs/media_metadata?folder='" in details
    assert "item.metadata = row;" in details
    assert "webcap:media-metadata-updated" in details


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
    assert ".app.shell-revamp.workspace-surface-grid .preview-shell > :not(#media-grid-surface)" in css
    assert ".app.shell-revamp.workspace-view-grid .preview-shell > :not(#media-grid-surface)" not in css


def test_grid_initializes_after_all_classic_scripts_are_loaded():
    actions = _read("tool/js/media_grid_actions.js")

    assert "addEventListener('DOMContentLoaded', initMediaGrid);" in actions
    assert "\ninitMediaGrid();" not in actions


def test_grid_delete_exclusively_uses_the_batch_prune_snapshot():
    actions = _read("tool/js/media_grid_actions.js")
    main = _read("tool/js/main.js")

    assert "function mediaGridHandleKeydown(e) {\n  if (e.defaultPrevented) return;" in actions
    assert "var items = mediaGridGetSelectedItems();" in actions
    assert "var count = items.length;" in actions
    assert "for (var i = 0; i < items.length; i += 1)" in actions
    assert "mediaGridState.selectedKeys.delete(key);" in actions
    assert "if (mediaGridState.open) return;" in main


def test_grid_deface_shortcut_uses_serial_batch_mutation_bookkeeping():
    actions = _read("tool/js/media_grid_actions.js")
    state = _read("tool/js/media_grid_state.js")

    assert "function mediaGridDefaceSelected()" in actions
    assert "var items = mediaGridGetSelectedItems();" in actions
    assert "var eligibleItems = items.filter(mediaGridCanDefaceItem);" in actions
    assert "return !!MEDIA_EXTENSIONS[ext];" in actions
    assert "if (!items.length)" in actions
    assert "if (!eligibleItems.length)" in actions
    assert "'Deface ' + eligibleItems.length + ' selected media item'" in actions
    assert "for (var i = 0; i < eligibleItems.length; i += 1)" in actions
    assert "var response = await fetch('/fs/deface'" in actions
    assert "var output = await response.text();" in actions
    assert "succeeded.push(item);" in actions
    assert "failed.push(item);" in actions
    assert "markMediaMutated(item.key, 'best_effort');" in actions
    assert "bumpMediaCacheBustToken(item.key);" in actions
    assert "refreshMediaResolutionCache();" in actions
    assert "mediaGridRefreshAfterMutation();" in actions
    assert "mediaGridState.defacing" in actions
    assert "defacing: false," in state

    assert "if (isEditableElement(document.activeElement)) return;" in actions
    assert "(e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey" in actions
    assert "if (!e.repeat) mediaGridDefaceSelected();" in actions


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
    assert "grid-template-columns: auto auto minmax(0, 1fr) auto;" in css
    assert ".preview-header-meta-resolution" in css
    assert "overflow: hidden;" in css
