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

  // Autosave config files as you type (not for captions)
  ui.editorEl.addEventListener('input', function() {
    if (state.currentConfigFile) {
      debouncedConfigAutosave();
    }
  });
  // Current folder row context menu handler
  if (ui.currentFolderRow) {
    ui.currentFolderRow.oncontextmenu = function (e) {
      e.preventDefault();
      var actions = [
        {
          label: 'Run Autoset',
          run: function () {
            setStatus('Running autoset...');
            streamPreviewFromFetch(
              '/fs/autoset_run',
              { folder: state.folder },
              ui,
              function () {
                setStatus('Autoset finished.');
              },
              function (err) {
                setStatus('Autoset failed: ' + err);
              }
            );
          }
        },
        {
          label: 'Deface',
          run: function () {
            setStatus('Defacing all videos...');
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

    var btn = document.getElementById('console-toggle-btn');
    if (btn && ui.consolePanelEl) {
      btn.onclick = function() {
        toggleConsolePanel();
        // Change arrow direction
        btn.innerHTML = (ui.consolePanelEl.style.display === 'none' || !ui.consolePanelEl.style.display) ? '&#x25B2;' : '&#x25BC;';
      };
    }

    // Media List context menu handler (moved from media_list.js)
    ui.mediaListEl.oncontextmenu = function (e) {
      var row = e.target.closest('.media-item');
      if (!row) return;
      var type = row.getAttribute('data-type');
      var key = row.getAttribute('data-key');
      e.preventDefault();
      if (type === 'folder') {
        var actions = [
          {
            label: 'Flag',
            render: function (container) {
              // Render a single row of small colored circles for flags
              var flagColors = [
                { name: 'Red', color: 'red' },
                { name: 'Green', color: 'green' },
                { name: 'Yellow', color: 'yellow' },
                { name: 'Orange', color: 'orange' }
              ];
              var row = document.createElement('div');
              row.className = 'flag-row';
              flagColors.forEach(function (flag) {
                var btn = document.createElement('button');
                btn.title = flag.name;
                btn.style.background = flag.color;
                btn.style.border = '1px solid #bbb';
                btn.style.width = '14px';
                btn.style.height = '14px';
                btn.style.borderRadius = '50%';
                btn.style.cursor = 'pointer';
                btn.style.outline = 'none';
                btn.style.padding = '0';
                btn.style.margin = '0';
                btn.onclick = function (e) {
                  e.stopPropagation();
                  markFlag(key, flag.color);
                  hideContextMenu();
                };
                row.appendChild(btn);
              });
              // Clear button (small gray circle with ×)
              var clearBtn = document.createElement('button');
              clearBtn.title = 'Clear Flag';
              clearBtn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#eee;border:1px solid #bbb;line-height:12px;text-align:center;font-size:12px;color:#666;">×</span>';
              clearBtn.style.background = 'none';
              clearBtn.style.border = 'none';
              clearBtn.style.padding = '0';
              clearBtn.style.margin = '0';
              clearBtn.style.cursor = 'pointer';
              clearBtn.style.outline = 'none';
              clearBtn.onclick = function (e) {
                e.stopPropagation();
                markFlag(key, null);
                hideContextMenu();
              };
              row.appendChild(clearBtn);
              container.appendChild(row);
            }
          },
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
              var parentPath = state.folder ? state.folder.replace(/\/+ $/, '') : '';
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
        showContextMenu(e.clientX, e.clientY, actions);
      } else if (type === 'media') {
        var mediaItem = state.items.find(function (item) { return item.key === key; });
        if (!mediaItem) return;
        var actions = [];
        var isInOriginals = (state.folder && state.folder.split(/[\/]/).pop() === 'originals');
        var fileName = mediaItem.fileName;
        // Add flagging for files
        actions.push({
          label: 'Flag',
          render: function (container) {
            var flagColors = [
              { name: 'Red', color: 'red' },
              { name: 'Green', color: 'green' },
              { name: 'Yellow', color: 'yellow' },
              { name: 'Orange', color: 'orange' }
            ];
            var row = document.createElement('div');
            row.className = 'flag-row';
            flagColors.forEach(function (flag) {
              var btn = document.createElement('button');
              btn.title = flag.name;
              btn.className = 'flag-btn';
              btn.style.background = flag.color;
              btn.onclick = function (e) {
                e.stopPropagation();
                markFlag(key, flag.color);
                hideContextMenu();
              };
              row.appendChild(btn);
            });
            // Clear button (small gray circle with ×)
            var clearBtn = document.createElement('button');
            clearBtn.title = 'Clear Flag';
            clearBtn.className = 'flag-btn flag-btn--clear';
            clearBtn.innerHTML = '<span>×</span>';
            clearBtn.onclick = function (e) {
              e.stopPropagation();
              markFlag(key, null);
              hideContextMenu();
            };
            row.appendChild(clearBtn);
            container.appendChild(row);
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
          var ext = (fileName || '').split('.').pop().toLowerCase();
          if (["mp4", "webm", "mov", "mkv", "avi", "m4v"].indexOf(ext) !== -1) {
            actions.push({
              label: 'Deface...',
              run: function () {
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
      if (typeof runReview === 'function') runReview();
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