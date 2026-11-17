function buildRowRelativePath(key) {
  var folder = String(state.folder || '').replace(/\\/g, '/').replace(/\/+$/, '');
  var name = String(key || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!name) return folder;
  if (!folder) return name;
  return folder + '/' + name;
}

function openPathInExplorer(relativePath) {
  HttpModule.postJson('/fs/open_in_explorer', { path: relativePath || '' }, function (status, responseText) {
    if (status === 200) return;
    var message = getErrorMessage(responseText, 'Failed to open in Explorer');
    if (status === 0) {
      message = 'Cannot reach WebCap server. Start it with: python -m tool.server.app';
    }
    alert(message);
  });
}

function openFolderInVsCode(relativePath) {
  fetch('/fs/open_in_vscode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: relativePath || '' })
  })
  .then(function(resp) {
    if (!resp.ok) {
      return resp.json().then(function(data) {
        throw new Error(data && data.error ? data.error : 'Failed to open folder in VS Code');
      }).catch(function() {
        throw new Error('Failed to open folder in VS Code');
      });
    }
    setStatus('Opened current folder in VS Code.');
  })
  .catch(function(err) {
    alert('Open in VS Code failed: ' + (err && err.message ? err.message : err));
  });
}

function runImageTransform(mediaItem, operation, label) {
  if (!mediaItem || !mediaItem.fileName) return;
  var actionLabel = String(label || 'Transform image');
  if (!confirm(actionLabel + '?\n\nThis will overwrite the image file.')) return;
  setStatus(actionLabel + '...');
  fetch('/media/image_transform', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folder: state.folder || '',
      fileName: mediaItem.fileName,
      operation: operation
    })
  })
    .then(function (resp) { return resp.json().then(function (data) { return { status: resp.status, data: data }; }); })
    .then(function (res) {
      if (res.status === 200 && res.data && res.data.ok) {
        setStatus(actionLabel + ': ' + mediaItem.fileName);
        markMediaMutated(mediaItem.key, 'best_effort');
        bumpMediaCacheBustToken(mediaItem.key);
        saveFolderStateForCurrentRoot();
        refreshMediaResolutionCache();
        selectPathMedia(mediaItem).catch(function () {});
      } else {
        setStatus((res.data && res.data.error) ? res.data.error : (actionLabel + ' failed'));
      }
    })
    .catch(function (err) {
      setStatus(actionLabel + ' failed: ' + (err && err.message ? err.message : err));
    });
}

function runRemoveBackground(mediaItem) {
  if (!mediaItem || !mediaItem.fileName) return;
  if (!confirm('Remove background?\n\nThis will overwrite the image file.\n\nJPEG images will be flattened onto a light grey background.')) return;
  setStatus('Removing background...');
  fetch('/media/remove_background', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folder: state.folder || '',
      fileName: mediaItem.fileName
    })
  })
    .then(function (resp) { return resp.json().then(function (data) { return { status: resp.status, data: data }; }); })
    .then(function (res) {
      if (res.status === 200 && res.data && res.data.ok) {
        setStatus('Background removed: ' + mediaItem.fileName);
        markMediaMutated(mediaItem.key, 'best_effort');
        bumpMediaCacheBustToken(mediaItem.key);
        saveFolderStateForCurrentRoot();
        refreshMediaResolutionCache();
        selectPathMedia(mediaItem).catch(function () {});
      } else {
        setStatus((res.data && res.data.error) ? res.data.error : 'Background removal failed');
      }
    })
    .catch(function (err) {
      setStatus('Background removal failed: ' + (err && err.message ? err.message : err));
    });
}

function runConvertWebpToPng(mediaItem) {
  if (!mediaItem || !mediaItem.fileName) return;
  var oldFileName = mediaItem.fileName;
  var newFileName = oldFileName.replace(/\.webp$/i, '.png');
  if (!confirm('Convert this WebP to lossless PNG?\n\nThe original WebP will remain preserved in originals.')) return;
  setStatus('Converting WebP to PNG...');
  fetch('/media/convert_webp_png', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folder: state.folder || '',
      fileName: oldFileName
    })
  })
    .then(function (resp) { return resp.json().then(function (data) { return { status: resp.status, data: data }; }); })
    .then(function (res) {
      if (res.status === 200 && res.data && res.data.ok) {
        var convertedFileName = res.data.fileName || newFileName;
        if (state.focusSet && Array.isArray(state.focusSet.keys)) {
          state.focusSet.keys = state.focusSet.keys.map(function (key) {
            return key === mediaItem.key ? convertedFileName : key;
          });
        }
        state.pendingSelectFileName = convertedFileName;
        setStatus('Converted to PNG: ' + convertedFileName);
        refreshCurrentDirectory();
      } else {
        setStatus((res.data && res.data.error) ? res.data.error : 'PNG conversion failed');
      }
    })
    .catch(function (err) {
      setStatus('PNG conversion failed: ' + (err && err.message ? err.message : err));
    });
}

