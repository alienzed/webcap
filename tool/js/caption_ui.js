// caption_ui.js
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
      deps.setStatus(ui, 'Invalid filename');
      return;
    }
    if (newFile.indexOf('.') === -1) {
      var dot = oldFile.lastIndexOf('.');
      if (dot > -1) {
        newFile += oldFile.slice(dot);
      }
    }
    if (!MEDIA_NAME_PATTERN.test(newFile)) {
      deps.setStatus(ui, 'Unsupported media file type');
      return;
    }
    // Backend rename: call deps.renameMedia
    deps.renameMedia(ui, state, mediaItem, oldFile, newFile).then(function () {
      deps.setStatus(ui, 'Renamed: ' + oldFile + ' -> ' + newFile);
      deps.refreshCurrentDirectory(ui, state);
    }).catch(function (err) {
      deps.setStatus(ui, (err && err.message) ? err.message : ('Rename failed: ' + err));
    });
  }

  function getOriginalNameFromTrashName(name) {
    return CaptionTrashOps.getOriginalNameFromTrashName(name);
  }

  // Backend-based rename/prune/restore
  // These are now just wrappers to deps
  async function renameMedia(ui, state, mediaItem, oldFile, newFile, deps) {
    return deps.renameMedia(ui, state, mediaItem, oldFile, newFile);
  }
  async function pruneMedia(ui, state, mediaItem, deps) {
    return deps.pruneMedia(ui, state, mediaItem);
  }
  async function restoreMedia(ui, state, mediaItem, deps) {
    return deps.restoreMedia(ui, state, mediaItem);
  }

  // Update renderFileList to handle .toml files list without navigation
  async function renderFileList(ui, state, filterText, token, filterToken, deps) {
    debugLog('[renderFileList] called. state.items:', state.items, 'state.childFolders:', state.childFolders, 'filterText:', filterText);
    if (window.DEBUG) {
      console.log('[webcap] renderFileList: state.childFolders:', state.childFolders);
    }
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
    // Always wire up the static Exit Set button after rendering
    CaptionListModule.ensureFocusSetExitButton(ui, state);

    var matchCount = 0;

    // Add 'Up One Directory' item if possible.
    var canGoUp = state.dirStack.length > 1;

    if (canGoUp) {
      var upRow = document.createElement('div');
      upRow.className = 'page-item folder-item';
      upRow.innerHTML = '<div>⬆ Up One Directory</div>';
      upRow.onclick = function () {
        if (deps && typeof deps.navigateUp === 'function') {
          deps.navigateUp(ui, state, deps);
        }
      };
      ui.pageListEl.appendChild(upRow);
      matchCount++;
    }

    if (window.DEBUG) {
      console.log('[webcap] renderFileList: rendering folders:', state.childFolders);
    }
    console.log('[webcap] renderFileList: rendering folders', state.childFolders);
    for (var i = 0; i < state.childFolders.length; ++i) {
      var folderItem = state.childFolders[i];
      var label = '📁 ' + folderItem.name;
      console.log('[webcap] renderFileList: rendering folder', folderItem);
      var row = document.createElement('div');
      row.className = 'page-item folder-item';
      row.innerHTML = '<div>' + escapeHtml(label) + '</div>';
      row.ondblclick = (function(folderName) {
        return function () {
          console.log('[webcap] renderFileList: folder double-click', folderName);
          state.folder = (state.folder ? state.folder + '/' : '') + folderName;
          if (state.dirStack && state.dirStack.length) {
            state.dirStack.push({ name: folderName });
          }
          if (deps && typeof deps.refreshCurrentDirectory === 'function') {
            deps.refreshCurrentDirectory(ui, state);
          }
        };
      })(folderItem.name);
      row.onclick = function () {
        setStatus(ui, 'Double-click folder to enter: ' + folderItem.name);
      };
      row.oncontextmenu = (function(folderItem) {
        return function(e) {
          e.preventDefault();
          e.stopPropagation();
          var protectedNames = ['originals', '.', '..'];
          var actions = [];
          if (protectedNames.indexOf(folderItem.name) === -1) {
            actions.push({
              label: 'Rename Folder',
              run: function() {
                var oldName = folderItem.name;
                var newName = window.prompt('Rename folder', oldName);
                if (newName === null) return;
                newName = String(newName || '').trim();
                if (!newName || newName === oldName || newName === '.' || newName === '..' || /[\\/]/.test(newName)) {
                  deps.setStatus(ui, 'Invalid folder name');
                  return;
                }
                var parent = state.folder || '';
                fetch('/fs/rename_folder', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ parent: parent, oldName: oldName, newName: newName })
                })
                  .then(function(resp) { return resp.json().then(function(data) { return {status: resp.status, data: data}; }); })
                  .then(function(res) {
                    if (res.status === 200 && res.data && res.data.ok) {
                      deps.setStatus(ui, 'Renamed folder: ' + oldName + ' -> ' + newName);
                      deps.refreshCurrentDirectory(ui, state);
                    } else {
                      deps.setStatus(ui, (res.data && res.data.error) ? res.data.error : 'Rename failed');
                    }
                  })
                  .catch(function(err) {
                    deps.setStatus(ui, 'Rename failed: ' + err);
                  });
              }
            });
          }
          if (actions.length > 0) {
            showContextMenu(e.clientX, e.clientY, actions);
          }
        };
      })(folderItem);
      ui.pageListEl.appendChild(row);
      matchCount++;
    }

    function attachMediaRow(mediaItem, captionText) {
      var row = document.createElement('div');
      var isActive = state.currentItem && state.currentItem.key === mediaItem.key;
      var emptyCaption = (captionText !== null && captionText !== undefined) && !(captionText || '').trim();
      var reviewed = state.reviewedSet.has(mediaItem.key);
      row.className = 'page-item' + (isActive ? ' active' : '') + (emptyCaption ? ' empty-caption' : '') + (reviewed ? ' reviewed' : '');
      row.setAttribute('data-key', mediaItem.key);

      // Show primer/template content as preview if caption is missing
      var displayText = mediaItem.label;
      if (emptyCaption && typeof window.buildAutoPrimer === 'function') {
        var primerText = window.buildAutoPrimer(mediaItem.fileName);
        if (primerText && primerText.trim()) {
          displayText += ' <span style="color:#888;font-style:italic;">[primer]</span>';
        }
      }
      row.innerHTML = '<div>' + escapeHtml(displayText) + '</div>';

      row.onclick = function (e) {
        if (state.currentItem && state.currentItem.key === mediaItem.key) {
          return;
        }
        if (state.reviewMode) {
          // Exit review mode and restore editability
          if (typeof window.setReviewMode === 'function') {
            window.setReviewMode(ui, state, false);
          }
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
        showContextMenu(e.clientX, e.clientY, [
          {
            label: 'Rename',
            run: function () {
              promptRenameMedia(mediaItem, ui, state, deps);
            }
          },
          {
            label: 'Prune',
            run: function () {
              deps.pruneMedia(ui, state, mediaItem).catch(function (err) {
                deps.setStatus(ui, String(err && err.message ? err.message : err));
              });
            }
          },
          {
            label: 'Restore',
            run: function () {
              deps.restoreMedia(ui, state, mediaItem).catch(function (err) {
                deps.setStatus(ui, String(err && err.message ? err.message : err));
              });
            }
          },
          {
            label: 'Reset',
            run: function () {
              if (deps && typeof deps.resetMedia === 'function') {
                deps.resetMedia(ui, state, mediaItem).catch(function (err) {
                  deps.setStatus(ui, String(err && err.message ? err.message : err));
                });
              } else {
                setStatus(ui, 'Reset not available');
              }
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

  // Backend-based navigation up
  function navigateUp(ui, state, deps) {
    if (!state.dirStack || state.dirStack.length <= 1) {
      if (deps && typeof deps.setStatus === 'function') {
        deps.setStatus(ui, 'Already at selected root folder');
      }
      return;
    }
    state.dirStack.pop();
    // Rebuild state.folder from dirStack (excluding root)
    var folder = state.dirStack.slice(1).map(function(entry) { return entry.name; }).join('/');
    state.folder = folder;
    if (deps && typeof deps.refreshCurrentDirectory === 'function') {
      deps.refreshCurrentDirectory(ui, state);
    }
  }

  // Focus set UI logic moved from caption_mode.js
  // Wire up the static Exit Set button below the media list
  function ensureFocusSetExitButton(ui, state) {
    var exitBtn = document.getElementById('focus-set-exit-btn');
    if (!exitBtn) return;
    if (!exitBtn.__focusSetBound) {
      exitBtn.__focusSetBound = true;
      exitBtn.onclick = function() {
        // Clear focus set and reload full directory
        state.focusSet = null;
        if (typeof window.refreshCurrentDirectory === 'function') {
          window.refreshCurrentDirectory(ui, state);
        } else if (ui && ui.refreshCurrentDirectory) {
          ui.refreshCurrentDirectory(ui, state);
        }
        // Hide the button (will be handled by refreshFocusSetUi too)
        exitBtn.style.display = 'none';
      };
    }
    return exitBtn;
  }

  function refreshFocusSetUi(ui, state) {
    var btn = document.getElementById('focus-set-exit-btn');
    if (!btn) return;
    if (state.focusSet && state.focusSet.keys && state.focusSet.keys.length) {
      btn.style.display = '';
      var source = state.focusSet.source ? (' - ' + state.focusSet.source) : '';
      btn.title = 'Show full folder list' + source;
    } else {
      btn.style.display = 'none';
      btn.title = 'Show full folder list';
    }
  }

  function clearFocusSet(ui, state, rerender) {
    state.focusSet = null;
    if (rerender) {
      if (typeof window.refreshCurrentDirectory === 'function') {
        window.refreshCurrentDirectory(ui, state);
      } else if (ui && ui.refreshCurrentDirectory) {
        ui.refreshCurrentDirectory(ui, state);
      } else {
        CaptionListModule.renderFileList(ui, state, ui.filterEl.value);
      }
    }
  }

  function activateFocusSet(ui, state, fileNames, source) {
    var seen = {};
    var keys = [];
    var names = (fileNames || []).map(function(name) { return String(name || ''); }).filter(Boolean);
    names.forEach(function(fileName) {
        for (var i = 0; i < state.items.length; i += 1) {
            var item = state.items[i];
            if (item.fileName !== fileName) {
                continue;
            }
            if (!seen[item.fileName]) {
                keys.push(item.fileName);
                seen[item.fileName] = true;
            }
        }
    });

    if (!keys.length) {
        CaptionListModule.clearFocusSet(ui, state, true);
        return;
    }

    state.focusSet = {
        keys: keys,
        source: String(source || '')
    };
    CaptionListModule.renderFileList(ui, state, ui.filterEl.value);
  }

  return {
    renderFileList: renderFileList,
    renameMedia: renameMedia,
    pruneMedia: pruneMedia,
    restoreMedia: restoreMedia,
    navigateUp: navigateUp,
    ensureFocusSetExitButton: ensureFocusSetExitButton,
    refreshFocusSetUi: refreshFocusSetUi,
    clearFocusSet: clearFocusSet,
    activateFocusSet: activateFocusSet
  };
})();


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