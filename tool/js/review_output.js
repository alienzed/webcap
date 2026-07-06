function activateFocusSet(fileNames, source, reportType) {
  var seen = {};
  var keys = [];
  var names = (fileNames || []).map(function (name) { return String(name || ''); }).filter(Boolean);
  reportType = String(reportType || '');
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
    source: String(source || ''),
    reportType: reportType
  };
  updateFocusSetUi();
  renderFileList(ui.filterEl.value);
}

function getFocusSetReportLabel(reportType) {
  if (reportType === 'selection') return 'Selection Analysis';
  if (reportType === 'captions') return 'Review Captions';
  return '';
}

function refreshReviewOutputSummary() {
  var folderEl = document.getElementById('review-output-summary-folder');
  var visibleEl = document.getElementById('review-output-summary-visible');
  var scopeEl = document.getElementById('review-output-summary-scope');
  if (!folderEl || !visibleEl || !scopeEl) return;

  var folder = String(state && state.folder || '').trim();
  var rootLabel = String(ROOT_FOLDER_LABEL || '').trim();
  var folderLabel = 'No folder selected';
  if (folder) {
    folderLabel = rootLabel ? (rootLabel + '/' + folder) : folder;
  } else if (rootLabel) {
    folderLabel = rootLabel;
  }

  var totalCount = Array.isArray(state && state.items) ? state.items.length : 0;
  var visibleCount = typeof getFilteredMediaItems === 'function' ? getFilteredMediaItems(false).length : 0;
  var focusSetCount = state && state.focusSet && state.focusSet.keys ? state.focusSet.keys.length : 0;

  folderEl.textContent = folderLabel;
  visibleEl.textContent = totalCount ? (visibleCount + ' of ' + totalCount + ' visible') : 'No media loaded';
  if (focusSetCount) {
    scopeEl.textContent = 'Focus set: ' + focusSetCount + ' item' + (focusSetCount === 1 ? '' : 's');
  } else if (state && state.supersetActive) {
    scopeEl.textContent = 'SuperSet search results';
  } else {
    scopeEl.textContent = 'Current folder scope';
  }
}

function updateFocusSetUi() {
  var focusSet = state && state.focusSet;
  var hasFocusSet = !!(focusSet && focusSet.keys && focusSet.keys.length);
  var reportLabel = hasFocusSet ? getFocusSetReportLabel(String(focusSet.reportType || '')) : '';
  var count = hasFocusSet ? focusSet.keys.length : 0;
  var source = hasFocusSet ? String(focusSet.source || '').trim() : '';
  if (ui.focusSetBannerEl) {
    ui.focusSetBannerEl.classList.toggle('hidden', !hasFocusSet);
  }
  if (ui.mediaListWrapperEl) {
    ui.mediaListWrapperEl.classList.toggle('focus-set-active', hasFocusSet);
  }
  if (ui.currentFolderRow) {
    ui.currentFolderRow.classList.toggle('focus-set-scope-header', hasFocusSet);
  }
  if (ui.focusSetBannerMetaEl) {
    if (hasFocusSet) {
      ui.focusSetBannerMetaEl.textContent = count + ' item' + (count === 1 ? '' : 's') + (source ? ' - ' + source : '');
    } else {
      ui.focusSetBannerMetaEl.textContent = '';
    }
  }
  if (ui.focusSetGridBtn) {
    ui.focusSetGridBtn.classList.toggle('hidden', !hasFocusSet);
  }
  if (ui.focusSetReturnBtn) {
    ui.focusSetReturnBtn.classList.toggle('hidden', !(hasFocusSet && reportLabel));
    ui.focusSetReturnBtn.title = reportLabel ? 'Return to ' + reportLabel : 'Return to report';
    ui.focusSetReturnBtn.setAttribute('aria-label', reportLabel ? 'Return to ' + reportLabel : 'Return to report');
  }
  if (ui.focusSetExitBtn) {
    ui.focusSetExitBtn.title = 'Exit focus set';
    ui.focusSetExitBtn.setAttribute('aria-label', 'Exit focus set');
  }
  updateSidebarSurfaceTools();
  mediaGridUpdateEntryVisibility();
  refreshReviewOutputSummary();
}

function clearFocusSet() {
  state.focusSet = null;
  updateFocusSetUi();
  renderFileList(ui.filterEl.value);
}

function rerunFocusSetReport() {
  var focusSet = state && state.focusSet;
  var reportType = String(focusSet && focusSet.reportType || '');
  if (!reportType) return;
  clearFocusSet();
  setTimeout(function () {
    if (reportType === 'selection') {
      runSelectionReview();
      return;
    }
    if (reportType === 'captions') {
      runReview();
    }
  }, 0);
}