function runBlurBackground(mediaItem) {
  if (!mediaItem || !mediaItem.fileName) return;
  if (!confirm('Blur background?\n\nThis will overwrite the image file.\n\nThe subject stays sharp while the original background is softened with a fixed blur.')) return;
  setStatus('Blurring background...');
  fetch('/media/blur_background', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folder: state.folder || '',
      fileName: mediaItem.fileName
    })
  })
    .then(function (resp) { return resp.json().then(function (data) { return { status: resp.status, data: data }; }); })
    .then(function (res) {
      if (res.status === 200 && res.data && res.data.ok) {
        setStatus('Background blurred: ' + mediaItem.fileName);
        markMediaMutated(mediaItem.key, 'best_effort');
        bumpMediaCacheBustToken(mediaItem.key);
        saveFolderStateForCurrentRoot();
        refreshMediaResolutionCache();
        selectPathMedia(mediaItem).catch(function () {});
      } else {
        setStatus((res.data && res.data.error) ? res.data.error : 'Background blur failed');
      }
    })
    .catch(function (err) {
      setStatus('Background blur failed: ' + (err && err.message ? err.message : err));
    });
}

function buildCurrentFolderContextActions() {
  var focusActionLabel = (state && state.focusSet && state.focusSet.keys && state.focusSet.keys.length)
    ? 'Resume Focus Annotation'
    : 'Focused Annotate';
  var browseOriginalsAction = state.folder && isSetFolderPath(state.folder)
    ? {
        label: 'Browse Originals',
        run: function () {
          fetchPathExistsForCurrentFolder('originals')
            .then(function (exists) {
              if (!exists) {
                setStatus('This folder has no originals.');
                return;
              }
              navigateIntoFolder('originals');
            })
            .catch(function (err) {
              setStatus('Could not open originals: ' + String(err && err.message ? err.message : err));
            });
        }
      }
    : null;
  return [
    {
      label: 'Open in Explorer',
      run: function () {
        openPathInExplorer(state.folder || '');
      }
    },
    {
      label: 'Open Folder in VS Code',
      run: function () {
        openFolderInVsCode(state.folder || '');
      }
    },
    browseOriginalsAction,
    state.folder && isSetFolderPath(state.folder) ? {
      label: 'Clone with VL Captions',
      run: function () { openVlSetClone(state.folder); }
    } : null,
    {
      label: focusActionLabel,
      run: function () {
        startFocusedAnnotation((state.currentItem && state.currentItem.key) || '');
      }
    },
    {
      label: 'Deface',
      run: function () {
        clearEditorAndPreview();
        setStatus('Defacing folder media...');
        var folderPath = state.folder || '';
        streamPreviewFromFetch(
          '/fs/deface',
          { folder: folderPath },
          ui,
          function () {
            setStatus('Defacing finished.');
            markAllCurrentFolderMediaMutated('best_effort');
            bumpAllCurrentFolderMediaCacheBustTokens();
            saveFolderStateForCurrentRoot();
            refreshCurrentDirectory();
          },
          function (err) {
            setStatus('Defacing failed: ' + err);
          },
          { showConsole: false }
        );
      }
    },
    {
      label: 'Reset Reviewed',
      run: function () {
        if (!confirm('Clear all reviewed state for this folder?')) return;
        state.reviewedSet = new Set();
        var rows = ui.mediaListEl.querySelectorAll('.media-item.reviewed');
        for (var i = 0; i < rows.length; i++) {
          rows[i].classList.remove('reviewed');
        }
        saveFolderStateForCurrentRoot();
        setStatus('Reviewed state cleared.');
      }
    }
  ];
}


