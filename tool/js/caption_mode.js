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


    var reviewBtn = document.getElementById('review-captions-btn');
    if (reviewBtn) {
      reviewBtn.addEventListener('click', function() {
        if (!state.items.length) {
          setStatus(ui, 'No media files loaded');
          return;
        }
        state.currentItem = null;
        renderFileList(ui, state, ui.filterEl.value);
        clearEditorAndPreview(ui, state);
        setReviewMode(ui, state, true);
        setStatus(ui, 'Reviewing all captions (read-only)');
        var currentSeq = ++state.listRenderSeq;
        var promises = state.items.map(function(item) {
          return CaptionOps.loadCaptionTextForItem(state, item).then(function(text) {
            return { name: item.fileName, text: text };
          });
        });
        Promise.all(promises).then(function(results) {
          if (currentSeq !== state.listRenderSeq || !state.reviewMode) {
            return;
          }
          var combined = results.map(function(r) {
            return r.name + ':\n' + (r.text || '');
          }).join('\n\n');
          state.suppressInput = true;
          ui.editorEl.value = combined;
          state.suppressInput = false;
        }).catch(function(err) {
          setStatus(ui, String(err && err.message ? err.message : err));
        });
      });
    }

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
    ui.dropZone.style.display = 'none';
    ui.editorEl.spellcheck = true;
    ui.editorEl.value = '';
    ui.editorEl.placeholder = 'Caption text (.txt)';
    ui.pageListEl.innerHTML = '';

    var doc = ui.previewEl.contentDocument || ui.previewEl.contentWindow.document;
    doc.open();
    doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:system-ui;padding:1rem;color:#666;">Select a media file to preview.</body></html>');
    doc.close();
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

  function openFolderPath(ui, state, folder) {
    HttpModule.get('/caption/list?folder=' + encodeURIComponent(folder), function(status, responseText) {
      if (status !== 200) {
        setStatus(ui, CaptionUtils.getErrorMessage(responseText, 'Could not open folder'));
        return;
      }

      var data = JSON.parse(responseText);
      state.mode = 'path';
      state.folder = folder;
      state.currentItem = null;
      state.childFolders = [];
      state.items = (data.files || []).map(function(name) {
        return { key: name, label: name, fileName: name, kind: 'path' };
      });

      renderFileList(ui, state, ui.filterEl.value);
      if (!state.items.length) {
        clearEditorAndPreview(ui, state);
        setStatus(ui, 'No supported media files in folder');
        return;
      }
      selectMedia(ui, state, state.items[0]).catch(function(err) {
        setStatus(ui, String(err && err.message ? err.message : err));
      });
    });
  }

  async function refreshPickerDirectory(ui, state) {
    var currentDir = state.dirStack[state.dirStack.length - 1];
    var childFolders = [];
    var items = [];

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

  function refreshCurrentDirectory(ui, state) {
    if (state.mode === 'picker') {
      if (!state.dirStack.length) {
        setStatus(ui, 'No folder loaded');
        return;
      }
      refreshPickerDirectory(ui, state).catch(function(err) {
        setStatus(ui, String(err && err.message ? err.message : err));
      });
      return;
    }

    var folder = CaptionUtils.normalizeFolderInput(state.folder || '');
    if (!folder) {
      setStatus(ui, 'No folder loaded');
      return;
    }
    openFolderPath(ui, state, folder);
  }

  function navigateUp(ui, state) {
    if (state.mode === 'picker') {
      if (state.dirStack.length <= 1) {
        setStatus(ui, 'Already at selected root folder');
        return;
      }
      state.dirStack.pop();
      updateFolderLabel(ui, state);
      refreshPickerDirectory(ui, state).catch(function(err) {
        setStatus(ui, String(err && err.message ? err.message : err));
      });
      return;
    }

    var current = CaptionUtils.normalizeFolderInput(state.folder || '');
    if (!current) {
      setStatus(ui, 'No folder loaded');
      return;
    }
    var parent = CaptionUtils.parentPath(current);
    if (!parent || parent === current) {
      setStatus(ui, 'Already at top-level path');
      return;
    }
    openFolderPath(ui, state, parent);
  }

  function updateFolderLabel(ui, state) {
    if (state.mode !== 'picker') {
      ui.newPageNameEl.value = state.folder || 'No folder selected';
      return;
    }

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

  // loadCaptionTextForItem now in CaptionOps

  async function renderFileList(ui, state, filterText, token, filterToken) {
    return CaptionListModule.renderFileList(ui, state, filterText, token, filterToken, {
      navigateUp: navigateUp,
      refreshPickerDirectory: refreshPickerDirectory,
      setStatus: setStatus,
      saveCurrentCaption: saveCurrentCaption,
      selectMedia: selectMedia,
      renderFileList: renderFileList
    });
  }
  

  async function selectMedia(ui, state, mediaItem) {
    setReviewMode(ui, state, false);
    state.currentItem = mediaItem;
    renderFileList(ui, state, ui.filterEl.value);

    // Always update textarea with the selected file's caption
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
        state.suppressInput = true;
        ui.editorEl.value = data.caption || '';
        state.suppressInput = false;
        var suffix = data.exists ? 'existing caption loaded' : 'new caption file will be created on save';
        setStatus(ui, 'Selected: ' + mediaItem.label + ' (' + suffix + ')');
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
    state.suppressInput = true;
    ui.editorEl.value = caption.text;
    state.suppressInput = false;
    var suffix = caption.exists ? 'existing caption loaded' : 'new caption file will be created on save';
    setStatus(ui, 'Selected: ' + mediaItem.label + ' (' + suffix + ')');
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
