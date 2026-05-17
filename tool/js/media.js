// media.js
// Global functions: restoreMediaItem, resetMediaItem, selectPathMedia, promptRenameMedia, navigateUp, renameMedia, renderPathPreview

function scrollCurrentMediaRowIntoView() {
  if (!ui || !ui.mediaListEl || !state || !state.currentItem || !state.currentItem.key) {
    return;
  }
  var rows = ui.mediaListEl.querySelectorAll('.media-item[data-type="media"]');
  var target = null;
  for (var i = 0; i < rows.length; i += 1) {
    if (rows[i].getAttribute('data-key') === state.currentItem.key) {
      target = rows[i];
      break;
    }
  }
  if (!target) {
    return;
  }
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

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
    if (state.ratings && Object.prototype.hasOwnProperty.call(state.ratings, mediaItem.key)) {
      delete state.ratings[mediaItem.key];
      saveFolderStateForCurrentRoot();
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

/**
 * Return the array of media items after applying the current UI filters.
 * If ignoreFocusSet is true, the focus set will be ignored and filters applied to full folder.
 */
function getFilteredMediaItems(ignoreFocusSet) {
  var q = (ui.filterEl && ui.filterEl.value) ? ui.filterEl.value.toLowerCase() : '';
  var mediaItems = Array.isArray(state.items) ? state.items.slice() : [];
  var missingCaptionsOnly = !!(ui.advancedFilterMissingCaptionsEl && ui.advancedFilterMissingCaptionsEl.checked);
  var reviewedOnly = !!(ui.advancedFilterReviewedEl && ui.advancedFilterReviewedEl.checked);
  var minStarsThreshold = getAdvancedMinStarsThreshold();
  var flagFilterValues = getAdvancedFlagFilterValues();

  // Apply focus set only when not ignoring it
  if (!ignoreFocusSet && state.focusSet && state.focusSet.keys && state.focusSet.keys.length) {
    var allow = {};
    state.focusSet.keys.forEach(function (key) { allow[key] = true; });
    mediaItems = mediaItems.filter(function (item) { return !!allow[item.key]; });
  }

  // Filter logic (by label, fileName, or caption)
  if (q) {
    mediaItems = mediaItems.filter(function (item) {
      var label = (item.label || '').toLowerCase();
      var fileName = (item.fileName || '').toLowerCase();
      var caption = (item.caption || '').toLowerCase();
      var tags = getTagsForMediaKey(item.key).join(' ').toLowerCase();
      return label.indexOf(q) !== -1 || fileName.indexOf(q) !== -1 || caption.indexOf(q) !== -1 || tags.indexOf(q) !== -1;
    });
  }
  if (missingCaptionsOnly) {
    mediaItems = mediaItems.filter(function (item) { return !item.hasCaption; });
  }
  if (reviewedOnly) {
    mediaItems = mediaItems.filter(function (item) { return !!(state.reviewedSet && state.reviewedSet.has(item.key)); });
  }
  if (minStarsThreshold !== null) {
    mediaItems = mediaItems.filter(function (item) {
      var rating = (typeof getRatingForMediaKey === 'function') ? getRatingForMediaKey(item.key) : 0;
      return rating > minStarsThreshold;
    });
  }
  if (flagFilterValues.length) {
    mediaItems = mediaItems.filter(function (item) {
      var itemFlag = String((state.flags && state.flags[item.key]) || '').toLowerCase();
      if (flagFilterValues.indexOf('any') !== -1) return !!itemFlag;
      return flagFilterValues.indexOf(itemFlag) !== -1;
    });
  }
  var showInvalidArOnly = !!(ui.advancedFilterInvalidArEl && ui.advancedFilterInvalidArEl.checked);
  if (showInvalidArOnly) {
    mediaItems = mediaItems.filter(function (item) {
      var ar = String((item.aspect_ratio || item.ar) || '').trim();
      if (!ar) return false;
      return !(typeof hasSupportedAspectBucket === 'function' && hasSupportedAspectBucket(ar));
    });
  }
  return mediaItems;
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
      if (state.currentItem && state.currentItem.key === mediaItem.key) {
        clearEditorAndPreview();
        window.renderChecklistPanel();
      }
      if (state.ratings && Object.prototype.hasOwnProperty.call(state.ratings, mediaItem.key)) {
        delete state.ratings[mediaItem.key];
        saveFolderStateForCurrentRoot();
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
        refreshMediaResolutionCache();
        selectPathMedia(mediaItem).catch(function () {});
      } else {
        setStatus('Reset failed: ' + xhr.responseText);
      }
    }
  };
  xhr.send(JSON.stringify({ folder: folder, fileName: fileName }));
}

function buildSelectedMediaStatus(mediaItem) {
  var suffix = '';
  if (mediaItem && mediaItem.fileName) {
    var parts = mediaItem.fileName.split('.');
    suffix = parts.length > 1 ? parts.pop() : '';
  }
  var status = 'Selected: ' + mediaItem.label + (suffix ? ' (' + suffix + ')' : '');
  if (mediaItem && mediaItem.fileName) {
    var resolution = getResolutionForMedia(mediaItem.fileName);
    if (resolution) {
      status += ' | ' + resolution;
    }
  }
  return status;
}