function openSetCaptionFindReplace(folderPath) {
  var dialog = document.getElementById('prep-set-caption-replace-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'prep-set-caption-replace-dialog';
    dialog.className = 'prep-set-caption-replace';
    dialog.innerHTML = '<form method="dialog" class="prep-set-caption-replace-form">' +
      '<div class="prep-set-caption-replace-heading"><h2>Find &amp; Replace in Set Captions</h2>' +
      '<button type="submit" aria-label="Close">×</button></div>' +
      '<div class="prep-set-caption-replace-folder"></div>' +
      '<label>Find<input name="find" type="text" required autocomplete="off"></label>' +
      '<label>Replace with<input name="replacement" type="text" autocomplete="off"></label>' +
      '<p class="prep-set-caption-replace-note">Exact, case-sensitive text in this Set’s saved captions only.</p>' +
      '<p class="prep-set-caption-replace-result" role="status" aria-live="polite"></p>' +
      '<div class="prep-set-caption-replace-actions"><button type="button" data-action="preview">Preview</button>' +
      '<button type="button" data-action="apply" disabled>Replace matches</button></div></form>';
    var style = document.createElement('style');
    style.textContent = '.prep-set-caption-replace{width:min(540px,calc(100vw - 30px));max-height:85vh;padding:22px;border:1px solid var(--border,#777);border-radius:10px;background:var(--panel,Canvas);color:var(--text,CanvasText)}' +
      '.prep-set-caption-replace::backdrop{background:#0009}.prep-set-caption-replace-form{display:grid;gap:14px}' +
      '.prep-set-caption-replace-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}' +
      '.prep-set-caption-replace-heading h2{margin:0;font-size:20px}.prep-set-caption-replace-heading button{border:0;background:none;color:inherit;font-size:24px;cursor:pointer}' +
      '.prep-set-caption-replace-folder{font-size:14px;overflow-wrap:anywhere;opacity:.75}' +
      '.prep-set-caption-replace-form label{display:grid;gap:6px;font-size:16px}' +
      '.prep-set-caption-replace-form input{box-sizing:border-box;width:100%;padding:9px;font:inherit;color:inherit;background:var(--surface,Canvas);border:1px solid var(--border,#777);border-radius:6px}' +
      '.prep-set-caption-replace-note{font-size:14px;margin:0;opacity:.8}' +
      '.prep-set-caption-replace-result{margin:0;min-height:22px;font-size:15px}' +
      '.prep-set-caption-replace-actions{display:flex;justify-content:flex-end;gap:8px}' +
      '.prep-set-caption-replace-actions button{padding:9px 12px;cursor:pointer}.prep-set-caption-replace-actions button:disabled{opacity:.5;cursor:default}';
    document.head.appendChild(style);
    document.body.appendChild(dialog);
    var form = dialog.querySelector('form');
    var findInput = form.elements.namedItem('find');
    var replacementInput = form.elements.namedItem('replacement');
    var previewButton = dialog.querySelector('[data-action="preview"]');
    var applyButton = dialog.querySelector('[data-action="apply"]');
    var resultEl = dialog.querySelector('.prep-set-caption-replace-result');
    var current = null;
    function invalidate() {
      current = null;
      applyButton.disabled = true;
      resultEl.textContent = '';
    }
    findInput.addEventListener('input',invalidate);
    replacementInput.addEventListener('input',invalidate);
    function send(apply) {
      var find = findInput.value;
      if (!find) { resultEl.textContent = 'Enter text to find.'; return; }
      var payload = {folder:dialog.dataset.folder,find:find,replace:replacementInput.value};
      if (apply) {
        if (!current) return;
        payload.apply = true;
        payload.signature = current.signature;
      }
      previewButton.disabled = true;
      applyButton.disabled = true;
      resultEl.textContent = apply ? 'Replacing…' : 'Searching…';
      fetch('/caption/set_replace',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
      }).then(function(resp) {
        return resp.json().then(function(data) {
          if (!resp.ok || data.error) throw new Error(data.error || 'Caption replacement failed.');
          return data;
        });
      }).then(function(data) {
        if (apply) {
          current = null;
          resultEl.textContent = 'Replaced ' + data.occurrences + ' matches in ' + data.files + ' captions.';
          setStatus(resultEl.textContent);
        } else {
          current = data;
          resultEl.textContent = data.occurrences + ' matches in ' + data.files + ' captions.';
          applyButton.disabled = data.occurrences === 0;
        }
      }).catch(function(err) {
        current = null;
        var message = 'Set caption replacement failed: ' + (err && err.message ? err.message : err);
        resultEl.textContent = message;
        setStatus(message);
        console.error(message,err);
      }).finally(function() { previewButton.disabled = false; });
    }
    previewButton.addEventListener('click',function() {send(false);});
    applyButton.addEventListener('click',function() {send(true);});
    dialog.addEventListener('close',invalidate);
    dialog._prepSetReplaceReset = invalidate;
  }
  dialog.dataset.folder = folderPath;
  dialog.querySelector('.prep-set-caption-replace-folder').textContent = folderPath;
  dialog.querySelector('form').reset();
  dialog._prepSetReplaceReset();
  dialog.showModal();
  dialog.querySelector('input[name="find"]').focus();
}

