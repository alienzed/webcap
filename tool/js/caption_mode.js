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
    configureUiForCaptionMode(ui, state);
    CaptionReviewModule.init(ui, state, {
      setStatus: setStatus,
      saveCurrentCaption: saveCurrentCaption,
      setReviewMode: setReviewMode,
      renderFileList: renderFileList,
      selectMedia: selectMedia,
      activateFocusSet: activateFocusSet,
      clearFocusSet: clearFocusSet
    });
    setupFolderStatePersistence(ui, state);
    setupFolderStateReset(ui, state);

    ui.openPageBtn.addEventListener('click', function() {
      chooseFolder(ui, state);
    });

    ui.captionUpBtn.addEventListener('click', function() {
      refreshCurrentDirectory(ui, state);
    });

    if (ui.autosetBtn) {
      ui.autosetBtn.addEventListener('click', function() {
        runAutoset(ui).catch(function(err) {
          setStatus(ui, String(err && err.message ? err.message : err));
        });
      });
    }

    // Debounced async filter to avoid race conditions
    var filterToken = { current: 0 };
    var debouncedFilter = DebounceModule.create(150);
    ui.filterEl.addEventListener('input', function() {
      var token = ++filterToken.current;
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

    setStatus(ui, 'Caption mode ready. Choose Folder, then double-click folders to enter.');
  }

  function configureUiForCaptionMode(ui, state) {
    ui.newPageNameEl.value = 'No folder selected';
    ui.newPageNameEl.placeholder = '';
    ui.newPageNameEl.readOnly = true;
    ui.newPageNameEl.classList.add('caption-folder-label');
    ui.topInputRow.classList.add('single');
    ui.createBtn.style.display = 'none';
    ui.openPageBtn.textContent = 'Choose Folder';
    ui.captionUpBtn.style.display = '';
    ui.captionUpBtn.textContent = '↻';
    ui.captionUpBtn.title = 'Refresh directory';
    var actionRow = document.getElementById('caption-list-actions');
    if (actionRow) {
      actionRow.style.display = '';
    }
    var reviewBtn = document.getElementById('review-captions-btn');
    var autosetBtn = document.getElementById('run-autoset-btn');
    if (reviewBtn) {
      reviewBtn.style.display = '';
      reviewBtn.textContent = 'Review Captions';
      placeActionButtons(ui, state, reviewBtn, autosetBtn);
    }
    if (autosetBtn) {
      autosetBtn.style.display = '';
      autosetBtn.textContent = 'Run Autoset';
      placeActionButtons(ui, state, reviewBtn, autosetBtn);
    }
    ui.dropZone.style.display = 'none';
    ui.editorEl.spellcheck = true;
    ui.editorEl.value = '';
    ui.editorEl.placeholder = 'Caption text (.txt)';
    ui.pageListEl.innerHTML = '';
    ui.pageListEl.classList.add('with-stats-pane');
    ui.pageListEl.tabIndex = 0;

    var doc = ui.previewEl.contentDocument || ui.previewEl.contentWindow.document;
    doc.open();
    doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:system-ui;padding:1rem;color:#666;">Select a media file to preview.</body></html>');
    doc.close();
  }

  function placeActionButtons(ui, state, reviewBtn, autosetBtn) {
    var row = document.getElementById('caption-list-actions');
    if (!row) {
      row = document.createElement('div');
      row.id = 'caption-list-actions';
      row.className = 'caption-list-actions';
      if (ui.pageListEl.parentNode) {
        ui.pageListEl.parentNode.insertBefore(row, ui.pageListEl.nextSibling);
      }
    }
    row.style.display = '';
    if (reviewBtn && reviewBtn.parentNode !== row) {
      row.appendChild(reviewBtn);
    }
    if (autosetBtn && autosetBtn.parentNode !== row) {
      row.appendChild(autosetBtn);
    }

    var exitBtn = ensureFocusSetExitButton(ui, state, row);
    refreshFocusSetUi(ui, state, exitBtn);
  }

  function ensureFocusSetExitButton(ui, state, row) {
    var exitBtn = document.getElementById('focus-set-exit-btn');
    if (!exitBtn) {
      exitBtn = document.createElement('button');
      exitBtn.id = 'focus-set-exit-btn';
      exitBtn.type = 'button';
      exitBtn.textContent = 'Exit Set';
      exitBtn.style.display = 'none';
      row.appendChild(exitBtn);
    }
    if (!exitBtn.__focusSetBound) {
      exitBtn.__focusSetBound = true;
      exitBtn.onclick = function() {
        clearFocusSet(ui, state, true);
      };
    }
    return exitBtn;
  }

  function refreshFocusSetUi(ui, state, exitBtn) {
    var btn = exitBtn || document.getElementById('focus-set-exit-btn');
    if (!btn) {
      return;
    }
    if (state.focusSet && state.focusSet.keys && state.focusSet.keys.length) {
      btn.style.display = '';
      var source = state.focusSet.source ? (' - ' + state.focusSet.source) : '';
      btn.title = 'Show full folder list' + source;
      return;
    }
    btn.style.display = 'none';
    btn.title = 'Show full folder list';
  }

  function clearFocusSet(ui, state, rerender) {
    state.focusSet = null;
    if (rerender) {
      renderFileList(ui, state, ui.filterEl.value);
    }
  }

  function activateFocusSet(ui, state, fileNames, source) {
    var seen = {};
    var keys = [];
    var names = (fileNames || []).map(function(name) { return String(name || ''); }).filter(Boolean);
    names.forEach(function(fileName) {
      for (var i = 0; i < state.items.length; i += 1) {
        var item = state.items[i];
        if (item.fileName !== fileName) {
          continue;
        }
        if (!seen[item.key]) {
          seen[item.key] = true;
          keys.push(item.key);
        }
        break;
      }
    });

    if (!keys.length) {
      clearFocusSet(ui, state, true);
      return;
    }

    state.focusSet = {
      keys: keys,
      source: String(source || '')
    };
    renderFileList(ui, state, ui.filterEl.value);
  }

  function runAutoset(ui) {
    return new Promise(function(resolve) {
      if (!ui.autosetBtn) {
        resolve();
        return;
      }

      ui.autosetBtn.disabled = true;
      setStatus(ui, 'Running autoset...');
      CaptionUtils.renderTextPreview(ui, 'Autoset Output', 'Running scripts/autoset.py --master .\nPlease wait...');

      HttpModule.postJson('/caption/run_autoset', { master: '.' }, function(status, responseText) {
        ui.autosetBtn.disabled = false;

        var payload = null;
        try {
          payload = JSON.parse(responseText || '{}');
        } catch (err) {
          payload = { error: 'Could not parse autoset output', output: String(responseText || '') };
        }

        var command = payload.command || 'scripts/autoset.py --master .';
        var output = payload.output || payload.error || '';
        var title = status === 200 ? 'Autoset Completed' : 'Autoset Failed';
        CaptionUtils.renderTextPreview(ui, title, '$ ' + command + '\n\n' + output);

        if (status === 200) {
          setStatus(ui, 'Autoset complete');
        } else {
          setStatus(ui, payload.error || 'Autoset failed');
        }
        resolve();
      });
    });
  }

  async function pruneMediaItem(ui, state, mediaItem) {
    if (!mediaItem) {
      setStatus(ui, 'No media item to prune');
      return;
    }
    if (mediaItem.kind !== 'picker') {
      setStatus(ui, 'Prune is available for folder-picker items only');
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

    await CaptionListModule.prunePickerMedia(mediaItem);

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

    await refreshPickerDirectory(ui, state);
    setStatus(ui, 'Pruned to .caption_trash: ' + fileName);
  }

  async function restoreMediaItem(ui, state, mediaItem) {
    if (!mediaItem) {
      setStatus(ui, 'No media item to restore');
      return;
    }
    if (mediaItem.kind !== 'picker') {
      setStatus(ui, 'Restore is available for folder-picker items only');
      return;
    }
    if (state.dirStack.length < 2 || state.dirStack[state.dirStack.length - 1].name !== '.caption_trash') {
      setStatus(ui, 'Restore is available inside .caption_trash only');
      return;
    }

    if (state.currentItem && state.currentItem.key === mediaItem.key) {
      await saveCurrentCaption(ui, state);
    }

    var targetDir = state.dirStack[state.dirStack.length - 2];
    var restored = await CaptionListModule.restorePickerMedia(mediaItem, targetDir);

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

    await refreshPickerDirectory(ui, state);
    setStatus(ui, 'Restored from .caption_trash: ' + restored.mediaName);
  }

  function chooseFolder(ui, state) {
    if (typeof window.showDirectoryPicker !== 'function') {
      setStatus(ui, 'Choose Folder is available in Chromium browsers (Chrome/Edge).');
      return;
    }

    window.showDirectoryPicker().then(function(rootHandle) {
      state.mode = 'picker';
      state.folder = '';
      state.currentItem = null;
      state.focusSet = null;
      state.dirStack = [rootHandle];
      updateFolderLabel(ui, state);
      return loadFolderStateForRoot(ui, state, rootHandle).then(function() {
        return refreshPickerDirectory(ui, state);
      });
    }).catch(function(err) {
      if (err && err.name === 'AbortError') {
        setStatus(ui, 'Folder selection canceled');
        return;
      }
      setStatus(ui, String(err && err.message ? err.message : 'Could not choose folder'));
    });
  }

  async function refreshPickerDirectory(ui, state) {
    var currentDir = state.dirStack[state.dirStack.length - 1];
    var childFolders = [];
    var items = [];
    persistCurrentDirectory(state);

    for await (var entry of currentDir.values()) {
      if (entry.kind === 'directory') {
        childFolders.push({ name: entry.name, handle: entry });
        continue;
      }
      if (entry.kind !== 'file') {
        continue;
      }
      var ext = CaptionUtils.getFileExtension(entry.name);
      // Accept config files as well as media
      if (MEDIA_EXTENSIONS[ext] || entry.name === 'configlo.toml' || entry.name === 'confighi.toml' || entry.name === 'dataset.lo.toml' || entry.name === 'dataset.hi.toml') {
        items.push({
          key: entry.name,
          label: entry.name,
          fileName: entry.name,
          kind: (MEDIA_EXTENSIONS[ext] ? 'picker' : 'config'),
          fileHandle: entry,
          dirHandle: currentDir
        });
      }
    }

    childFolders.sort(function(a, b) { return a.name.localeCompare(b.name); });
    items.sort(function(a, b) { return a.label.localeCompare(b.label); });
    state.childFolders = childFolders;
    state.items = items;
    state.currentItem = null;

    // Auto-create config files if missing
    await maybeCreateConfigFiles(currentDir);

    if (state.focusSet && state.focusSet.keys && state.focusSet.keys.length) {
      var allow = {};
      items.forEach(function(item) { allow[item.key] = true; });
      state.focusSet.keys = state.focusSet.keys.filter(function(key) { return !!allow[key]; });
      if (!state.focusSet.keys.length) {
        state.focusSet = null;
      }
    }

    renderFileList(ui, state, ui.filterEl.value);
    if (!items.length) {
      clearEditorAndPreview(ui, state);
      setStatus(ui, 'No supported media files in current folder');
      return;
    }
    await selectMedia(ui, state, items[0]);
  }

  // Minimal config file creation logic
  async function maybeCreateConfigFiles(dirHandle) {
    const configFiles = [
      { name: 'configlo.toml', template: 'configlo.toml', dataset: 'dataset.lo.toml' },
      { name: 'confighi.toml', template: 'confighi.toml', dataset: 'dataset.hi.toml' },
      { name: 'dataset.lo.toml', template: 'dataset.lo.toml' },
      { name: 'dataset.hi.toml', template: 'dataset.hi.toml' }
    ];
    for (const cfg of configFiles) {
      let exists = false;
      try {
        await dirHandle.getFileHandle(cfg.name);
        exists = true;
      } catch (e) {}
      if (exists) continue;
      // Read template
      let text = '';
      try {
        text = await (await fetch(`/templates/default/${cfg.template}`)).text();
      } catch (e) { continue; }
      // For configlo/confighi, substitute dataset path
      if (cfg.dataset) {
        text = text.replace(/^(dataset\s*=\s*").*?(")/m, `dataset = "${cfg.dataset}"`);
        text = text.replace(/^(dataset\s*=\s*).*/m, `dataset = "${cfg.dataset}"`);
      }
      // Write file
      try {
        const handle = await dirHandle.getFileHandle(cfg.name, { create: true });
        const writer = await handle.createWritable();
        await writer.write(text);
        await writer.close();
      } catch (e) {}
    }
  }

  function persistCurrentDirectory(state) {
    if (!window.DirHandleStoreModule || !state.dirStack.length) {
      return;
    }
    var currentDir = state.dirStack[state.dirStack.length - 1];
    var names = state.dirStack.map(function(handle) { return handle.name; });
    DirHandleStoreModule.saveLastDir(currentDir, names);
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

  async function loadFolderStateForRoot(ui, state, rootHandle) {
    var folderState = await readFolderStateFile(rootHandle);
    if (!folderState) {
      state.reviewedSet = new Set();
      applyFolderStateToDom(emptyFolderState());
      return;
    }
    applyFolderStateToDom(folderState);
    state.reviewedSet = new Set(folderState.reviewedKeys || []);
    state.lastFolderStateKey = rootHandle.name;
    setStatus(ui, 'Loaded folder settings from ' + FOLDER_STATE_FILE);
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
      if (!err || err.name !== 'NotFoundError') {
        throw err;
      }
    }

    applyFolderStateToDom(emptyFolderState());
    state.reviewedSet = new Set();
    renderFileList(ui, state, ui.filterEl.value);

    setStatus(ui, 'Folder settings reset (.webcap_state.json removed)');
  }

  function refreshCurrentDirectory(ui, state) {
    if (!state.dirStack.length) {
      setStatus(ui, 'No folder loaded');
      return;
    }
    refreshPickerDirectory(ui, state).catch(function(err) {
      setStatus(ui, String(err && err.message ? err.message : err));
    });
  }

  function navigateUp(ui, state) {
    if (state.dirStack.length <= 1) {
      setStatus(ui, 'Already at selected root folder');
      return;
    }
    state.dirStack.pop();
    updateFolderLabel(ui, state);
    refreshPickerDirectory(ui, state).catch(function(err) {
      setStatus(ui, String(err && err.message ? err.message : err));
    });
  }

  function updateFolderLabel(ui, state) {
    if (!state.dirStack.length) {
      ui.newPageNameEl.value = 'No folder selected';
      return;
    }

    var names = state.dirStack.map(function(handle) { return handle.name; });
    ui.newPageNameEl.value = names.join(' / ');
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

  async function renderFileList(ui, state, filterText, token, filterToken) {
    refreshFocusSetUi(ui, state);
    return CaptionListModule.renderFileList(ui, state, filterText, token, filterToken, {
      navigateUp: navigateUp,
      refreshCurrentDirectory: refreshCurrentDirectory,
      refreshPickerDirectory: refreshPickerDirectory,
      setStatus: setStatus,
      saveCurrentCaption: saveCurrentCaption,
      pruneMedia: pruneMediaItem,
      restoreMedia: restoreMediaItem,
      activateFocusSet: activateFocusSet,
      clearFocusSet: clearFocusSet,
      onReviewedSetChanged: function() {
        if (state.scheduleFolderStateSave) {
          state.scheduleFolderStateSave();
        }
      },
      selectMedia: selectMedia,
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
  

  async function selectMedia(ui, state, mediaItem) {
    setReviewMode(ui, state, false);
    state.currentItem = mediaItem;
    renderFileList(ui, state, ui.filterEl.value);
    if (mediaItem.kind === 'config') {
      // Show config file in editor, right pane indicator
      const file = await mediaItem.fileHandle.getFile();
      const text = await file.text();
      state.suppressInput = true;
      ui.editorEl.value = text;
      state.suppressInput = false;
      setStatus(ui, 'Editing config file: ' + mediaItem.label);
      // Optionally, disable spellcheck for config files
      ui.editorEl.spellcheck = false;
      return;
    } else {
      ui.editorEl.spellcheck = true;
    }
    if (mediaItem.kind === 'picker') {
      await selectPickerMedia(ui, state, mediaItem);
      return;
    }
    await selectPathMedia(ui, state, mediaItem);
  }

  function selectPathMedia(ui, state, mediaItem) {
    return new Promise(function(resolve, reject) {
      renderPathPreview(ui, state.folder, mediaItem.fileName);
      HttpModule.get('/caption/load?folder=' + encodeURIComponent(state.folder) + '&media=' + encodeURIComponent(mediaItem.fileName), function(status, responseText) {
        if (status !== 200) {
          reject(new Error(CaptionUtils.getErrorMessage(responseText, 'Could not load caption')));
          return;
        }
        if (state.currentItem !== mediaItem) {
          resolve();
          return;
        }
        var data = JSON.parse(responseText);
        var seeded = false;
        var text = data.caption || '';
        if (!text.trim()) {
          var primer = buildAutoPrimer(mediaItem.fileName);
          if (primer) {
            text = primer;
            seeded = true;
          }
        }
        state.suppressInput = true;
        ui.editorEl.value = text;
        state.suppressInput = false;
        var suffix = seeded ? 'primer applied' : (data.exists ? 'existing caption loaded' : 'new caption file will be created on save');
        setStatus(ui, 'Selected: ' + mediaItem.label + ' (' + suffix + ')');
        if (seeded) {
          saveCurrentCaption(ui, state).catch(function(err) {
            setStatus(ui, String(err && err.message ? err.message : err));
          });
        }
        resolve();
      });
    });
  }

  async function selectPickerMedia(ui, state, mediaItem) {
    var file = await mediaItem.fileHandle.getFile();
    renderPickerPreview(ui, state, file, mediaItem.label);
    var caption = await CaptionOps.readPickerCaption(mediaItem);
    if (state.currentItem !== mediaItem) {
      return;
    }
    var seeded = false;
    var text = caption.text || '';
    if (!text.trim()) {
      var primer = buildAutoPrimer(mediaItem.fileName);
      if (primer) {
        text = primer;
        seeded = true;
      }
    }
    state.suppressInput = true;
    ui.editorEl.value = text;
    state.suppressInput = false;
    var suffix = seeded ? 'primer applied' : (caption.exists ? 'existing caption loaded' : 'new caption file will be created on save');
    setStatus(ui, 'Selected: ' + mediaItem.label + ' (' + suffix + ')');
    if (seeded) {
      saveCurrentCaption(ui, state).catch(function(err) {
        setStatus(ui, String(err && err.message ? err.message : err));
      });
    }
  }

  function buildAutoPrimer(fileName) {
    var primerOptions = StatsViewModule.getPrimerOptionsFromDom();
    if (!primerOptions || !primerOptions.template.trim()) {
      return '';
    }
    return CaptionTemplateModule.buildPrimerFromConfig(fileName, primerOptions);
  }

  function saveCurrentCaption(ui, state) {
    if (state.reviewMode || !state.currentItem) {
      return Promise.resolve();
    }
    if (state.currentItem.kind === 'config') {
      // Do not auto-save config files as captions
      return Promise.resolve();
    }
    if (state.currentItem.kind === 'picker') {
      return savePickerCaption(ui, state.currentItem, ui.editorEl.value || '');
    }
    return CaptionOps.savePathCaption(ui, state, state.currentItem, ui.editorEl.value || '');
  }

  // savePathCaption now in CaptionOps

  async function savePickerCaption(ui, mediaItem, text) {
    var captionName = mediaItem.fileName.replace(/\.[^.]+$/, '.txt');
    var captionHandle = await mediaItem.dirHandle.getFileHandle(captionName, { create: true });
    var writer = await captionHandle.createWritable();
    await writer.write(text);
    await writer.close();
    setStatus(ui, 'Saved: ' + captionName);
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
    var ext = CaptionUtils.getFileExtension(mediaName);
    var mediaUrl = '/caption/media?folder=' + encodeURIComponent(folder) + '&media=' + encodeURIComponent(mediaName);
    CaptionUtils.renderPreviewHtml(ui, !!IMAGE_EXTENSIONS[ext], mediaUrl);
  }

  function renderPickerPreview(ui, state, file, fallbackLabel) {
    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = '';
    }
    state.objectUrl = URL.createObjectURL(file);
    var ext = CaptionUtils.getFileExtension(file.name || fallbackLabel || '');
    CaptionUtils.renderPreviewHtml(ui, !!IMAGE_EXTENSIONS[ext], state.objectUrl);
  }

  function setStatus(ui, text) {
    ui.statusEl.textContent = text || '';
  }

  ModeRouterModule.registerMode('caption', startCaptionMode);
})();
