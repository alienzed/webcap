// caption_ui.js

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
    // Backend rename: call deps.renameMedia
    deps.renameMedia(ui, state, mediaItem, oldFile, newFile).then(function () {
      setStatus(ui, 'Renamed: ' + oldFile + ' -> ' + newFile);
      deps.refreshCurrentDirectory(ui, state);
    }).catch(function (err) {
      setStatus(ui, (err && err.message) ? err.message : ('Rename failed: ' + err));
    });
  }

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
        // No-op: refresh button is now static in HTML
    debugLog('[renderFileList] called. state.items:', state.items, 'state.childFolders:', state.childFolders, 'filterText:', filterText);
    if (window.DEBUG) {
      //console.log('[webcap] renderFileList: state.childFolders:', state.childFolders);
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
      upRow.className = 'page-item folder-item header-item';
      upRow.innerHTML = '<div>⬆ Up One Directory</div>';
      upRow.onclick = function () {
        deps.navigateUp(ui, state, deps);
      };
      ui.pageListEl.appendChild(upRow);
      matchCount++;
    }

    // Add current directory entry with open folder icon, below 'Up One Directory', but skip if at root or if current folder is named 'originals' (at any depth)
    if (state.folder && state.folder.length) {
      var currentDirName = state.folder.split(/[\\/]/).pop();
      if (currentDirName.toLowerCase() !== 'originals') {
        var currentRow = document.createElement('div');
        currentRow.className = 'page-item folder-item header-item current-folder-item current-folder-bordered';
        currentRow.innerHTML = '<div>🗁 ' + escapeHtml(currentDirName) + '</div>';
        currentRow.oncontextmenu = function(e) {
          e.preventDefault();
          e.stopPropagation();
          var actions = [
            {
              label: 'Run autoset.py',
              run: function() {
                setStatus(ui, 'Running autoset.py...');
                var previewFrame = ui.previewEl;
                if (previewFrame && previewFrame.contentDocument) {
                  var doc = previewFrame.contentDocument;
                  doc.open();
                  doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;">');
                  doc.close();
                }
                var folderPath = state.folder;
                fetch('/fs/autoset_run', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ folder: folderPath })
                }).then(function(response) {
                  var previewFrame = ui.previewEl;
                  if (!response.body || !window.ReadableStream) {
                    response.text().then(function(text) {
                      if (previewFrame && previewFrame.contentDocument) {
                        var doc = previewFrame.contentDocument;
                        doc.open();
                        doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;">');
                        doc.write(text.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
                        doc.write('</body></html>');
                        doc.close();
                      }
                    });
                    return;
                  }
                  var reader = response.body.getReader();
                  var decoder = new TextDecoder();
                  var output = '';
                  function readChunk() {
                    reader.read().then(function(result) {
                      if (result.done) {
                        setStatus(ui, 'autoset.py finished.');
                        if (previewFrame && previewFrame.contentDocument) {
                          var doc = previewFrame.contentDocument;
                          doc.open();
                          doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;">');
                          doc.write(output.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
                          doc.write('</body></html>');
                          doc.close();
                        }
                        return;
                      }
                      output += decoder.decode(result.value, {stream:true});
                      if (previewFrame && previewFrame.contentDocument) {
                        var doc = previewFrame.contentDocument;
                        doc.open();
                        doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;">');
                        doc.write(output.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
                        doc.write('</body></html>');
                        doc.close();
                        // Scroll preview to bottom
                        if (previewFrame && previewFrame.contentWindow) {
                          var body = previewFrame.contentDocument && previewFrame.contentDocument.body;
                          if (body) body.scrollTop = body.scrollHeight;
                        }
                      }
                      readChunk();
                    });
                  }
                  readChunk();
                }).catch(function(err) {
                  setStatus(ui, 'autoset.py failed: ' + err);
                });
              }
            },
            {
              label: 'Deface',
              run: function() {
                setStatus(ui, 'Defacing all videos...');
                var previewFrame = ui.previewEl;
                if (previewFrame && previewFrame.contentDocument) {
                  var doc = previewFrame.contentDocument;
                  doc.open();
                  doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;">');
                  doc.close();
                }
                var folderPath = state.folder;
                fetch('/fs/deface_folder', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ folder: folderPath })
                }).then(function(response) {
                  var previewFrame = ui.previewEl;
                  if (!response.body || !window.ReadableStream) {
                    response.text().then(function(text) {
                      if (previewFrame && previewFrame.contentDocument) {
                        var doc = previewFrame.contentDocument;
                        doc.open();
                        doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;">');
                        doc.write(text.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
                        doc.write('</body></html>');
                        doc.close();
                      }
                    });
                    return;
                  }
                  var reader = response.body.getReader();
                  var decoder = new TextDecoder();
                  var output = '';
                  function readChunk() {
                    reader.read().then(function(result) {
                      if (result.done) {
                          setStatus(ui, 'Defacing finished.');
                          if (previewFrame && previewFrame.contentDocument) {
                            var doc = previewFrame.contentDocument;
                            doc.open();
                            doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;">');
                            doc.write(output.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
                            doc.write('</body></html>');
                            doc.close();
                          }
                          refreshCurrentDirectory(ui, state);
                          return;
                        }
                      output += decoder.decode(result.value, {stream:true});
                      if (previewFrame && previewFrame.contentDocument) {
                        var doc = previewFrame.contentDocument;
                        doc.open();
                        doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;">');
                        doc.write(output.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
                        doc.write('</body></html>');
                        doc.close();
                      }
                      readChunk();
                    });
                  }
                  readChunk();
                }).catch(function(err) {
                  setStatus(ui, 'Defacing failed: ' + err);
                });
              }
            }
          ];
          showContextMenu(e.clientX, e.clientY, actions);
        };
        ui.pageListEl.appendChild(currentRow);
        matchCount++;
      }
    }

    if (window.DEBUG) {
      //console.log('[webcap] renderFileList: rendering folders:', state.childFolders);
    }
    //console.log('[webcap] renderFileList: rendering folders', state.childFolders);
    for (var i = 0; i < state.childFolders.length; ++i) {
      var folderItem = state.childFolders[i];
      var label = ' 🗀 ' + folderItem.name; // Indent with two spaces
      //console.log('[webcap] renderFileList: rendering folder', folderItem);
      var row = document.createElement('div');
      row.className = 'page-item folder-item';
      row.innerHTML = '<div>' + escapeHtml(label) + '</div>';
      row.onclick = (function(folderName) {
        return function () {
          //console.log('[webcap] renderFileList: folder click', folderName);
          state.folder = (state.folder ? state.folder + '/' : '') + folderName;
          if (state.dirStack && state.dirStack.length) {
            state.dirStack.push({ name: folderName });
          }
          // Clear current selection and editor/preview
          state.currentItem = null;
          window.clearEditorAndPreview(ui, state);
          deps.refreshCurrentDirectory(ui, state);
        };
      })(folderItem.name);
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
                  setStatus(ui, 'Invalid folder name');
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
                      setStatus(ui, 'Renamed folder: ' + oldName + ' -> ' + newName);
                      deps.refreshCurrentDirectory(ui, state);
                    } else {
                      setStatus(ui, (res.data && res.data.error) ? res.data.error : 'Rename failed');
                    }
                  })
                  .catch(function(err) {
                    setStatus(ui, 'Rename failed: ' + err);
                  });
              }
            });

            actions.push({
              label: 'Duplicate Folder',
              run: function() {
                setStatus(ui, 'Duplicating folder...');
                var folderPath = (state.folder ? state.folder + '/' : '') + folderItem.name;
                fetch('/fs/duplicate_folder', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ src: folderPath })
                })
                .then(function(resp) { return resp.json().then(function(data) { return {status: resp.status, data: data}; }); })
                .then(function(res) {
                  if (res.status === 200 && res.data && res.data.success) {
                    setStatus(ui, 'Duplicated folder: ' + folderItem.name);
                    deps.refreshCurrentDirectory(ui, state);
                  } else {
                    setStatus(ui, (res.data && res.data.error) ? res.data.error : 'Duplicate failed');
                  }
                })
                .catch(function(err) {
                  setStatus(ui, 'Duplicate failed: ' + err);
                });
              }
            });

            actions.push({
              label: 'Deface',
              run: function() {
                // Add Deface... to file context menu for video files
                if (['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v'].indexOf(ext) !== -1) {
                  actions.push({
                    label: 'Deface...',
                    run: function () {
                      var defaultThresh = '0.4';
                      var t = window.prompt('Deface: Enter threshold (-t, 0.0-1.0)', defaultThresh);
                      if (t === null) return;
                      t = String(t).trim();
                      if (!/^0(\.\d+)?|1(\.0+)?$/.test(t)) {
                        setStatus(ui, 'Invalid threshold');
                        return;
                      }
                      setStatus(ui, 'Defacing file...');
                      var previewFrame = ui.previewEl;
                      if (previewFrame && previewFrame.contentDocument) {
                        var doc = previewFrame.contentDocument;
                        doc.open();
                        doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;">');
                        doc.close();
                      }
                      var filePath = (state.folder ? state.folder + '/' : '') + mediaItem.fileName;
                      fetch('/fs/deface_file', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ file: filePath, thresh: t })
                      }).then(function(response) {
                        var previewFrame = ui.previewEl;
                        if (!response.body || !window.ReadableStream) {
                          response.text().then(function(text) {
                            if (previewFrame && previewFrame.contentDocument) {
                              var doc = previewFrame.contentDocument;
                              doc.open();
                              doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;">');
                              doc.write(text.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
                              doc.write('</body></html>');
                              doc.close();
                            }
                          });
                          return;
                        }
                        var reader = response.body.getReader();
                        var decoder = new TextDecoder();
                        var output = '';
                        function readChunk() {
                          reader.read().then(function(result) {
                            if (result.done) {
                              setStatus(ui, 'Defacing finished.');
                              if (previewFrame && previewFrame.contentDocument) {
                                var doc = previewFrame.contentDocument;
                                doc.open();
                                doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;">');
                                doc.write(output.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
                                doc.write('</body></html>');
                                doc.close();
                              }
                              if (typeof refreshCurrentDirectory === 'function') {
                                refreshCurrentDirectory(ui, state);
                              }
                              return;
                            }
                            output += decoder.decode(result.value, {stream:true});
                            if (previewFrame && previewFrame.contentDocument) {
                              var doc = previewFrame.contentDocument;
                              doc.open();
                              doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;">');
                              doc.write(output.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
                              doc.write('</body></html>');
                              doc.close();
                              // Scroll preview to bottom
                              if (previewFrame && previewFrame.contentWindow) {
                                var body = previewFrame.contentDocument && previewFrame.contentDocument.body;
                                if (body) body.scrollTop = body.scrollHeight;
                              }
                            }
                            readChunk();
                          });
                        }
                        readChunk();
                      }).catch(function(err) {
                        setStatus(ui, 'Defacing failed: ' + err);
                      });
                    }
                  });
                }
                setStatus(ui, 'Defacing all videos...');
                // Stream output to the main preview pane (iframe)
                var previewFrame = ui.previewEl;
                if (previewFrame && previewFrame.contentDocument) {
                  var doc = previewFrame.contentDocument;
                  doc.open();
                  doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;">');
                  doc.close();
                }
                var folderPath = (state.folder ? state.folder + '/' : '') + folderItem.name;
                fetch('/fs/deface_folder', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ folder: folderPath })
                }).then(function(response) {
                  var previewFrame = ui.previewEl;
                  if (!response.body || !window.ReadableStream) {
                    response.text().then(function(text) {
                      if (previewFrame && previewFrame.contentDocument) {
                        var doc = previewFrame.contentDocument;
                        doc.open();
                        doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;">');
                        doc.write(text.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
                        doc.write('</body></html>');
                        doc.close();
                      }
                    });
                    return;
                  }
                  var reader = response.body.getReader();
                  var decoder = new TextDecoder();
                  var output = '';
                  function readChunk() {
                    reader.read().then(function(result) {
                      if (result.done) {
                        setStatus(ui, 'Defacing finished.');
                        // Finalize output in preview pane
                        if (previewFrame && previewFrame.contentDocument) {
                          var doc = previewFrame.contentDocument;
                          doc.open();
                          doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;">');
                          doc.write(output.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
                          doc.write('</body></html>');
                          doc.close();
                        }
                        return;
                      }
                      output += decoder.decode(result.value, {stream:true});
                      if (previewFrame && previewFrame.contentDocument) {
                        var doc = previewFrame.contentDocument;
                        doc.open();
                        doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;">');
                        doc.write(output.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
                        doc.write('</body></html>');
                        doc.close();
                        // Scroll preview to bottom
                        if (previewFrame && previewFrame.contentWindow) {
                          var body = previewFrame.contentDocument && previewFrame.contentDocument.body;
                          if (body) body.scrollTop = body.scrollHeight;
                        }
                      }
                      readChunk();
                    });
                  }
                  readChunk();
                }).catch(function(err) {
                  setStatus(ui, 'Defacing failed: ' + err);
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

      // Choose icon based on file extension
      var icon = '';
      var ext = '';
      if (mediaItem.fileName) {
        var dot = mediaItem.fileName.lastIndexOf('.');
        if (dot !== -1) ext = mediaItem.fileName.slice(dot).toLowerCase();
      }
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].indexOf(ext) !== -1) {
        icon = '🖼️'; // image
      } else if (['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v'].indexOf(ext) !== -1) {
        icon = '🎬'; // video
      } else if (['.ogg'].indexOf(ext) !== -1) {
        icon = '🎵'; // audio (ogg)
      } else {
        icon = '📄'; // generic file
      }

      // Show primer/template content as preview if caption is missing
      var displayText = mediaItem.label;
      if (emptyCaption) {
        var primerText = window.buildAutoPrimer(mediaItem.fileName);
        if (primerText && primerText.trim()) {
          displayText += ' <span style="color:#888;font-style:italic;">[primer]</span>';
        }
      }
      row.innerHTML = '<div>' + icon + '&nbsp;' + escapeHtml(displayText) + '</div>';

      row.onclick = function (e) {
        if (state.currentItem && state.currentItem.key === mediaItem.key) {
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
        var actions = [];
        var isInOriginals = (state.folder && state.folder.split(/[\\/]/).pop() === 'originals');
        var fileName = mediaItem.fileName;
        if (isInOriginals) {
          actions.push({
            label: 'Restore',
            run: function () {
              deps.restoreMedia(ui, state, mediaItem).catch(function (err) {
                setStatus(ui, String(err && err.message ? err.message : err));
              });
            }
          });
        } else {
          actions.push({
            label: 'Rename',
            run: function () {
              promptRenameMedia(mediaItem, ui, state, deps);
            }
          });
          actions.push({
            label: 'Prune',
            run: function () {
              deps.pruneMedia(ui, state, mediaItem).catch(function (err) {
                setStatus(ui, String(err && err.message ? err.message : err));
              });
            }
          });
          // Add Deface... for video files
          var ext = (fileName || '').split('.').pop().toLowerCase();
          if (["mp4","webm","mov","mkv","avi","m4v"].indexOf(ext) !== -1) {
            actions.push({
              label: 'Deface...',
              run: function () {
                var defaultThresh = '0.4';
                var t = window.prompt('Deface: Enter threshold (-t, 0.0-1.0)', defaultThresh);
                if (t === null) return;
                t = String(t).trim();
                if (!/^0(\.\d+)?|1(\.0+)?$/.test(t)) {
                  setStatus(ui, 'Invalid threshold');
                  return;
                }
                setStatus(ui, 'Defacing file...');
                var previewFrame = ui.previewEl;
                if (previewFrame && previewFrame.contentDocument) {
                  var doc = previewFrame.contentDocument;
                  doc.open();
                  doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;">');
                  doc.close();
                }
                var filePath = (state.folder ? state.folder + '/' : '') + mediaItem.fileName;
                fetch('/fs/deface_file', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ file: filePath, thresh: t })
                }).then(function(response) {
                  var previewFrame = ui.previewEl;
                  if (!response.body || !window.ReadableStream) {
                    response.text().then(function(text) {
                      if (previewFrame && previewFrame.contentDocument) {
                        var doc = previewFrame.contentDocument;
                        doc.open();
                        doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;">');
                        doc.write(text.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
                        doc.write('</body></html>');
                        doc.close();
                      }
                    });
                    return;
                  }
                  var reader = response.body.getReader();
                  var decoder = new TextDecoder();
                  var output = '';
                  function readChunk() {
                    reader.read().then(function(result) {
                      if (result.done) {
                        setStatus(ui, 'Defacing finished.');
                        if (previewFrame && previewFrame.contentDocument) {
                          var doc = previewFrame.contentDocument;
                          doc.open();
                          doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;">');
                          doc.write(output.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
                          doc.write('</body></html>');
                          doc.close();
                        }
                        return;
                      }
                      output += decoder.decode(result.value, {stream:true});
                      if (previewFrame && previewFrame.contentDocument) {
                        var doc = previewFrame.contentDocument;
                        doc.open();
                        doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;">');
                        doc.write(output.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
                        doc.write('</body></html>');
                        doc.close();
                      }
                      readChunk();
                    });
                  }
                  readChunk();
                }).catch(function(err) {
                  setStatus(ui, 'Defacing failed: ' + err);
                });
              }
            });
          }
          // Only show Restore if file is missing from working dir but present in originals
          var originals = (state.originals || []);
          var inWorking = state.items.some(function(item) { return item.fileName === fileName; });
          var inOriginals = originals.some(function(item) { return item.fileName === fileName; });
          if (!inWorking && inOriginals) {
            actions.push({
              label: 'Restore',
              run: function () {
                deps.restoreMedia(ui, state, mediaItem).catch(function (err) {
                  setStatus(ui, String(err && err.message ? err.message : err));
                });
              }
            });
          }
          actions.push({
            label: 'Reset',
            run: function () {
              if (deps) {
                deps.resetMedia(ui, state, mediaItem).catch(function (err) {
                  setStatus(ui, String(err && err.message ? err.message : err));
                });
              } else {
                setStatus(ui, 'Reset not available');
              }
            }
          });
        }
        showContextMenu(e.clientX, e.clientY, actions);
      };

      row.ondblclick = function (e) {
        // Toggle reviewed state on double-click.
        if (state.reviewedSet.has(mediaItem.key)) {
          state.reviewedSet.delete(mediaItem.key);
        } else {
          state.reviewedSet.add(mediaItem.key);
        }
        deps.onReviewedSetChanged();
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
      setStatus(ui, 'Already at selected root folder');
      return;
    }
    state.dirStack.pop();
    // Rebuild state.folder from dirStack (excluding root)
    var folder = state.dirStack.slice(1).map(function(entry) { return entry.name; }).join('/');
    state.folder = folder;
    // Clear current selection and editor/preview
    state.currentItem = null;
    window.clearEditorAndPreview(ui, state);
    deps.refreshCurrentDirectory(ui, state);
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
        // Restore editability on the editor (robust)
        ui.editorEl.removeAttribute('readonly');
        window.clearEditorAndPreview(ui, state);
        window.refreshCurrentDirectory(ui, state);
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

  function clearFocusSet(ui, state) {
    state.focusSet = null;
    window.refreshCurrentDirectory(ui, state);
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
        CaptionListModule.clearFocusSet(ui, state);
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
      setStatus(ui, 'No media files loaded');
      return;
    }

    deps.saveCurrentCaption(ui, state).then(function() {
      deps.clearFocusSet(ui, state);
      state.currentItem = null;
      ui.editorEl.setAttribute('readonly', 'readonly');
      deps.renderFileList(ui, state, ui.filterEl.value);
      var details = document.getElementById('stats-details');
      if (details) {
        details.open = true;
      }

      var runSeq = (state.reviewSeq || 0) + 1;
      state.reviewSeq = runSeq;
      setStatus(ui, 'Building combined captions and stats...');

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
        setStatus(ui, 'Review ready: ' + results.length + ' files');
      });
    }).catch(function(err) {
      setStatus(ui, String(err && err.message ? err.message : err));
    });
  }

  function selectByFileName(ui, state, fileName, deps, focusFiles, focusSource) {
    if (!fileName) {
      return;
    }

    if (focusFiles && focusFiles.length) {
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
      setStatus(ui, 'File not found in current folder: ' + fileName);
      return;
    }

    if (ui.filterEl.value) {
      ui.filterEl.value = '';
      ui.filterEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    deps.selectMedia(ui, state, target).then(function() {
      scrollToCurrentRow(ui, state);
    }).catch(function(err) {
      setStatus(ui, String(err && err.message ? err.message : err));
    });
  }

  function applyTokenFilter(ui, token, deps) {
    var value = String(token || '').trim();
    ui.filterEl.value = value;
    var ev = new Event('input', { bubbles: true });
    ui.filterEl.dispatchEvent(ev);
    if (value) {
      setStatus(ui, 'Filter applied from token: ' + value);
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