function buildFolderContextMenuActions(key) {
  var actions = [
    createFlagAction(key),
    {
      label: 'Rename Folder',
      run: function () {
        var oldName = key;
        var newName = prompt('Rename folder', oldName);
        if (newName === null) return;
        newName = String(newName || '').trim();
        if (!newName || newName === oldName || newName === '.' || newName === '..' || /[\\/]/.test(newName)) {
          setStatus('Invalid folder name');
          return;
        }
        var parentPath = state.folder ? state.folder.replace(/\/+$/, '') : '';
        fetch('/fs/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            folder: parentPath,
            old_name: oldName,
            new_name: newName
          })
        })
          .then(function (resp) { return resp.json().then(function (data) { return { status: resp.status, data: data }; }); })
          .then(function (res) {
            if (res.status === 200 && res.data && !res.data.error) {
              setStatus('Renamed folder: ' + oldName + ' -> ' + newName);
              refreshCurrentDirectory();
            } else {
              setStatus((res.data && res.data.error) ? res.data.error : 'Rename failed');
            }
          })
          .catch(function (err) {
            setStatus('Rename failed: ' + err);
          });
      }
    },
    {
      label: 'Duplicate Folder',
      run: function () {
        setStatus('Duplicating folder...');
        var folderPath = buildRowRelativePath(key);
        fetch('/fs/duplicate_folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ src: folderPath })
        })
          .then(function (resp) { return resp.json().then(function (data) { return { status: resp.status, data: data }; }); })
          .then(function (res) {
            if (res.status === 200 && res.data && res.data.success) {
              setStatus('Duplicated folder: ' + key);
              refreshCurrentDirectory();
            } else {
              setStatus((res.data && res.data.error) ? res.data.error : 'Duplicate failed');
            }
          })
          .catch(function (err) {
            setStatus('Duplicate failed: ' + err);
          });
      }
    }
  ];
  var setFolderPath = buildRowRelativePath(key);
  if (isSetFolderPath(setFolderPath)) {
    actions.push({
      label: 'Find & Replace Captions',
      run: function () { openSetCaptionFindReplace(setFolderPath); }
    });
    actions.push({
      label: 'Clone with VL Captions',
      run: function () { openVlSetClone(setFolderPath); }
    });
  }
  actions.push({
    label: 'Open in Explorer',
    run: function () {
      openPathInExplorer(buildRowRelativePath(key));
    }
  });
  return actions;
}

function runDefaceMediaItem(mediaItem, threshold) {
  var wasCurrentItem = !!(state.currentItem && state.currentItem.key === mediaItem.key);
  setStatus('Defacing file...');
  streamPreviewFromFetch(
    '/fs/deface',
    { file: buildRowRelativePath(mediaItem.fileName), thresh: String(threshold) },
    ui,
    function () {
      setStatus('Defacing finished.');
      markMediaMutated(mediaItem.key, 'best_effort');
      bumpMediaCacheBustToken(mediaItem.key);
      saveFolderStateForCurrentRoot();
      refreshMediaResolutionCache();
      if (wasCurrentItem) {
        selectPathMedia(mediaItem).catch(function () {});
      }
    },
    function (err) {
      setStatus('Defacing failed: ' + err);
    },
    { showConsole: false }
  );
}

var h3ProbePollTimer = null;
var h3ProbeLogOffset = 0;
var h3ProbeActive = false;

