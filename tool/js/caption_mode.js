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
      if (state.suppressInput || !state.currentItem) {
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
        if (!state.currentItem || state.currentItem.key !== scheduledForKey) {
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
    var confirmed = window.confirm('Prune this media file and its caption?\n\n' + fileName + '\n\nThis will move the media to the originals folder (if not already present) and remove it from this set. The latest caption will be saved in originals.');
    if (!confirmed) {
      return;
    }
    if (state.currentItem && state.currentItem.key === mediaItem.key) {
      await saveCurrentCaption(ui, state);
    }
    await CaptionListModule.pruneMedia(ui, state, mediaItem, {
      pruneMedia: async function(ui, state, mediaItem) {
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
    setStatus(ui, 'Pruned to originals: ' + fileName);
  }

  async function restoreMediaItem(ui, state, mediaItem) {
    if (!mediaItem) {
      setStatus(ui, 'No media item to restore');
      return;
    }
    var fileName = mediaItem.fileName;
    var confirmed = window.confirm('Restore this media file and its caption from originals?\n\n' + fileName + '\n\nThis will overwrite any current version in this set.');
    if (!confirmed) {
      return;
    }
    if (state.currentItem && state.currentItem.key === mediaItem.key) {
      await saveCurrentCaption(ui, state);
    }
    await CaptionListModule.restoreMedia(ui, state, mediaItem, {
      restoreMedia: async function(ui, state, mediaItem) {
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
    setStatus(ui, 'Restored from originals: ' + fileName);
  }

  async function resetMediaItem(ui, state, mediaItem) {
    if (!mediaItem) {
      setStatus(ui, 'No media item to reset');
      return;
    }
    var fileName = mediaItem.fileName;
    var confirmed = window.confirm('Reset this media file and its caption to the original version?\n\n' + fileName);
    if (!confirmed) {
      return;
    }
    if (state.currentItem && state.currentItem.key === mediaItem.key) {
      await saveCurrentCaption(ui, state);
    }
    var folder = state.folder || '';
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/caption/reset');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          setStatus(ui, 'Reset to original: ' + fileName);
          refreshCurrentDirectory(ui, state);
        } else {
          setStatus(ui, 'Reset failed: ' + xhr.responseText);
        }
      }
    };
    xhr.send(JSON.stringify({ folder: folder, fileName: fileName }));
  }

  // Directory listing now uses backend /fs/list
  function refreshCurrentDirectory(ui, state) {
    var path = state.folder || '';
    console.log('[webcap] refreshCurrentDirectory: called with path', path);
    var last = state.dirStack && state.dirStack.length ? state.dirStack[state.dirStack.length - 1].name : '';
    ui.folderLabelEl.value = last ? last.split(/[\\/]/).filter(Boolean).pop() : '[root]';
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
            // --- PATCH: Load and apply folder state fields ---
            readFolderStateFile(path).then(function(folderState) {
              if (folderState) applyFolderStateToDom(folderState);
              renderFileList(ui, state, ui.filterEl.value);
              setStatus(ui, 'Loaded folder: ' + (path || '[root]'));
            });
            // --- END PATCH ---
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
    // Restore reviewedSet from reviewedKeys for persistence
    if (window.CaptionState && Array.isArray(clean.reviewedKeys)) {
      window.CaptionState.reviewedSet = new Set(clean.reviewedKeys);
    }
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


  async function readFolderStateFile(folderPath) {
    // folderPath: relative path from FS root ('' for root)
    try {
      const resp = await fetch('/fs/folder_state/load?folder=' + encodeURIComponent(folderPath), { method: 'GET' });
      if (!resp.ok) throw new Error('Failed to load folder state');
      const data = await resp.json();
      return sanitizeFolderState(data || {});
    } catch (err) {
      console.warn('Could not read folder state file:', err);
      return null;
    }
  }


  async function writeFolderStateFile(folderPath, folderState) {
    // folderPath: relative path from FS root ('' for root)
    try {
      const resp = await fetch('/fs/folder_state/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: folderPath, state: folderState })
      });
      if (!resp.ok) throw new Error('Failed to save folder state');
      return true;
    } catch (err) {
      console.warn('Could not write folder state file:', err);
      return false;
    }
  }

  async function saveFolderStateForCurrentRoot(ui, state) {
    if (!state.folder) {
      return;
    }
    var folderPath = state.folder;
    var snapshot = snapshotFolderStateFromDom();
    await writeFolderStateFile(folderPath, snapshot);
  }

  async function resetFolderState(ui, state) {
    if (!state.folder) {
      setStatus(ui, 'No folder loaded');
      return;
    }
    var confirmed = window.confirm('Reset saved folder settings?\n\nThis deletes .webcap_state.json in the current folder.');
    if (!confirmed) {
      return;
    }
    var folderPath = state.folder;
    // Save empty state to backend (overwrites file)
    await writeFolderStateFile(folderPath, emptyFolderState());
    applyFolderStateToDom(emptyFolderState());
    state.reviewedSet = new Set();
    renderFileList(ui, state, ui.filterEl.value);
    setStatus(ui, 'Folder settings reset (.webcap_state.json overwritten)');
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

  function renderFileList(ui, state, filterText, token, filterToken) {
    CaptionListModule.refreshFocusSetUi(ui, state);
    return CaptionListModule.renderFileList(ui, state, filterText, token, filterToken, {
      navigateUp: navigateUp,
      refreshCurrentDirectory: refreshCurrentDirectory,
      setStatus: setStatus,
      saveCurrentCaption: saveCurrentCaption,
      pruneMedia: pruneMediaItem,
      restoreMedia: restoreMediaItem,
      resetMedia: resetMediaItem,
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
      // Always ensure editor is editable
      ui.editorEl.removeAttribute('readonly');
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
    if (!state.currentItem) {
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

  // Expose refreshCurrentDirectory and startCaptionMode globally
  window.refreshCurrentDirectory = refreshCurrentDirectory;
  window.startCaptionMode = startCaptionMode;

  window.clearEditorAndPreview = clearEditorAndPreview;
})();

