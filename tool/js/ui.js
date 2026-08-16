// Global functions: hideContextMenu, ensureContextMenu, showContextMenu, refreshCurrentDirectory

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
    var wasVisible = contextMenuEl.style.display !== 'none';
    contextMenuEl.style.display = 'none';
    contextMenuEl.innerHTML = '';
    if (wasVisible) {
      window.dispatchEvent(new CustomEvent('webcap:context-menu-hidden'));
    }
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
    customContainer.style.marginTop = '4px';
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


function updateSidebarSurfaceTools() {
  var hasCurrentItem = !!(state && state.currentItem && state.currentItem.fileName);
  if (ui.sidebarFocusBtnEl) {
    ui.sidebarFocusBtnEl.disabled = false;
    ui.sidebarFocusBtnEl.classList.toggle('hidden', !hasCurrentItem);
    ui.sidebarFocusBtnEl.title = hasCurrentItem
      ? 'Open Focused Annotation for the selected item'
      : 'Select a media item to open Focused Annotation';
  }
  if (typeof renderPreviewHeaderMeta === 'function') {
    renderPreviewHeaderMeta();
  }
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
    '<li style="margin:0 0 6px 0;"><strong>Incomplete</strong>: requirement groups not fully satisfied.</li>' +
    '<li style="margin:0 0 6px 0;"><strong>Invalid AR</strong>: items with unsupported aspect buckets.</li>' +
    '<li style="margin:0 0 6px 0;"><strong>Tag Mismatch</strong>: items with no tags, or with item tags not found in the caption.</li>' +
    '<li style="margin:0 0 6px 0;"><strong>Prune Candidates</strong>: whole-set technical warnings and conservative resolution outliers.</li>' +
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

function openSuperSetHelpInPreview() {
  if (typeof renderAdvancedHelpPreview !== 'function') {
    setStatus('Help preview unavailable.');
    return;
  }
  renderAdvancedHelpPreview(
    'SuperSet Search Help',
    '<p style="margin:0 0 10px 0;">SuperSet Search applies the current text and advanced filters to the current folder plus every subfolder.</p>' +
    '<h4 style="margin:12px 0 6px 0;font-size:14px;">How it works</h4>' +
    '<ul style="margin:0 0 8px 18px;padding:0;">' +
    '<li style="margin:0 0 6px 0;">Turn on <strong>SuperSet Search</strong>, then click <strong>Search</strong> to build a cross-folder result list.</li>' +
    '<li style="margin:0 0 6px 0;">Changing any filter marks those results stale until you search again.</li>' +
    '<li style="margin:0 0 6px 0;">Use <strong>Create Set From Results</strong> to materialize the matched media into a new set.</li>' +
    '</ul>' +
    '<h4 style="margin:12px 0 6px 0;font-size:14px;">Use boundary</h4>' +
    '<p style="margin:0;">SuperSet is intended only for that materialization flow. Do not treat it as a normal browse, review, or edit mode outside creating a new set from the matched results.</p>'
  );
}

function clearCaptionFilterInputs() {
  if (ui.filterEl) ui.filterEl.value = '';
  if (ui.advancedFilterMissingCaptionsEl) ui.advancedFilterMissingCaptionsEl.checked = false;
  if (ui.advancedFilterReviewedEl) ui.advancedFilterReviewedEl.checked = false;
  if (ui.advancedFilterUnreviewedEl) ui.advancedFilterUnreviewedEl.checked = false;
  if (ui.advancedFilterUntaggedEl) ui.advancedFilterUntaggedEl.checked = false;
  if (ui.advancedFilterIncompleteEl) ui.advancedFilterIncompleteEl.checked = false;
  ui.advancedFilterPruneCandidatesEl.checked = false;
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
    saveFolderStateForCurrentRoot();
    return;
  }
  if (typeof updateSuperSetControls === 'function') updateSuperSetControls();
  renderFileList();
  saveFolderStateForCurrentRoot();
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

function navigateIntoFolder(name) {
  var folderName = String(name || '').trim();
  if (!folderName || folderName === '.' || folderName === '..' || /[\\/]/.test(folderName)) {
    throw new Error('Invalid folder name.');
  }
  if (typeof clearFocusSet === 'function' && state.focusSet && state.focusSet.keys && state.focusSet.keys.length) {
    clearFocusSet();
  }
  state.folder = (state.folder ? state.folder + '/' : '') + folderName;
  if (state.dirStack.length) {
    state.dirStack.push({ name: folderName });
  }
  state.currentItem = null;
  clearEditorAndPreview();
  clearCaptionFilterInputs();
  refreshCurrentDirectory();
}

// Directory listing now uses backend /fs/list
function refreshCurrentDirectory() {
  var path = state.folder || '';
  invalidatePruneCandidates();
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
  debugLog('[webcap] refreshCurrentDirectory: called.');
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
  debugLog('[webcap] refreshCurrentDirectory: requesting /fs/describe.');
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
          state.childFolders = (resp.folders || []).map(function (f) {
            return { name: f.name, trainingStatus: f.trainingStatus || null };
          });
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
           ensureFocusSetMetadataForCurrentFolder();
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
           refreshTrainingWorkspace();
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
           refreshTrainingWorkspace();
        }
      } else {
        var loadError = 'Error loading folder: ' + xhr.status;
        try {
          var errorPayload = JSON.parse(xhr.responseText || '{}');
          if (errorPayload && errorPayload.error) loadError += ' — ' + errorPayload.error;
        } catch (errorParseFailure) {
          // The HTTP status remains useful when an intermediary returned non-JSON.
        }
        setStatus(loadError);
        state.childFolders = [];
        state.items = [];
        if (ui.upBtn) ui.upBtn.classList.add('hidden');
        renderFileList(ui.filterEl.value);
        refreshTrainingWorkspace();
      }
      updateSetFolderScopedUi();
      updateReviewButtonAvailability();
    }
  };
  xhr.send();
}
// Ensure live filtering as you type
var debouncedSaveMediaFilters = debounceCreate(250);

function handleMediaFilterChanged() {
  markSuperSetSearchDirty();
  renderFileList();
  debouncedSaveMediaFilters(function () {
    saveFolderStateForCurrentRoot();
  });
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
ui.advancedFilterPruneCandidatesEl.addEventListener('change', handleMediaFilterChanged);
if (ui.advancedFilterStarsEl) {
  ui.advancedFilterStarsEl.addEventListener('change', handleMediaFilterChanged);
}
if (ui.advancedFilterFlagEl) {
  ui.advancedFilterFlagEl.addEventListener('change', handleMediaFilterChanged);
}
if (ui.advancedFilterInvalidArEl) {
  ui.advancedFilterInvalidArEl.addEventListener('change', function () {
    if (ui.advancedFilterInvalidArEl.checked
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
    if (!ui.advancedFilterSupersetEl.checked && state && state.supersetActive) {
      exitSuperSetSearch({ uncheck: false });
      return;
    }
    state.supersetArmed = !!ui.advancedFilterSupersetEl.checked;
    if (state.supersetArmed) state.supersetSearchDirty = true;
    updateSuperSetControls();
  });
}
if (ui.supersetSearchBtn) {
  ui.supersetSearchBtn.addEventListener('click', function () {
    runSuperSetSearch();
  });
}
if (ui.supersetExitBtn) {
  ui.supersetExitBtn.addEventListener('click', function () {
    exitSuperSetSearch({ uncheck: true });
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
if (ui.supersetInfoBtn) {
  ui.supersetInfoBtn.addEventListener('click', function (event) {
    event.preventDefault();
    event.stopPropagation();
    openSuperSetHelpInPreview();
  });
}
