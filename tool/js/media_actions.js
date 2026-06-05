// media_actions.js
// Global functions: pruneMedia, duplicateImageItem, restoreMediaItem, resetMediaItem, promptRenameMedia, renameMedia

pruneMedia = async function (mediaItem) {
  // Confirm before pruning
  if (!state.folder || !mediaItem || !mediaItem.key) {
    setStatus('No folder or media selected for prune');
    return;
  }
  var confirmed = confirm('Remove this media file from the current set?\n\n' + mediaItem.key + '\n\nYou can restore it later from originals.');
  if (!confirmed) {
    setStatus('Prune cancelled');
    return;
  }
  setStatus('Pruning media: ' + mediaItem.key + ' ...');
  try {
    const resp = await fetch('/media/prune', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: state.folder, media: mediaItem.key })
    });
    if (!resp.ok) {
      const msg = await resp.text();
      setStatus('Prune failed: ' + getErrorMessage(msg, resp.statusText));
      return;
    }
    setStatus('Media pruned: ' + mediaItem.key);
    var prunedWasCurrent = !!(state.currentItem && (state.currentItem.key === mediaItem.key || state.currentItem.fileName === mediaItem.key));
    var nextItemToSelect = null;
    // Remove pruned item from state.items instead of refreshing the directory.
    if (window.state && Array.isArray(state.items)) {
      var idx = state.items.findIndex(function(item) {
        return item && (item.key === mediaItem.key || item.fileName === mediaItem.key);
      });
      if (idx !== -1) {
        if (prunedWasCurrent && (idx + 1) < state.items.length) {
          nextItemToSelect = state.items[idx + 1];
        }
        state.items.splice(idx, 1);
      }
    }
    if (prunedWasCurrent) {
      state.currentItem = null;
      clearEditorAndPreview();
      window.renderChecklistPanel();
      renderFileList();
      if (nextItemToSelect) {
        // Best-effort next-item selection; silent no-op on failure.
        selectPathMedia(nextItemToSelect).catch(function () {});
      }
    } else {
      renderFileList();
    }
  } catch (err) {
    setStatus('Prune error: ' + (err && err.message ? err.message : err));
  }
};

function duplicateImageItem(mediaItem) {
  if (!state.folder || !mediaItem || !mediaItem.fileName) {
    setStatus('No image selected for duplicate');
    return;
  }
  setStatus('Duplicating image: ' + mediaItem.fileName + ' ...');
  var srcPath = (state.folder ? state.folder + '/' : '') + mediaItem.fileName;
  fetch('/fs/duplicate_image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ src: srcPath })
  })
    .then(function (resp) {
      return resp.json().then(function (data) {
        return { status: resp.status, data: data };
      });
    })
    .then(function (res) {
      if (res.status === 200 && res.data && res.data.success) {
        var newName = (res.data && res.data.dstName) ? res.data.dstName : '';
        if (newName) {
          state.pendingSelectFileName = newName;
          setStatus('Duplicated image: ' + mediaItem.fileName + ' -> ' + newName);
        } else {
          setStatus('Duplicated image: ' + mediaItem.fileName);
        }
        refreshCurrentDirectory();
        return;
      }
      setStatus((res.data && res.data.error) ? res.data.error : 'Duplicate image failed');
    })
    .catch(function (err) {
      setStatus('Duplicate image failed: ' + (err && err.message ? err.message : err));
    });
}

