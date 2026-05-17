var appSettingsLoadedConfig = null;

function setAppSettingsStatus(text, isError) {
  if (!ui.appSettingsStatusEl) return;
  ui.appSettingsStatusEl.textContent = text || '';
  ui.appSettingsStatusEl.style.color = isError ? '#b91c1c' : '';
}

function normalizeAppConfigShape(cfg) {
  var out = (cfg && typeof cfg === 'object') ? JSON.parse(JSON.stringify(cfg)) : {};
  if (!out.filesystem || typeof out.filesystem !== 'object') out.filesystem = {};
  if (!out.training || typeof out.training !== 'object') out.training = {};
  if (typeof out.debug !== 'boolean') out.debug = !!out.debug;
  if (!out.filesystem.root) out.filesystem.root = '';
  if (!out.filesystem.models) out.filesystem.models = '';
  if (!out.training.diffusion_pipe_wsl) out.training.diffusion_pipe_wsl = '';
  if (!out.training.activate_script) out.training.activate_script = '';
  if (!out.training.config_hi) out.training.config_hi = '';
  if (!out.training.config_lo) out.training.config_lo = '';
  if (out.training.mode === 'quality') out.training.mode = 'normal';
  if (!out.training.mode || ['poc', 'normal'].indexOf(out.training.mode) === -1) out.training.mode = 'normal';
  return out;
}

function renderAppSettingsJson(cfg) {
  if (!ui.appSettingsJsonEl) return;
  ui.appSettingsJsonEl.value = JSON.stringify(cfg, null, 2);
}

function fillAppSettingsForm(cfg) {
  var c = normalizeAppConfigShape(cfg);
  if (ui.appSettingsRootEl) ui.appSettingsRootEl.value = c.filesystem.root || '';
  if (ui.appSettingsModelsEl) ui.appSettingsModelsEl.value = c.filesystem.models || '';
  if (ui.appSettingsTrainingDiffusionPipeWslEl) ui.appSettingsTrainingDiffusionPipeWslEl.value = c.training.diffusion_pipe_wsl || '';
  if (ui.appSettingsTrainingActivateScriptEl) ui.appSettingsTrainingActivateScriptEl.value = c.training.activate_script || '';
  if (ui.appSettingsTrainingConfigHiEl) ui.appSettingsTrainingConfigHiEl.value = c.training.config_hi || '';
  if (ui.appSettingsTrainingConfigLoEl) ui.appSettingsTrainingConfigLoEl.value = c.training.config_lo || '';
  var mode = c.training.mode || 'normal';
  if (mode === 'poc' && ui.appSettingsTrainingModePocEl) ui.appSettingsTrainingModePocEl.checked = true;
  else if (ui.appSettingsTrainingModeNormalEl) ui.appSettingsTrainingModeNormalEl.checked = true;
  if (ui.appSettingsDebugEl) ui.appSettingsDebugEl.checked = !!c.debug;
  renderAppSettingsJson(c);
}

function collectAppSettingsFormConfig() {
  var mode = 'normal';
  if (ui.appSettingsTrainingModePocEl && ui.appSettingsTrainingModePocEl.checked) mode = 'poc';
  return normalizeAppConfigShape({
    filesystem: {
      root: ui.appSettingsRootEl ? ui.appSettingsRootEl.value : '',
      models: ui.appSettingsModelsEl ? ui.appSettingsModelsEl.value : '',
    },
    debug: !!(ui.appSettingsDebugEl && ui.appSettingsDebugEl.checked),
    training: {
      diffusion_pipe_wsl: ui.appSettingsTrainingDiffusionPipeWslEl ? ui.appSettingsTrainingDiffusionPipeWslEl.value : '',
      activate_script: ui.appSettingsTrainingActivateScriptEl ? ui.appSettingsTrainingActivateScriptEl.value : '',
      config_hi: ui.appSettingsTrainingConfigHiEl ? ui.appSettingsTrainingConfigHiEl.value : '',
      config_lo: ui.appSettingsTrainingConfigLoEl ? ui.appSettingsTrainingConfigLoEl.value : '',
      mode: mode,
    }
  });
}

