var appSettingsLoadedConfig = null;
var appSettingsActiveTab = 'general';
var appSettingsTrainingProfiles = [
  { id: 'wan22_t2v', uiKey: 'appSettingsTrainingProfileWan22El' },
  { id: 'krea2_raw', uiKey: 'appSettingsTrainingProfileKrea2El' },
  { id: 'wan21_t2v_14b', uiKey: 'appSettingsTrainingProfileWan21El' },
  { id: 'minimax_h3', uiKey: 'appSettingsTrainingProfileH3El' }
];

function setAppSettingsTab(tabName, focusTab) {
  var next = ['general', 'training', 'advanced'].indexOf(tabName) !== -1 ? tabName : 'general';
  appSettingsActiveTab = next;
  var selectedButton = null;
  Array.prototype.forEach.call(document.querySelectorAll('[data-app-settings-tab]'), function (button) {
    var active = button.getAttribute('data-app-settings-tab') === next;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
    if (active) selectedButton = button;
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-app-settings-panel]'), function (panel) {
    var active = panel.getAttribute('data-app-settings-panel') === next;
    panel.classList.toggle('hidden', !active);
    panel.hidden = !active;
  });
  if (focusTab && selectedButton) selectedButton.focus();
}

function setAppSettingsStatus(text, isError) {
  if (!ui.appSettingsStatusEl) return;
  ui.appSettingsStatusEl.textContent = text || '';
  ui.appSettingsStatusEl.style.color = isError ? '#b91c1c' : '';
}

function normalizeAppConfigShape(cfg) {
  var out = (cfg && typeof cfg === 'object') ? JSON.parse(JSON.stringify(cfg)) : {};
  if (!out.filesystem || typeof out.filesystem !== 'object') out.filesystem = {};
  if (!out.training || typeof out.training !== 'object') out.training = {};
  if (!out.primer || typeof out.primer !== 'object') out.primer = {};
  if (!out.requirements || typeof out.requirements !== 'object') out.requirements = {};
  if (typeof out.debug !== 'boolean') out.debug = !!out.debug;
  if (!out.filesystem.root) out.filesystem.root = '';
  if (!out.filesystem.models) out.filesystem.models = '';
  if (!out.training.diffusion_pipe_wsl) out.training.diffusion_pipe_wsl = '';
  if (!out.training.wsl_distribution) out.training.wsl_distribution = '';
  if (!out.training.conda_executable) out.training.conda_executable = '';
  if (!out.training.conda_environment) out.training.conda_environment = '';
  if (!out.training.activate_script) out.training.activate_script = '';
  delete out.training.mode;
  delete out.training.write_selection_snapshot_comments;
  if (!Array.isArray(out.training.enabled_profiles)) {
    out.training.enabled_profiles = appSettingsTrainingProfiles.map(function (profile) { return profile.id; });
  } else {
    out.training.enabled_profiles = out.training.enabled_profiles.map(function (profileId) {
      return String(profileId || '').trim().toLowerCase();
    });
  }
  if (typeof out.primer.template !== 'string') out.primer.template = '';
  if (!out.analysis || typeof out.analysis !== 'object') out.analysis = {};
  if (typeof out.analysis.enableFaceAnalysis !== 'boolean') out.analysis.enableFaceAnalysis = false;
  if (typeof out.analysis.enableMediaPipeAnalysis !== 'boolean') out.analysis.enableMediaPipeAnalysis = false;
  if (!out.requirements.termWrappersByTerm || typeof out.requirements.termWrappersByTerm !== 'object') {
    out.requirements.termWrappersByTerm = {};
  }
  if (out.requirements.termWrapperPrefixesByTerm && typeof out.requirements.termWrapperPrefixesByTerm === 'object') {
    Object.keys(out.requirements.termWrapperPrefixesByTerm).forEach(function (termKey) {
      if (!Object.prototype.hasOwnProperty.call(out.requirements.termWrappersByTerm, termKey)) {
        out.requirements.termWrappersByTerm[termKey] = {
          prefix: String(out.requirements.termWrapperPrefixesByTerm[termKey] || '').trim(),
          suffix: ''
        };
      }
    });
  }
  delete out.requirements.termWrapperPrefixesByTerm;
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
  if (ui.appSettingsTrainingWslDistributionEl) ui.appSettingsTrainingWslDistributionEl.value = c.training.wsl_distribution || '';
  if (ui.appSettingsTrainingCondaExecutableEl) ui.appSettingsTrainingCondaExecutableEl.value = c.training.conda_executable || '';
  if (ui.appSettingsTrainingCondaEnvironmentEl) ui.appSettingsTrainingCondaEnvironmentEl.value = c.training.conda_environment || '';
  if (ui.appSettingsTrainingActivateScriptEl) ui.appSettingsTrainingActivateScriptEl.value = c.training.activate_script || '';
  appSettingsTrainingProfiles.forEach(function (profile) {
    var el = ui[profile.uiKey];
    if (el) el.checked = c.training.enabled_profiles.indexOf(profile.id) !== -1;
  });
  if (ui.appSettingsPrimerTemplateEl) ui.appSettingsPrimerTemplateEl.value = c.primer.template || '';
  if (ui.appSettingsDebugEl) ui.appSettingsDebugEl.checked = !!c.debug;
  if (ui.appSettingsEnableFaceAnalysisEl) ui.appSettingsEnableFaceAnalysisEl.checked = !!c.analysis.enableFaceAnalysis;
  if (ui.appSettingsEnableMediaPipeAnalysisEl) ui.appSettingsEnableMediaPipeAnalysisEl.checked = !!c.analysis.enableMediaPipeAnalysis;
  renderAppSettingsJson(c);
}

