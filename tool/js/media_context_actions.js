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

function buildCurrentFolderContextActions() {
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
    {
      label: 'Run Autoset (Legacy)',
      run: function () {
        runAutosetForCurrentFolder();
      }
    },
    {
      label: 'Generate Dataset Configs',
      run: function () {
        runGenerateDatasetConfigsForCurrentFolder();
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
            refreshCurrentDirectory();
          },
          function (err) {
            setStatus('Defacing failed: ' + err);
          }
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
  actions.push({
    label: 'Open in Explorer',
    run: function () {
      openPathInExplorer(buildRowRelativePath(key));
    }
  });
  return actions;
}

function buildMediaContextMenuActions(mediaItem, key) {
  var actions = [];
  var isInOriginals = (state.folder && state.folder.split(/[\/]/).pop() === 'originals');
  var fileName = mediaItem.fileName;
  var ext = (fileName || '').split('.').pop().toLowerCase();
  var isVideoFile = ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi', 'm4v'].indexOf(ext) !== -1;

  actions.push(createFlagAction(key));
  actions.push({
    label: 'Open Containing Folder',
    run: function () {
      openPathInExplorer(buildRowRelativePath(key));
    }
  });
  actions.push({ separator: true });

  if (isInOriginals) {
    actions.push({
      label: 'Restore',
      run: function () {
        restoreMediaItem(mediaItem);
      }
    });
    return actions;
  }

  actions.push({
    label: 'Rename',
    run: function () {
      promptRenameMedia(mediaItem, ui, state);
    }
  });
  actions.push({
    label: 'Prune',
    run: function () {
      pruneMedia(mediaItem).catch(function (err) {
        setStatus(String(err && err.message ? err.message : err));
      });
    }
  });
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

  var defaceAction = null;
  if (MEDIA_EXTENSIONS['.' + ext]) {
    defaceAction = {
      label: 'Deface...',
      run: function () {
        clearEditorAndPreview();
        var defaultThresh = '0.4';
        var t = prompt('Deface: Enter threshold (-t, 0.0-1.0)', defaultThresh);
        if (t === null) return;
        t = String(t).trim();
        if (!/^0(\.\d+)?|1(\.0+)?$/.test(t)) {
          setStatus('Invalid threshold');
          return;
        }
        setStatus('Defacing file...');
        var filePath = buildRowRelativePath(mediaItem.fileName);
        streamPreviewFromFetch(
          '/fs/deface',
          { file: filePath, thresh: t },
          ui,
          function () {
            setStatus('Defacing finished.');
            refreshMediaResolutionCache();
            // Reload preview for the current item (file was mutated in place)
            if (state.currentItem && state.currentItem.fileName === mediaItem.fileName) {
              selectPathMedia(state.currentItem).catch(function () {});
            }
          }
        );
      }
    };
  }

  if (isCroppableImageFile(fileName)) {
    actions.push({
      label: 'Duplicate Image',
      run: function () {
        duplicateImageItem(mediaItem);
      }
    });
    actions.push({ separator: true });
    actions.push({
      label: 'Crop...',
      run: function () {
        openImageCropModal(mediaItem);
      }
    });
    actions.push({
      label: 'Rotate Left 90°',
      run: function () {
        runImageTransform(mediaItem, 'rotate_left_90', 'Rotating image left');
      }
    });
    actions.push({
      label: 'Rotate Right 90°',
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
    if (defaceAction) actions.push(defaceAction);
  }

  if (defaceAction && !isCroppableImageFile(fileName)) actions.push(defaceAction);


  // Add 'Flip Horizontal' for all video files
  if (isVideoFile) {
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
  }

  if (isVideoFile) {
    actions.push({
      label: 'Clip...',
      run: function () {
        openVideoClipModal(mediaItem);
      }
    });
  }

  return actions;
}
