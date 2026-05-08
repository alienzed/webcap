// media.js
// Global functions: restoreMediaItem, resetMediaItem, selectPathMedia, promptRenameMedia, navigateUp, renameMedia, renderPathPreview

pruneMedia = async function (mediaItem) {
  // Confirm before pruning
  if (!state.folder || !mediaItem || !mediaItem.key) {
    setStatus('No folder or media selected for prune');
    return;
  }
  var confirmed = confirm('Permanently remove this media file?\n\n' + mediaItem.key + '\n\nThis cannot be undone.');
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
    var nextItem = null;
    var prunedWasCurrent = !!(state.currentItem && (state.currentItem.key === mediaItem.key || state.currentItem.fileName === mediaItem.key));
    // Remove pruned item from state.items instead of refreshing the directory.
    if (window.state && Array.isArray(state.items)) {
      var idx = state.items.findIndex(function(item) {
        return item && (item.key === mediaItem.key || item.fileName === mediaItem.key);
      });
      if (idx !== -1) {
        state.items.splice(idx, 1);
        if (prunedWasCurrent && state.items.length) {
          nextItem = state.items[idx] || state.items[idx - 1] || null;
        }
      }
    }
    if (prunedWasCurrent) {
      state.currentItem = null;
      if (nextItem) {
        selectPathMedia(nextItem);
      } else {
        clearEditorAndPreview();
        window.renderChecklistPanel();
        renderFileList();
      }
    } else {
      renderFileList();
    }
  } catch (err) {
    setStatus('Prune error: ' + (err && err.message ? err.message : err));
  }
};

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
      // Only update state after request completes
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
        window.renderChecklistPanel();
      }
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
  xhr.open('POST', '/media/reset');
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
      var text = '';
      if (status !== 200) {
        renderFileList();
        return;
      }
      try {
        var data = JSON.parse(responseText);
        text = data.caption || '';
      } catch (e) {
        ui.editorEl.value = '';
        setStatus('Error parsing caption: ' + e);
        renderFileList();
        return;
      }
      // If caption is missing or empty, auto-populate with primer/template if available
      if (!(text || '').trim()) {
        var primerText = buildAutoPrimer(mediaItem.fileName);
        ui.editorEl.value = primerText || '';
      } else {
        ui.editorEl.value = text;
      }
      var suffix = mediaItem.fileName.split('.').pop();
      setStatus('Selected: ' + mediaItem.label + ' (' + suffix + ')');
      renderChecklistPanel();
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
  renameMedia(mediaItem, oldFile, newFile).then(function () {
    setStatus('Renamed: ' + oldFile + ' -> ' + newFile);
    // Store the new filename to reselect after refresh
    window.state = window.state || {};
    state.pendingSelectFileName = newFile;
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

function renderPathPreview(folder, mediaName) {
  var ext = getFileExtension(mediaName);
  var mediaUrl = '/caption/media?folder=' + encodeURIComponent(folder) + '&media=' + encodeURIComponent(mediaName);
  renderPreviewHtml(!!IMAGE_EXTENSIONS[ext], mediaUrl);
}

function renderPreviewHtml(isImage, src) {
  var tag = '';
  if (isImage) {
    tag = '<img src="' + src + '" alt="preview" style="max-width:100%;max-height:100%;object-fit:contain;">';
  } else {
    tag = '' +
      '<div id="video-wrap" style="max-width:100%;max-height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;">' +
      '  <video id="media-video" controls autoplay loop muted playsinline preload="metadata" style="max-width:100%;max-height:100%;">' +
      '    <source src="' + src + '">' +
      '  </video>' +
      '  <div id="video-error" style="display:none;color:#ddd;font:13px system-ui;text-align:center;max-width:420px;">' +
      '    Video failed to load in browser preview. The codec may be unsupported.' +
      '  </div>' +
      '</div>';
  }

  var doc = ui.previewEl.contentDocument || ui.previewEl.contentdocument;
  doc.open();
  doc.write(
    '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;display:flex;align-items:center;justify-content:center;background:#111;height:100vh;">' +
    tag +
    '<script>\n' +
    'var video=document.getElementById("media-video");\n' +
    'if(video){\n' +
    '  var error=document.getElementById("video-error");\n' +
    '  video.addEventListener("error",function(){ if(error){ error.style.display="block"; } });\n' +
    '  var source=video.querySelector("source");\n' +
    '  if(source){ source.addEventListener("error",function(){ if(error){ error.style.display="block"; } }); }\n' +
    '  var p=video.play(); if(p && p.catch){ p.catch(function(){}); }\n' +
    '}\n' +
    '<\/script></body></html>'
  );
  doc.close();
}

async function renderFileList() {
  debugLog('[renderFileList] called. state.items:', state.items, 'state.childFolders:', state.childFolders, 'filterText:', ui.filterEl.value);
  var q = (ui.filterEl.value || '').toLowerCase();
  var renderSeq = ++state.listRenderSeq;
  ui.mediaListEl.innerHTML = '';
  var mediaItems = state.items;
  // Focus set logic (if active)
  if (state.focusSet && state.focusSet.keys && state.focusSet.keys.length) {
    var allow = {};
    state.focusSet.keys.forEach(function (key) {
      allow[key] = true;
    });
    mediaItems = state.items.filter(function (item) {
      return !!allow[item.key];
    });
  }
  // Filter logic (by label, fileName, or caption)
  if (q) {
    mediaItems = mediaItems.filter(function (item) {
      var label = (item.label || '').toLowerCase();
      var fileName = (item.fileName || '').toLowerCase();
      var caption = (item.caption || '').toLowerCase();
      return label.indexOf(q) !== -1 || fileName.indexOf(q) !== -1 || caption.indexOf(q) !== -1;
    });
  }
  // Show count of matching media items
  ui.captionFilterCount.textContent = mediaItems.length + (mediaItems.length === 1 ? ' item matches the filter' : ' items match the filter');


  var matchCount = 0;

  // Modern color palette for flags
  // Use centralized FLAG_COLOR_MAP from constants.js
  for (var i = 0; i < state.childFolders.length; ++i) {
    var folderItem = state.childFolders[i];
    var flagColor = state.flags && state.flags[folderItem.name];
    var colorDot = '';
    if (flagColor) {
      colorDot = '<span class="flag-dot flag-dot--' + flagColor + '" style="margin-left:8px;"></span>';
    }
    var label = '🗀 ' + folderItem.name;
    var row = document.createElement('div');
    row.className = 'media-item folder-item';
    row.setAttribute('data-type', 'folder');
    row.setAttribute('data-key', folderItem.name);
    row.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;width:100%"><span>' + label + '</span>' + colorDot + '</div>';
    ui.mediaListEl.appendChild(row);
    matchCount++;
  }

  // Render media items
  mediaItems.forEach(function (mediaItem) {
    var isActive = state.currentItem && state.currentItem.key === mediaItem.key;
    var reviewed = state.reviewedSet.has(mediaItem.key);
    var className = 'media-item';
    if (isActive) className += ' active';
    if (reviewed) className += ' reviewed';
    if (!mediaItem.hasCaption) className += ' empty-caption';
    var icon = '';
    var ext = '';
    if (mediaItem.fileName) {
      var dot = mediaItem.fileName.lastIndexOf('.');
      if (dot !== -1) ext = mediaItem.fileName.slice(dot).toLowerCase();
    }
    if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].indexOf(ext) !== -1) {
      icon = '🖼️';
    } else if ([".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"].indexOf(ext) !== -1) {
      icon = '🎬';
    } else if ([".ogg"].indexOf(ext) !== -1) {
      icon = '🎵';
    } else {
      icon = '📄';
    }
    var flagColor = state.flags && state.flags[mediaItem.key];
    var colorDot = '';
    if (flagColor) {
      colorDot = '<span class="flag-dot flag-dot--' + flagColor + '" style="margin-left:8px;"></span>';
    }
    var displayText = mediaItem.label;
    var row = document.createElement('div');
    row.className = className;
    row.setAttribute('data-type', 'media');
    row.setAttribute('data-key', mediaItem.key);
    row.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;width:100%">' + icon + '&nbsp;' + escapeHtml(displayText) + colorDot + '</div>';
    ui.mediaListEl.appendChild(row);
    matchCount++;
  });
}

