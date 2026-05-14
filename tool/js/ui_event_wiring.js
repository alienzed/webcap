function handleCurrentFolderRowContextMenu(e) {
  e.preventDefault();
  showContextMenu(e.clientX, e.clientY, buildCurrentFolderContextActions());
}

var utilityPathFlyoutOpen = false;

function buildUtilityPathSegments() {
  var stack = (state.dirStack && state.dirStack.length) ? state.dirStack.slice() : [{ name: '' }];
  if (!stack.length) stack = [{ name: '' }];
  return stack.map(function (entry, idx) {
    if (idx === 0) {
      return String(ROOT_FOLDER_LABEL || 'root');
    }
    return String((entry && entry.name) || '');
  });
}

function closeUtilityPathFlyout() {
  utilityPathFlyoutOpen = false;
  if (ui.utilityPathFlyoutEl) {
    ui.utilityPathFlyoutEl.classList.remove('open');
  }
  if (ui.utilityCurrentPathBtn) {
    ui.utilityCurrentPathBtn.setAttribute('aria-expanded', 'false');
  }
}

function refreshUtilityPathFlyout() {
  if (!utilityPathFlyoutOpen || !ui.utilityPathFlyoutEl) return;
  renderUtilityPathFlyout();
}

function renderUtilityPathFlyout() {
  if (!ui.utilityPathFlyoutEl) return;
  var flyout = ui.utilityPathFlyoutEl;
  flyout.innerHTML = '';
  var labels = buildUtilityPathSegments();
  for (var i = 0; i < labels.length; i++) {
    (function (idx) {
      var segmentBtn = document.createElement('button');
      segmentBtn.type = 'button';
      segmentBtn.className = 'utility-path-segment' + (idx === labels.length - 1 ? ' current' : '');
      segmentBtn.textContent = labels[idx] || '/';
      segmentBtn.title = labels[idx] || '/';
      segmentBtn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof navigateToDirStackIndex === 'function') {
          navigateToDirStackIndex(idx);
        }
        closeUtilityPathFlyout();
      };
      flyout.appendChild(segmentBtn);
      if (idx < labels.length - 1) {
        var separator = document.createElement('span');
        separator.className = 'utility-path-separator';
        separator.textContent = '›';
        flyout.appendChild(separator);
      }
    })(i);
  }
}

function toggleUtilityPathFlyout() {
  if (!ui.utilityCurrentPathBtn || !ui.utilityPathFlyoutEl) return;
  utilityPathFlyoutOpen = !utilityPathFlyoutOpen;
  if (utilityPathFlyoutOpen) {
    renderUtilityPathFlyout();
    ui.utilityPathFlyoutEl.classList.add('open');
    ui.utilityCurrentPathBtn.setAttribute('aria-expanded', 'true');
    return;
  }
  closeUtilityPathFlyout();
}

function wireUtilityPathFlyout() {
  if (!ui.utilityCurrentPathBtn || !ui.utilityPathFlyoutEl) return;
  if (ui.utilityCurrentPathBtn.__pathFlyoutWired) return;
  ui.utilityCurrentPathBtn.__pathFlyoutWired = true;
  ui.utilityCurrentPathBtn.setAttribute('aria-expanded', 'false');
  document.addEventListener('click', function (e) {
    if (!utilityPathFlyoutOpen) return;
    var target = e.target;
    var inButton = ui.utilityCurrentPathBtn.contains(target);
    var inFlyout = ui.utilityPathFlyoutEl.contains(target);
    if (inButton || inFlyout) return;
    closeUtilityPathFlyout();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeUtilityPathFlyout();
    }
  });
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
    state.folder = (state.folder ? state.folder + '/' : '') + key;
    if (state.dirStack.length) {
      state.dirStack.push({ name: key });
    }
    state.currentItem = null;
    clearEditorAndPreview();
    refreshCurrentDirectory();
    return;
  }
  if (type !== 'media') return;
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
  ctBtn.onclick = function() {
    toggleConsolePanel();
    ctBtn.innerHTML = (ui.consolePanelEl.style.display === 'none' || !ui.consolePanelEl.style.display) ? '&#x25B2;' : '&#x25BC;';
  };
}

function wireTrainingButtons() {
  var trainingGenerateBtn = document.getElementById('training-generate-btn');
  if (trainingGenerateBtn) {
    trainingGenerateBtn.onclick = function () {
      runGenerateDatasetConfigsForCurrentFolder(
        function () {
          refreshTrainingConfigList();
          if (state.currentConfigFile) {
            ui.editorEl.value = '';
            setStatus('Dataset configs generated. Please reload the config file to see changes.');
            state.currentConfigFile = null;
          } else {
            setStatus('Dataset configs generated.');
          }
        }
      );
    };
  }

  var trainingPrepareDatasetBtn = document.getElementById('training-prepare-dataset-btn');
  if (trainingPrepareDatasetBtn) {
    trainingPrepareDatasetBtn.onclick = function () {
      runPrepareDatasetForCurrentFolder();
    };
  }

  var trainingTrainBtn = document.getElementById('training-train-btn');
  if (trainingTrainBtn) {
    trainingTrainBtn.onclick = function () {
      if (!ensureFolderSelected('No folder selected for training.')) {
        return;
      }
      setStatus('Printing training commands...');
      streamPreviewFromFetch(
        '/fs/train_run',
        { folder: state.folder },
        ui,
        function () {
          setStatus('Training command preview finished.');
        },
        function (err) {
          setStatus('Training command preview failed: ' + err);
        }
      );
    };
  }
}

function wireMiscActionButtons() {
  if (ui.refreshBtn) {
    ui.refreshBtn.onclick = function () {
      refreshCurrentDirectory();
    };
  }

  if (ui.reviewBtn) {
    ui.reviewBtn.onclick = function () {
      runReview();
    };
  }

  if (ui.upBtn) {
    ui.upBtn.onclick = function () {
      navigateUp();
    };
  } else if (ui.upRow) {
    ui.upRow.onclick = function () {
      navigateUp();
    };
  }

  if (ui.focusSetExitBtn) {
    ui.focusSetExitBtn.onclick = function () {
      state.focusSet = null;
      if (ui.editorEl) ui.editorEl.removeAttribute('readonly');
      clearEditorAndPreview();
      refreshCurrentDirectory();
      ui.focusSetExitBtn.style.display = 'none';
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
          focusSource: decodeURIComponent(source || '')
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
  wireUtilityPathFlyout();
  if (ui.currentFolderRow) {
    ui.currentFolderRow.oncontextmenu = handleCurrentFolderRowContextMenu;
  }
  if (ui.mediaListEl) {
    ui.mediaListEl.ondblclick = handleMediaListDoubleClick;
    ui.mediaListEl.onclick = handleMediaListClick;
    ui.mediaListEl.oncontextmenu = handleMediaListContextMenu;
  }
  wireConsoleToggleButton();
  wireTrainingButtons();
  wireMiscActionButtons();
  wireReportLinks();
}
