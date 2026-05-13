// Hide checklist panel and clear current media selection
function clearEditorAndPreview() {
  if (ui && ui.editorEl) {
    ui.editorEl.value = '';
  }
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = '';
  }
  if (ui && ui.previewEl) {
    var doc = ui.previewEl.contentDocument || ui.previewEl.contentdocument;
    if (doc) {
      doc.open();
      doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:system-ui;padding:1rem;color:#666;">No media to preview.</body></html>');
      doc.close();
    }
  }
  var checklistPanelEl = document.getElementById('caption-checklist-panel');
  if (checklistPanelEl) checklistPanelEl.style.display = 'none';
  state.currentItem = null;
}

function clearSelection() {
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = '';
  }
  state.currentItem = null;
  state.currentConfigFile = null;
  renderFileList(ui.filterEl.value);
}

function createFlagAction(itemKey) {
  function flagRowRenderer(color) {
    markFlag(itemKey, color);
  }

  return {
    label: 'Flag',
    render: flagRowRenderer
  };
}

function runAutosetForCurrentFolder() {
  if (!state.folder) {
    setStatus('No folder selected for autoset.');
    return;
  }
  setStatus('Running legacy autoset...');
  streamPreviewFromFetch(
    '/fs/autoset_run',
    { folder: state.folder },
    ui,
    function () {
      setStatus('Legacy autoset finished.');
    },
    function (err) {
      setStatus('Autoset failed: ' + err);
    }
  );
}

function runPrepareDatasetForCurrentFolder() {
  if (!state.folder) {
    setStatus('No folder selected for dataset preparation.');
    return;
  }
  state.currentConfigFile = null;
  state.currentItem = null;
  clearEditorAndPreview();
  renderChecklistPanel();
  renderFileList(ui.filterEl.value);
  setStatus('Preparing dataset...');
  streamPreviewFromFetch(
    '/fs/prepare_dataset',
    { folder: state.folder },
    ui,
    function () {
      setStatus('Dataset preparation finished.');
      refreshTrainingConfigList();
    },
    function (err) {
      setStatus('Dataset preparation failed: ' + err);
    }
  );
}