function pollH3CalibrationLog() {
  if (h3ProbePollTimer) {
    clearTimeout(h3ProbePollTimer);
    h3ProbePollTimer = null;
  }
  fetch('/fs/h3_probe/log?offset=' + encodeURIComponent(h3ProbeLogOffset))
    .then(function (response) { return response.json(); })
    .then(function (payload) {
      if (!payload || !payload.ok) throw new Error((payload && payload.error) || 'Could not read H3 calibration output.');
      if (payload.text) appendToConsolePanel(payload.text);
      h3ProbeLogOffset = Number(payload.offset || h3ProbeLogOffset || 0);
      h3ProbeActive = !!payload.active;
      if (h3ProbeActive) {
        h3ProbePollTimer = setTimeout(pollH3CalibrationLog, 1000);
        return;
      }
      setStatus('H3 calibration ' + String(payload.status || 'finished') + '.');
    })
    .catch(function (error) {
      setStatus('H3 calibration console update failed: ' + String(error && error.message ? error.message : error));
    });
}

function refreshH3CalibrationStatus() {
  fetch('/fs/h3_probe/status')
    .then(function (response) { return response.json(); })
    .then(function (payload) {
      if (!payload || !payload.ok) return;
      h3ProbeActive = !!payload.active;
      if (h3ProbeActive) pollH3CalibrationLog();
    })
    .catch(function () {});
}

function stopH3Calibration() {
  fetch('/fs/h3_probe/stop', { method: 'POST' })
    .then(function (response) { return response.json(); })
    .then(function (payload) {
      if (!payload || !payload.ok) throw new Error((payload && payload.error) || 'Could not stop H3 calibration.');
      appendToConsolePanel('[h3-probe] Stop requested. Preserving partial results.\n');
      setStatus('Stopping H3 calibration');
      h3ProbeActive = true;
      pollH3CalibrationLog();
    })
    .catch(function (error) {
      setStatus('H3 calibration stop failed: ' + String(error && error.message ? error.message : error));
    });
}

function runH3Calibration(mediaItem) {
  if (!confirm('Run H3 calibration with the selected source?\n\nThis is a long, GPU-intensive calibration. Avoid other GPU-heavy applications while it runs. Training remains available, but concurrent GPU work makes the results less reliable.')) return;
  showConsolePanel();
  appendToConsolePanel('[h3-probe] Preparing H3 calibration\n');
  setStatus('Starting H3 calibration');
  fetch('/fs/h3_probe/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: state.folder, fileName: mediaItem.fileName })
  })
    .then(function (response) {
      return response.text().then(function (responseText) {
        var payload = null;
        try {
          payload = JSON.parse(responseText);
        } catch (error) {
          if (response.status === 404) {
            throw new Error('The running WebCap server does not include the H3 probe endpoint. Restart WebCap, then try again.');
          }
          throw new Error('H3 probe request returned HTTP ' + response.status + ' instead of a server response. Check the WebCap server terminal.');
        }
        if (!response.ok || !payload || !payload.ok) {
          throw new Error((payload && payload.error) || 'Could not prepare H3 envelope probe.');
        }
        return payload;
      });
    })
    .then(function (payload) {
      h3ProbeActive = true;
      h3ProbeLogOffset = 0;
      appendToConsolePanel('[h3-probe] Started ' + payload.probeId + '.\n');
      setStatus('H3 calibration running. Output is in the console.');
      pollH3CalibrationLog();
    })
    .catch(function (error) {
      setStatus('H3 calibration start failed: ' + String(error && error.message ? error.message : error));
    });
}