async function restoreMediaItem(mediaItem) {
  if (!mediaItem) {
    setStatus('No media item to restore');
    return;
  }
  var fileName = mediaItem.fileName;
  var confirmed = confirm('Restore this media file and its caption from originals?\n\n' + fileName + '\n\nRestore will only work if the file does not already exist. It will NOT overwrite.');
  if (!confirmed) {
    setStatus('Restore cancelled');
    return;
  }
  // Compute parent folder (set folder) if in originals
  var folder = state.folder || '';
  if (folder.endsWith('/originals')) {
    folder = folder.slice(0, -'/originals'.length);
  } else if (folder.endsWith('\\originals')) {
    folder = folder.slice(0, -'\\originals'.length);
  } else if (folder.split('/').pop() === 'originals' || folder.split('\\').pop() === 'originals') {
    folder = folder.replace(/[\\/]originals$/, '');
  }
  var xhr = new XMLHttpRequest();
  xhr.open('POST', '/media/restore');
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.onreadystatechange = function () {
    if (xhr.readyState === 4) {
      if (xhr.status === 200) {
        setStatus('Restored from originals: ' + fileName + '. Open parent folder to view.');
        // Remove restored item from the current list immediately (no full refresh).
        if (window.state && Array.isArray(state.items)) {
          var idx = state.items.findIndex(function (item) {
            return item && (item.key === mediaItem.key || item.fileName === mediaItem.fileName);
          });
          if (idx !== -1) {
            state.items.splice(idx, 1);
          }
        }
      } else {
        var msg = 'Restore failed';
        try {
          var resp = JSON.parse(xhr.responseText);
          if (xhr.status === 409) {
            msg = 'Restore failed: File already exists. Use Reset to overwrite.';
          } else if (xhr.status === 404) {
            msg = 'Restore failed: No original found in originals folder.';
          } else if (resp && resp.error) {
            msg = 'Restore failed: ' + resp.error;
          }
        } catch (e) {
          msg = 'Restore failed: ' + xhr.responseText;
        }
        setStatus(msg);
      }
      if (state.focusSet && state.focusSet.keys && state.focusSet.keys.length) {
        state.focusSet.keys = state.focusSet.keys.filter(function (key) {
          return key !== mediaItem.key;
        });
        if (!state.focusSet.keys.length) {
          state.focusSet = null;
        }
      }
      if (state.currentItem && state.currentItem.key === mediaItem.key) {
        clearEditorAndPreview();
        window.renderChecklistPanel();
      }
      renderFileList();
    }
  };
  xhr.send(JSON.stringify({ folder: folder, fileName: fileName }));
}

async function resetMediaItem(mediaItem) {
  if (!mediaItem) {
    setStatus('No media item to reset');
    return;
  }
  var fileName = mediaItem.fileName;
  var confirmed = confirm('Reset this media file to the original version?\n\n' + fileName);
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
  xhr.open('POST', '/media/reset');
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.onreadystatechange = function () {
    if (xhr.readyState === 4) {
      if (xhr.status === 200) {
        setStatus('Reset to original: ' + fileName);
        clearMediaMutated(mediaItem.key);
        saveFolderStateForCurrentRoot();
        refreshMediaResolutionCache();
        selectPathMedia(mediaItem).catch(function () {});
      } else {
        setStatus('Reset failed: ' + xhr.responseText);
      }
    }
  };
  xhr.send(JSON.stringify({ folder: folder, fileName: fileName }));
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
  renameMedia(mediaItem, oldFile, newFile).then(function () {
    if (typeof captionItemTagsByMedia === 'object' && captionItemTagsByMedia) {
      if (Array.isArray(captionItemTagsByMedia[oldFile])) {
        captionItemTagsByMedia[newFile] = captionItemTagsByMedia[oldFile].slice();
        delete captionItemTagsByMedia[oldFile];
        saveItemTagsToFolderState();
      }
    }
    if (state.ratings && Object.prototype.hasOwnProperty.call(state.ratings, oldFile)) {
      state.ratings[newFile] = state.ratings[oldFile];
      delete state.ratings[oldFile];
      saveFolderStateForCurrentRoot();
    }
    if (moveMediaMutationState(oldFile, newFile)) {
      saveFolderStateForCurrentRoot();
    }
    setStatus('Renamed: ' + oldFile + ' -> ' + newFile);
    // Update the current item's fileName and reload preview
    if (state.currentItem && state.currentItem.fileName === oldFile) {
      state.currentItem.fileName = newFile;
      selectPathMedia(state.currentItem).catch(function () {});
    } else {
      // If item not currently selected, just refresh list to show new name
      renderFileList();
    }
  }).catch(function (err) {
    setStatus((err && err.message) ? err.message : ('Rename failed: ' + err));
  });
}

async function renameMedia(mediaItem, oldFile, newFile) {
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
