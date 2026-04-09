(function() {
  var MEDIA_EXTENSIONS = {
    '.mp4': true, '.webm': true, '.ogg': true, '.mov': true, '.mkv': true, '.avi': true, '.m4v': true,
    '.jpg': true, '.jpeg': true, '.png': true, '.gif': true, '.webp': true, '.bmp': true
  };

  function startStatsMode(context) {
    var ui = context.ui;
    var state = {
      dirHandle: null,
      dirNames: [],
      runToken: 0,
      items: []
    };

    configureUiForStatsMode(ui);
    wireActions(ui, state);
    tryRestoreSavedDirectory(ui, state).then(function(restored) {
      if (!restored) {
        setStatus(ui, 'Stats mode ready. Choose Folder to begin.');
      }
    });
  }

  function configureUiForStatsMode(ui) {
    ui.createBtn.style.display = 'none';
    ui.topInputRow.classList.add('single');
    ui.newPageNameEl.readOnly = true;
    ui.newPageNameEl.classList.add('caption-folder-label');
    ui.newPageNameEl.value = 'No folder selected';
    ui.openPageBtn.textContent = 'Choose Folder';
    ui.captionUpBtn.style.display = '';
    ui.captionUpBtn.textContent = 'Refresh Stats';
    ui.captionUpBtn.title = 'Recalculate stats';
    ui.dropZone.style.display = 'none';
    ui.filterEl.style.display = 'none';
    if (ui.reviewBtn) {
      ui.reviewBtn.style.display = 'none';
    }
    ui.pageListEl.classList.add('stats-mode-list');
    ui.pageListEl.innerHTML = StatsViewModule.buildStatsPanelHtml('Recalculate');

    ui.editorEl.value = '';
    ui.editorEl.readOnly = true;
    ui.editorEl.placeholder = 'Combined captions will appear here after Recalculate.';

    StatsViewModule.renderReportPreview(ui, {
      total: 0,
      withCaption: 0,
      missingCaption: 0,
      requiredPhrase: '',
      requiredHits: 0,
      requiredPercent: 0,
      phraseSummary: [],
      ruleFailures: [],
      topTokens: [],
      rareTokens: []
    });
  }

  function wireActions(ui, state) {
    ui.openPageBtn.onclick = function() {
      chooseFolder(ui, state);
    };

    ui.captionUpBtn.onclick = function() {
      recalculateStats(ui, state);
    };

    var runBtn = document.getElementById('stats-run-btn');
    if (runBtn) {
      runBtn.onclick = function() {
        recalculateStats(ui, state);
      };
    }
  }

  function chooseFolder(ui, state) {
    if (typeof window.showDirectoryPicker !== 'function') {
      setStatus(ui, 'Choose Folder requires Chromium browser support.');
      return;
    }

    window.showDirectoryPicker().then(function(rootHandle) {
      state.dirHandle = rootHandle;
      state.dirNames = [rootHandle.name];
      ui.newPageNameEl.value = state.dirNames.join(' / ');
      if (window.DirHandleStoreModule) {
        DirHandleStoreModule.saveLastDir(rootHandle, state.dirNames);
      }
      recalculateStats(ui, state);
    }).catch(function(err) {
      if (err && err.name === 'AbortError') {
        setStatus(ui, 'Folder selection canceled');
        return;
      }
      setStatus(ui, String(err && err.message ? err.message : err));
    });
  }

  async function tryRestoreSavedDirectory(ui, state) {
    if (!window.DirHandleStoreModule) {
      return false;
    }

    var saved = await DirHandleStoreModule.loadLastDir();
    if (!saved || !saved.handle) {
      return false;
    }

    var granted = await hasReadPermission(saved.handle);
    if (!granted) {
      return false;
    }

    state.dirHandle = saved.handle;
    state.dirNames = (saved.dirNames && saved.dirNames.length) ? saved.dirNames : [saved.handle.name];
    ui.newPageNameEl.value = state.dirNames.join(' / ');
    recalculateStats(ui, state);
    setStatus(ui, 'Reused folder from Caption mode');
    return true;
  }

  async function hasReadPermission(handle) {
    try {
      var permission = await handle.queryPermission({ mode: 'read' });
      return permission === 'granted';
    } catch (err) {
      return false;
    }
  }

  async function recalculateStats(ui, state) {
    if (!state.dirHandle) {
      setStatus(ui, 'No folder selected');
      return;
    }

    var token = ++state.runToken;
    setStatus(ui, 'Calculating stats...');

    try {
      var items = await readCaptionItems(state.dirHandle);
      if (token !== state.runToken) {
        return;
      }
      state.items = items;

      var options = StatsViewModule.getOptionsFromDom();
      var report = StatsEngineModule.compute(items, {
        requiredPhrase: options.requiredPhrase,
        phrases: options.phrases,
        tokenRules: options.tokenRules
      });

      ui.editorEl.value = StatsViewModule.buildCombinedCaptionsText(items);
      StatsViewModule.renderReportPreview(ui, report);
      setStatus(ui, 'Stats updated: ' + report.total + ' files');
    } catch (err) {
      setStatus(ui, String(err && err.message ? err.message : err));
    }
  }

  async function readCaptionItems(dirHandle) {
    var items = [];

    for await (var entry of dirHandle.values()) {
      if (entry.kind !== 'file') {
        continue;
      }
      var ext = CaptionUtils.getFileExtension(entry.name);
      if (!MEDIA_EXTENSIONS[ext]) {
        continue;
      }

      var captionName = entry.name.replace(/\.[^.]+$/, '.txt');
      var captionText = '';
      try {
        var captionHandle = await dirHandle.getFileHandle(captionName);
        var captionFile = await captionHandle.getFile();
        captionText = await captionFile.text();
      } catch (err) {
        captionText = '';
      }

      items.push({
        fileName: entry.name,
        caption: captionText
      });
    }

    items.sort(function(a, b) { return a.fileName.localeCompare(b.fileName); });
    return items;
  }

  function setStatus(ui, text) {
    ui.statusEl.textContent = text || '';
  }

  ModeRouterModule.registerMode('stats', startStatsMode);
})();