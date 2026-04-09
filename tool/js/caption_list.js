// caption_list.js
// Caption sidebar render logic extracted from caption_mode for file-size safety.

var CaptionListModule = (function() {
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
    var canGoUp = false;
    if (state.mode === 'picker' && state.dirStack.length > 1) {
      canGoUp = true;
    } else if (state.mode === 'path') {
      var current = CaptionUtils.normalizeFolderInput(state.folder || '');
      var parent = CaptionUtils.parentPath(current);
      if (parent && parent !== current) {
        canGoUp = true;
      }
    }

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

      var openBtn = '';
      if (state.mode === 'path') {
        openBtn = '<button class="open-folder-btn" title="Open containing folder" data-file="' + encodeURIComponent(mediaItem.fileName) + '">Open</button>';
      }
      row.innerHTML = '<div>' + CaptionUtils.escapeHtml(mediaItem.label) + '</div>' + openBtn;

      row.onclick = function(e) {
        if (e.target && e.target.classList.contains('open-folder-btn')) {
          var file = decodeURIComponent(e.target.getAttribute('data-file'));
          fetch('/open_folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: state.folder + '/' + file })
          }).then(function(resp) {
            if (!resp.ok) {
              return resp.json().then(function(data) {
                deps.setStatus(ui, data.error || 'Failed to open folder');
              });
            }
            deps.setStatus(ui, 'Opened folder for: ' + file);
          }).catch(function(err) {
            deps.setStatus(ui, 'Failed to open folder: ' + err);
          });
          e.stopPropagation();
          return;
        }

        if (state.currentItem && state.currentItem.key === mediaItem.key) {
          return;
        }
        deps.saveCurrentCaption(ui, state).then(function() {
          return deps.selectMedia(ui, state, mediaItem);
        }).catch(function(err) {
          deps.setStatus(ui, String(err && err.message ? err.message : err));
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
