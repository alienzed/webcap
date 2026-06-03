// Global functions: hideContextMenu, ensureContextMenu, showContextMenu, clearFocusSet, activateFocusSet, wireReviewActions, runReview, selectByFileName, applyTokenFilter, refreshCurrentDirectory

var MEDIA_NAME_PATTERN = /\.(mp4|webm|ogg|mov|mkv|avi|m4v|jpg|jpeg|png|gif|webp|bmp)$/i;
var contextMenuEl = null;
var previewWheelNavigateLastAt = 0;
var PREVIEW_WHEEL_NAV_COOLDOWN_MS = 140;

function handlePreviewWheelNavigate(deltaY) {
  if (!state || !state.currentItem || !state.currentItem.fileName) {
    return false;
  }
  if (typeof moveSelectedMediaByOffset !== 'function') {
    return false;
  }
  var delta = Number(deltaY);
  if (!isFinite(delta) || delta === 0) {
    return false;
  }
  var now = Date.now();
  if ((now - previewWheelNavigateLastAt) < PREVIEW_WHEEL_NAV_COOLDOWN_MS) {
    return false;
  }
  var handled = moveSelectedMediaByOffset(delta > 0 ? 1 : -1);
  if (handled) {
    previewWheelNavigateLastAt = now;
  }
  return handled;
}

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
          .then(function() { setStatus('Saved (CTRL+S)'); })
          .catch(function(err) { setStatus(String(err && err.message ? err.message : err)); });
      }
    }
    // F2: Rename selected media item
    if (e.key === 'F2') {
      e.preventDefault();
      if (state && state.currentItem && state.currentItem.fileName) {
        promptRenameMedia(state.currentItem);
      }
    }
  });
  addEventListener('scroll', hideContextMenu, true);

  return contextMenuEl;
}

