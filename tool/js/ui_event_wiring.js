function handleCurrentFolderRowContextMenu(e) {
  e.preventDefault();
  showContextMenu(e.clientX, e.clientY, buildCurrentFolderContextActions());
}

function handleMediaListDoubleClick(e) {
  var row = e.target.closest('.media-item');
  if (!row) return;
  var type = row.getAttribute('data-type');
  var key = row.getAttribute('data-key');
  if (type !== 'media') return;
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

function handleMediaListClick(e) {
  var row = e.target.closest('.media-item');
  if (!row) return;
  var type = row.getAttribute('data-type');
  var key = row.getAttribute('data-key');
  if (type === 'up') {
    navigateUp();
    return;
  }
  if (type === 'folder') {
    navigateIntoFolder(key);
    return;
  }
  if (type !== 'media') return;
  var mediaItem = state.items.find(function (item) { return item.key === key; });
  if (!mediaItem) return;
  if (typeof isMediaGridSurfaceOpen === 'function' && isMediaGridSurfaceOpen() && typeof closeMediaGridSurface === 'function') {
    closeMediaGridSurface();
  }
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

function handleMediaListContextMenu(e) {
  var row = e.target.closest('.media-item');
  if (!row) return;
  var type = row.getAttribute('data-type');
  var key = row.getAttribute('data-key');
  e.preventDefault();

  if (type === 'folder') {
    showContextMenu(e.clientX, e.clientY, buildFolderContextMenuActions(key));
    return;
  }
  if (type !== 'media') return;
  var mediaItem = state.items.find(function (item) { return item.key === key; });
  if (!mediaItem) return;
  showContextMenu(e.clientX, e.clientY, buildMediaContextMenuActions(mediaItem, key));
}

function wireConsoleToggleButton() {
  var ctBtn = document.getElementById('console-toggle-btn');
  if (!ctBtn) return;
  if (typeof syncConsoleToggleButton === 'function') {
    syncConsoleToggleButton();
  }
  ctBtn.onclick = function() {
    toggleConsolePanel();
  };
}

function extractTrainingPreviewCommand(outputText) {
  if (!outputText) return '';
  var lines = String(outputText).split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = String(lines[i] || '').trim();
    if (!line) continue;
    if (line.indexOf('deepspeed --num_gpus=1 train.py --deepspeed --config') === -1) continue;
    return line;
  }
  return '';
}

function copyTextToClipboard(text, onOk, onErr) {
  var value = String(text || '');
  if (!value) {
    if (onErr) onErr(new Error('Nothing to copy'));
    return;
  }
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(value).then(function () {
      if (onOk) onOk();
    }).catch(function () {
      tryLegacyCopy();
    });
    return;
  }
  tryLegacyCopy();

  function tryLegacyCopy() {
    var ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (_e) {
      ok = false;
    }
    document.body.removeChild(ta);
    if (ok) {
      if (onOk) onOk();
      return;
    }
    if (onErr) onErr(new Error('Clipboard copy failed'));
  }
}

function wireMiscActionButtons() {
  if (ui.refreshBtn) {
    ui.refreshBtn.onclick = function () {
      refreshCurrentDirectory();
    };
  }

  if (ui.reviewSetBtn) {
    ui.reviewSetBtn.onclick = function () {
      runReview();
    };
  }


  if (ui.sidebarFocusBtnEl) {
    ui.sidebarFocusBtnEl.onclick = function () {
      if (typeof openFocusedAnnotationModal === 'function') {
        openFocusedAnnotationModal();
      }
    };
  }

  if (ui.createSetFromResultsBtn) {
    ui.createSetFromResultsBtn.onclick = function () {
      runCreateSetFromResultsFlow();
    };
  }

  if (ui.upBtn) {
    ui.upBtn.onclick = function () {
      navigateUp();
    };
  }

  if (ui.focusSetExitBtn) {
    ui.focusSetExitBtn.onclick = function () {
      exitFocusSetToBrowsing();
    };
  }

  if (ui.focusSetReturnBtn) {
    ui.focusSetReturnBtn.onclick = function () {
      rerunFocusSetReport();
    };
  }

  if (ui.statsRunBtn) {
    ui.statsRunBtn.onclick = function () {
      runReview();
    };
  }
}

function wireReportLinks() {
  document.querySelectorAll('.fail-link').forEach(function(btn){
    btn.addEventListener('click', function(){
      var f = btn.getAttribute('data-file') || '';
      var focus = btn.getAttribute('data-focus') || '';
      var source = btn.getAttribute('data-source') || '';
      var files = [];
      if (focus) files = decodeURIComponent(focus).split('\n').filter(Boolean);
      if (parent && parent.postMessage) {
        parent.postMessage({
          type: 'caption-review-select',
          fileName: decodeURIComponent(f),
          focusFiles: files,
          focusSource: decodeURIComponent(source || ''),
          reportType: 'review'
        }, '*');
      }
    });
  });
  document.querySelectorAll('.token-link').forEach(function(btn){
    btn.addEventListener('click', function(){
      var t = btn.getAttribute('data-token') || '';
      if (parent && parent.postMessage) {
        parent.postMessage({ type: 'caption-review-token', token: decodeURIComponent(t) }, '*');
      }
    });
  });
}

function wireMainUiEvents() {
  if (ui.currentFolderRow) {
    ui.currentFolderRow.oncontextmenu = handleCurrentFolderRowContextMenu;
  }
  if (ui.mediaListEl) {
    ui.mediaListEl.ondblclick = handleMediaListDoubleClick;
    ui.mediaListEl.onclick = handleMediaListClick;
    ui.mediaListEl.oncontextmenu = handleMediaListContextMenu;
  }
  wireConsoleToggleButton();
  wireMiscActionButtons();
  wireReportLinks();
  if (typeof updateSidebarSurfaceTools === 'function') {
    updateSidebarSurfaceTools();
  }
}
