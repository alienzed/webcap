// Global functions: hideContextMenu, ensureContextMenu, showContextMenu, ensureFocusSetExitButton, refreshFocusSetUi, clearFocusSet, activateFocusSet, wireReviewActions, runReview, selectByFileName, applyTokenFilter, refreshCurrentDirectory

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
    // Hide context menu on Escape
    if (e.key === 'Escape') {
      hideContextMenu();
      return;
    }
    // CTRL+S or CMD+S: Save caption if editor is focused and not read-only
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      if (document.activeElement === ui.editorEl && !ui.editorEl.readOnly) {
        e.preventDefault();
        saveCurrentCaption(ui, state)
          .then(function() { setStatus(ui, 'Saved (CTRL+S)'); })
          .catch(function(err) { setStatus(ui, String(err && err.message ? err.message : err)); });
      }
    }
  });
  addEventListener('scroll', hideContextMenu, true);

  return contextMenuEl;
}

function showContextMenu(clientX, clientY, actions) {
  var el = ensureContextMenu();
  el.innerHTML = '';
  var customRenderers = [];
  actions.forEach(function (action) {
    if (typeof action.render === 'function') {
      customRenderers.push(action.render);
    } else {
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
    }
  });
  // Render custom renderers (e.g., flag row) at the bottom
  if (customRenderers.length) {
    var customContainer = document.createElement('div');
    customContainer.style.marginTop = '8px';
    // If this is the flag color row, use the same palette as media.js
    // Palette: green: #43aa8b, yellow: #ffd166, orange: #f8961e, red: #f94144
    var flagColors = [
      { color: '#f94144', key: 'red' },
      { color: '#43aa8b', key: 'green' },
      { color: '#ffd166', key: 'yellow' },
      { color: '#f8961e', key: 'orange' }
    ];
    if (customRenderers.length === 1 && customRenderers[0].name === 'flagRowRenderer') {
      // Render color dots for flags
      flagColors.forEach(function (flag) {
        var dot = document.createElement('span');
        dot.style.display = 'inline-block';
        dot.style.width = '20px';
        dot.style.height = '20px';
        dot.style.borderRadius = '50%';
        dot.style.background = flag.color;
        dot.style.margin = '0 8px 0 0';
        dot.style.verticalAlign = 'middle';
        dot.style.cursor = 'pointer';
        dot.title = flag.key.charAt(0).toUpperCase() + flag.key.slice(1);
        dot.onclick = function (e) {
          e.stopPropagation();
          hideContextMenu();
          customRenderers[0](flag.key);
        };
        customContainer.appendChild(dot);
      });
      // Add a clear (X) button
      var clearBtn = document.createElement('button');
      clearBtn.textContent = '×';
      clearBtn.style.marginLeft = '8px';
      clearBtn.style.marginBottom = '10px';
      clearBtn.onclick = function (e) {
        e.stopPropagation();
        hideContextMenu();
        customRenderers[0](null);
      };
      customContainer.appendChild(clearBtn);
    } else {
      customRenderers.forEach(function (renderFn) {
        renderFn(customContainer);
      });
    }
    el.appendChild(customContainer);
  }

  el.style.display = 'block';
  el.style.left = clientX + 'px';
  el.style.top = clientY + 'px';

  var rect = el.getBoundingClientRect();
  var left = clientX;
  var top = clientY;
  if (rect.right > innerWidth - 8) {
    left = Math.max(8, innerWidth - rect.width - 8);
  }
  if (rect.bottom > innerHeight - 8) {
    top = Math.max(8, innerHeight - rect.height - 8);
  }
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}


