// Per-target debounce timers
var autosaveTimers = {};
var editorLiveUiTimer = 0;

function cancelEditorAutosaveForCaption(folder, media) {
    var key = 'caption:' + (folder || '') + '/' + (media || '');
    if (!autosaveTimers[key]) return;
    clearTimeout(autosaveTimers[key]);
    delete autosaveTimers[key];
}

function cancelEditorAutosaveForConfig(folder, file) {
    var key = 'config:' + (folder || '') + '/' + (file || '');
    if (!autosaveTimers[key]) return;
    clearTimeout(autosaveTimers[key]);
    delete autosaveTimers[key];
}

function scheduleEditorLiveUiRefresh() {
    var mediaKey = state && state.currentItem && state.currentItem.key;
    if (editorLiveUiTimer) {
        clearTimeout(editorLiveUiTimer);
    }
    editorLiveUiTimer = setTimeout(function () {
        editorLiveUiTimer = 0;
        if (!mediaKey || !state || !state.currentItem || state.currentItem.key !== mediaKey) return;
        invalidateChecklistReviewedRequirementsForCurrentTagMismatch({ skipRender: true });
        renderChecklistPanel({ skipItemDetailRefresh: true });
    }, 150);
}

function refreshEditorDeferredUi(mediaKey, folder) {
    if (typeof folder === 'string' && String((state && state.folder) || '') !== folder) return;
    if (mediaKey && (!state || !state.currentItem || state.currentItem.key !== mediaKey)) return;
    renderItemTagsPanel();
    renderItemMetadataPanel();
    updateBalanceDistributionWheel();
    updatePrimerCaptionResetUi();
}

// Helper: get current autosave target key and payload
function getAutosaveTargetAndPayload() {
    // Caption mode
    if (state.currentItem) {
        // Use state.folder for folder path, matching manual save logic
        return {
            key: 'caption:' + (state.folder || '') + '/' + state.currentItem.fileName,
            endpoint: '/caption/save',
            payload: {
                folder: state.folder || '',
                media: state.currentItem.fileName,
                text: ui.editorEl.value
            }
        };
    }
    // Config mode
    if (state.currentConfigFile) {
        return {
            key: 'config:' + state.currentConfigFile.folder + '/' + state.currentConfigFile.file,
            endpoint: '/fs/save_config',
            payload: {
                folder: state.currentConfigFile.folder,
                file: state.currentConfigFile.file,
                text: ui.editorEl.value
            }
        };
    }
    // No valid target
    return null;
}

// Main autosave input handler
function handleEditorInputAutosave(e) {
    clearCaptionApplyConfirmation();
    // Keep caption-match feedback responsive without rebuilding every panel per keystroke.
    scheduleEditorLiveUiRefresh();

    var target = getAutosaveTargetAndPayload();
    if (!target) {
      debugLog('[autosave] No valid target, skipping.');
      return;
    }

    // Capture snapshot at event time
    var snapshot = {
        endpoint: target.endpoint,
        folder: (target.payload && target.payload.folder) || '',
        media: (target.payload && target.payload.media) || '',
        file: (target.payload && target.payload.file) || '',
        text: (target.payload && typeof target.payload.text === 'string' ? target.payload.text : ''),
        mediaKey: (state.currentItem && state.currentItem.key) || undefined,
        isPrimerPreview: !!(
          target.endpoint === '/caption/save' &&
          state.currentItem &&
          typeof state.currentItem.primerPreviewText === 'string' &&
          String(target.payload.text || '') === state.currentItem.primerPreviewText
        )
    };
    debugLog('[autosave] Input event captured.');

    // Debounce per target
    if (autosaveTimers[target.key]) {
      clearTimeout(autosaveTimers[target.key]);
        debugLog('[autosave] Cleared existing debounce.');
    }
    autosaveTimers[target.key] = setTimeout(function() {
        debugLog('[autosave] Debounce fired.');
        refreshEditorDeferredUi(snapshot.mediaKey, snapshot.folder);
        
        // Caption autosave
        if (snapshot.endpoint === '/caption/save') {
            if (snapshot.isPrimerPreview) {
                debugLog('[autosave] Skipped save: captured text is a WebCap primer preview.');
                delete autosaveTimers[target.key];
                return;
            }
            // Prevent saving if editor contains only the primer caption
            var primer = '';
            if (snapshot.media) {
                primer = buildAutoPrimer(snapshot.media, snapshot.mediaKey);
            }
            if (primer && snapshot.text.trim() === primer.trim()) {
                debugLog('[autosave] Skipped save: primer-only content.');
            } else {
                debugLog('[autosave] Saving caption.');
                saveCaptionDirect(snapshot.folder, snapshot.media, snapshot.text, snapshot.mediaKey)
                  .then(function() {
                    if (
                      String((state && state.folder) || '') === snapshot.folder &&
                      state.currentItem &&
                      state.currentItem.key === snapshot.mediaKey &&
                      String(ui.editorEl.value || '') === snapshot.text
                    ) {
                      setCaptionApplyConfirmation(snapshot.mediaKey, snapshot.text, 'autosaved');
                    }
                    debugLog('[autosave] Save succeeded');
                  })
                  .catch(function(err) {
                    debugLog('[autosave] Save failed:', err);
                  });
            }
        }
        // Config autosave
        else if (snapshot.endpoint === '/fs/save_config') {
            debugLog('[autosave] Saving config.');
            saveConfigDirect(snapshot.folder, snapshot.file, snapshot.text)
              .then(function() {
                    debugLog('[autosave] Save succeeded');
                  })
                  .catch(function(err) {
                debugLog('[autosave] Save failed:', err);
              });
        }
        
        // Optionally: cleanup
        delete autosaveTimers[target.key];
    }, 2000); // 1000ms debounce; adjust as needed
}
