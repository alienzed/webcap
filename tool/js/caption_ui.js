// caption_ui.js
// caption_list.js
// Caption sidebar render logic extracted from caption_mode for file-size safety.

var CaptionListModule = (function () {
  var MEDIA_NAME_PATTERN = /\.(mp4|webm|ogg|mov|mkv|avi|m4v|jpg|jpeg|png|gif|webp|bmp)$/i;
  var contextMenuEl = null;

  function hideContextMenu() {
    if (contextMenuEl) {
      contextMenuEl.style.display = 'none';
      contextMenuEl.innerHTML = '';
    }
  }

  function ensureContextMenu() {
    if (contextMenuEl) {
      return contextMenuEl;
    }

    contextMenuEl = document.createElement('div');
    contextMenuEl.className = 'caption-context-menu';
    contextMenuEl.style.display = 'none';
    document.body.appendChild(contextMenuEl);

    document.addEventListener('click', hideContextMenu);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        hideContextMenu();
      }
    });
    window.addEventListener('scroll', hideContextMenu, true);

    return contextMenuEl;
  }

  function showContextMenu(clientX, clientY, actions) {
    var el = ensureContextMenu();
    el.innerHTML = '';
    actions.forEach(function (action) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'caption-context-menu-item';
      btn.textContent = action.label;
      btn.onclick = function (ev) {
        ev.stopPropagation();
        hideContextMenu();
        action.run();
      };
      el.appendChild(btn);
    });

    el.style.display = 'block';
    el.style.left = clientX + 'px';
    el.style.top = clientY + 'px';

    var rect = el.getBoundingClientRect();
    var left = clientX;
    var top = clientY;
    if (rect.right > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (rect.bottom > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - rect.height - 8);
    }
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  function promptRenameMedia(mediaItem, ui, state, deps) {
    var oldFile = mediaItem.fileName;
    var input = window.prompt('Rename file', oldFile);
    if (input === null) {
      return;
    }
    var newFile = String(input || '').trim();
    if (!newFile || newFile === oldFile) {
      return;
    }
    if (newFile === '.' || newFile === '..' || newFile.indexOf('/') !== -1 || newFile.indexOf('\\') !== -1) {
      setStatus(ui, 'Invalid filename');
      return;
    }
    if (newFile.indexOf('.') === -1) {
      var dot = oldFile.lastIndexOf('.');
      if (dot > -1) {
        newFile += oldFile.slice(dot);
      }
    }
    if (!MEDIA_NAME_PATTERN.test(newFile)) {
      setStatus(ui, 'Unsupported media file type');
      return;
    }

    renamePickerMedia(mediaItem, oldFile, newFile).then(function () {
      setStatus(ui, 'Renamed: ' + oldFile + ' -> ' + newFile);
      deps.refreshCurrentDirectory(ui, state);
    }).catch(function (err) {
      setStatus(ui, (err && err.message) ? err.message : ('Rename failed: ' + err));
    });
  }

  function getOriginalNameFromTrashName(name) {
    return CaptionTrashOps.getOriginalNameFromTrashName(name);
  }

  async function renamePickerMedia(mediaItem, oldFile, newFile) {
    var dirHandle = mediaItem.dirHandle;

    try {
      await dirHandle.getFileHandle(newFile);
      throw new Error('Target media filename already exists');
    } catch (err) {
      if (!err || err.name !== 'NotFoundError') {
        throw err;
      }
    }

    // Keep a single-undo copy of original media+caption before mutating names.
    await CaptionTrashOps.backupOriginalPair(dirHandle, mediaItem, oldFile);

    var oldFileObj = await mediaItem.fileHandle.getFile();
    var newMediaHandle = await dirHandle.getFileHandle(newFile, { create: true });
    var mediaWriter = await newMediaHandle.createWritable();
    await mediaWriter.write(await oldFileObj.arrayBuffer());
    await mediaWriter.close();
    await dirHandle.removeEntry(oldFile);

    var oldCaption = oldFile.replace(/\.[^.]+$/, '.txt');
    var newCaption = newFile.replace(/\.[^.]+$/, '.txt');
    if (oldCaption === newCaption) {
      return;
    }

    try {
      var oldCaptionHandle = await dirHandle.getFileHandle(oldCaption);

      try {
        await dirHandle.getFileHandle(newCaption);
        throw new Error('Target caption filename already exists');
      } catch (err2) {
        if (!err2 || err2.name !== 'NotFoundError') {
          throw err2;
        }
      }

      var oldCaptionFile = await oldCaptionHandle.getFile();
      var newCaptionHandle = await dirHandle.getFileHandle(newCaption, { create: true });
      var captionWriter = await newCaptionHandle.createWritable();
      await captionWriter.write(await oldCaptionFile.text());
      await captionWriter.close();
      await dirHandle.removeEntry(oldCaption);
    } catch (err3) {
      if (!err3 || err3.name !== 'NotFoundError') {
        throw err3;
      }
    }
  }

  async function prunePickerMedia(mediaItem) {
    return CaptionTrashOps.prunePickerMedia(mediaItem);
  }

  async function restorePickerMedia(mediaItem, targetDirHandle) {
    return CaptionTrashOps.restorePickerMedia(mediaItem, targetDirHandle);
  }

  // Update renderFileList to handle .toml files list without navigation
  async function renderFileList(ui, state, filterText, token, filterToken, deps) {
    var q = (filterText || '').toLowerCase();
    var renderSeq = ++state.listRenderSeq;
    ui.pageListEl.innerHTML = '';
    var mediaItems = state.items;
    if (state.focusSet && state.focusSet.keys && state.focusSet.keys.length) {
      var allow = {};
      state.focusSet.keys.forEach(function (key) {
        allow[key] = true;
      });
      mediaItems = state.items.filter(function (item) {
        return !!allow[item.key];
      });
    }
    var countDiv = document.getElementById('caption-filter-count');
    if (!countDiv) {
      countDiv = document.createElement('div');
      countDiv.id = 'caption-filter-count';
      countDiv.style = 'font-size:13px;color:#888;margin-bottom:4px;';
      ui.pageListEl.parentNode.insertBefore(countDiv, ui.pageListEl);
    }

    var matchCount = 0;

    // Add 'Up One Directory' item if possible.
    var canGoUp = state.dirStack.length > 1;

    if (canGoUp) {
      var upRow = document.createElement('div');
      upRow.className = 'page-item folder-item';
      upRow.innerHTML = '<div>⬆ Up One Directory</div>';
      upRow.onclick = function () {
        deps.navigateUp(ui, state);
      };
      ui.pageListEl.appendChild(upRow);
      matchCount++;
    }

    state.childFolders.forEach(function (folderItem) {
      var label = '📁 ' + folderItem.name;
      if (q && label.toLowerCase().indexOf(q) === -1) {
        return;
      }
      var row = document.createElement('div');
      row.className = 'page-item folder-item';
      row.innerHTML = '<div>' + escapeHtml(label) + '</div>';
      row.ondblclick = function () {
        state.dirStack.push(folderItem.handle);
        Promise.all([
          deps.refreshPickerDirectory(ui, state),
          refreshConfigFiles(ui, state)
        ]).catch(function (err) {
          setStatus(ui, String(err && err.message ? err.message : err));
        });
      };
      row.onclick = function () {
        setStatus(ui, 'Double-click folder to enter: ' + folderItem.name);
      };
      ui.pageListEl.appendChild(row);
      matchCount++;
    });

    // Populate the .toml files list from the current directory using state.configItems
    var tomlList = document.getElementById('toml-files-list');
    if (tomlList) {
      tomlList.innerHTML = '';
      var tomlFiles = (state.configItems && state.configItems.length) ? state.configItems : [];
      if (tomlFiles.length === 0) {
        var emptyMessage = document.createElement('div');
        emptyMessage.className = 'empty-message';
        emptyMessage.innerText = 'No .toml files found in this directory.';
        tomlList.appendChild(emptyMessage);
      } else {
        tomlFiles.forEach(function (tomlItem) {
          var row = document.createElement('div');
          row.className = 'page-item';
          row.innerHTML = '<div>' + escapeHtml(tomlItem.fileName) + '</div>';
          row.onclick = function () {
            setStatus(ui, 'Editing: ' + tomlItem.fileName);
            window.loadTomlFile(ui, state, tomlItem);
          };
          tomlList.appendChild(row);
        });
      }
    }

    function attachMediaRow(mediaItem, captionText) {
      var row = document.createElement('div');
      var isActive = state.currentItem && state.currentItem.key === mediaItem.key;
      var emptyCaption = (captionText !== null && captionText !== undefined) && !(captionText || '').trim();
      var reviewed = state.reviewedSet.has(mediaItem.key);
      row.className = 'page-item' + (isActive ? ' active' : '') + (emptyCaption ? ' empty-caption' : '') + (reviewed ? ' reviewed' : '');
      row.setAttribute('data-key', mediaItem.key);

      row.innerHTML = '<div>' + escapeHtml(mediaItem.label) + '</div>';

      row.onclick = function (e) {
        if (state.currentItem && state.currentItem.key === mediaItem.key) {
          return;
        }
        if (state.reviewMode) {
          deps.selectMedia(ui, state, mediaItem).catch(function (err) {
            setStatus(ui, String(err && err.message ? err.message : err));
          });
          return;
        }
        deps.saveCurrentCaption(ui, state).then(function () {
          return deps.selectMedia(ui, state, mediaItem);
        }).catch(function (err) {
          setStatus(ui, String(err && err.message ? err.message : err));
        });
      };

      row.oncontextmenu = function (e) {
        e.preventDefault();
        e.stopPropagation();
        var inTrashFolder = state.dirStack.length > 1 && state.dirStack[state.dirStack.length - 1].name === '.caption_trash';
        var canRestore = inTrashFolder && !!getOriginalNameFromTrashName(mediaItem.fileName);
        showContextMenu(e.clientX, e.clientY, [
          {
            label: 'Rename',
            run: function () {
              promptRenameMedia(mediaItem, ui, state, deps);
            }
          },
          {
            label: canRestore ? 'Restore' : 'Prune',
            run: function () {
              var op = canRestore ? deps.restoreMedia : deps.pruneMedia;
              op(ui, state, mediaItem).catch(function (err) {
                setStatus(ui, String(err && err.message ? err.message : err));
              });
            }
          }
        ]);
      };

      row.ondblclick = function (e) {
        // Toggle reviewed state on double-click.
        if (state.reviewedSet.has(mediaItem.key)) {
          state.reviewedSet.delete(mediaItem.key);
        } else {
          state.reviewedSet.add(mediaItem.key);
        }
        if (deps.onReviewedSetChanged) {
          deps.onReviewedSetChanged();
        }
        deps.renderFileList(ui, state, ui.filterEl.value);
        e.stopPropagation();
      };

      ui.pageListEl.appendChild(row);
      matchCount++;
    }

    if (!q) {
      mediaItems.forEach(function (mediaItem) {
        attachMediaRow(mediaItem, null);
      });
      countDiv.textContent = matchCount + ' item' + (matchCount === 1 ? '' : 's') + ' match filter';

      mediaItems.forEach(function (mediaItem) {
        CaptionOps.loadCaptionTextForItem(state, mediaItem).then(function (captionText) {
          if (renderSeq !== state.listRenderSeq) {
            return;
          }
          var row = null;
          var rows = ui.pageListEl.querySelectorAll('.page-item[data-key]');
          for (var i = 0; i < rows.length; i += 1) {
            if (rows[i].getAttribute('data-key') === mediaItem.key) {
              row = rows[i];
              break;
            }
          }
          if (!row) {
            return;
          }
          if (!(captionText || '').trim()) {
            row.classList.add('empty-caption');
          } else {
            row.classList.remove('empty-caption');
          }
        });
      });
      return;
    }

    var captionPromises = mediaItems.map(function (mediaItem) {
      return CaptionOps.loadCaptionTextForItem(state, mediaItem).then(function (captionText) {
        return { mediaItem: mediaItem, captionText: captionText || '' };
      });
    });

    Promise.all(captionPromises).then(function (results) {
      if (renderSeq !== state.listRenderSeq) {
        return;
      }
      if (filterToken && token !== undefined && token !== filterToken.current) {
        return;
      }

      results.forEach(function (entry) {
        var mediaItem = entry.mediaItem;
        var captionText = entry.captionText;
        var lower = mediaItem.label.toLowerCase();
        if (lower.indexOf(q) === -1 && captionText.toLowerCase().indexOf(q) === -1) {
          return;
        }
        attachMediaRow(mediaItem, captionText);
      });

      countDiv.textContent = matchCount + ' item' + (matchCount === 1 ? '' : 's') + ' match filter';
    });
  }

  // Add logic to populate the .toml files panel dynamically
  function populateTomlFilesPanel(ui, state) {
    // Hide config file list: do nothing
    // (Autocreation logic remains active elsewhere)
  }

  window.populateTomlFilesPanel = populateTomlFilesPanel;

  // Update refreshPickerDirectory to call populateTomlFilesPanel
  async function refreshPickerDirectory(ui, state, deps) {
    await deps.refreshPickerDirectory(ui, state);
  }

  // Update navigateUp to call populateTomlFilesPanel
  function navigateUp(ui, state, deps) {
    if (state.dirStack.length > 1) {
      state.dirStack.pop();
      Promise.all([
        deps.refreshPickerDirectory(ui, state),
        refreshConfigFiles(ui, state)
      ]).catch(function (err) {
        setStatus(ui, String(err && err.message ? err.message : err));
      });
    }
  }

  return {
    renderFileList: renderFileList,
    prunePickerMedia: prunePickerMedia,
    restorePickerMedia: restorePickerMedia
  };
})();