function collectAppSettingsFormConfig() {
  var base = normalizeAppConfigShape(appSettingsLoadedConfig || {});
  base.filesystem.root = ui.appSettingsRootEl ? ui.appSettingsRootEl.value : '';
  base.filesystem.models = ui.appSettingsModelsEl ? ui.appSettingsModelsEl.value : '';
  base.debug = !!(ui.appSettingsDebugEl && ui.appSettingsDebugEl.checked);
  base.training.diffusion_pipe_wsl = ui.appSettingsTrainingDiffusionPipeWslEl ? ui.appSettingsTrainingDiffusionPipeWslEl.value : '';
  base.training.wsl_distribution = ui.appSettingsTrainingWslDistributionEl ? ui.appSettingsTrainingWslDistributionEl.value : '';
  base.training.conda_executable = ui.appSettingsTrainingCondaExecutableEl ? ui.appSettingsTrainingCondaExecutableEl.value : '';
  base.training.conda_environment = ui.appSettingsTrainingCondaEnvironmentEl ? ui.appSettingsTrainingCondaEnvironmentEl.value : '';
  base.training.activate_script = ui.appSettingsTrainingActivateScriptEl ? ui.appSettingsTrainingActivateScriptEl.value : '';
  base.training.enabled_profiles = appSettingsTrainingProfiles.filter(function (profile) {
    var el = ui[profile.uiKey];
    return !!(el && el.checked);
  }).map(function (profile) { return profile.id; });
  base.primer.template = ui.appSettingsPrimerTemplateEl ? ui.appSettingsPrimerTemplateEl.value : '';
  base.analysis.enableFaceAnalysis = !!(ui.appSettingsEnableFaceAnalysisEl && ui.appSettingsEnableFaceAnalysisEl.checked);
  base.analysis.enableMediaPipeAnalysis = !!(ui.appSettingsEnableMediaPipeAnalysisEl && ui.appSettingsEnableMediaPipeAnalysisEl.checked);
  return normalizeAppConfigShape(base);
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
  setAppSettingsTab(appSettingsActiveTab, false);
  ui.appSettingsModalEl.classList.remove('hidden');
  ui.appSettingsModalEl.setAttribute('aria-hidden', 'false');
  focusFirstModalTextField(ui.appSettingsModalEl);
  HttpModule.get('/app/config', function (status, responseText) {
    if (status !== 200) {
      setAppSettingsStatus('Failed to load settings.', true);
      return;
    }
    try {
      var cfg = JSON.parse(responseText);
      appSettingsLoadedConfig = normalizeAppConfigShape(cfg);
      setRuntimeAppConfig(cfg);
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

function syncUnsavedPrimerTemplateFromAppConfig() {
  if (typeof syncCurrentFolderPrimerTemplateFromAppDefault === 'function') {
    syncCurrentFolderPrimerTemplateFromAppDefault();
  }
}

function saveAppSettings(opts) {
  var saveAndReload = !!(opts && opts.reloadAfterSave);
  var closeOnSuccess = !opts || opts.closeOnSuccess !== false;
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
    setRuntimeAppConfig(saved);
    fillAppSettingsForm(saved);
    setRootFolderLabelFromConfig(saved);
    syncUnsavedPrimerTemplateFromAppConfig();
    if (saveAndReload) {
      if (closeOnSuccess) closeAppSettingsModal();
      setStatus('Settings saved. Reloading runtime settings...');
      triggerRuntimeConfigReload(true);
      return;
    }
    if (closeOnSuccess) {
      closeAppSettingsModal();
    } else {
      setAppSettingsStatus('Saved. Click Save + Reboot to apply runtime changes.', false);
    }
    setStatus('Settings saved. Use Save + Reboot to apply runtime changes.');
  });
}

function resetAppSettings() {
  if (!confirm('Reset the app requirements to the stock defaults? This will remove custom global requirement terms.')) {
    return;
  }
  setAppSettingsStatus('Resetting app defaults...', false);
  HttpModule.postJson('/app/reset_app', {}, function (status, responseText) {
    if (status !== 200) {
      setAppSettingsStatus(getErrorMessage(responseText, 'Failed to reset app defaults.'), true);
      return;
    }
    var saved = null;
    try {
      var parsed = JSON.parse(responseText);
      saved = normalizeAppConfigShape(parsed.config || {});
    } catch (e) {
      saved = normalizeAppConfigShape(appSettingsLoadedConfig || {});
    }
    appSettingsLoadedConfig = saved;
    setRuntimeAppConfig(saved);
    fillAppSettingsForm(saved);
    setRootFolderLabelFromConfig(saved);
    syncUnsavedPrimerTemplateFromAppConfig();
    setAppSettingsStatus('App requirements reset to defaults.', false);
    setStatus('App requirements reset to defaults.');
    refreshCurrentDirectory();
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
      setRuntimeAppConfig(cfg);
      fillAppSettingsForm(cfg);
      setRootFolderLabelFromConfig(cfg);
      syncUnsavedPrimerTemplateFromAppConfig();
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
  ui.utilityCurrentPathBtn.title = tooltipPath
    ? ('Go to root folder. Current folder: ' + tooltipPath)
    : 'Go to root folder';
  var labelEl = document.getElementById('utility-path-label');
  if (labelEl) {
    labelEl.textContent = tooltipPath || 'Workspace';
  }
}

function openHelpReadmeInPreview() {
  setStatus('Loading help...');
  HttpModule.get('/app/help_readme', function (status, responseText) {
    if (status !== 200) {
      setStatus('Help load failed.');
      return;
    }
    // Reuse the existing clear flow so preview actions/selection are reset consistently.
    clearEditorAndPreview();
    renderFileList(ui && ui.filterEl ? ui.filterEl.value : '');

    var doc = ui.previewEl.contentDocument || ui.previewEl.contentdocument;
    if (!doc) {
      setStatus('Help load failed.');
      return;
    }
    var theme = typeof getCurrentAppTheme === 'function' ? getCurrentAppTheme() : 'light';
    var isDark = String(theme || '').toLowerCase() === 'dark';
    var escaped = escapeHtml(responseText || '');
    doc.open();
    doc.write(
      '<!DOCTYPE html><html data-theme="' + (isDark ? 'dark' : 'light') + '"><head><meta charset="UTF-8">' +
      '<style>' +
      'html{color-scheme:' + (isDark ? 'dark' : 'light') + ';}' +
      'body{font-family:Consolas,monospace;margin:0;padding:16px;background:' + (isDark ? '#0f172a' : '#f8fafc') + ';color:' + (isDark ? '#e5e7eb' : '#1f2937') + ';line-height:1.4;}' +
      'h3{margin-top:0;font-family:system-ui;color:' + (isDark ? '#f8fafc' : '#111827') + ';}' +
      'pre{white-space:pre-wrap;margin:0;color:' + (isDark ? '#e5e7eb' : '#1f2937') + ';}' +
      '</style></head>' +
      '<body>' +
      '<h3>README</h3>' +
      '<pre>' + escaped + '</pre>' +
      '</body></html>'
    );
    doc.close();
    setStatus('Help loaded.');
  });
}

function wireAppSettingsUi() {
  if (ui.utilitySettingsBtn) ui.utilitySettingsBtn.onclick = openAppSettingsModal;
  if (ui.utilityHelpBtn) ui.utilityHelpBtn.onclick = openHelpReadmeInPreview;
  if (ui.utilityCurrentPathBtn) {
    ui.utilityCurrentPathBtn.onclick = function () {
      navigateToDirStackIndex(0);
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
  if (ui.appSettingsResetBtn) {
    ui.appSettingsResetBtn.onclick = resetAppSettings;
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-app-settings-tab]'), function (button) {
    button.onclick = function () {
      setAppSettingsTab(button.getAttribute('data-app-settings-tab'), false);
    };
    button.onkeydown = function (event) {
      var tabs = ['general', 'training', 'advanced'];
      var current = tabs.indexOf(button.getAttribute('data-app-settings-tab'));
      var next = current;
      if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (current + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      setAppSettingsTab(tabs[next], true);
    };
  });
  setAppSettingsTab(appSettingsActiveTab, false);
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
    ui.appSettingsTrainingWslDistributionEl,
    ui.appSettingsTrainingCondaExecutableEl,
    ui.appSettingsTrainingCondaEnvironmentEl,
    ui.appSettingsTrainingProfileWan22El,
    ui.appSettingsTrainingProfileKrea2El,
    ui.appSettingsTrainingProfileWan21El,
    ui.appSettingsTrainingProfileH3El,
    ui.appSettingsPrimerTemplateEl,
    ui.appSettingsEnableFaceAnalysisEl,
    ui.appSettingsEnableMediaPipeAnalysisEl,
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
