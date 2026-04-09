// caption_list.js
// Caption sidebar render logic extracted from caption_mode for file-size safety.

var CaptionListModule = (function() {
  var MEDIA_NAME_PATTERN = /\.(mp4|webm|ogg|mov|mkv|avi|m4v|jpg|jpeg|png|gif|webp|bmp)$/i;

  async function writeFileFromArrayBuffer(dirHandle, name, buffer) {
    var handle = await dirHandle.getFileHandle(name, { create: true });
    var writer = await handle.createWritable();
    await writer.write(buffer);
    await writer.close();
  }

  async function writeFileFromText(dirHandle, name, text) {
    var handle = await dirHandle.getFileHandle(name, { create: true });
    var writer = await handle.createWritable();
    await writer.write(text);
    await writer.close();
  }

  async function backupOriginalPair(dirHandle, mediaItem, oldFile) {
    var trashDir = await dirHandle.getDirectoryHandle('.caption_trash', { create: true });

    var oldFileObj = await mediaItem.fileHandle.getFile();
    await writeFileFromArrayBuffer(trashDir, oldFile, await oldFileObj.arrayBuffer());

    var oldCaption = oldFile.replace(/\.[^.]+$/, '.txt');
    try {
      var oldCaptionHandle = await dirHandle.getFileHandle(oldCaption);
      var oldCaptionFile = await oldCaptionHandle.getFile();
      await writeFileFromText(trashDir, oldCaption, await oldCaptionFile.text());
    } catch (err) {
      if (!err || err.name !== 'NotFoundError') {
        throw err;
      }
    }
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
    await backupOriginalPair(dirHandle, mediaItem, oldFile);

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

  async function renderFileList(ui, state, filterText, token, filterToken, deps) {
    var q = (filterText || '').toLowerCase();
    var renderSeq = ++state.listRenderSeq;
    ui.pageListEl.innerHTML = '';
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
      upRow.onclick = function() {
        deps.navigateUp(ui, state);
      };
      ui.pageListEl.appendChild(upRow);
      matchCount++;
    }

    state.childFolders.forEach(function(folderItem) {
      var label = '📁 ' + folderItem.name;
      if (q && label.toLowerCase().indexOf(q) === -1) {
        return;
      }
      var row = document.createElement('div');
      row.className = 'page-item folder-item';
      row.innerHTML = '<div>' + CaptionUtils.escapeHtml(label) + '</div>';
      row.ondblclick = function() {
        state.dirStack.push(folderItem.handle);
        deps.refreshPickerDirectory(ui, state).catch(function(err) {
          deps.setStatus(ui, String(err && err.message ? err.message : err));
        });
      };
      row.onclick = function() {
        deps.setStatus(ui, 'Double-click folder to enter: ' + folderItem.name);
      };
      ui.pageListEl.appendChild(row);
      matchCount++;
    });

    function attachMediaRow(mediaItem, captionText) {
      var row = document.createElement('div');
      var isActive = state.currentItem && state.currentItem.key === mediaItem.key;
      var emptyCaption = (captionText !== null && captionText !== undefined) && !(captionText || '').trim();
      var reviewed = state.reviewedSet.has(mediaItem.key);
      row.className = 'page-item' + (isActive ? ' active' : '') + (emptyCaption ? ' empty-caption' : '') + (reviewed ? ' reviewed' : '');
      row.setAttribute('data-key', mediaItem.key);

      row.innerHTML = '<div>' + CaptionUtils.escapeHtml(mediaItem.label) + '</div>';

      row.onclick = function(e) {
        if (state.currentItem && state.currentItem.key === mediaItem.key) {
          return;
        }
        if (state.reviewMode) {
          deps.selectMedia(ui, state, mediaItem).catch(function(err) {
            deps.setStatus(ui, String(err && err.message ? err.message : err));
          });
          return;
        }
        deps.saveCurrentCaption(ui, state).then(function() {
          return deps.selectMedia(ui, state, mediaItem);
        }).catch(function(err) {
          deps.setStatus(ui, String(err && err.message ? err.message : err));
        });
      };

      row.oncontextmenu = function(e) {
        e.preventDefault();
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

        renamePickerMedia(mediaItem, oldFile, newFile).then(function() {
          deps.setStatus(ui, 'Renamed: ' + oldFile + ' -> ' + newFile);
          deps.refreshCurrentDirectory(ui, state);
        }).catch(function(err) {
          deps.setStatus(ui, (err && err.message) ? err.message : ('Rename failed: ' + err));
        });
      };

      row.ondblclick = function(e) {
        // Toggle reviewed state on double-click.
        if (state.reviewedSet.has(mediaItem.key)) {
          state.reviewedSet.delete(mediaItem.key);
        } else {
          state.reviewedSet.add(mediaItem.key);
        }
        deps.renderFileList(ui, state, ui.filterEl.value);
        e.stopPropagation();
      };

      ui.pageListEl.appendChild(row);
      matchCount++;
    }

    if (!q) {
      state.items.forEach(function(mediaItem) {
        attachMediaRow(mediaItem, null);
      });
      countDiv.textContent = matchCount + ' item' + (matchCount === 1 ? '' : 's') + ' match filter';

      state.items.forEach(function(mediaItem) {
        CaptionOps.loadCaptionTextForItem(state, mediaItem).then(function(captionText) {
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

    var captionPromises = state.items.map(function(mediaItem) {
      return CaptionOps.loadCaptionTextForItem(state, mediaItem).then(function(captionText) {
        return { mediaItem: mediaItem, captionText: captionText || '' };
      });
    });

    Promise.all(captionPromises).then(function(results) {
      if (renderSeq !== state.listRenderSeq) {
        return;
      }
      if (filterToken && token !== undefined && token !== filterToken.current) {
        return;
      }

      results.forEach(function(entry) {
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

  return {
    renderFileList: renderFileList
  };
})();