function showContextMenu(clientX, clientY, actions) {
  var el = ensureContextMenu();
  el.innerHTML = '';
  var normalizedActions = [];
  var sawNonSeparator = false;
  var pendingSeparator = false;
  (actions || []).forEach(function (action) {
    if (!action) return;
    if (action.separator) {
      if (sawNonSeparator) pendingSeparator = true;
      return;
    }
    if (pendingSeparator) {
      normalizedActions.push({ separator: true });
      pendingSeparator = false;
    }
    normalizedActions.push(action);
    sawNonSeparator = true;
  });
  var customRenderers = [];
  normalizedActions.forEach(function (action) {
    if (action.separator) {
      var sep = document.createElement('div');
      sep.className = 'caption-context-menu-separator';
      el.appendChild(sep);
      return;
    }
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
    // Use the central palette from constants.js (fail fast if missing)
    if (customRenderers.length === 1 && customRenderers[0].name === 'flagRowRenderer') {
      var flagRow = document.createElement('div');
      flagRow.className = 'flag-row';
      // Render color dots for flags
      FLAG_COLORS.forEach(function (key) {
        var dot = document.createElement('span');
        dot.className = 'flag-dot flag-dot--' + key;
        dot.style.cursor = 'pointer';
        dot.title = key.charAt(0).toUpperCase() + key.slice(1);
        dot.onclick = function (e) {
          e.stopPropagation();
          hideContextMenu();
          customRenderers[0](key);
        };
        flagRow.appendChild(dot);
      });
      // Add a clear (X) button
      var clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.title = 'Clear Flag';
      clearBtn.className = 'flag-btn--clear';
      clearBtn.innerHTML = '<span>×</span>';
      clearBtn.onclick = function (e) {
        e.stopPropagation();
        hideContextMenu();
        customRenderers[0](null);
      };
      flagRow.appendChild(clearBtn);
      customContainer.appendChild(flagRow);
    } else {
      customRenderers.forEach(function (renderFn) {
        renderFn(customContainer);
      });
    }
    el.appendChild(customContainer);
  }

  el.style.display = 'inline-block';
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
  addEventListener('message', function (event) {
    var data = event.data;
    if (!data) {
      return;
    }
    if (data.type === 'media-preview-reselect') {
      reselectCurrentMediaFromPreview();
      return;
    }
    if (data.type === 'media-preview-wheel-navigate') {
      handlePreviewWheelNavigate(data.deltaY);
      return;
    }
    if (data.type === 'caption-review-select') {
      selectByFileName(data.fileName, data.focusFiles, data.focusSource);
      return;
    }
    if (data.type === 'caption-review-token') {
      applyTokenFilter(data.token);
      return;
    }
    if (data.type === 'caption-review-phrase') {
      if (typeof setFilterFromBalancePhrase === 'function') {
        setFilterFromBalancePhrase(data.phrase);
      } else {
        applyTokenFilter(data.phrase);
      }
    }
  });
}

function updateReviewButtonAvailability() {
  if (!ui.reviewBtn) return;
  var availability = getReviewAvailability();
  ui.reviewBtn.disabled = false;
  ui.reviewBtn.classList.toggle('hidden', !availability.enabled);
  ui.reviewBtn.title = availability.message;
}

function updateSetFolderScopedUi() {
  var inSetFolder = isSetFolderContext(state.folder, state.items);
  var workspace = document.getElementById('sidebar-workspace');
  if (!workspace) return;
  workspace.classList.toggle('hidden', !inSetFolder);
}

function getReviewAvailability() {
  if (!isSetFolderPath(state.folder)) {
    return {
      enabled: false,
      message: "Review Captions is only available inside a set folder"
    };
  }
  if (!Array.isArray(state.items) || !state.items.length) {
    return {
      enabled: false,
      message: "Review Captions requires at least one media file in this set folder"
    };
  }
  return {
    enabled: true,
    message: 'Review captions in this set folder'
  };
}

function openAdvancedFilterHelpInPreview() {
  if (typeof renderAdvancedHelpPreview !== 'function') {
    setStatus('Help preview unavailable.');
    return;
  }
  renderAdvancedHelpPreview(
    'Advanced Filters Help',
    '<p style="margin:0 0 10px 0;">Use Advanced Filters to narrow the media list before review, prep, and set creation.</p>' +
    '<h4 style="margin:12px 0 6px 0;font-size:14px;">Text Filter (top search box)</h4>' +
    '<ul style="margin:0 0 8px 18px;padding:0;">' +
    '<li style="margin:0 0 6px 0;">Use comma-separated terms; all included terms must match.</li>' +
    '<li style="margin:0 0 6px 0;">Prefix a term with <code>-</code> or <code>!</code> to exclude it.</li>' +
    '<li style="margin:0 0 6px 0;">Search checks filename, label, caption text, and item tags.</li>' +
    '</ul>' +
    '<h4 style="margin:12px 0 6px 0;font-size:14px;">Checkbox Filters</h4>' +
    '<ul style="margin:0 0 8px 18px;padding:0;">' +
    '<li style="margin:0 0 6px 0;"><strong>Captionless</strong>: items without captions.</li>' +
    '<li style="margin:0 0 6px 0;"><strong>Reviewed</strong>: items marked reviewed.</li>' +
    '<li style="margin:0 0 6px 0;"><strong>Unreviewed</strong>: items not marked reviewed yet.</li>' +
    '<li style="margin:0 0 6px 0;"><strong>Incomplete</strong>: requirement groups not fully satisfied (N/A counts as complete).</li>' +
    '<li style="margin:0 0 6px 0;"><strong>Invalid AR</strong>: items with unsupported aspect buckets.</li>' +
    '<li style="margin:0 0 6px 0;"><strong>Untagged</strong>: items with no item tags.</li>' +
    '</ul>' +
    '<h4 style="margin:12px 0 6px 0;font-size:14px;">Stars + Flag</h4>' +
    '<ul style="margin:0 0 8px 18px;padding:0;">' +
    '<li style="margin:0 0 6px 0;"><strong>Stars</strong>: include selected star ratings and optionally <strong>No Star</strong>.</li>' +
    '<li style="margin:0 0 6px 0;"><strong>Flag</strong>: include selected colors and optionally <strong>No Flag</strong>.</li>' +
    '</ul>' +
    '<h4 style="margin:12px 0 6px 0;font-size:14px;">Composing Filters</h4>' +
    '<p style="margin:0 0 6px 0;">All active filters are combined with AND logic. Add filters gradually, then clear with the <strong>x</strong> button.</p>' +
    '<p style="margin:0;">This help is intentionally structured to expand later with Smart Set filter guidance.</p>'
  );
}

function clearCaptionFilterInputs() {
  if (ui.filterEl) ui.filterEl.value = '';
  if (ui.advancedFilterMissingCaptionsEl) ui.advancedFilterMissingCaptionsEl.checked = false;
  if (ui.advancedFilterReviewedEl) ui.advancedFilterReviewedEl.checked = false;
  if (ui.advancedFilterUnreviewedEl) ui.advancedFilterUnreviewedEl.checked = false;
  if (ui.advancedFilterUntaggedEl) ui.advancedFilterUntaggedEl.checked = false;
  if (ui.advancedFilterIncompleteEl) ui.advancedFilterIncompleteEl.checked = false;
  if (ui.advancedFilterStarsEl) {
    Array.prototype.forEach.call(ui.advancedFilterStarsEl.querySelectorAll('input[type="checkbox"]'), function (input) {
      input.checked = false;
    });
  }
  if (ui.advancedFilterFlagEl) {
    Array.prototype.forEach.call(ui.advancedFilterFlagEl.querySelectorAll('input[type="checkbox"]'), function (input) {
      input.checked = false;
    });
  }
  if (ui.advancedFilterInvalidArEl) ui.advancedFilterInvalidArEl.checked = false;
  if (ui.advancedFilterSupersetEl) ui.advancedFilterSupersetEl.checked = false;
}

function clearCaptionFilters() {
  clearCaptionFilterInputs();
  if (typeof exitSuperSetSearch === 'function' && state && state.supersetActive) {
    exitSuperSetSearch({ uncheck: true });
    return;
  }
  if (typeof updateSuperSetControls === 'function') updateSuperSetControls();
  renderFileList();
}

function clearMediaFiltersForGeneratedDataset(path) {
  var value = String(path || '');
  var isGeneratedDatasetPath = value.split(/[\\/]/).some(function (part) {
    return part.toLowerCase() === 'auto_dataset';
  });
  if (!isGeneratedDatasetPath) {
    state.autoDatasetFilterResetPath = '';
    return;
  }
  if (state.autoDatasetFilterResetPath === value) {
    return;
  }
  state.autoDatasetFilterResetPath = value;
  clearCaptionFilterInputs();
}

function runReview() {
  var availability = getReviewAvailability();
  if (!availability.enabled) {
    setStatus(availability.message + '.');
    updateReviewButtonAvailability();
    return;
  }
  if (!state.items.length) {
    setStatus('No media files loaded');
    return;
  }
  if (state.currentItem && state.currentItem.fileName) {
    savePathCaption();
  }
  state.currentItem = null;
  renderChecklistPanel();
  ui.editorEl.setAttribute('readonly', 'readonly');
  renderFileList(ui.filterEl.value);
  setSidebarTab('review');
  var runSeq = (state.reviewSeq || 0) + 1;
  state.reviewSeq = runSeq;
  setStatus('Building combined captions and stats...');
  var visibleRows = Array.prototype.slice.call(
    ui.mediaListEl ? ui.mediaListEl.querySelectorAll('.media-item[data-type="media"]') : []
  );
  var visibleKeys = visibleRows
    .map(function (row) { return String(row.getAttribute('data-key') || '').trim(); })
    .filter(Boolean);
  var results = visibleKeys.map(function (key) {
    var item = (state.items || []).find(function (it) { return it && it.key === key; });
    var tags = [];
    if (item && typeof getTagsForMediaKey === 'function') {
      tags = getTagsForMediaKey(item.key);
    }
    return {
      fileName: item ? item.fileName : key,
      caption: item ? item.caption || '' : '',
      tags: Array.isArray(tags) ? tags : []
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
      reviewRules: options.reviewRules
    });
    state.suppressInput = true;
    ui.editorEl.value = buildCombinedCaptionsText(results);
    state.suppressInput = false;
    renderReportPreview(report, results.map(function (row) { return row.fileName; }));
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
      if (typeof scrollCurrentMediaRowIntoView === 'function') {
        scrollCurrentMediaRowIntoView();
      }
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

function classifyTrainingConfigFile(fileName) {
  var lower = String(fileName || '').toLowerCase();
  if (/(^|[._-])hi([._-]|$)/.test(lower)) return 'hi';
  if (/(^|[._-])lo([._-]|$)/.test(lower)) return 'lo';
  var hasHi = lower.indexOf('hi') !== -1;
  var hasLo = lower.indexOf('lo') !== -1;
  if (hasHi && !hasLo) return 'hi';
  if (hasLo && !hasHi) return 'lo';
  return 'lo';
}

function buildTrainingConfigColumnHtml(title, files) {
  var buttons = files.map(function (f) {
    return '<button type="button" class="training-config-link" data-file="' + encodeURIComponent(f) + '">' + escapeHtml(f) + '</button>';
  }).join('');
  if (!buttons) {
    buttons = '<div class="training-config-empty">No files</div>';
  }
  return '' +
    '<div class="training-config-col">' +
    '<div class="training-config-col-title">' + title + '</div>' +
    buttons +
    '</div>';
}

function refreshTrainingConfigList() {
  var listEl = document.getElementById('training-config-list');
  if (!listEl) return;
  if (!state.folder) {
    listEl.textContent = 'No folder selected.';
    return;
  }
  listEl.textContent = 'Loading...';
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/fs/list_config?folder=' + encodeURIComponent(state.folder));
  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) return;
    if (xhr.status !== 200) {
      listEl.textContent = 'No config files.';
      return;
    }
    try {
      var resp = JSON.parse(xhr.responseText);
      var files = Array.isArray(resp.files) ? resp.files : [];
      if (!files.length) {
        listEl.textContent = 'No config files.';
        return;
      }
      files.sort(function (a, b) {
        return String(a || '').toLowerCase().localeCompare(String(b || '').toLowerCase());
      });
      var hiFiles = [];
      var loFiles = [];
      files.forEach(function (f) {
        if (classifyTrainingConfigFile(f) === 'hi') hiFiles.push(f);
        else loFiles.push(f);
      });
      listEl.innerHTML = '' +
        '<div class="training-config-grid">' +
        buildTrainingConfigColumnHtml('High Noise', hiFiles) +
        buildTrainingConfigColumnHtml('Low Noise', loFiles) +
        '</div>';
      Array.prototype.forEach.call(listEl.querySelectorAll('.training-config-link'), function (btn) {
        btn.onclick = function () {
          var fileName = decodeURIComponent(btn.getAttribute('data-file') || '');
          if (!fileName) return;
          loadConfigFileToEditor(fileName);
        };
      });
    } catch (e) {
      listEl.textContent = 'No config files.';
    }
  };
  xhr.send();
}

// Directory listing now uses backend /fs/list
function refreshCurrentDirectory() {
  var path = state.folder || '';
  if (state && state.supersetActive) {
    state.supersetActive = false;
    state.supersetResults = [];
    state.supersetRenderedCount = 0;
    state.supersetCurrentResult = null;
    state.supersetSearchDirty = false;
    state.supersetSourceFolder = '';
    state.supersetArmed = false;
    if (ui.advancedFilterSupersetEl) ui.advancedFilterSupersetEl.checked = false;
    if (typeof updateSuperSetControls === 'function') updateSuperSetControls();
  }
  updateUtilityPathLabel(path);
  updateSetFolderScopedUi();
  updateReviewButtonAvailability();
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
  clearMediaFiltersForGeneratedDataset(path);

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
          applyFolderStateToDom(folderState);
          loadChecklistFromFolderState(folderState);
          loadCaptionHelpersFromFolderState(folderState);
          loadItemTagsFromFolderState(folderState);
          refreshMediaResolutionCache();
          state.reviewedSet = state.reviewedSet || new Set();
          renderFileList(ui.filterEl.value);
          refreshDeterministicMutationStatus();
          
          // --- Static header toggling (display only, wiring in main.js) ---
          if (ui.upBtn) {
            ui.upBtn.classList.toggle('hidden', !(state.dirStack.length > 1));
          }
          var currentLabel = document.getElementById('current-folder-label');
          if (currentLabel) {
            var folder = state.folder || '';
            if (folder) {
              currentLabel.textContent = folder.split(/[\\/]/).pop();
            } else {
              currentLabel.textContent = (typeof ROOT_FOLDER_LABEL === 'string' && ROOT_FOLDER_LABEL.length) ? ROOT_FOLDER_LABEL : 'root';
            }
          }
          if (typeof updateUtilityPathLabel === 'function') {
            updateUtilityPathLabel(state.folder || '');
          }
          setStatus('Loaded folder: ' + (path || ROOT_FOLDER_LABEL));
          refreshTrainingConfigList();
          // If a file was just renamed, reselect it
          if (window.state && state.pendingSelectFileName) {
            var fname = state.pendingSelectFileName;
            state.pendingSelectFileName = undefined;
            setTimeout(function() { selectByFileName(fname); }, 0);
          }
        } catch (e) {
          setStatus('Error parsing folder list: ' + (e && e.message ? e.message : e));
          state.childFolders = [];
          state.items = [];
          if (ui.upBtn) ui.upBtn.classList.add('hidden');
          renderFileList(ui.filterEl.value);
          refreshTrainingConfigList();
        }
      } else {
        setStatus('Error loading folder: ' + xhr.status);
        state.childFolders = [];
        state.items = [];
        if (ui.upBtn) ui.upBtn.classList.add('hidden');
        renderFileList(ui.filterEl.value);
        refreshTrainingConfigList();
      }
      updateSetFolderScopedUi();
      updateReviewButtonAvailability();
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
function handleMediaFilterChanged() {
  if (typeof markSuperSetSearchDirty === 'function') markSuperSetSearchDirty();
  renderFileList();
}