function syncAppSettingsJsonFromForm() {
  renderAppSettingsJson(collectAppSettingsFormConfig());
}

function parseAppSettingsJson() {
  var text = (ui.appSettingsJsonEl && ui.appSettingsJsonEl.value) ? ui.appSettingsJsonEl.value.trim() : '';
  if (!text) return collectAppSettingsFormConfig();
  return normalizeAppConfigShape(JSON.parse(text));
}

function openAppSettingsModal() {
  if (!ui.appSettingsModalEl) return;
  setAppSettingsStatus('Loading settings...', false);
  ui.appSettingsModalEl.classList.remove('hidden');
  ui.appSettingsModalEl.setAttribute('aria-hidden', 'false');
  HttpModule.get('/app/config', function (status, responseText) {
    if (status !== 200) {
      setAppSettingsStatus('Failed to load settings.', true);
      return;
    }
    try {
      var cfg = JSON.parse(responseText);
      appSettingsLoadedConfig = normalizeAppConfigShape(cfg);
      fillAppSettingsForm(appSettingsLoadedConfig);
      setAppSettingsStatus('', false);
    } catch (e) {
      setAppSettingsStatus('Failed to parse settings JSON.', true);
    }
  });
}

function closeAppSettingsModal() {
  if (!ui.appSettingsModalEl) return;
  ui.appSettingsModalEl.classList.add('hidden');
  ui.appSettingsModalEl.setAttribute('aria-hidden', 'true');
}

function setRootFolderLabelFromConfig(cfg) {
  if (!cfg || !cfg.filesystem || !cfg.filesystem.root) return;
  var rootPath = String(cfg.filesystem.root || '');
  ROOT_FOLDER_PATH = rootPath;
  ROOT_FOLDER_LABEL = String(rootPath).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || ROOT_FOLDER_LABEL;
}

function saveAppSettings(opts) {
  var saveAndReload = !!(opts && opts.reloadAfterSave);
  var payload = null;
  try {
    payload = parseAppSettingsJson();
  } catch (e) {
    setAppSettingsStatus('Invalid JSON: ' + (e && e.message ? e.message : e), true);
    return;
  }
  setAppSettingsStatus('Saving settings...', false);
  HttpModule.postJson('/app/config', payload, function (status, responseText) {
    if (status !== 200) {
      setAppSettingsStatus(getErrorMessage(responseText, 'Failed to save settings.'), true);
      return;
    }
    var saved = null;
    try {
      var parsed = JSON.parse(responseText);
      saved = normalizeAppConfigShape(parsed.config || payload);
    } catch (e) {
      saved = normalizeAppConfigShape(payload);
    }
    appSettingsLoadedConfig = saved;
    fillAppSettingsForm(saved);
    setRootFolderLabelFromConfig(saved);
    if (saveAndReload) {
      triggerRuntimeConfigReload(true);
      return;
    }
    setAppSettingsStatus('Saved. Click Reboot to apply runtime changes.', false);
    setStatus('Settings saved.');
  });
}

function triggerRuntimeConfigReload(quietInModal) {
  HttpModule.postJson('/app/reboot', {}, function (status, responseText) {
    if (status !== 200) {
      var msg = getErrorMessage(responseText, 'Reboot failed.');
      setStatus(msg);
      if (!quietInModal) setAppSettingsStatus(msg, true);
      return;
    }
    var cfg = null;
    try {
      var parsed = JSON.parse(responseText);
      cfg = normalizeAppConfigShape(parsed.config || {});
    } catch (e) {
      cfg = null;
    }
    if (cfg) {
      appSettingsLoadedConfig = cfg;
      fillAppSettingsForm(cfg);
      setRootFolderLabelFromConfig(cfg);
    }
    if (!quietInModal) setAppSettingsStatus('Runtime settings reloaded.', false);
    setStatus('Runtime settings reloaded from config.json.');
    refreshCurrentDirectory();
  });
}

