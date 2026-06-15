// Per-target debounce timers
var autosaveTimers = {};

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
    invalidateChecklistReviewedRequirementsForCurrentTagMismatch({ skipRender: true });
    // Always refresh live highlight UI while typing.
    renderChecklistPanel();
    renderItemTagsPanel();
    renderItemMetadataPanel();
    updateBalanceDistributionWheel();
    updatePrimerCaptionResetUi();

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
        mediaKey: (state.currentItem && state.currentItem.key) || undefined
    };
    debugLog('[autosave] input event snapshot:', JSON.stringify(snapshot));

    // Debounce per target
    if (autosaveTimers[target.key]) {
        clearTimeout(autosaveTimers[target.key]);
        debugLog('[autosave] Cleared existing debounce for', target.key);
    }
    autosaveTimers[target.key] = setTimeout(function() {
        debugLog('[autosave] Debounce fired for', target.key, 'with snapshot:', JSON.stringify(snapshot));
        
        // Caption autosave
        if (snapshot.endpoint === '/caption/save') {
            // Prevent saving if editor contains only the primer caption
            var primer = '';
            if (snapshot.media) {
                primer = buildAutoPrimer(snapshot.media, snapshot.mediaKey);
            }
            if (primer && snapshot.text.trim() === primer.trim()) {
                debugLog('[autosave] Skipped save: editor contains only primer caption');
            } else {
                debugLog('[autosave] Saving caption:', JSON.stringify({folder: snapshot.folder, media: snapshot.media, text: snapshot.text, mediaKey: snapshot.mediaKey}));
                saveCaptionDirect(snapshot.folder, snapshot.media, snapshot.text, snapshot.mediaKey)
                  .then(function() {
                    debugLog('[autosave] Save succeeded');
                  })
                  .catch(function(err) {
                    debugLog('[autosave] Save failed:', err);
                  });
            }
        }
        // Config autosave
        else if (snapshot.endpoint === '/fs/save_config') {
            debugLog('[autosave] Saving config:', JSON.stringify({folder: snapshot.folder, file: snapshot.file, text: snapshot.text}));
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
    }, 1000); // 1000ms debounce; adjust as needed
}