function getAdvancedMinStarsThreshold() {
  if (!ui.advancedFilterMinStarsEl) return null;
  var raw = String(ui.advancedFilterMinStarsEl.value || '').trim();
  if (!raw.length) return null;
  var n = Number(raw);
  if (!isFinite(n)) return null;
  return Math.max(0, Math.min(4, Math.round(n)));
}

function getAdvancedFlagFilterValue() {
  if (!ui.advancedFilterFlagEl) return '';
  return getAdvancedFlagFilterValues().join(',');
}

function getAdvancedFlagFilterValues() {
  if (!ui.advancedFilterFlagEl) return [];
  var inputs = ui.advancedFilterFlagEl.querySelectorAll('input[type="checkbox"]:checked');
  return Array.prototype.map.call(inputs, function (input) {
    return String(input.value || '').trim().toLowerCase();
  }).filter(Boolean);
}

function selectPathMedia(mediaItem) {
  return new Promise(function (resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/caption/load?folder=' + encodeURIComponent(state.folder) + '&media=' + encodeURIComponent(mediaItem.fileName), false);
    try {
      xhr.send(null);
    } catch (err) {
      renderFileList();
      reject(err);
      return;
    }

    var text = '';
    if (xhr.status !== 200) {
      renderFileList();
      reject(new Error('Failed to load caption for ' + mediaItem.fileName));
      return;
    }
    try {
      var data = JSON.parse(xhr.responseText);
      text = data.caption || '';
    } catch (e) {
      setStatus('Error parsing caption: ' + e);
      renderFileList();
      reject(e);
      return;
    }
    // Load before committing selection so the editor and save target change together.
    var nextEditorValue = text;
    if (!(text || '').trim()) {
      var primerText = buildAutoPrimer(mediaItem.fileName);
      nextEditorValue = primerText || '';
    }
    state.currentItem = mediaItem;
    ui.editorEl.removeAttribute('readonly');
    ui.editorEl.value = nextEditorValue;
    renderPathPreview(state.folder, mediaItem.fileName);
    setStatus(buildSelectedMediaStatus(mediaItem));
    renderChecklistPanel();
    if (typeof renderPhraseCopyPanel === 'function') {
      renderPhraseCopyPanel();
    }
    // Re-render list to show selection
    renderFileList();
    scrollCurrentMediaRowIntoView();
    resolve(mediaItem);
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

function navigateToDirStackIndex(targetIndex) {
  if (!state.dirStack || !state.dirStack.length) {
    return;
  }
  var idx = Number(targetIndex);
  if (!isFinite(idx)) return;
  idx = Math.max(0, Math.min(state.dirStack.length - 1, Math.floor(idx)));
  state.dirStack = state.dirStack.slice(0, idx + 1);
  state.folder = state.dirStack.slice(1).map(function (entry) { return entry.name; }).join('/');
  // Clear current selection and editor/preview
  state.currentItem = null;
  clearEditorAndPreview();
  if (typeof clearCaptionFilterInputs === 'function') {
    clearCaptionFilterInputs();
  }
  refreshCurrentDirectory();
}

// Backend-based navigation up
function navigateUp() {
  if (!state.dirStack || state.dirStack.length <= 1) {
    setStatus('Already at selected root folder');
    return;
  }
  navigateToDirStackIndex(state.dirStack.length - 2);
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
  // Add cache-busting timestamp
  var ts = Date.now();
  var mediaUrl = '/caption/media?folder=' + encodeURIComponent(folder) + '&media=' + encodeURIComponent(mediaName) + '&t=' + ts;
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
  debugLog('[renderFileList] called. state.items:', state.items, 'state.childFolders:', state.childFolders, 'filterText:', ui.filterEl ? ui.filterEl.value : '');
  var renderSeq = ++state.listRenderSeq;
  ui.mediaListEl.innerHTML = '';
  var mediaItems = getFilteredMediaItems(false);
  // Show count of matching media items
  var countText = mediaItems.length + (mediaItems.length === 1 ? ' item matches the filter' : ' items match the filter');
  if (ui.captionFilterCountTextEl) {
    ui.captionFilterCountTextEl.textContent = countText;
  } else if (ui.captionFilterCount) {
    ui.captionFilterCount.textContent = countText;
  }
  var showPrepareQuickLink = !!(ui.captionFilterPrepareLinkEl && state.folder && mediaItems.length > 0);
  if (ui.captionFilterCountSeparatorEl) {
    ui.captionFilterCountSeparatorEl.classList.toggle('hidden', !showPrepareQuickLink);
  }
  if (ui.captionFilterPrepareLinkEl) {
    ui.captionFilterPrepareLinkEl.classList.toggle('hidden', !showPrepareQuickLink);
  }


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