function buildMediaContextMenuActions(mediaItem, key) {
  var actions = [];
  var isInOriginals = (state.folder && state.folder.split(/[\/]/).pop() === 'originals');
  var fileName = mediaItem.fileName;
  var ext = (fileName || '').split('.').pop().toLowerCase();
  var isVideoFile = ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi', 'm4v'].indexOf(ext) !== -1;
  var isImageFile = isCroppableImageFile(fileName);
  var flagAction = createFlagAction(key);

  if (isInOriginals) {
    actions.push({
      label: 'Restore',
      run: function () {
        restoreMediaItem(mediaItem);
      }
    });
    actions.push({
      label: 'Open Containing Folder',
      run: function () {
        openPathInExplorer(buildRowRelativePath(key));
      }
    });
    actions.push(flagAction);
    return actions;
  }

  actions.push({
    label: 'Focused Annotate',
    run: function () {
      startFocusedAnnotationForMediaItem(mediaItem);
    }
  });
  actions.push({
    label: 'Focus Caption',
    run: function () {
      startFocusedCaptionForMediaItem(mediaItem);
    }
  });
  if (isCaptionVisionSupportedMedia(fileName)) {
    actions.push({
      label: 'VL Workspace...',
      run: function () {
        openVlWorkspace(mediaItem, 'sight');
      }
    });
  }
  actions.push({
    label: 'Copy Tags',
    run: function () {
      copyTagsForMediaKey(mediaItem.key);
    }
  });
  if (hasTagClipboardTags()) {
    actions.push({
      label: 'Paste Tags',
      run: function () {
        return pasteClipboardTagsToMediaKey(mediaItem.key);
      }
    });
  }

  var defaceAction = null;
  var defaceOptionsAction = null;
  if (MEDIA_EXTENSIONS['.' + ext]) {
    defaceAction = {
      label: 'Deface',
      run: function () {
        runDefaceMediaItem(mediaItem, '0.4');
      }
    };
    defaceOptionsAction = {
      label: 'Deface...',
      run: function () {
        var t = prompt('Deface: Enter threshold (-t, 0.0-1.0)', '0.4');
        if (t === null) return;
        t = String(t).trim();
        if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(t)) {
          setStatus('Invalid threshold');
          return;
        }
        runDefaceMediaItem(mediaItem, t);
      }
    };
  }

  if (isImageFile || defaceAction || isVideoFile) {
    actions.push({ separator: true });
  }

  if (isImageFile) {
    actions.push({
      label: 'Crop...',
      run: function () {
        openImageCropModal(mediaItem);
      }
    });
    actions.push({
      label: 'Remove Object...',
      run: function () {
        openRemoveObjectModal(mediaItem);
      }
    });
    actions.push({
      label: 'Blur Background',
      run: function () {
        runBlurBackground(mediaItem);
      }
    });
    actions.push({
      label: 'Remove Background',
      run: function () {
        runRemoveBackground(mediaItem);
      }
    });
    if (defaceAction) actions.push(defaceAction);
    if (defaceOptionsAction) actions.push(defaceOptionsAction);
    actions.push({ separator: true });
    actions.push({
      label: 'Rotate Left 90 deg',
      run: function () {
        runImageTransform(mediaItem, 'rotate_left_90', 'Rotating image left');
      }
    });
    actions.push({
      label: 'Rotate Right 90 deg',
      run: function () {
        runImageTransform(mediaItem, 'rotate_right_90', 'Rotating image right');
      }
    });
    actions.push({
      label: 'Flip Vertical',
      run: function () {
        runImageTransform(mediaItem, 'flip_vertical', 'Flipping image vertical');
      }
    });
    actions.push({
      label: 'Flip Horizontal',
      run: function () {
        runImageTransform(mediaItem, 'flip_horizontal', 'Flipping image horizontal');
      }
    });
    if (ext === 'webp') {
      actions.push({
        label: 'Convert to PNG',
        run: function () {
          runConvertWebpToPng(mediaItem);
        }
      });
    }
  } else if (defaceAction) {
    actions.push(defaceAction);
    actions.push(defaceOptionsAction);
  }

  if (isVideoFile) {
    if (!isImageFile && !defaceAction) {
      actions.push({ separator: true });
    }
    actions.push({
      label: 'Flip Horizontal',
      run: function () {
        if (!confirm('Flip this video horizontally? This will overwrite the file.')) return;
        setStatus('Flipping video...');
        fetch('/media/flip_horizontal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder: state.folder, fileName: mediaItem.fileName })
        })
          .then(function (resp) { return resp.json().then(function (data) { return { status: resp.status, data: data }; }); })
          .then(function (res) {
            if (res.status === 200 && res.data && res.data.ok) {
              setStatus('Video flipped.');
              markMediaMutated(mediaItem.key, 'best_effort');
              bumpMediaCacheBustToken(mediaItem.key);
              saveFolderStateForCurrentRoot();
              refreshMediaResolutionCache();
              selectPathMedia(mediaItem).catch(function () {});
            } else {
              setStatus((res.data && res.data.error) ? res.data.error : 'Flip failed');
            }
          })
          .catch(function (err) {
            setStatus('Flip failed: ' + (err && err.message ? err.message : err));
          });
      }
    });
    function convertVideoToFps(fps) {
      if (!isFinite(fps) || fps <= 0) {
        setStatus('FPS must be a finite number greater than zero.');
        return;
      }
      setStatus('Converting video to ' + fps + ' FPS...');
      fetch('/media/convert_fps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: state.folder, fileName: mediaItem.fileName, fps: fps })
      })
        .then(function (resp) { return resp.json().then(function (data) { return { status: resp.status, data: data }; }); })
        .then(function (res) {
          if (res.status === 200 && res.data && res.data.ok) {
            setStatus('Video converted to ' + res.data.fps + ' FPS.');
            markMediaMutated(mediaItem.key, 'best_effort');
            bumpMediaCacheBustToken(mediaItem.key);
            saveFolderStateForCurrentRoot();
            refreshMediaResolutionCache();
            selectPathMedia(mediaItem).catch(function () {});
          } else {
            setStatus((res.data && res.data.error) ? res.data.error : 'FPS conversion failed');
          }
        })
        .catch(function (err) {
          setStatus('FPS conversion failed: ' + (err && err.message ? err.message : err));
        });
    }
    actions.push({
      label: 'Convert to 24 FPS',
      run: function () { convertVideoToFps(24); }
    });
    actions.push({
      label: 'Convert to...',
      run: function () {
        var fpsText = prompt('Convert video to FPS', '');
        if (fpsText === null) return;
        convertVideoToFps(Number(String(fpsText).trim()));
      }
    });
    actions.push({
      label: 'Clip...',
      run: function () {
        openVideoClipModal(mediaItem);
      }
    });
  }

  // Keep action entries flat for Preview buttons/shortcuts; the menu renderer
  // alone collapses secondary media edits into one disclosure.
  var editLabels = new Set([
    'Blur Background', 'Remove Background', 'Deface', 'Deface...',
    'Rotate Left 90 deg', 'Rotate Right 90 deg', 'Flip Vertical',
    'Flip Horizontal', 'Convert to PNG', 'Convert to 24 FPS', 'Convert to...'
  ]);
  actions.forEach(function (action) {
    if (action && editLabels.has(action.label)) action.group = 'Edit Media';
  });

  actions.push({ separator: true });
  actions.push({
    label: 'Rename',
    run: function () {
      promptRenameMedia(mediaItem, ui, state);
    }
  });
  if (isImageFile || isVideoFile) {
    actions.push({
      label: 'Duplicate',
      run: function () {
        duplicateMediaItem(mediaItem);
      }
    });
  }
  actions.push({
    label: 'Open Containing Folder',
    run: function () {
      openPathInExplorer(buildRowRelativePath(key));
    }
  });

  actions.push({ separator: true });
  actions.push({
    label: 'Reset',
    run: function () {
      if (!confirm('Reset this file to the original version? This will overwrite the current file but leave the caption unchanged.')) return;
      setStatus('Resetting file...');
      var filePath = (state.folder ? state.folder : '') || '';
      fetch('/media/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: filePath, fileName: mediaItem.fileName })
      })
        .then(function (resp) { return resp.json().then(function (data) { return { status: resp.status, data: data }; }); })
        .then(function (res) {
          if (res.status === 200 && res.data && res.data.ok) {
            setStatus('File reset to original.');
            clearMediaMutated(mediaItem.key);
            bumpMediaCacheBustToken(mediaItem.key);
            saveFolderStateForCurrentRoot();
            refreshMediaResolutionCache();
            selectPathMedia(mediaItem).catch(function () {});
          } else {
            setStatus((res.data && res.data.error) ? res.data.error : 'Reset failed');
          }
        })
        .catch(function (err) {
          setStatus('Reset failed: ' + err);
        });
    }
  });
  actions.push({
    label: 'Prune',
    run: function (options) {
      return pruneMedia(mediaItem, options).catch(function (err) {
        setStatus(String(err && err.message ? err.message : err));
        return false;
      });
    }
  });
  actions.push(flagAction);

  return actions;
}

setTimeout(refreshH3CalibrationStatus, 0);
