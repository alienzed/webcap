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
    ? 'Resume Focus Annotation...'
    : 'Focused Annotate...';
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
    {
      label: focusActionLabel,
      run: function () {
        if (typeof openFocusedAnnotationModal === 'function') {
          openFocusedAnnotationModal();
        } else {
          setStatus('Focused annotation is unavailable.');
        }
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

function prepareH3EnvelopeProbe(mediaItem) {
  setStatus('Preparing H3 envelope probe...');
  fetch('/fs/h3_probe/prepare', {
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
      copyTextToClipboard(payload.command, function () {
        setStatus('H3 envelope probe command copied. Seed: ' + payload.seedPath);
      }, function (error) {
        setStatus('H3 envelope probe prepared. Copy this command manually: ' + payload.command + ' (' + error.message + ')');
      });
    })
    .catch(function (error) {
      setStatus('H3 envelope probe preparation failed: ' + String(error && error.message ? error.message : error));
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
    label: 'Focused Annotate...',
    run: function () {
      if (typeof openFocusedAnnotationForMediaItem === 'function') {
        openFocusedAnnotationForMediaItem(mediaItem);
      } else {
        setStatus('Focused annotation is unavailable.');
      }
    }
  });
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
    actions.push({
      label: 'Clip...',
      run: function () {
        openVideoClipModal(mediaItem);
      }
    });
    actions.push({
      label: 'Prepare H3 envelope probe...',
      run: function () {
        prepareH3EnvelopeProbe(mediaItem);
      }
    });
  }

  actions.push({ separator: true });
  actions.push({
    label: 'Rename',
    run: function () {
      promptRenameMedia(mediaItem, ui, state);
    }
  });
  if (isImageFile) {
    actions.push({
      label: 'Duplicate Image',
      run: function () {
        duplicateImageItem(mediaItem);
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