if (ui.filterEl) {
  ui.filterEl.addEventListener('input', handleMediaFilterChanged);
}
if (ui.advancedFilterMissingCaptionsEl) {
  ui.advancedFilterMissingCaptionsEl.addEventListener('change', handleMediaFilterChanged);
}
if (ui.advancedFilterReviewedEl) {
  ui.advancedFilterReviewedEl.addEventListener('change', handleMediaFilterChanged);
}
if (ui.advancedFilterUnreviewedEl) {
  ui.advancedFilterUnreviewedEl.addEventListener('change', handleMediaFilterChanged);
}
if (ui.advancedFilterUntaggedEl) {
  ui.advancedFilterUntaggedEl.addEventListener('change', handleMediaFilterChanged);
}
if (ui.advancedFilterIncompleteEl) {
  ui.advancedFilterIncompleteEl.addEventListener('change', handleMediaFilterChanged);
}
if (ui.advancedFilterStarsEl) {
  ui.advancedFilterStarsEl.addEventListener('change', handleMediaFilterChanged);
}
if (ui.advancedFilterFlagEl) {
  ui.advancedFilterFlagEl.addEventListener('change', handleMediaFilterChanged);
}
if (ui.advancedFilterInvalidArEl) {
  ui.advancedFilterInvalidArEl.addEventListener('change', function () {
    if (ui.advancedFilterInvalidArEl.checked
      && typeof isMediaMetadataLoading === 'function'
      && isMediaMetadataLoading()) {
      ui.advancedFilterInvalidArEl.checked = false;
      setStatus('Invalid AR is unavailable while metadata is generating. Please try again in a moment.');
      return;
    }
    handleMediaFilterChanged();
  });
}
if (ui.advancedFilterSupersetEl) {
  ui.advancedFilterSupersetEl.addEventListener('change', function () {
    if (!ui.advancedFilterSupersetEl.checked && typeof exitSuperSetSearch === 'function' && state && state.supersetActive) {
      exitSuperSetSearch({ uncheck: false });
      return;
    }
    state.supersetArmed = !!ui.advancedFilterSupersetEl.checked;
    if (state.supersetArmed) state.supersetSearchDirty = true;
    if (typeof updateSuperSetControls === 'function') updateSuperSetControls();
  });
}
if (ui.supersetSearchBtn) {
  ui.supersetSearchBtn.addEventListener('click', function () {
    if (typeof runSuperSetSearch === 'function') runSuperSetSearch();
  });
}
if (ui.supersetExitBtn) {
  ui.supersetExitBtn.addEventListener('click', function () {
    if (typeof exitSuperSetSearch === 'function') exitSuperSetSearch({ uncheck: true });
  });
}
if (ui.captionFilterClearAllBtn) {
  ui.captionFilterClearAllBtn.addEventListener('click', function () {
    clearCaptionFilters();
  });
}
if (ui.advancedFilterInfoBtn) {
  ui.advancedFilterInfoBtn.addEventListener('click', openAdvancedFilterHelpInPreview);
}