// File/Folder Flags
function markFlag(itemKey, color) {
  debugLog('[markFlag] itemKey:', itemKey, 'color:', color, 'state.folder:', state.folder);
  if (color) {
    state.flags[itemKey] = color;
  } else {
    delete state.flags[itemKey];
  }
  saveFlags();
  // Update only the flag dot in the DOM for the affected item
  // Use centralized FLAG_COLOR_MAP from constants.js
  // Try both media and folder
  var sel = '[data-key="' + itemKey.replace(/"/g, '\"') + '"]';
  var itemEls = Array.prototype.slice.call(document.querySelectorAll('.media-item' + sel));
  if (!itemEls.length) {
    // Try folder only
    itemEls = Array.prototype.slice.call(document.querySelectorAll('.folder-item' + sel));
  }
  itemEls.forEach(function(row) {
    // Remove any existing flag dot
    var dots = row.querySelectorAll('.flag-dot');
    dots.forEach(function(dot) { dot.parentNode.removeChild(dot); });
    // Add new dot if color is set
    if (color) {
      var dot = document.createElement('span');
      dot.className = 'flag-dot flag-dot--' + color;
      row.querySelector('div').appendChild(dot);
    }
  });
  // Do NOT refresh the directory or clear selection
}

function saveFlags() {
  // Save the full folder state (including flags, reviewedKeys, stats, primer, etc.)
  var folderPath = state.folder || '';
  var snapshot = snapshotFolderStateFromDom();
  debugLog('[saveFlags] folderPath:', folderPath, 'snapshot:', snapshot);
  writeFolderStateFile(folderPath, snapshot);
}