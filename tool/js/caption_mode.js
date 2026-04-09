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
      currentItem: null,
      objectUrl: '',
      mode: 'path'
    };

    configureUiForCaptionMode(ui);

    ui.createBtn.addEventListener('click', function() {
      var folder = normalizeFolderInput(ui.newPageNameEl.value || '');
      if (!folder) {
        setStatus(ui, 'Enter a folder path first');
        return;
      }
      ui.newPageNameEl.value = folder;
      openFolderPath(ui, state, folder);
    });

    ui.newPageNameEl.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        ui.createBtn.click();
      }
    });

    ui.openPageBtn.addEventListener('click', function() {
      chooseFolder(ui, state);
    });

    ui.filterEl.addEventListener('input', function() {
      renderMediaList(ui, state, ui.filterEl.value);
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

    setStatus(ui, 'Caption mode ready. Choose Folder (Chrome) or type a path and click Open Path.');
  }

  function configureUiForCaptionMode(ui) {
    ui.newPageNameEl.value = '';
    ui.newPageNameEl.placeholder = 'absolute folder path';
    ui.createBtn.textContent = 'Open Path';
    ui.openPageBtn.textContent = 'Choose Folder';
    ui.dropZone.style.display = 'none';
    ui.editorEl.value = '';
    ui.editorEl.placeholder = 'Caption text (.txt)';
    ui.pageListEl.innerHTML = '';

    var doc = ui.previewEl.contentDocument || ui.previewEl.contentWindow.document;
    doc.open();
    doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:system-ui;padding:1rem;color:#666;">Select a media file to preview.</body></html>');
    doc.close();
  }

  function setStatus(ui, text) {
    ui.statusEl.textContent = text || '';
  }

  function chooseFolder(ui, state) {
    if (typeof window.showDirectoryPicker !== 'function') {
      setStatus(ui, 'Choose Folder is available in Chromium browsers (Chrome/Edge).');
      return;
    }

    window.showDirectoryPicker().then(function(rootHandle) {
      return loadFromPickedFolder(ui, state, rootHandle);
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
        setStatus(ui, getErrorMessage(responseText, 'Could not open folder'));
        return;
      }

      var data = JSON.parse(responseText);
      state.folder = folder;
      state.mode = 'path';
      state.currentItem = null;
      state.items = (data.files || []).map(function(name) {
        return {
          key: name,
          label: name,
          fileName: name,
          kind: 'path'
        };
      });

      renderMediaList(ui, state, ui.filterEl.value);

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

  async function loadFromPickedFolder(ui, state, rootHandle) {
    var items = [];
    await collectMediaItems(rootHandle, '', items);

    items.sort(function(a, b) {
      return a.label.localeCompare(b.label);
    });

    state.mode = 'picker';
    state.folder = '';
    state.currentItem = null;
    state.items = items;
    ui.newPageNameEl.value = rootHandle.name || '';

    renderMediaList(ui, state, ui.filterEl.value);

    if (!items.length) {
      clearEditorAndPreview(ui, state);
      setStatus(ui, 'No supported media files found in chosen folder');
      return;
    }

    await selectMedia(ui, state, items[0]);
  }

  async function collectMediaItems(dirHandle, prefix, out) {
    for await (var entry of dirHandle.values()) {
      if (entry.kind === 'directory') {
        await collectMediaItems(entry, prefix + entry.name + '/', out);
        continue;
      }
      if (entry.kind !== 'file') {
        continue;
      }

      var ext = getFileExtension(entry.name);
      if (!MEDIA_EXTENSIONS[ext]) {
        continue;
      }

      var relativePath = prefix + entry.name;
      out.push({
        key: relativePath,
        label: relativePath,
        fileName: entry.name,
        kind: 'picker',
        fileHandle: entry,
        dirHandle: dirHandle
      });
    }
  }

  function renderMediaList(ui, state, filterText) {
    var q = (filterText || '').toLowerCase();
    ui.pageListEl.innerHTML = '';

    state.items.forEach(function(mediaItem) {
      var lower = mediaItem.label.toLowerCase();
      if (q && lower.indexOf(q) === -1) {
        return;
      }

      var row = document.createElement('div');
      var isActive = state.currentItem && state.currentItem.key === mediaItem.key;
      row.className = 'page-item' + (isActive ? ' active' : '');
      row.setAttribute('data-key', mediaItem.key);
      row.innerHTML = '<div>' + escapeHtml(mediaItem.label) + '</div>';
      row.onclick = function() {
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
    });
  }

  async function selectMedia(ui, state, mediaItem) {
    state.currentItem = mediaItem;
    renderMediaList(ui, state, ui.filterEl.value);

    if (mediaItem.kind === 'picker') {
      await selectPickerMedia(ui, state, mediaItem);
      return;
    }

    await selectPathMedia(ui, state, mediaItem);
  }

  function selectPathMedia(ui, state, mediaItem) {
    return new Promise(function(resolve, reject) {
      renderPathPreview(ui, state.folder, mediaItem.fileName);

      HttpModule.get(
        '/caption/load?folder=' + encodeURIComponent(state.folder) + '&media=' + encodeURIComponent(mediaItem.fileName),
        function(status, responseText) {
          if (status !== 200) {
            reject(new Error(getErrorMessage(responseText, 'Could not load caption')));
            return;
          }

          var data = JSON.parse(responseText);
          state.suppressInput = true;
          ui.editorEl.value = data.caption || '';
          state.suppressInput = false;

          var suffix = data.exists ? 'existing caption loaded' : 'new caption file will be created on save';
          setStatus(ui, 'Selected: ' + mediaItem.label + ' (' + suffix + ')');
          resolve();
        }
      );
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
      HttpModule.postJson('/caption/save', {
        folder: state.folder,
        media: mediaItem.fileName,
        text: text
      }, function(status, responseText) {
        if (status === 200) {
          setStatus(ui, 'Saved: ' + mediaItem.fileName.replace(/\.[^.]+$/, '.txt'));
          resolve();
          return;
        }

        reject(new Error(getErrorMessage(responseText, 'Could not save caption')));
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
    var ext = getFileExtension(mediaName);
    var mediaUrl = '/caption/media?folder=' + encodeURIComponent(folder) + '&media=' + encodeURIComponent(mediaName);
    renderPreviewHtml(ui, ext, mediaUrl);
  }

  function renderPickerPreview(ui, state, file, fallbackLabel) {
    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = '';
    }

    state.objectUrl = URL.createObjectURL(file);
    var ext = getFileExtension(file.name || fallbackLabel || '');
    renderPreviewHtml(ui, ext, state.objectUrl);
  }

  function renderPreviewHtml(ui, ext, src) {
    var tag = '';
    if (IMAGE_EXTENSIONS[ext]) {
      tag = '<img src="' + src + '" alt="preview" style="max-width:100%;max-height:100%;object-fit:contain;">';
    } else {
      tag = '<video controls style="max-width:100%;max-height:100%;"><source src="' + src + '"></video>';
    }

    var doc = ui.previewEl.contentDocument || ui.previewEl.contentWindow.document;
    doc.open();
    doc.write(
      '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;display:flex;align-items:center;justify-content:center;background:#111;height:100vh;">' +
      tag +
      '</body></html>'
    );
    doc.close();
  }

  function normalizeFolderInput(value) {
    var text = String(value || '').trim();
    if (!text) {
      return '';
    }
    if (text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"') {
      text = text.slice(1, -1).trim();
    }
    return text;
  }

  function getFileExtension(name) {
    var idx = name.lastIndexOf('.');
    if (idx === -1) {
      return '';
    }
    return name.slice(idx).toLowerCase();
  }

  function getErrorMessage(responseText, fallback) {
    try {
      var data = JSON.parse(responseText);
      return data.error || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  ModeRouterModule.registerMode('caption', startCaptionMode);
})();