function updateUtilityPathLabel(pathText) {
  if (!ui.utilityCurrentPathBtn) return;
  var normalized = String(pathText || '').trim();
  var rootLabel = String(ROOT_FOLDER_LABEL || '').trim();
  var tooltipPath = normalized || '';
  if (rootLabel) {
    tooltipPath = tooltipPath ? (rootLabel + '/' + tooltipPath) : rootLabel;
  }
  ui.utilityCurrentPathBtn.title = tooltipPath ? ('Current folder: ' + tooltipPath) : 'Current folder';
  refreshUtilityPathFlyout();

}

function openHelpReadmeInPreview() {
  setStatus('Loading help...');
  HttpModule.get('/app/help_readme', function (status, responseText) {
    if (status !== 200) {
      setStatus('Help load failed.');
      return;
    }
    var doc = ui.previewEl.contentDocument || ui.previewEl.contentdocument;
    if (!doc) {
      setStatus('Help load failed.');
      return;
    }
    var escaped = escapeHtml(responseText || '');
    doc.open();
    doc.write(
      '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
      '<body style="font-family:Consolas,monospace;padding:16px;background:#f8fafc;color:#1f2937;line-height:1.4;">' +
      '<h3 style="margin-top:0;font-family:system-ui;">README</h3>' +
      '<pre style="white-space:pre-wrap;margin:0;">' + escaped + '</pre>' +
      '</body></html>'
    );
    doc.close();
    setStatus('Help loaded.');
  });
}

function wireAppSettingsUi() {
  if (ui.utilitySettingsBtn) ui.utilitySettingsBtn.onclick = openAppSettingsModal;
  if (ui.utilityHelpBtn) ui.utilityHelpBtn.onclick = openHelpReadmeInPreview;
  if (ui.utilityRebootBtn) {
    ui.utilityRebootBtn.onclick = function () {
      if (!confirm('Reload runtime settings from config.json now?')) return;
      triggerRuntimeConfigReload(false);
    };
  }
  if (ui.utilityCurrentPathBtn) {
    ui.utilityCurrentPathBtn.onclick = function () {
      if (typeof toggleUtilityPathFlyout === 'function') {
        toggleUtilityPathFlyout();
      }
    };
  }

  if (ui.appSettingsCloseBtn) ui.appSettingsCloseBtn.onclick = closeAppSettingsModal;
  if (ui.appSettingsCancelBtn) ui.appSettingsCancelBtn.onclick = closeAppSettingsModal;
  if (ui.appSettingsSaveBtn) {
    ui.appSettingsSaveBtn.onclick = function () {
      saveAppSettings({ reloadAfterSave: false });
    };
  }
  if (ui.appSettingsSaveReloadBtn) {
    ui.appSettingsSaveReloadBtn.onclick = function () {
      saveAppSettings({ reloadAfterSave: true });
    };
  }
  if (ui.appSettingsModalEl) {
    ui.appSettingsModalEl.addEventListener('click', function (e) {
      if (e.target === ui.appSettingsModalEl) {
        closeAppSettingsModal();
      }
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!ui.appSettingsModalEl || ui.appSettingsModalEl.classList.contains('hidden')) return;
    closeAppSettingsModal();
  });

  var syncFields = [
    ui.appSettingsRootEl,
    ui.appSettingsModelsEl,
    ui.appSettingsTrainingDiffusionPipeWslEl,
    ui.appSettingsTrainingActivateScriptEl,
    ui.appSettingsTrainingConfigHiEl,
    ui.appSettingsTrainingConfigLoEl,
    ui.appSettingsDebugEl,
  ];
  syncFields.forEach(function (el) {
    if (!el) return;
    el.addEventListener('input', syncAppSettingsJsonFromForm);
    el.addEventListener('change', syncAppSettingsJsonFromForm);
  });
  if (ui.appSettingsJsonEl) {
    ui.appSettingsJsonEl.addEventListener('blur', function () {
      try {
        fillAppSettingsForm(parseAppSettingsJson());
        setAppSettingsStatus('', false);
      } catch (e) {
        setAppSettingsStatus('Invalid JSON: ' + (e && e.message ? e.message : e), true);
      }
    });
  }
}