function isEditableElement(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  var tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

function moveSelectedMediaByOffset(offset) {
  if (!offset || !state.currentItem || !state.currentItem.fileName || !ui.mediaListEl) {
    return false;
  }
  var rows = Array.prototype.slice.call(
    ui.mediaListEl.querySelectorAll('.media-item[data-type="media"]')
  );
  if (!rows.length) {
    return false;
  }
  var currentKey = state.currentItem.key;
  var idx = rows.findIndex(function (row) {
    return row.getAttribute('data-key') === currentKey;
  });
  if (idx === -1) {
    return false;
  }
  var nextIdx = idx + offset;
  if (nextIdx < 0 || nextIdx >= rows.length) {
    return false;
  }
  var nextKey = rows[nextIdx].getAttribute('data-key');
  if (!nextKey || nextKey === currentKey) {
    return false;
  }
  var nextItem = state.items.find(function (item) {
    return item && item.key === nextKey;
  });
  if (!nextItem) {
    return false;
  }

  var goNext = function () {
    selectPathMedia(nextItem).catch(function (err) {
      setStatus(String(err && err.message ? err.message : err));
    });
  };
  if (state.currentItem && state.currentItem.fileName) {
    savePathCaption().then(goNext).catch(function (err) {
      setStatus(String(err && err.message ? err.message : err));
    });
  } else {
    goNext();
  }
  return true;
}

var sidebarActiveTab = 'review';

function setSidebarTab(tabName) {
  var tabs = {
    config: { buttonId: 'sidebar-tab-config-btn', paneId: 'primer-details' },
    review: { buttonId: 'sidebar-tab-review-btn', paneId: 'cation-review' },
    train: { buttonId: 'sidebar-tab-train-btn', paneId: 'training-details' }
  };
  var activeName = tabs[tabName] ? tabName : 'review';
  sidebarActiveTab = activeName;

  Object.keys(tabs).forEach(function (name) {
    var tab = tabs[name];
    var btn = document.getElementById(tab.buttonId);
    var pane = document.getElementById(tab.paneId);
    var active = name === activeName;
    if (btn) {
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    }
    if (pane) {
      pane.classList.toggle('hidden', !active);
      pane.setAttribute('aria-hidden', active ? 'false' : 'true');
    }
  });
}

function wireSidebarTabs() {
  var buttons = document.querySelectorAll('[data-sidebar-tab]');
  if (!buttons.length) return;
  Array.prototype.forEach.call(buttons, function (btn) {
    btn.onclick = function () {
      setSidebarTab(btn.getAttribute('data-sidebar-tab'));
    };
  });
  setSidebarTab(sidebarActiveTab);
}

function wireAllUi() {
  // Autosaving of primer/stats changes (debounced)
  wireStatsPrimerAutoSave();

  // Ignore CTRL+S/CMD+S in caption editor (prevent browser save)
  ui.editorEl.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      // Optionally, show a tooltip or status message here if desired
      setStatus('Caption saved.');
    }
  });
  // Wire up review actions (if stats.js is loaded)
  wireReviewActions();
  // Run Report Button
  ui.reviewBtn.onclick = function () {
    runReview();
  };
  
  // Wire up CTRL+S/CMD+S to new save logic
  ui.editorEl.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      saveCurrentEditorContent();
    }
  });

  checklistPanelEl = document.getElementById('caption-checklist-panel');
  setChecklistPanelVisible(false);
  wireCaptionHelpersUi();
  wireItemDetailsUi();
  wireSidebarTabs();
  if (typeof wireAppSettingsUi === 'function') {
    wireAppSettingsUi();
  }
  var addInput = document.getElementById('checklist-add-input');
  var addBtn = document.getElementById('checklist-add-btn');
  if (addBtn && addInput) {
    addBtn.onclick = function() {
      var val = addInput.value.trim();
      if (!val || checklistItems.indexOf(val) !== -1) return;
      checklistItems.push(val);
      checklistItems.sort(checklistSort);
      for (var k in checklistCheckedByMedia) {
        if (checklistCheckedByMedia[k]) checklistCheckedByMedia[k][val] = false;
      }
      syncReviewedFromChecklistAll();
      saveChecklistToFolderState();
      renderChecklistPanel();
      addInput.value = '';
    };
    addInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') addBtn.onclick();
    });
  }

  var closeBtn = document.getElementById('checklist-close-btn');
  if (closeBtn) {
    closeBtn.onclick = function() {
      checklistPanelEl.style.display = 'none';
    };
  }

  ui.editorEl.addEventListener('input', handleEditorInputAutosave);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'F2' && document.activeElement !== ui.editorEl && state.currentItem) {
      var inOriginals = state.folder && state.folder.split(/[\/]/).pop() === 'originals';
      if (!inOriginals) {
        e.preventDefault();
        promptRenameMedia(state.currentItem);
      }
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (!state.currentItem || !state.currentItem.fileName) return;
    if (isEditableElement(document.activeElement)) return;
    var handled = moveSelectedMediaByOffset(e.key === 'ArrowUp' ? -1 : 1);
    if (handled) {
      e.preventDefault();
    }
  });

  // (Removed redundant/broken config autosave handler; handled by handleEditorInputAutosave)
  // Current folder row context menu handler
  if (ui.currentFolderRow) {
    ui.currentFolderRow.oncontextmenu = function (e) {
      e.preventDefault();
      var actions = [
        {
          label: 'Run Autoset (Legacy)',
          run: function () {
            runAutosetForCurrentFolder();
          }
        },
        {
          label: 'Generate Dataset Configs',
          run: function () {
            state.currentConfigFile = null;
            state.currentItem = null;
            clearEditorAndPreview();
            renderChecklistPanel();
            renderFileList(ui.filterEl.value);
            setStatus('Generating dataset configs...');
            streamPreviewFromFetch(
              '/fs/generate_dataset_config',
              { folder: state.folder },
              ui,
              function () {
                setStatus('Dataset configs generated.');
              },
              function (err) {
                setStatus('Dataset config generation failed: ' + err);
              }
            );
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
      showContextMenu(e.clientX, e.clientY, actions);
    };
  }
  // Media List double-click handler for toggling reviewed state
  if (ui.mediaListEl) {
    ui.mediaListEl.ondblclick = function (e) {
      var row = e.target.closest('.media-item');
      if (!row) return;
      var type = row.getAttribute('data-type');
      var key = row.getAttribute('data-key');
      if (type === 'media') {
        var mediaItem = state.items.find(function (item) { return item.key === key; });
        if (!mediaItem) return;
        if (state.reviewedSet.has(mediaItem.key)) {
          state.reviewedSet.delete(mediaItem.key);
          row.classList.remove('reviewed');
        } else {
          state.reviewedSet.add(mediaItem.key);
          row.classList.add('reviewed');
        }
        saveFolderStateForCurrentRoot();
      }
    };
  }
  // Refresh button
  if (ui.refreshBtn) {
    ui.refreshBtn.onclick = function () {
      refreshCurrentDirectory();
    };
  }

  // Review Captions button
  if (ui.reviewBtn) {
    ui.reviewBtn.onclick = function () {
      runReview();
    };
  }

  var trainingGenerateBtn = document.getElementById('training-generate-btn');
  if (trainingGenerateBtn) {
    trainingGenerateBtn.onclick = function () {
      if (!state.folder) {
        setStatus('No folder selected for config generation.');
        return;
      }
      state.currentConfigFile = null;
      state.currentItem = null;
      clearEditorAndPreview();
      renderChecklistPanel();
      renderFileList(ui.filterEl.value);
      setStatus('Generating dataset configs...');
      streamPreviewFromFetch(
        '/fs/generate_dataset_config',
        { folder: state.folder },
        ui,
        function () {
          refreshTrainingConfigList();
          if (state.currentConfigFile) {
            ui.editorEl.value = '';
            setStatus('Dataset configs generated. Please reload the config file to see changes.');
            state.currentConfigFile = null;
          } else {
            setStatus('Dataset configs generated.');
          }
        },
        function (err) {
          setStatus('Dataset config generation failed: ' + err);
        }
      );
    };
  }

  var trainingPrepareDatasetBtn = document.getElementById('training-prepare-dataset-btn');
  if (trainingPrepareDatasetBtn) {
    trainingPrepareDatasetBtn.onclick = function () {
      runPrepareDatasetForCurrentFolder();
    };
  }

  var trainingTrainBtn = document.getElementById('training-train-btn');
  if (trainingTrainBtn) {
    trainingTrainBtn.onclick = function () {
      if (!state.folder) {
        setStatus('No folder selected for training.');
        return;
      }
      setStatus('Printing training commands...');
      streamPreviewFromFetch(
        '/fs/train_run',
        { folder: state.folder },
        ui,
        function () {
          setStatus('Training command preview finished.');
        },
        function (err) {
          setStatus('Training command preview failed: ' + err);
        }
      );
    };
  }

  // Up One Directory button
  if (ui.upRow) {
    ui.upRow.onclick = function () {
      navigateUp();
    };
  }

  // Media List click handler
  if (ui.mediaListEl) {
    ui.mediaListEl.onclick = function (e) {
      var row = e.target.closest('.media-item');
      if (!row) return;
      var type = row.getAttribute('data-type');
      var key = row.getAttribute('data-key');
      if (type === 'up') {
        navigateUp();
      } else if (type === 'folder') {
        state.folder = (state.folder ? state.folder + '/' : '') + key;
        if (state.dirStack.length) {
          state.dirStack.push({ name: key });
        }
        state.currentItem = null;
        clearEditorAndPreview();
        refreshCurrentDirectory();
      } else if (type === 'media') {
        var mediaItem = state.items.find(function (item) { return item.key === key; });
        if (!mediaItem) return;
        if (state.currentItem && state.currentItem.key === mediaItem.key) return;
        if (state.currentItem && state.currentItem.fileName) {
          savePathCaption().then(function () {
            selectPathMedia(mediaItem);
          }).catch(function (err) {
            setStatus(String(err && err.message ? err.message : err));
          });
        } else {
          selectPathMedia(mediaItem);
        }
      }
    };

    var ctBtn = document.getElementById('console-toggle-btn');
    ctBtn.onclick = function() {
      toggleConsolePanel();
      // Change arrow direction
      ctBtn.innerHTML = (ui.consolePanelEl.style.display === 'none' || !ui.consolePanelEl.style.display) ? '&#x25B2;' : '&#x25BC;';
    };

    // Media List context menu handler (moved from media_list.js)
    ui.mediaListEl.oncontextmenu = function (e) {
      var row = e.target.closest('.media-item');
      if (!row) return;
      var type = row.getAttribute('data-type');
      var key = row.getAttribute('data-key');
      e.preventDefault();
      if (type === 'folder') {
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
              // Compute parent path (without trailing slash, never including the folder itself)
              var parentPath = state.folder ? state.folder.replace(/\/+$/, '') : '';
              // If in root, parentPath is ''
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
              var folderPath = (state.folder ? state.folder + '/' : '') + key;
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
            fetch('/fs/open_in_explorer', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: (state.folder ? state.folder + '/' : '') + key })
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
        });
        showContextMenu(e.clientX, e.clientY, actions);
      } else if (type === 'media') {
        var mediaItem = state.items.find(function (item) { return item.key === key; });
        if (!mediaItem) return;
        var actions = [];
        var isInOriginals = (state.folder && state.folder.split(/[\/]/).pop() === 'originals');
        var fileName = mediaItem.fileName;
        // Add flagging for files
        actions.push(createFlagAction(key));
        actions.push({
          label: 'Open in Explorer',
          run: function () {
            fetch('/fs/open_in_explorer', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: (state.folder ? state.folder + '/' : '') + key })
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
        });
        if (isInOriginals) {
          actions.push({
            label: 'Restore',
            run: function () {
              restoreMediaItem(mediaItem);
            }
          });
        } else {
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
                var filePath = (state.folder ? state.folder + '/' : '') + mediaItem.fileName;
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
        }
        showContextMenu(e.clientX, e.clientY, actions);
      }
    };
  }

  // Focus Set Exit button
  if (ui.focusSetExitBtn) {
    ui.focusSetExitBtn.onclick = function () {
      state.focusSet = null;
      if (ui.editorEl) ui.editorEl.removeAttribute('readonly');
      clearEditorAndPreview();
      refreshCurrentDirectory();
      ui.focusSetExitBtn.style.display = 'none';
    };
  }

  // Stats Run button
  if (ui.statsRunBtn) {
    ui.statsRunBtn.onclick = function () {
      runReview();
    };
  }
  document.querySelectorAll(".fail-link").forEach(function(btn){
      btn.addEventListener("click",function(){
          var f=btn.getAttribute("data-file")||"";
          var focus=btn.getAttribute("data-focus")||"";
          var source=btn.getAttribute("data-source")||"";
          var files=[];
          if(focus){files=decodeURIComponent(focus).split("\n").filter(Boolean);}
          if(parent&&parent.postMessage){
              parent.postMessage({
                  type:"caption-review-select",
                  fileName:decodeURIComponent(f),
                  focusFiles:files,
                  focusSource:decodeURIComponent(source||"")
              },"*");
          }
      });
  });
  document.querySelectorAll(".token-link").forEach(function(btn){
      btn.addEventListener("click",function(){
          var t=btn.getAttribute("data-token")||"";
          if(parent&&parent.postMessage){
              parent.postMessage({type:"caption-review-token",token:decodeURIComponent(t)},"*");
          }
      });
  });

}

addEventListener('DOMContentLoaded', function () {
  console.log('[webcap] initializing');
  refreshCurrentDirectory();
  wireAllUi();
});
