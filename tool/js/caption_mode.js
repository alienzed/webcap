// Modularized: uses CaptionState and CaptionOps
(function() {
  var IMAGE_EXTENSIONS = { '.jpg': true, '.jpeg': true, '.png': true, '.gif': true, '.webp': true, '.bmp': true };
  var MEDIA_EXTENSIONS = {
    '.mp4': true, '.webm': true, '.ogg': true, '.mov': true, '.mkv': true, '.avi': true, '.m4v': true,
    '.jpg': true, '.jpeg': true, '.png': true, '.gif': true, '.webp': true, '.bmp': true
  };

  function startCaptionMode(context) {
    var ui = context.ui;
    var scheduleSave = DebounceModule.create(500);
    var state = window.CaptionState;
    configureUiForCaptionMode(ui);
    CaptionReviewModule.init(ui, state, {
      setStatus: setStatus,
      saveCurrentCaption: saveCurrentCaption,
      setReviewMode: setReviewMode,
      renderFileList: renderFileList,
      selectMedia: selectMedia
    });

    ui.openPageBtn.addEventListener('click', function() {
      chooseFolder(ui, state);
    });

    ui.captionUpBtn.addEventListener('click', function() {
      refreshCurrentDirectory(ui, state);
    });

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

  function configureUiForCaptionMode(ui) {
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
    if (reviewBtn) {
      reviewBtn.style.display = '';
      reviewBtn.textContent = 'Review Captions';
      placeReviewButton(ui, reviewBtn);
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

  function placeReviewButton(ui, reviewBtn) {
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
    if (reviewBtn.parentNode !== row) {
      row.appendChild(reviewBtn);
    }
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
      state.dirStack = [rootHandle];
      updateFolderLabel(ui, state);
      return refreshPickerDirectory(ui, state);
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
      if (!MEDIA_EXTENSIONS[ext]) {
        continue;
      }
      items.push({
        key: entry.name,
        label: entry.name,
        fileName: entry.name,
        kind: 'picker',
        fileHandle: entry,
        dirHandle: currentDir
      });
    }

    childFolders.sort(function(a, b) { return a.name.localeCompare(b.name); });
    items.sort(function(a, b) { return a.label.localeCompare(b.label); });
    state.childFolders = childFolders;
    state.items = items;
    state.currentItem = null;

    renderFileList(ui, state, ui.filterEl.value);
    if (!items.length) {
      clearEditorAndPreview(ui, state);
      setStatus(ui, 'No supported media files in current folder');
      return;
    }
    await selectMedia(ui, state, items[0]);
  }

  function persistCurrentDirectory(state) {
    if (!window.DirHandleStoreModule || !state.dirStack.length) {
      return;
    }
    var currentDir = state.dirStack[state.dirStack.length - 1];
    var names = state.dirStack.map(function(handle) { return handle.name; });
    DirHandleStoreModule.saveLastDir(currentDir, names);
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
    return CaptionListModule.renderFileList(ui, state, filterText, token, filterToken, {
      navigateUp: navigateUp,
      refreshCurrentDirectory: refreshCurrentDirectory,
      refreshPickerDirectory: refreshPickerDirectory,
      setStatus: setStatus,
      saveCurrentCaption: saveCurrentCaption,
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
