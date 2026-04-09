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

    // Remove Up button event, handled in file list now

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
      state.captionCache[captionCacheKey(state, state.currentItem)] = ui.editorEl.value || '';
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
    ui.captionUpBtn.style.display = 'none';
    ui.dropZone.style.display = 'none';
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

  function captionCacheKey(state, mediaItem) {
    if (mediaItem.kind === 'picker') {
      var dirNames = state.dirStack.map(function(handle) { return handle.name; }).join('/');
      return 'picker:' + dirNames + ':' + mediaItem.fileName;
    }
    return 'path:' + (state.folder || '') + ':' + mediaItem.fileName;
  }

  // loadCaptionTextForItem now in CaptionOps

  async function renderFileList(ui, state, filterText, token, filterToken) {
    var q = (filterText || '').toLowerCase();
    var renderSeq = ++state.listRenderSeq;
    ui.pageListEl.innerHTML = '';
    var countDiv = document.getElementById('caption-filter-count');
    if (!countDiv) {
      countDiv = document.createElement('div');
      countDiv.id = 'caption-filter-count';
      countDiv.style = 'font-size:13px;color:#888;margin-bottom:4px;';
      ui.pageListEl.parentNode.insertBefore(countDiv, ui.pageListEl);
    }
    var matchCount = 0;
    // Add 'Up One Directory' item if possible
    var canGoUp = false;
    if (state.mode === 'picker' && state.dirStack.length > 1) {
      canGoUp = true;
    } else if (state.mode === 'path') {
      var current = CaptionUtils.normalizeFolderInput(state.folder || '');
      var parent = CaptionUtils.parentPath(current);
      if (parent && parent !== current) {
        canGoUp = true;
      }
    }
    if (canGoUp) {
      var upRow = document.createElement('div');
      upRow.className = 'page-item folder-item';
      upRow.innerHTML = '<div>⬆ Up One Directory</div>';
      upRow.onclick = function() {
        navigateUp(ui, state);
      };
      ui.pageListEl.appendChild(upRow);
      matchCount++;
    }
    // ...existing code for childFolders...
    state.childFolders.forEach(function(folderItem) {
      var label = '📁 ' + folderItem.name;
      if (q && label.toLowerCase().indexOf(q) === -1) {
        return;
      }
      var row = document.createElement('div');
      row.className = 'page-item folder-item';
      row.innerHTML = '<div>' + CaptionUtils.escapeHtml(label) + '</div>';
      row.ondblclick = function() {
        state.dirStack.push(folderItem.handle);
        refreshPickerDirectory(ui, state).catch(function(err) {
          setStatus(ui, String(err && err.message ? err.message : err));
        });
      };
      row.onclick = function() {
        setStatus(ui, 'Double-click folder to enter: ' + folderItem.name);
      };
      ui.pageListEl.appendChild(row);
      matchCount++;
    });
    function attachMediaRow(mediaItem, captionText) {
      var row = document.createElement('div');
      var isActive = state.currentItem && state.currentItem.key === mediaItem.key;
      var emptyCaption = (captionText !== null && captionText !== undefined) && !(captionText || '').trim();
      var reviewed = state.reviewedSet.has(mediaItem.key);
      row.className = 'page-item' + (isActive ? ' active' : '') + (emptyCaption ? ' empty-caption' : '') + (reviewed ? ' reviewed' : '');
      row.setAttribute('data-key', mediaItem.key);
      var openBtn = '';
      if (state.mode === 'path') {
        openBtn = '<button class="open-folder-btn" title="Open containing folder" data-file="' + encodeURIComponent(mediaItem.fileName) + '">Open</button>';
      }
      row.innerHTML = '<div>' + CaptionUtils.escapeHtml(mediaItem.label) + '</div>' + openBtn;
      row.onclick = function(e) {
        if (e.target && e.target.classList.contains('open-folder-btn')) {
          var file = decodeURIComponent(e.target.getAttribute('data-file'));
          fetch('/open_folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: state.folder + '/' + file })
          }).then(function(resp) {
            if (!resp.ok) {
              return resp.json().then(function(data) {
                setStatus(ui, data.error || 'Failed to open folder');
              });
            }
            setStatus(ui, 'Opened folder for: ' + file);
          }).catch(function(err) {
            setStatus(ui, 'Failed to open folder: ' + err);
          });
          e.stopPropagation();
          return;
        }
        if (state.currentItem && state.currentItem.key === mediaItem.key) {
          return;
        }
        saveCurrentCaption(ui, state).then(function() {
          return selectMedia(ui, state, mediaItem);
        }).catch(function(err) {
          setStatus(ui, String(err && err.message ? err.message : err));
        });
      };
      row.ondblclick = function(e) {
        // Toggle reviewed state on double-click
        if (state.reviewedSet.has(mediaItem.key)) {
          state.reviewedSet.delete(mediaItem.key);
        } else {
          state.reviewedSet.add(mediaItem.key);
        }
        renderFileList(ui, state, ui.filterEl.value);
        e.stopPropagation();
      };
      ui.pageListEl.appendChild(row);
      matchCount++;
    }
    if (!q) {
      state.items.forEach(function(mediaItem) {
        attachMediaRow(mediaItem, null);
      });
      countDiv.textContent = matchCount + ' item' + (matchCount === 1 ? '' : 's') + ' match filter';
      state.items.forEach(function(mediaItem) {
        CaptionOps.loadCaptionTextForItem(state, mediaItem).then(function(captionText) {
          if (renderSeq !== state.listRenderSeq) {
            return;
          }
          var row = null;
          var rows = ui.pageListEl.querySelectorAll('.page-item[data-key]');
          for (var i = 0; i < rows.length; i += 1) {
            if (rows[i].getAttribute('data-key') === mediaItem.key) {
              row = rows[i];
              break;
            }
          }
          if (!row) {
            return;
          }
          if (!(captionText || '').trim()) {
            row.classList.add('empty-caption');
          } else {
            row.classList.remove('empty-caption');
          }
        });
      });
      return;
    }
    var captionPromises = state.items.map(function(mediaItem) {
      return CaptionOps.loadCaptionTextForItem(state, mediaItem).then(function(captionText) {
        return { mediaItem: mediaItem, captionText: captionText || '' };
      });
    });
    Promise.all(captionPromises).then(function(results) {
      if (renderSeq !== state.listRenderSeq) {
        return;
      }
      if (filterToken && token !== undefined && token !== filterToken.current) {
        return;
      }
      results.forEach(function(entry) {
        var mediaItem = entry.mediaItem;
        var captionText = entry.captionText;
        var lower = mediaItem.label.toLowerCase();
        if (lower.indexOf(q) === -1 && captionText.toLowerCase().indexOf(q) === -1) {
          return;
        }
        attachMediaRow(mediaItem, captionText);
      });
      countDiv.textContent = matchCount + ' item' + (matchCount === 1 ? '' : 's') + ' match filter';
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
    var caption = await readPickerCaption(mediaItem);
    if (state.currentItem !== mediaItem) {
      return;
    }
    state.suppressInput = true;
    ui.editorEl.value = caption.text;
    state.suppressInput = false;
    var suffix = caption.exists ? 'existing caption loaded' : 'new caption file will be created on save';
    setStatus(ui, 'Selected: ' + mediaItem.label + ' (' + suffix + ')');
  }

  async function readPickerCaption(mediaItem) {
    var captionName = mediaItem.fileName.replace(/\.[^.]+$/, '.txt');
    try {
      var captionHandle = await mediaItem.dirHandle.getFileHandle(captionName);
      var file = await captionHandle.getFile();
      return { text: await file.text(), exists: true };
    } catch (err) {
      return { text: '', exists: false };
    }
  }

  function saveCurrentCaption(ui, state) {
    if (!state.currentItem) {
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
