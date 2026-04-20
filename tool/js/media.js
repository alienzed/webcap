
// media.js
// Global functions: restoreMediaItem, resetMediaItem, selectPathMedia, promptRenameMedia, navigateUp, renameMedia, renderPathPreview

async function restoreMediaItem( mediaItem) {
  if (!mediaItem) {
    setStatus('No media item to restore');
    return;
  }
  var fileName = mediaItem.fileName;
  var confirmed = confirm('Restore this media file and its caption from originals?\n\n' + fileName + '\n\nThis will overwrite any current version in this set.');
  if (!confirmed) {
    return;
  }
  if (state.currentItem && state.currentItem.key === mediaItem.key) {
    if (state.currentItem && state.currentItem.fileName) {
      await savePathCaption();
    }
  }
  await restoreMedia( mediaItem, {
    restoreMedia: async function ( mediaItem) {
      return new Promise(function (resolve, reject) {
        var folder = state.folder || '';
        var media = mediaItem.fileName;
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/caption/restore');
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.onreadystatechange = function () {
          if (xhr.readyState === 4) {
            if (xhr.status === 200) {
              try {
                var resp = JSON.parse(xhr.responseText);
                resolve(resp);
              } catch (e) {
                resolve({ mediaName: media });
              }
            } else {
              reject(new Error('Restore failed: ' + xhr.responseText));
            }
          }
        };
        xhr.send(JSON.stringify({ folder: folder, media: media }));
      });
    }
  });
  state.reviewedSet.delete(mediaItem.key);
  if (state.focusSet && state.focusSet.keys && state.focusSet.keys.length) {
    state.focusSet.keys = state.focusSet.keys.filter(function (key) {
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
  refreshCurrentDirectory();
  setStatus('Restored from originals: ' + fileName);
}

async function resetMediaItem( mediaItem) {
  if (!mediaItem) {
    setStatus('No media item to reset');
    return;
  }
  var fileName = mediaItem.fileName;
  var confirmed = confirm('Reset this media file and its caption to the original version?\n\n' + fileName);
  if (!confirmed) {
    return;
  }
  if (state.currentItem && state.currentItem.key === mediaItem.key) {
    if (state.currentItem && state.currentItem.fileName) {
      await savePathCaption();
    }
  }
  var folder = state.folder || '';
  var xhr = new XMLHttpRequest();
  xhr.open('POST', '/caption/reset');
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.onreadystatechange = function () {
    if (xhr.readyState === 4) {
      if (xhr.status === 200) {
        setStatus('Reset to original: ' + fileName);
        refreshCurrentDirectory();
      } else {
        setStatus('Reset failed: ' + xhr.responseText);
      }
    }
  };
  xhr.send(JSON.stringify({ folder: folder, fileName: fileName }));
}

function selectPathMedia(mediaItem) {
  return new Promise(function (resolve, reject) {
    // Set currentItem before any UI update
    state.currentItem = mediaItem;
    // Always ensure editor is editable
    ui.editorEl.removeAttribute('readonly');
    renderPathPreview(state.folder, mediaItem.fileName);
    HttpModule.get('/caption/load?folder=' + encodeURIComponent(state.folder) + '&media=' + encodeURIComponent(mediaItem.fileName), function (status, responseText) {
      if (status !== 200) {
        setStatus('Error loading caption: ' + status);
        return;
      }
      var text = '';
      try {
        var data = JSON.parse(responseText);
        text = data.caption || '';
      } catch (e) {
        setStatus('Error parsing caption: ' + e);
        return;
      }
      // If caption is missing, populate with primer/template
      if (!(text || '').trim()) {
        text = buildAutoPrimer(mediaItem.fileName);
      }
      ui.editorEl.value = text;
      var suffix = mediaItem.fileName.split('.').pop();
      setStatus('Selected: ' + mediaItem.label + ' (' + suffix + ')');
      // Re-render list to show selection
      renderFileList();
    });
  });
}

function promptRenameMedia(mediaItem) {
  var oldFile = mediaItem.fileName;
  var input = prompt('Rename file', oldFile);
  if (input === null) {
    return;
  }
  var newFile = String(input || '').trim();
  if (!newFile || newFile === oldFile) {
    return;
  }
  if (newFile === '.' || newFile === '..' || newFile.indexOf('/') !== -1 || newFile.indexOf('\\') !== -1) {
    setStatus('Invalid filename');
    return;
  }
  if (newFile.indexOf('.') === -1) {
    var dot = oldFile.lastIndexOf('.');
    if (dot > -1) {
      newFile += oldFile.slice(dot);
    }
  }
  if (!MEDIA_NAME_PATTERN.test(newFile)) {
    setStatus('Unsupported media file type');
    return;
  }
  renameMedia( mediaItem, oldFile, newFile).then(function () {
    setStatus('Renamed: ' + oldFile + ' -> ' + newFile);
    refreshCurrentDirectory();
  }).catch(function (err) {
    setStatus((err && err.message) ? err.message : ('Rename failed: ' + err));
  });
}

// Backend-based navigation up
function navigateUp() {
  if (!state.dirStack || state.dirStack.length <= 1) {
    setStatus('Already at selected root folder');
    return;
  }
  state.dirStack.pop();
  // Rebuild state.folder from dirStack (excluding root)
  var folder = state.dirStack.slice(1).map(function (entry) { return entry.name; }).join('/');
  state.folder = folder;
  // Clear current selection and editor/preview
  state.currentItem = null;
  clearEditorAndPreview();
  refreshCurrentDirectory();
}

async function renameMedia( mediaItem, oldFile, newFile) {
  // Rename media and caption via backend
  return new Promise(function (resolve, reject) {
    var folder = state.folder || '';
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/fs/rename');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          resolve();
        } else {
          reject(new Error('Rename failed: ' + xhr.responseText));
        }
      }
    };
    xhr.send(JSON.stringify({ folder: folder, old_name: oldFile, new_name: newFile }));
  });
}

function renderPathPreview(folder, mediaName) {
  var ext = getFileExtension(mediaName);
  var mediaUrl = '/caption/media?folder=' + encodeURIComponent(folder) + '&media=' + encodeURIComponent(mediaName);
  renderPreviewHtml(!!IMAGE_EXTENSIONS[ext], mediaUrl);
}