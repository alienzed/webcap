// Modularized: uses CaptionState and CaptionOps
(function() {
  var FOLDER_STATE_FILE = '.webcap_state.json';
  var FOLDER_STATE_VERSION = 1;
  var IMAGE_EXTENSIONS = { '.jpg': true, '.jpeg': true, '.png': true, '.gif': true, '.webp': true, '.bmp': true };
  var MEDIA_EXTENSIONS = {
    '.mp4': true, '.webm': true, '.ogg': true, '.mov': true, '.mkv': true, '.avi': true, '.m4v': true,
    '.jpg': true, '.jpeg': true, '.png': true, '.gif': true, '.webp': true, '.bmp': true
  };

  function startCaptionMode(context) {
    var ui = context.ui;
    var scheduleSave = DebounceModule.create(500);
    var state = window.CaptionState;
    console.log('[webcap] startCaptionMode: initializing');
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/fs/root');
    xhr.onreadystatechange = async function() {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          try {
            var resp = JSON.parse(xhr.responseText);
            var rootPath = resp.root || '';
            console.log('[webcap] startCaptionMode: /fs/root response', resp);
            state.folder = '';
            state.dirStack = [{ name: rootPath }];
            console.log('[webcap] startCaptionMode: set state.folder and state.dirStack', state.folder, state.dirStack);
            try {
              refreshCurrentDirectory(ui, state);
              setStatus(ui, 'Caption mode ready. Root directory loaded: ' + rootPath);
            } catch (e) {
              setStatus(ui, 'Error loading root directory: ' + (e && e.message ? e.message : e));
              console.error('[webcap] Error loading root directory:', e);
            }
          } catch (e) {
            setStatus(ui, 'Backend FS_ROOT: [error reading response]');
            console.error('[webcap] Error parsing /fs/root response:', e);
          }
        } else {
          setStatus(ui, 'Backend FS_ROOT: [error fetching]');
          console.error('[webcap] Error fetching /fs/root:', xhr.status, xhr.responseText);
        }
      }
    };
    xhr.send();
    CaptionReviewModule.init(ui, state, {
      setStatus: setStatus,
      saveCurrentCaption: saveCurrentCaption,
      setReviewMode: setReviewMode,
      renderFileList: renderFileList,
      selectMedia: selectPathMedia, // Use the correct backend-driven media selector
      activateFocusSet: CaptionListModule.activateFocusSet,
      clearFocusSet: CaptionListModule.clearFocusSet
    });
    setupFolderStatePersistence(ui, state);
    setupFolderStateReset(ui, state);

    ui.refreshBtn.addEventListener('click', function() {
      console.log('[webcap] refreshBtn clicked');
      refreshCurrentDirectory(ui, state);
    });

    var filterToken = { current: 0 };
    var debouncedFilter = DebounceModule.create(150);
    ui.filterEl.addEventListener('input', function() {
      var token = ++filterToken.current;
      console.log('[webcap] filter input, token', token, 'value', ui.filterEl.value);
      debouncedFilter(function() {
        renderFileList(ui, state, ui.filterEl.value, token, filterToken);
      });
    });
    ui.pageListEl.addEventListener('keydown', function(e) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') {
        return;
      }
      navigateListByArrow(ui, state, e.key === 'ArrowDown' ? 1 : -1, e);
    });

    ui.editorEl.addEventListener('input', function() {
      if (state.suppressInput || !state.currentItem || state.reviewMode) {
        return;
      }
      var currentRow = ui.pageListEl.querySelector('.page-item[data-key="' + state.currentItem.key + '"]');
      if (currentRow) {
        if ((ui.editorEl.value || '').trim()) {
          currentRow.classList.remove('empty-caption');
        } else {
          currentRow.classList.add('empty-caption');
        }
      }
      state.captionCache[CaptionOps.captionCacheKey(state, state.currentItem)] = ui.editorEl.value || '';
      var scheduledForKey = state.currentItem.key;
      scheduleSave(function() {
        if (!state.currentItem || state.currentItem.key !== scheduledForKey || state.reviewMode) {
          return;
        }
        saveCurrentCaption(ui, state).catch(function(err) {
          setStatus(ui, String(err && err.message ? err.message : err));
        });
      });
    });

    state.folder = '';
    console.log('[webcap] startCaptionMode: calling refreshCurrentDirectory');
    refreshCurrentDirectory(ui, state);
    setStatus(ui, 'Caption mode ready. Root directory loaded.');
  }


  async function pruneMediaItem(ui, state, mediaItem) {
    if (!mediaItem) {
      setStatus(ui, 'No media item to prune');
      return;
    }
    var fileName = mediaItem.fileName;
    var confirmed = window.confirm('Move this media file and its caption to .caption_trash?\n\n' + fileName);
    if (!confirmed) {
      return;
    }
    if (state.currentItem && state.currentItem.key === mediaItem.key) {
      await saveCurrentCaption(ui, state);
    }
    await CaptionListModule.pruneMedia(ui, state, mediaItem, {
      pruneMedia: async function(ui, state, mediaItem) {
        // Move media and caption to .caption_trash via backend
        return new Promise(function(resolve, reject) {
          var folder = state.folder || '';
          var media = mediaItem.fileName;
          var xhr = new XMLHttpRequest();
          xhr.open('POST', '/caption/prune');
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
              if (xhr.status === 200) {
                resolve();
              } else {
                reject(new Error('Prune failed: ' + xhr.responseText));
              }
            }
          };
          xhr.send(JSON.stringify({ folder: folder, media: media }));
        });
      }
    });
    delete state.captionCache[CaptionOps.captionCacheKey(state, mediaItem)];
    state.reviewedSet.delete(mediaItem.key);
    if (state.focusSet && state.focusSet.keys && state.focusSet.keys.length) {
      state.focusSet.keys = state.focusSet.keys.filter(function(key) {
        return key !== mediaItem.key;
      });
      if (!state.focusSet.keys.length) {
        state.focusSet = null;
      }
    }
    if (state.scheduleFolderStateSave) {
      state.scheduleFolderStateSave();
    }
    if (state.currentItem && state.currentItem.key === mediaItem.key) {
      state.currentItem = null;
    }
    refreshCurrentDirectory(ui, state);
    setStatus(ui, 'Pruned to .caption_trash: ' + fileName);
  }

  async function restoreMediaItem(ui, state, mediaItem) {
    if (!mediaItem) {
      setStatus(ui, 'No media item to restore');
      return;
    }
    if (state.dirStack.length < 2 || state.dirStack[state.dirStack.length - 1].name !== '.caption_trash') {
      setStatus(ui, 'Restore is available inside .caption_trash only');
      return;
    }
    if (state.currentItem && state.currentItem.key === mediaItem.key) {
      await saveCurrentCaption(ui, state);
    }
    await CaptionListModule.restoreMedia(ui, state, mediaItem, {
      restoreMedia: async function(ui, state, mediaItem) {
        // Restore media and caption from .caption_trash via backend
        return new Promise(function(resolve, reject) {
          var folder = state.folder || '';
          var media = mediaItem.fileName;
          var xhr = new XMLHttpRequest();
          xhr.open('POST', '/caption/restore');
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
              if (xhr.status === 200) {
                try {
                  var resp = JSON.parse(xhr.responseText);
                  resolve(resp);
                } catch (e) {
                  resolve({ mediaName: media });
                }
              } else {
                reject(new Error('Restore failed: ' + xhr.responseText));
              }
            }
          };
          xhr.send(JSON.stringify({ folder: folder, media: media }));
        });
      }
    });
    delete state.captionCache[CaptionOps.captionCacheKey(state, mediaItem)];
    state.reviewedSet.delete(mediaItem.key);
    if (state.focusSet && state.focusSet.keys && state.focusSet.keys.length) {
      state.focusSet.keys = state.focusSet.keys.filter(function(key) {
        return key !== mediaItem.key;
      });
      if (!state.focusSet.keys.length) {
        state.focusSet = null;
      }
    }
    if (state.scheduleFolderStateSave) {
      state.scheduleFolderStateSave();
    }
    if (state.currentItem && state.currentItem.key === mediaItem.key) {
      state.currentItem = null;
    }
    refreshCurrentDirectory(ui, state);
    setStatus(ui, 'Restored from .caption_trash: ' + mediaItem.fileName);
  }

  // Directory listing now uses backend /fs/list
  function refreshCurrentDirectory(ui, state) {
    var path = state.folder || '';
    console.log('[webcap] refreshCurrentDirectory: called with path', path);
    if (ui.folderLabelEl) {
      var last = state.dirStack && state.dirStack.length ? state.dirStack[state.dirStack.length - 1].name : '';
      ui.folderLabelEl.value = last ? last.split(/[\\/]/).filter(Boolean).pop() : '[root]';
    }
    console.log('[webcap] refreshCurrentDirectory: requesting /fs/list', path);

    var url = '/fs/list' + (path ? ('?path=' + encodeURIComponent(path)) : '');
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          try {
            var resp = JSON.parse(xhr.responseText);
            // Expect resp.folders and resp.files arrays
            state.childFolders = (resp.folders || []).map(function(name) {
              return { name: name };
            });
            // Only include media files in state.items
            state.items = (resp.files || []).filter(function(name) {
              var ext = name.slice(name.lastIndexOf('.')).toLowerCase();
              return MEDIA_EXTENSIONS[ext];
            }).map(function(name) {
              return {
                fileName: name,
                label: name,
                key: name
              };
            });
            renderFileList(ui, state, ui.filterEl.value);
            setStatus(ui, 'Loaded folder: ' + (path || '[root]'));
          } catch (e) {
            setStatus(ui, 'Error parsing folder list: ' + (e && e.message ? e.message : e));
            state.childFolders = [];
            state.items = [];
            renderFileList(ui, state, ui.filterEl.value);
          }
        } else {
          setStatus(ui, 'Error loading folder: ' + xhr.status);
          state.childFolders = [];
          state.items = [];
          renderFileList(ui, state, ui.filterEl.value);
        }
      }
    };
    xhr.send();
  }



  function setupFolderStatePersistence(ui, state) {
    var saveLater = DebounceModule.create(300);
    state.scheduleFolderStateSave = function() {
      saveLater(function() {
        saveFolderStateForCurrentRoot(ui, state).catch(function(err) {
          setStatus(ui, String(err && err.message ? err.message : err));
        });
      });
    };
    var ids = [
      'stats-required-phrase',
      'stats-phrases',
      'stats-token-rules',
      'primer-template',
      'primer-defaults',
      'primer-mappings'
    ];

    ids.forEach(function(id) {
      var el = document.getElementById(id);
      if (!el || el.__folderStateBound) {
        return;
      }
      el.__folderStateBound = true;
      el.addEventListener('input', function() {
        state.scheduleFolderStateSave();
      });
    });
  }

  function setupFolderStateReset(ui, state) {
    var btn = document.getElementById('folder-settings-reset-btn');
    if (!btn || btn.__folderResetBound) {
      return;
    }
    btn.__folderResetBound = true;
    btn.addEventListener('click', function() {
      resetFolderState(ui, state).catch(function(err) {
        setStatus(ui, String(err && err.message ? err.message : err));
      });
    });
  }

  function sanitizeFolderState(data) {
    var src = data || {};
    var stats = src.stats || {};
    var primer = src.primer || {};
    var reviewedKeys = Array.isArray(src.reviewedKeys) ? src.reviewedKeys : [];
    reviewedKeys = reviewedKeys.map(function(key) { return String(key || ''); }).filter(Boolean);
    return {
      version: FOLDER_STATE_VERSION,
      stats: {
        requiredPhrase: String(stats.requiredPhrase || ''),
        phrases: String(stats.phrases || ''),
        tokenRules: String(stats.tokenRules || '')
      },
      primer: {
        template: String(primer.template || ''),
        defaults: String(primer.defaults || ''),
        mappings: String(primer.mappings || '')
      },
      reviewedKeys: reviewedKeys
    };
  }

  function emptyFolderState() {
    return sanitizeFolderState({
      stats: {
        requiredPhrase: '',
        phrases: '',
        tokenRules: ''
      },
      primer: {
        template: '',
        defaults: '',
        mappings: ''
      },
      reviewedKeys: []
    });
  }

  function snapshotFolderStateFromDom() {
    var stats = StatsViewModule.getOptionsFromDom();
    var primer = StatsViewModule.getPrimerOptionsFromDom();
    return sanitizeFolderState({
      stats: stats,
      primer: primer,
      reviewedKeys: Array.from(window.CaptionState.reviewedSet || []).sort()
    });
  }

  function applyFolderStateToDom(folderState) {
    var clean = sanitizeFolderState(folderState);
    var requiredPhraseEl = document.getElementById('stats-required-phrase');
    var phrasesEl = document.getElementById('stats-phrases');
    var tokenRulesEl = document.getElementById('stats-token-rules');
    var templateEl = document.getElementById('primer-template');
    var defaultsEl = document.getElementById('primer-defaults');
    var mappingsEl = document.getElementById('primer-mappings');

    if (requiredPhraseEl) {
      requiredPhraseEl.value = clean.stats.requiredPhrase;
    }
    if (phrasesEl) {
      phrasesEl.value = clean.stats.phrases;
    }
    if (tokenRulesEl) {
      tokenRulesEl.value = clean.stats.tokenRules;
    }
    if (templateEl) {
      templateEl.value = clean.primer.template;
    }
    if (defaultsEl) {
      defaultsEl.value = clean.primer.defaults;
    }
    if (mappingsEl) {
      mappingsEl.value = clean.primer.mappings;
    }
  }

  async function readFolderStateFile(rootHandle) {
    try {
      var handle = await rootHandle.getFileHandle(FOLDER_STATE_FILE);
      var file = await handle.getFile();
      var text = await file.text();
      var data = JSON.parse(text || '{}');
      return sanitizeFolderState(data);
    } catch (err) {
      console.warn('Could not read folder state file:', err);
      if (!err || err.name !== 'NotFoundError') {
        throw err;
      }
      return null;
    }
  }

  async function writeFolderStateFile(rootHandle, folderState) {
    var handle = await rootHandle.getFileHandle(FOLDER_STATE_FILE, { create: true });
    var writer = await handle.createWritable();
    await writer.write(JSON.stringify(folderState, null, 2));
    await writer.close();
  }

  async function saveFolderStateForCurrentRoot(ui, state) {
    if (!state.dirStack || !state.dirStack.length) {
      return;
    }
    var rootHandle = state.dirStack[0];
    if (!rootHandle) {
      return;
    }
    var snapshot = snapshotFolderStateFromDom();
    await writeFolderStateFile(rootHandle, snapshot);
  }

  async function resetFolderState(ui, state) {
    if (!state.dirStack || !state.dirStack.length) {
      setStatus(ui, 'No folder loaded');
      return;
    }

    var confirmed = window.confirm('Reset saved folder settings?\n\nThis deletes .webcap_state.json in the current root folder.');
    if (!confirmed) {
      return;
    }

    var rootHandle = state.dirStack[0];
    try {
      await rootHandle.removeEntry(FOLDER_STATE_FILE);
    } catch (err) {
      console.warn('Could not remove folder state file:', err);
      if (!err || err.name !== 'NotFoundError') {
        throw err;
      }
    }

    applyFolderStateToDom(emptyFolderState());
    state.reviewedSet = new Set();
    renderFileList(ui, state, ui.filterEl.value);

    setStatus(ui, 'Folder settings reset (.webcap_state.json removed)');
  }


  function navigateUp(ui, state) {
    if (state.dirStack.length <= 1) {
      setStatus(ui, 'Already at selected root folder');
      return;
    }
    state.dirStack.pop();
    // Rebuild state.folder from dirStack (excluding root)
    state.folder = state.dirStack.slice(1).map(function(entry) { return entry.name; }).join('/');
    updateFolderLabel(ui, state);
    refreshCurrentDirectory(ui, state);
  }

  function updateFolderLabel(ui, state) {
    if (!state.dirStack.length) {
      ui.folderLabelEl.value = '[root]';
      return;
    }
    var current = state.dirStack[state.dirStack.length - 1];
    var name = current && current.name ? current.name : '[root]';
    if (!name || name === '' || name === '/' || name === '\\') {
      name = '[root]';
    }
    ui.folderLabelEl.value = name;
  }

  function setReviewMode(ui, state, enabled) {
    state.reviewMode = !!enabled;
    ui.editorEl.readOnly = state.reviewMode;
    if (state.reviewMode) {
      ui.editorEl.classList.add('readonly');
    } else {
      ui.editorEl.classList.remove('readonly');
    }
  }

  function renderFileList(ui, state, filterText, token, filterToken) {
    CaptionListModule.refreshFocusSetUi(ui, state);
    return CaptionListModule.renderFileList(ui, state, filterText, token, filterToken, {
      navigateUp: navigateUp,
      refreshCurrentDirectory: refreshCurrentDirectory,
      setStatus: setStatus,
      saveCurrentCaption: saveCurrentCaption,
      pruneMedia: pruneMediaItem,
      restoreMedia: restoreMediaItem,
      renameMedia: async function(ui, state, mediaItem, oldFile, newFile) {
        // Rename media and caption via backend
        return new Promise(function(resolve, reject) {
          var folder = state.folder || '';
          var xhr = new XMLHttpRequest();
          xhr.open('POST', '/fs/rename');
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
              if (xhr.status === 200) {
                resolve();
              } else {
                reject(new Error('Rename failed: ' + xhr.responseText));
              }
            }
          };
          xhr.send(JSON.stringify({ folder: folder, old_name: oldFile, new_name: newFile }));
        });
      },
      activateFocusSet: CaptionListModule.activateFocusSet,
      clearFocusSet: CaptionListModule.clearFocusSet,
      onReviewedSetChanged: function() {
        if (state.scheduleFolderStateSave) {
          state.scheduleFolderStateSave();
        }
      },
      selectMedia: selectPathMedia,
      renderFileList: renderFileList
    });
  }
  function navigateListByArrow(ui, state, step, event) {
    var rows = ui.pageListEl.querySelectorAll('.page-item[data-key]');
    if (!rows.length) {
      return;
    }

    event.preventDefault();

    var currentIdx = -1;
    if (state.currentItem) {
      for (var i = 0; i < rows.length; i += 1) {
        if (rows[i].getAttribute('data-key') === state.currentItem.key) {
          currentIdx = i;
          break;
        }
      }
    }

    var nextIdx = 0;
    if (currentIdx === -1) {
      nextIdx = step > 0 ? 0 : rows.length - 1;
    } else {
      nextIdx = currentIdx + step;
      if (nextIdx < 0 || nextIdx >= rows.length) {
        return;
      }
    }

    var key = rows[nextIdx].getAttribute('data-key');
    var mediaItem = null;
    for (var j = 0; j < state.items.length; j += 1) {
      if (state.items[j].key === key) {
        mediaItem = state.items[j];
        break;
      }
    }
    if (!mediaItem) {
      return;
    }

    if (state.reviewMode) {
      selectMedia(ui, state, mediaItem).catch(function(err) {
        setStatus(ui, String(err && err.message ? err.message : err));
      });
      return;
    }

    saveCurrentCaption(ui, state).then(function() {
      return selectMedia(ui, state, mediaItem);
    }).catch(function(err) {
      setStatus(ui, String(err && err.message ? err.message : err));
    });
  }

  function selectPathMedia(ui, state, mediaItem) {
    return new Promise(function(resolve, reject) {
      // Set currentItem before any UI update
      state.currentItem = mediaItem;
      renderPathPreview(ui, state.folder, mediaItem.fileName);
      HttpModule.get('/caption/load?folder=' + encodeURIComponent(state.folder) + '&media=' + encodeURIComponent(mediaItem.fileName), function(status, responseText) {
        if (status !== 200) {
          setStatus(ui, 'Error loading caption: ' + status);
          return;
        }
        var text = '';
        try {
          var data = JSON.parse(responseText);
          text = data.caption || '';
        } catch (e) {
          setStatus(ui, 'Error parsing caption: ' + e);
          return;
        }
        // If caption is missing, populate with primer/template
        if (!(text || '').trim()) {
          text = buildAutoPrimer(mediaItem.fileName);
        }
        ui.editorEl.value = text;
        var suffix = mediaItem.fileName.split('.').pop();
        setStatus(ui, 'Selected: ' + mediaItem.label + ' (' + suffix + ')');
        // Re-render list to show selection
        renderFileList(ui, state, ui.filterEl.value);
      });
    });
  }

  function buildAutoPrimer(fileName) {
    var primerOptions = StatsViewModule.getPrimerOptionsFromDom();
    if (!primerOptions || !primerOptions.template.trim()) {
      return '';
    }
    return CaptionTemplateModule.buildPrimerFromConfig(fileName, primerOptions);
  }
  window.buildAutoPrimer = buildAutoPrimer;

  function saveCurrentCaption(ui, state) {
    if (state.reviewMode || !state.currentItem) {
      return Promise.resolve();
    }
    if (state.currentItem.kind === 'config') {
      // Do not auto-save config files as captions
      return Promise.resolve();
    }
    return CaptionOps.savePathCaption(ui, state, state.currentItem, ui.editorEl.value || '');
  }

  function clearEditorAndPreview(ui, state) {
    ui.editorEl.value = '';
    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = '';
    }
    var doc = ui.previewEl.contentDocument || ui.previewEl.contentWindow.document;
    doc.open();
    doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:system-ui;padding:1rem;color:#666;">No media to preview.</body></html>');
    doc.close();
  }

  function renderPathPreview(ui, folder, mediaName) {
    var ext = getFileExtension(mediaName);
    var mediaUrl = '/caption/media?folder=' + encodeURIComponent(folder) + '&media=' + encodeURIComponent(mediaName);
    renderPreviewHtml(ui, !!IMAGE_EXTENSIONS[ext], mediaUrl);
  }

  // Expose startCaptionMode globally for main.js
  window.startCaptionMode = startCaptionMode;
})();

