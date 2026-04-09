(function() {
  var IMAGE_EXTENSIONS = { '.jpg': true, '.jpeg': true, '.png': true, '.gif': true, '.webp': true, '.bmp': true };
  var MEDIA_EXTENSIONS = {
    '.mp4': true, '.webm': true, '.ogg': true, '.mov': true, '.mkv': true, '.avi': true, '.m4v': true,
    '.jpg': true, '.jpeg': true, '.png': true, '.gif': true, '.webp': true, '.bmp': true
  };

  function startCaptionMode(context) {
    var ui = context.ui;
    var scheduleSave = DebounceModule.create(500);
    var state = {
      folder: '',
      suppressInput: false,
      items: [],
      childFolders: [],
      currentItem: null,
      objectUrl: '',
      mode: 'path',
      dirStack: []
    };

    configureUiForCaptionMode(ui);

    ui.openPageBtn.addEventListener('click', function() {
      chooseFolder(ui, state);
    });

    ui.captionUpBtn.addEventListener('click', function() {
      navigateUp(ui, state);
    });

    ui.filterEl.addEventListener('input', function() {
      renderFileList(ui, state, ui.filterEl.value);
    });

    ui.editorEl.addEventListener('input', function() {
      if (state.suppressInput || !state.currentItem) {
        return;
      }
      scheduleSave(function() {
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

  async function renderFileList(ui, state, filterText) {
      var q = (filterText || '').toLowerCase();
      ui.pageListEl.innerHTML = '';

      // Count matches for filter
      var matchCount = 0;

      // Folder filtering (unchanged)
      state.childFolders.forEach(function(folderItem) {
        var label = '[DIR] ' + folderItem.name;
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

      // --- Caption filtering logic ---
      // Cache for caption texts
      if (!state._captionCache) state._captionCache = {};
      var captionCache = state._captionCache;

      // Helper to fetch caption for a media item
      function fetchCaption(folder, fileName) {
        var key = folder + '/' + fileName;
        if (captionCache[key] !== undefined) return Promise.resolve(captionCache[key]);
        return fetch('/caption/load?folder=' + encodeURIComponent(folder) + '&media=' + encodeURIComponent(fileName))
          .then(function(resp) { return resp.ok ? resp.json() : { caption: '' }; })
          .then(function(data) {
            captionCache[key] = (data.caption || '');
            return captionCache[key];
          }).catch(function() {
            captionCache[key] = '';
            return '';
          });
      }

      // Gather all caption fetch promises
      var captionPromises = state.items.map(function(mediaItem) {
        return fetchCaption(state.folder, mediaItem.fileName).then(function(captionText) {
          return { mediaItem: mediaItem, captionText: captionText };
        });
      });

      // Wait for all captions, then filter and render
      Promise.all(captionPromises).then(function(results) {
        results.forEach(function(entry) {
          var mediaItem = entry.mediaItem;
          var captionText = entry.captionText.toLowerCase();
          var lower = mediaItem.label.toLowerCase();
          // Match if file name or caption contains filter
          if (q && lower.indexOf(q) === -1 && captionText.indexOf(q) === -1) {
            return;
          }

          var row = document.createElement('div');
          var isActive = state.currentItem && state.currentItem.key === mediaItem.key;
          row.className = 'page-item' + (isActive ? ' active' : '');

          // Add open folder button (only for path mode)
          var openBtn = '';
          if (state.mode === 'path') {
            openBtn = '<button class="open-folder-btn" title="Open containing folder" data-file="' + encodeURIComponent(mediaItem.fileName) + '">📂</button>';
          }

          row.innerHTML = '<div>' + CaptionUtils.escapeHtml(mediaItem.label) + '</div>' + openBtn;

          row.onclick = function(e) {
            // Open folder button click
            if (e.target && e.target.classList.contains('open-folder-btn')) {
              var file = decodeURIComponent(e.target.getAttribute('data-file'));
              // POST to /open_folder with folder and file
              fetch('/open_folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: state.folder + '/' + file })
              }).then(function(resp) {
                if (!resp.ok) return resp.json().then(function(data) { setStatus(ui, data.error || 'Failed to open folder'); });
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
          ui.pageListEl.appendChild(row);
          matchCount++;
        });

        // Show count above list
        var countDiv = document.getElementById('caption-filter-count');
        if (!countDiv) {
          countDiv = document.createElement('div');
          countDiv.id = 'caption-filter-count';
          countDiv.style = 'font-size:13px;color:#888;margin-bottom:4px;';
          ui.pageListEl.parentNode.insertBefore(countDiv, ui.pageListEl);
        }
        countDiv.textContent = matchCount + ' item' + (matchCount === 1 ? '' : 's') + ' match filter';
      });
    }
  

  async function selectMedia(ui, state, mediaItem) {
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
    return savePathCaption(ui, state, state.currentItem, ui.editorEl.value || '');
  }

  function savePathCaption(ui, state, mediaItem, text) {
    return new Promise(function(resolve, reject) {
      HttpModule.postJson('/caption/save', { folder: state.folder, media: mediaItem.fileName, text: text }, function(status, responseText) {
        if (status === 200) {
          setStatus(ui, 'Saved: ' + mediaItem.fileName.replace(/\.[^.]+$/, '.txt'));
          resolve();
          return;
        }
        reject(new Error(CaptionUtils.getErrorMessage(responseText, 'Could not save caption')));
      });
    });
  }

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