function exitFocusSetToBrowsing() {
  state.focusSet = null;
  updateFocusSetUi();
  if (ui.editorEl) ui.editorEl.removeAttribute('readonly');
  clearEditorAndPreview();
  refreshCurrentDirectory();
}

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
    if (data.type === 'media-preview-open-grid') {
      if (typeof isMediaGridSurfaceOpen === 'function' && isMediaGridSurfaceOpen()) {
        return;
      }
      if (typeof openMediaGridSurface === 'function') {
        openMediaGridSurface();
      }
      return;
    }
    if (data.type === 'media-preview-wheel-navigate') {
      handlePreviewWheelNavigate(data.deltaY);
      return;
    }
    if (data.type === 'caption-review-select') {
      selectByFileName(data.fileName, data.focusFiles, data.focusSource, data.reportType);
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
  var availability = getReviewAvailability();
  if (ui.reviewBtn) {
    ui.reviewBtn.disabled = false;
    ui.reviewBtn.classList.toggle('hidden', !availability.enabled);
    ui.reviewBtn.title = availability.message;
  }
  if (ui.reviewSelectionsBtn) {
    ui.reviewSelectionsBtn.disabled = false;
    ui.reviewSelectionsBtn.classList.toggle('hidden', !availability.enabled);
    ui.reviewSelectionsBtn.title = availability.message.replace('Review Captions', 'Selection Analysis').replace('Review captions', 'Selection analysis');
  }
  refreshReviewOutputSummary();
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
      message: 'Review Captions is only available inside a set folder'
    };
  }
  if (!Array.isArray(state.items) || !state.items.length) {
    return {
      enabled: false,
      message: 'Review Captions requires at least one media file in this set folder'
    };
  }
  var visibleCount = getVisibleReviewItems().length;
  if (!visibleCount) {
    return {
      enabled: false,
      message: 'Review Captions requires at least one visible media item'
    };
  }
  return {
    enabled: true,
    message: 'Review captions in this set folder'
  };
}

function getVisibleReviewItems() {
  var visibleRows = Array.prototype.slice.call(
    ui.mediaListEl ? ui.mediaListEl.querySelectorAll('.media-item[data-type="media"]') : []
  );
  var visibleKeys = visibleRows
    .map(function (row) { return String(row.getAttribute('data-key') || '').trim(); })
    .filter(Boolean);
  return visibleKeys.map(function (key) {
    var item = (state.items || []).find(function (it) { return it && it.key === key; });
    var tags = [];
    if (item && typeof getTagsForMediaKey === 'function') {
      tags = getTagsForMediaKey(item.key);
    }
    return {
      key: item ? item.key : key,
      fileName: item ? item.fileName : key,
      caption: item ? item.caption || '' : '',
      tags: Array.isArray(tags) ? tags : []
    };
  });
}

function buildSelectionReport(items) {
  var summary = {
    total: 0,
    images: 0,
    videos: 0,
    withCaption: 0,
    missingCaption: 0
  };
  (items || []).forEach(function (row) {
    if (!row || !row.fileName) return;
    summary.total += 1;
    if (isPreviewVideoFileName(row.fileName)) {
      summary.videos += 1;
    } else {
      summary.images += 1;
    }
    if (String(row.caption || '').trim()) {
      summary.withCaption += 1;
    } else {
      summary.missingCaption += 1;
    }
  });
  return summary;
}

function runReview() {
  if (typeof setWorkspaceWorkflowMode === 'function') {
    setWorkspaceWorkflowMode('review');
  }
  if (typeof setWorkspaceSurface === 'function') {
    setWorkspaceSurface('reviewOutput');
  }
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
  var results = getVisibleReviewItems();
  if (!results.length) {
    setStatus('No visible media items to review.');
    updateReviewButtonAvailability();
    return;
  }
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

function runSelectionReview() {
  if (typeof setWorkspaceWorkflowMode === 'function') {
    setWorkspaceWorkflowMode('select');
  }
  if (typeof setWorkspaceSurface === 'function') {
    setWorkspaceSurface('reviewOutput');
  }
  var availability = getReviewAvailability();
  if (!availability.enabled) {
    setStatus(availability.message.replace('Review Captions', 'Selection Analysis') + '.');
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
  setStatus('Building selection report...');
  try {
    var results = getVisibleReviewItems();
    if (!results.length) {
      setStatus('No visible media items to review.');
      updateReviewButtonAvailability();
      return;
    }
    var report = buildSelectionReport(results);
    renderSelectionPreview(report, results.map(function (row) { return row.fileName; }));
    setStatus('Selection review ready: ' + results.length + ' files');
  } catch (err) {
    setStatus(String(err && err.message ? err.message : err));
  }
}

function selectByFileName(fileName, focusFiles, focusSource, reportType) {
  if (!fileName) {
    return;
  }
  if (typeof isMediaGridSurfaceOpen === 'function' && isMediaGridSurfaceOpen() && typeof closeMediaGridSurface === 'function') {
    closeMediaGridSurface();
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
    activateFocusSet(focusFiles, focusSource || 'Focused Items', reportType || '');
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
