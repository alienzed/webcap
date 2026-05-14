function buildRowRelativePath(key) {
  return (state.folder ? state.folder + '/' : '') + key;
}

function openPathInExplorer(relativePath) {
  fetch('/fs/open_in_explorer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: relativePath || '' })
  })
  .then(function(resp) {
    if (!resp.ok) {
      return resp.json().then(function(data) {
        throw new Error(data && data.error ? data.error : 'Failed to open in explorer');
      }).catch(function() {
        throw new Error('Failed to open in explorer');
      });
    }
  })
  .catch(function(err) {
    alert('Open in Explorer failed: ' + (err && err.message ? err.message : err));
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

function buildCurrentFolderContextActions() {
  return [
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

  actions.push(createFlagAction(key));
  actions.push({
    label: 'Open in Explorer',
    run: function () {
      openPathInExplorer(buildRowRelativePath(key));
    }
  });

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
            refreshCurrentDirectory();
          } else {
            setStatus((res.data && res.data.error) ? res.data.error : 'Reset failed');
          }
        })
        .catch(function (err) {
          setStatus('Reset failed: ' + err);
        });
    }
  });

  if (isCroppableImageFile(fileName)) {
    actions.push({
      label: 'Duplicate Image',
      run: function () {
        duplicateImageItem(mediaItem);
      }
    });
    actions.push({
      label: 'Crop...',
      run: function () {
        openCropModal(mediaItem);
      }
    });
  }

  var ext = (fileName || '').split('.').pop().toLowerCase();
  if (MEDIA_EXTENSIONS['.' + ext]) {
    actions.push({
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
          }
        );
      }
    });
  }

  return actions;
}