// caption_review.js
// Review/stats bridge for caption mode.

var CaptionReviewModule = (function() {
  function init(ui, state, deps) {
    wireReviewActions(ui, state, deps);
  }

  function wireReviewActions(ui, state, deps) {
    var reviewBtn = document.getElementById('review-captions-btn');
    if (reviewBtn) {
      reviewBtn.onclick = function() {
        runReview(ui, state, deps);
      };
    }

    var runBtn = document.getElementById('stats-run-btn');
    if (runBtn) {
      runBtn.onclick = function() {
        runReview(ui, state, deps);
      };
    }

    window.addEventListener('message', function(event) {
      var data = event.data;
      if (!data) {
        return;
      }
      if (data.type === 'caption-review-select') {
        selectByFileName(ui, state, data.fileName, deps, data.focusFiles, data.focusSource);
        return;
      }
      if (data.type === 'caption-review-token') {
        applyTokenFilter(ui, data.token, deps);
      }
    });
  }

  function runReview(ui, state, deps) {
    if (!state.items.length) {
      deps.setStatus(ui, 'No media files loaded');
      return;
    }

    deps.saveCurrentCaption(ui, state).then(function() {
      if (deps.clearFocusSet) {
        deps.clearFocusSet(ui, state);
      }
      deps.setReviewMode(ui, state, true);
      state.currentItem = null;
      deps.renderFileList(ui, state, ui.filterEl.value);
      var details = document.getElementById('stats-details');
      if (details) {
        details.open = true;
      }

      var runSeq = (state.reviewSeq || 0) + 1;
      state.reviewSeq = runSeq;
      deps.setStatus(ui, 'Building combined captions and stats...');

      var promises = state.items.map(function(item) {
        return CaptionOps.loadCaptionTextForItem(state, item).then(function(text) {
          return {
            fileName: item.fileName,
            caption: text || ''
          };
        });
      });

      return Promise.all(promises).then(function(results) {
        if (state.reviewSeq !== runSeq) {
          return;
        }
        var options = StatsViewModule.getOptionsFromDom();
        var report = StatsEngineModule.compute(results, {
          requiredPhrase: options.requiredPhrase,
          phrases: options.phrases,
          tokenRules: options.tokenRules
        });
        state.suppressInput = true;
        ui.editorEl.value = StatsViewModule.buildCombinedCaptionsText(results);
        state.suppressInput = false;
        StatsViewModule.renderReportPreview(ui, report);
        deps.setStatus(ui, 'Review ready: ' + results.length + ' files');
      });
    }).catch(function(err) {
      deps.setStatus(ui, String(err && err.message ? err.message : err));
    });
  }

  function selectByFileName(ui, state, fileName, deps, focusFiles, focusSource) {
    if (!fileName) {
      return;
    }

    if (deps.activateFocusSet && focusFiles && focusFiles.length) {
      deps.activateFocusSet(ui, state, focusFiles, focusSource || 'Focused Items');
    }

    var target = null;
    for (var i = 0; i < state.items.length; i += 1) {
      if (state.items[i].fileName === fileName) {
        target = state.items[i];
        break;
      }
    }
    if (!target) {
      deps.setStatus(ui, 'File not found in current folder: ' + fileName);
      return;
    }

    if (ui.filterEl.value) {
      ui.filterEl.value = '';
      ui.filterEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    deps.selectMedia(ui, state, target).then(function() {
      scrollToCurrentRow(ui, state);
    }).catch(function(err) {
      deps.setStatus(ui, String(err && err.message ? err.message : err));
    });
  }

  function applyTokenFilter(ui, token, deps) {
    var value = String(token || '').trim();
    ui.filterEl.value = value;
    var ev = new Event('input', { bubbles: true });
    ui.filterEl.dispatchEvent(ev);
    if (value) {
      deps.setStatus(ui, 'Filter applied from token: ' + value);
    }
  }

  function scrollToCurrentRow(ui, state) {
    if (!state.currentItem) {
      return;
    }
    var row = ui.pageListEl.querySelector('.page-item[data-key="' + state.currentItem.key + '"]');
    if (!row || !row.scrollIntoView) {
      return;
    }
    row.scrollIntoView({ block: 'nearest' });
  }

  return {
    init: init
  };
})();