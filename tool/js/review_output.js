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
  if (reportType === 'review') return 'Review Set';
  if (reportType === 'pruneCandidates') return 'Prune Candidates';
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
    if (reportType === 'review') {
      runReview();
    } else if (reportType === 'pruneCandidates') {
      openPruneCandidatesReport();
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
  if (ui.reviewSetBtn) {
    ui.reviewSetBtn.disabled = false;
    ui.reviewSetBtn.classList.toggle('hidden', !availability.enabled);
    ui.reviewSetBtn.title = availability.message;
  }
  if (ui.captionSheetBtn) {
    ui.captionSheetBtn.disabled = false;
    ui.captionSheetBtn.classList.toggle('hidden', !availability.enabled);
    ui.captionSheetBtn.title = availability.enabled
      ? 'Show the current visible captions as one spellchecked text sheet'
      : availability.message;
  }
  var pruneAvailable = isSetFolderPath(state.folder) && Array.isArray(state.items) && state.items.length > 0;
  ui.pruneCandidatesBtn.disabled = false;
  ui.pruneCandidatesBtn.classList.toggle('hidden', !pruneAvailable);
  ui.pruneCandidatesBtn.title = pruneAvailable
    ? 'Review whole-set prune candidates'
    : 'Prune Candidates requires at least one media file in a set folder';
  refreshReviewOutputSummary();
}

function showCaptionSheet() {
  var availability = getReviewAvailability();
  if (!availability.enabled) {
    setStatus(availability.message + '.');
    return;
  }
  if (state.currentItem && state.currentItem.fileName) {
    savePathCaption();
  }
  var items = getVisibleReviewItems();
  if (!items.length) {
    setStatus('No visible media items to review.');
    return;
  }
  if (ui.captionSheetTextEl) ui.captionSheetTextEl.value = buildCombinedCaptionsText(items);
  if (ui.captionSheetSummaryEl) {
    ui.captionSheetSummaryEl.textContent = items.length + ' visible caption' + (items.length === 1 ? '' : 's');
  }
  if (ui.captionSheetPane) ui.captionSheetPane.classList.remove('hidden');
  ui.pruneCandidatesPane.classList.add('hidden');
  if (ui.captionSheetBtn) ui.captionSheetBtn.setAttribute('aria-pressed', 'true');
  ui.pruneCandidatesBtn.setAttribute('aria-pressed', 'false');
  setStatus('Caption sheet ready: ' + items.length + ' files');
}

function updateSetFolderScopedUi() {
  var inSetFolder = isSetFolderPath(state.folder);
  var reviewAvailable = getReviewAvailability().enabled;
  var workspace = document.getElementById('sidebar-workspace');
  if (!workspace) return;
  workspace.classList.toggle('hidden', !inSetFolder);
  var reviewBtn = document.getElementById('sidebar-open-review-output-btn');
  var trainingBtn = document.getElementById('sidebar-open-training-btn');
  var drawer = document.getElementById('sidebar-set-actions-drawer');
  var createSetBtn = document.getElementById('create-set-from-results-btn');
  if (reviewBtn) reviewBtn.classList.toggle('hidden', !reviewAvailable);
  if (trainingBtn) trainingBtn.classList.toggle('hidden', !inSetFolder);
  if (drawer) drawer.classList.toggle('hidden', !inSetFolder && (!createSetBtn || createSetBtn.classList.contains('hidden')));
}

function getReviewAvailability() {
  if (!isSetFolderPath(state.folder)) {
    return {
      enabled: false,
      message: 'Review Set is only available inside a set folder'
    };
  }
  if (!Array.isArray(state.items) || !state.items.length) {
    return {
      enabled: false,
      message: 'Review Set requires at least one media file in this set folder'
    };
  }
  var visibleCount = getVisibleReviewItems().length;
  if (!visibleCount) {
    return {
      enabled: false,
      message: 'Review Set requires at least one visible media item'
    };
  }
  return {
    enabled: true,
    message: 'Review the current set'
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

function buildReviewScopeSummary(items) {
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
  var reviewPane = document.getElementById('review-output-review-pane');
  if (reviewPane) reviewPane.classList.remove('hidden');
  ui.pruneCandidatesPane.classList.add('hidden');
  ui.pruneCandidatesBtn.setAttribute('aria-pressed', 'false');
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
    renderReviewSetPreview(report, results.map(function (row) { return row.fileName; }), buildReviewScopeSummary(results));
    setStatus('Review ready: ' + results.length + ' files');
  } catch (err) {
    setStatus(String(err && err.message ? err.message : err));
  }
}

function selectByFileName(fileName, focusFiles, focusSource, reportType, options) {
  if (!fileName) {
    return;
  }
  var opts = options || {};
  if (typeof isMediaGridSurfaceOpen === 'function' && isMediaGridSurfaceOpen() && typeof closeMediaGridSurface === 'function') {
    closeMediaGridSurface();
  }

  function doSelect() {
    var target = null;
    var clearedTextFilter = false;
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

    if (!opts.preserveMediaFilters && ui.filterEl.value && !isMediaItemInCurrentFilteredList(target)) {
      var currentTextFilter = ui.filterEl.value;
      ui.filterEl.value = '';
      if (isMediaItemInCurrentFilteredList(target)) {
        clearedTextFilter = true;
        ui.filterEl.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        ui.filterEl.value = currentTextFilter;
      }
    }

    selectPathMedia(target).then(function () {
      if (typeof scrollCurrentMediaRowIntoView === 'function') {
        scrollCurrentMediaRowIntoView();
      }
      if (clearedTextFilter) {
        setStatus('Selected ' + fileName + '; cleared the text filter to reach it.');
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