function activateFocusSet(fileNames, source) {
  var seen = {};
  var keys = [];
  var names = (fileNames || []).map(function (name) { return String(name || ''); }).filter(Boolean);
  names.forEach(function (fileName) {
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
    clearFocusSet();
    return;
  }

  state.focusSet = {
    keys: keys,
    source: String(source || '')
  };
  if (ui.focusSetExitBtn) ui.focusSetExitBtn.style.display = '';
  renderFileList(ui.filterEl.value);
}

// Review/stats bridge for caption mode.
function wireReviewActions() {
  // Wire up Review Captions button and stats-run button to runReview
  var reviewBtn = document.getElementById('review-captions-btn');
  if (reviewBtn) {
    reviewBtn.onclick = function () {
      runReview();
    };
  }
  var runBtn = document.getElementById('stats-run-btn');
  if (runBtn) {
    runBtn.onclick = function () {
      runReview();
    };
  }
  addEventListener('message', function (event) {
    var data = event.data;
    if (!data) {
      return;
    }
    if (data.type === 'caption-review-select') {
      selectByFileName(data.fileName, data.focusFiles, data.focusSource);
      return;
    }
    if (data.type === 'caption-review-token') {
      applyTokenFilter(data.token);
    }
  });
}

function runReview() {
  if (!state.items.length) {
    setStatus('No media files loaded');
    return;
  }
  if (state.currentItem && state.currentItem.fileName) {
    savePathCaption();
  }
  clearFocusSet();
  state.currentItem = null;
  ui.editorEl.setAttribute('readonly', 'readonly');
  renderFileList(ui.filterEl.value);
  var details = document.getElementById('stats-details');
  if (details) {
    details.open = true;
  }
  var runSeq = (state.reviewSeq || 0) + 1;
  state.reviewSeq = runSeq;
  setStatus('Building combined captions and stats...');
  var results = state.items.map(function (item) {
    return {
      fileName: item.fileName,
      caption: item.caption || ''
    };
  });
  try {
    if (state.reviewSeq !== runSeq) {
      return;
    }
    var options = getOptionsFromDom();
    var report = compute(results, {
      requiredPhrase: options.requiredPhrase,
      phrases: options.phrases,
      tokenRules: options.tokenRules
    });
    state.suppressInput = true;
    ui.editorEl.value = buildCombinedCaptionsText(results);
    state.suppressInput = false;
    renderReportPreview(report);
    setStatus('Review ready: ' + results.length + ' files');
  } catch (err) {
    setStatus(String(err && err.message ? err.message : err));
  }
}

function selectByFileName(fileName, focusFiles, focusSource) {
  if (!fileName) {
    return;
  }

  function doSelect() {
    var target = null;
    for (var i = 0; i < state.items.length; i += 1) {
      if (state.items[i].fileName === fileName) {
        target = state.items[i];
        break;
      }
    }
    if (!target) {
      setStatus('File not found in current folder: ' + fileName);
      return;
    }

    if (ui.filterEl.value) {
      ui.filterEl.value = '';
      ui.filterEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    selectPathMedia(target).then(function () {
      //scrollToCurrentRow();
    }).catch(function (err) {
      setStatus(String(err && err.message ? err.message : err));
    });
  }

  if (focusFiles && focusFiles.length) {
    activateFocusSet(focusFiles, focusSource || 'Focused Items');
    setTimeout(doSelect, 0);
  } else {
    doSelect();
  }
}

function applyTokenFilter(token) {
  var value = String(token || '').trim();
  ui.filterEl.value = value;
  var ev = new Event('input', { bubbles: true });
  ui.filterEl.dispatchEvent(ev);
  if (value) {
    setStatus('Filter applied from token: ' + value);
  }
}

// Directory listing now uses backend /fs/list
function refreshCurrentDirectory() {
  var path = state.folder || '';
  debugLog('[webcap] refreshCurrentDirectory: called with path', path);
  // Ensure dirStack is initialized with root if empty or at root
  if (!state.dirStack || !Array.isArray(state.dirStack)) {
    state.dirStack = [];
  }
  if (!path) {
    // At root: dirStack should be exactly one entry for root
    if (state.dirStack.length !== 1 || state.dirStack[0].name !== '') {
      state.dirStack = [{ name: '' }];
    }
  } else if (state.dirStack.length === 0) {
    // Navigating directly to a subfolder: initialize root first
    state.dirStack = [{ name: '' }];
  }
  var last = state.dirStack && state.dirStack.length ? state.dirStack[state.dirStack.length - 1].name : '';
  debugLog('[webcap] refreshCurrentDirectory: requesting /fs/describe', path);

  var url = '/fs/describe' + (path ? ('?path=' + encodeURIComponent(path)) : '');
  // Clear current selection and editor/preview on folder change
  state.currentItem = null;
  clearEditorAndPreview();
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url);
  xhr.onreadystatechange = function () {
    if (xhr.readyState === 4) {
      if (xhr.status === 200) {
        try {
          var resp = JSON.parse(xhr.responseText);
          // resp.folders: array of {name, ...}
          // resp.files: array of {name, extension, ...}
          // resp.captions: { [media]: {exists, empty} }
          // resp.folder_state: folder state object
          state.childFolders = (resp.folders || []).map(function (f) { return { name: f.name }; });
          state.files = (resp.files || []).map(function (f) { return f.name; });
          var captions = resp.captions || {};
          state.items = (resp.files || []).filter(function (f) {
            var ext = f.extension;
            return MEDIA_EXTENSIONS[ext];
          }).map(function (f) {
            var cap = captions[f.name] || {};
            var text = typeof cap.text === 'string' ? cap.text : '';
            return {
              label: f.name,
              key: f.name,
              fileName: f.name,
              caption: text,
              hasCaption: !!(text && text.trim().length)
            };
          });
          // --- Load and apply folder state fields ---
          var folderState = resp.folder_state || {};
          if (Object.keys(folderState).length) applyFolderStateToDom(folderState);
          state.reviewedSet = state.reviewedSet || new Set();
          renderFileList(ui.filterEl.value);
          
          // --- Static header toggling (display only, wiring in main.js) ---
          var upRow = document.getElementById('up-one-directory-row');
          if (upRow) upRow.style.display = state.dirStack.length > 1 ? '' : 'none';
          var currentLabel = document.getElementById('current-folder-label');
          if (currentLabel) {
            var folder = state.folder || '';
            if (folder) {
              currentLabel.textContent = folder.split(/[\\/]/).pop();
            } else {
              currentLabel.textContent = (typeof ROOT_FOLDER_LABEL === 'string' && ROOT_FOLDER_LABEL.length) ? ROOT_FOLDER_LABEL : 'root';
            }
          }
          setStatus('Loaded folder: ' + (path || ROOT_FOLDER_LABEL));
        } catch (e) {
          setStatus('Error parsing folder list: ' + (e && e.message ? e.message : e));
          state.childFolders = [];
          state.items = [];
          renderFileList(ui.filterEl.value);
        }
      } else {
        setStatus('Error loading folder: ' + xhr.status);
        state.childFolders = [];
        state.items = [];
        renderFileList(ui.filterEl.value);
      }
    }
  };
  xhr.send();
}
// Clears the current focus set and updates UI accordingly
function clearFocusSet() {
  state.focusSet = null;
  if (ui.focusSetExitBtn) ui.focusSetExitBtn.style.display = 'none';
  renderFileList(ui.filterEl.value);
}
// Ensure live filtering as you type
if (ui.filterEl) {
  ui.filterEl.addEventListener('input', function () {
    renderFileList();
  });
}