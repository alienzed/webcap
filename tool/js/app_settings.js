var appSettingsLoadedConfig = null;
var appSettingsActiveTab = 'general';
var appSettingsTrainingProfiles = [
  { id: 'wan22_t2v', uiKey: 'appSettingsTrainingProfileWan22El' },
  { id: 'krea2_raw', uiKey: 'appSettingsTrainingProfileKrea2El' },
  { id: 'wan21_t2v_14b', uiKey: 'appSettingsTrainingProfileWan21El' },
  { id: 'minimax_h3', uiKey: 'appSettingsTrainingProfileH3El' }
];
var appSettingsTestCopyRoots = [
  { stage: 'h3', uiKey: 'appSettingsTrainingTestCopyH3RootEl' },
  { stage: 'krea2', uiKey: 'appSettingsTrainingTestCopyKrea2RootEl' },
  { stage: 'wan21', uiKey: 'appSettingsTrainingTestCopyWan21RootEl' },
  { stage: 'hi', uiKey: 'appSettingsTrainingTestCopyHiRootEl' },
  { stage: 'lo', uiKey: 'appSettingsTrainingTestCopyLoRootEl' }
];

function setAppSettingsTab(tabName, focusTab) {
  var next = ['general', 'models', 'training', 'director', 'system'].indexOf(tabName) !== -1 ? tabName : 'general';
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
  if (!out.caption_assist || typeof out.caption_assist !== 'object') out.caption_assist = {};
  if (!out.storyboard || typeof out.storyboard !== 'object') out.storyboard = {};
  if (!out.storyboard.director || typeof out.storyboard.director !== 'object') out.storyboard.director = {};
  if (!out.requirements || typeof out.requirements !== 'object') out.requirements = {};
  if (typeof out.debug !== 'boolean') out.debug = !!out.debug;
  out.theme = String(out.theme || '').toLowerCase() === 'dark' ? 'dark' : 'light';
  out.director_model = String(out.director_model || '').trim();
  out.vision_model = String(out.vision_model || '').trim();
  out.generate_model = String(out.generate_model || '').trim();
  if (!out.filesystem.root) out.filesystem.root = '';
  if (!out.filesystem.output_root) out.filesystem.output_root = '';
  if (!out.filesystem.models) out.filesystem.models = '';
  if (!out.training.diffusion_pipe_wsl) out.training.diffusion_pipe_wsl = '';
  if (!out.training.wsl_distribution) out.training.wsl_distribution = '';
  if (!out.training.conda_executable) out.training.conda_executable = '';
  if (!out.training.conda_environment) out.training.conda_environment = '';
  if (!out.training.activate_script) out.training.activate_script = '';
  if (typeof out.training.h3_split_cache_phase !== 'boolean') out.training.h3_split_cache_phase = false;
  if (!Number.isInteger(out.training.repeat_reference_epochs) || out.training.repeat_reference_epochs <= 0) out.training.repeat_reference_epochs = 90;
  if (!out.training.test_copy_roots || typeof out.training.test_copy_roots !== 'object') out.training.test_copy_roots = {};
  appSettingsTestCopyRoots.forEach(function (root) {
    out.training.test_copy_roots[root.stage] = String(out.training.test_copy_roots[root.stage] || '');
  });
  if (typeof out.training.test_copy_subfolder !== 'string') out.training.test_copy_subfolder = '';
  delete out.training.mode;
  delete out.training.write_selection_snapshot_comments;
  if (!Array.isArray(out.training.enabled_profiles)) {
    out.training.enabled_profiles = appSettingsTrainingProfiles.map(function (profile) { return profile.id; });
  } else {
    out.training.enabled_profiles = out.training.enabled_profiles.map(function (profileId) {
      return String(profileId || '').trim().toLowerCase();
    });
  }
  if (out.storyboard.director.mode !== 'remote') out.storyboard.director.mode = 'local';
  if (typeof out.storyboard.director.endpoint !== 'string') out.storyboard.director.endpoint = '';
  if (!Array.isArray(out.storyboard.director.remote_endpoints)) out.storyboard.director.remote_endpoints = [];
  out.storyboard.director.remote_endpoints = out.storyboard.director.remote_endpoints.map(function (item, index) {
    item = item && typeof item === 'object' ? item : {};
    return {
      id: String(item.id || ('remote-' + String(index + 1))).trim(),
      name: String(item.name || ('Remote ' + String(index + 1))).trim(),
      endpoint: String(item.endpoint || '').trim(),
      enabled: item.enabled !== false
    };
  });
  if (out.storyboard.director.endpoint && !out.storyboard.director.remote_endpoints.some(function (item) { return item.endpoint === out.storyboard.director.endpoint; })) {
    out.storyboard.director.remote_endpoints.unshift({ id: 'remote', name: 'Remote', endpoint: out.storyboard.director.endpoint, enabled: true });
  }
  if (typeof out.storyboard.director.llama_server !== 'string') out.storyboard.director.llama_server = '';
  if (!Number.isInteger(out.storyboard.director.port)) out.storyboard.director.port = 8189;
  if (out.storyboard.director.context_size !== null && !Number.isInteger(out.storyboard.director.context_size)) out.storyboard.director.context_size = null;
  if (!Object.prototype.hasOwnProperty.call(out.storyboard.director, 'max_tokens')) out.storyboard.director.max_tokens = 16384;
  if (out.storyboard.director.max_tokens !== null && !Number.isInteger(out.storyboard.director.max_tokens)) out.storyboard.director.max_tokens = null;
  if (typeof out.primer.template !== 'string') out.primer.template = '';
  if (typeof out.caption_assist.preferred_sequence !== 'string') out.caption_assist.preferred_sequence = DEFAULT_CAPTION_ASSIST_SEQUENCE;
  if (!out.analysis || typeof out.analysis !== 'object') out.analysis = {};
  if (typeof out.analysis.enableFaceAnalysis !== 'boolean') out.analysis.enableFaceAnalysis = false;
  if (typeof out.analysis.enableMediaPipeAnalysis !== 'boolean') out.analysis.enableMediaPipeAnalysis = false;
  if (!out.requirements.termWrappersByTerm || typeof out.requirements.termWrappersByTerm !== 'object') {
    out.requirements.termWrappersByTerm = {};
  }
  if (!out.requirements.termWrappersByGroup || typeof out.requirements.termWrappersByGroup !== 'object') {
    out.requirements.termWrappersByGroup = {};
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

function appSettingsEndpointId(value, index) {
  var normalized = String(value || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized || normalized === 'local') normalized = 'remote-' + String(index + 1);
  return normalized;
}

function renderAppSettingsDirectorEndpoints(endpoints) {
  if (!ui.appSettingsDirectorEndpointsEl) return;
  endpoints = Array.isArray(endpoints) ? endpoints : [];
  ui.appSettingsDirectorEndpointsEl.innerHTML = '';
  endpoints.forEach(function (endpoint, index) {
    var card = document.createElement('div');
    card.className = 'app-settings-runtime-card app-settings-runtime-card-remote';
    card.dataset.directorEndpointRow = String(index);
    card.dataset.endpointId = appSettingsEndpointId(endpoint.id, index);
    card.innerHTML =
      '<div class="app-settings-runtime-card-header">' +
        '<label class="app-settings-field app-settings-runtime-name-field">' +
          '<span class="app-settings-field-label">Name</span>' +
          '<input type="text" data-director-endpoint-name value="' + escapeHtml(String(endpoint.name || '')) + '" placeholder="Work PC">' +
        '</label>' +
        '<div class="app-settings-runtime-card-actions">' +
          '<label class="app-settings-check-row"><input type="checkbox" data-director-endpoint-enabled' + (endpoint.enabled !== false ? ' checked' : '') + '><span>Enabled</span></label>' +
          '<button type="button" class="review-captions-btn" data-director-endpoint-remove>Remove</button>' +
        '</div>' +
      '</div>' +
      '<label class="app-settings-field app-settings-field-wide">' +
        '<span class="app-settings-field-label">Endpoint</span>' +
        '<input type="text" data-director-endpoint-url value="' + escapeHtml(String(endpoint.endpoint || '')) + '" placeholder="http://192.168.1.20:11434/v1">' +
      '</label>';
    ui.appSettingsDirectorEndpointsEl.appendChild(card);
  });
}

function renderUnavailableVisionPreference(select, configuredModel, label) {
  var configured = String(configuredModel || '').trim();
  select.innerHTML = '';
  var option = document.createElement('option');
  option.value = configured;
  option.textContent = configured ? ((label || 'Unavailable') + ' · ' + configured) : (label || 'No Vision models available');
  select.appendChild(option);
  select.value = configured;
}

function refreshAppSettingsVisionModels(configuredModel) {
  var select = ui.appSettingsVisionModelEl;
  if (!select) return Promise.resolve();
  var configured = String(configuredModel || '').trim();
  select.disabled = true;
  select.innerHTML = '<option value="">Loading vision models...</option>';
  return fetch('/caption/vision-capabilities').then(function (response) {
    return response.json().then(function (payload) {
      if (!response.ok || !payload || payload.ok === false) {
        throw new Error(payload && payload.error ? payload.error : 'Could not load Vision models.');
      }
      var models = Array.isArray(payload.models) ? payload.models : [];
      var saved = configured || String(payload.configuredModel || '').trim();
      if (!models.length) {
        renderUnavailableVisionPreference(select, saved, 'Vision model unavailable');
        select.disabled = true;
        return;
      }

      renderDirectorModelOptions(select, models, saved || payload.defaultModel);
      var savedAvailable = !saved || models.some(function (model) {
        return String(model && model.id || '') === saved;
      });
      if (saved && !savedAvailable) {
        var unavailable = document.createElement('option');
        unavailable.value = saved;
        unavailable.textContent = 'Unavailable · ' + saved;
        select.insertBefore(unavailable, select.firstChild);
        select.value = saved;
      }
      select.disabled = false;
    });
  }).catch(function (err) {
    renderUnavailableVisionPreference(select, configured, 'Vision models unavailable');
    select.disabled = true;
    if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Vision Settings', err);
  });
}


function collectAppSettingsDirectorEndpoints() {
  if (!ui.appSettingsDirectorEndpointsEl) return [];
  return Array.prototype.map.call(
    ui.appSettingsDirectorEndpointsEl.querySelectorAll('[data-director-endpoint-row]'),
    function (row, index) {
      var name = row.querySelector('[data-director-endpoint-name]');
      var endpoint = row.querySelector('[data-director-endpoint-url]');
      var enabled = row.querySelector('[data-director-endpoint-enabled]');
      return {
        id: appSettingsEndpointId(row.dataset.endpointId || (name && name.value), index),
        name: String(name && name.value || '').trim() || ('Remote ' + String(index + 1)),
        endpoint: String(endpoint && endpoint.value || '').trim(),
        enabled: !!(enabled && enabled.checked)
      };
    }
  ).filter(function (item) { return !!item.endpoint; });
}

function addAppSettingsDirectorEndpoint() {
  var current = collectAppSettingsDirectorEndpoints();
  var used = {};
  current.forEach(function (item) { used[String(item.id || '')] = true; });
  var number = current.length + 1;
  while (used['remote-' + String(number)]) number += 1;
  current.push({
    id: 'remote-' + String(number),
    name: 'Remote ' + String(number),
    endpoint: '',
    enabled: true
  });
  renderAppSettingsDirectorEndpoints(current);
  syncAppSettingsJsonFromForm();
  var rows = ui.appSettingsDirectorEndpointsEl.querySelectorAll('[data-director-endpoint-row]');
  var last = rows.length ? rows[rows.length - 1] : null;
  var input = last && last.querySelector('[data-director-endpoint-name]');
  if (input) input.focus();
}

var appSettingsCaptionSequenceCursor = null;

function appSettingsCaptionSequenceContainsGroup(sequenceText, groupLabel) {
  var normalizedSequence = String(sequenceText || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!normalizedSequence) return false;
  var label = String(groupLabel || '').trim();
  if (!label) return true;
  var key = normalizeRequirementPrimerKey(label).replace(/_/g, ' ');
  var normalizedLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  var padded = ' ' + normalizedSequence + ' ';
  return (!!key && padded.indexOf(' ' + key + ' ') !== -1) || (!!normalizedLabel && padded.indexOf(' ' + normalizedLabel + ' ') !== -1);
}

function renderAppSettingsCaptionSequenceGroups() {
  var host = ui.appSettingsCaptionSequenceGroupsEl;
  var sequenceEl = ui.appSettingsCaptionSequenceEl;
  if (!host || !sequenceEl) return;
  var groups = (typeof checklistItems !== 'undefined' && Array.isArray(checklistItems) && checklistItems.length) ? checklistItems.slice() : getDefaultRequirementItems().slice();
  var missing = groups.filter(function (label) { return !appSettingsCaptionSequenceContainsGroup(sequenceEl.value, label); });
  host.innerHTML = '';
  if (!missing.length) {
    var complete = document.createElement('span');
    complete.className = 'app-settings-note';
    complete.textContent = 'All current groups are named explicitly.';
    host.appendChild(complete);
    return;
  }
  missing.forEach(function (label) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'review-captions-btn app-settings-caption-sequence-chip';
    button.textContent = label;
    button.title = 'Insert ' + label + ' into the preferred caption sequence';
    button.addEventListener('click', function () {
      var value = String(sequenceEl.value || '');
      var start = appSettingsCaptionSequenceCursor && Number.isInteger(appSettingsCaptionSequenceCursor.start) ? appSettingsCaptionSequenceCursor.start : value.length;
      var end = appSettingsCaptionSequenceCursor && Number.isInteger(appSettingsCaptionSequenceCursor.end) ? appSettingsCaptionSequenceCursor.end : start;
      start = Math.max(0, Math.min(start, value.length));
      end = Math.max(start, Math.min(end, value.length));
      var before = value.slice(0, start), after = value.slice(end);
      var prefix = before && !before.endsWith('\n') ? '\n' : '';
      var suffix = after && !after.startsWith('\n') ? '\n' : '';
      var insertion = prefix + label + suffix;
      sequenceEl.value = before + insertion + after;
      var caret = start + insertion.length - suffix.length;
      sequenceEl.focus(); sequenceEl.setSelectionRange(caret, caret);
      appSettingsCaptionSequenceCursor = { start: caret, end: caret };
      renderAppSettingsCaptionSequenceGroups(); syncAppSettingsJsonFromForm();
    });
    host.appendChild(button);
  });
}

function captureAppSettingsCaptionSequenceCursor() {
  var el = ui.appSettingsCaptionSequenceEl; if (!el) return;
  appSettingsCaptionSequenceCursor = { start: typeof el.selectionStart === 'number' ? el.selectionStart : String(el.value || '').length, end: typeof el.selectionEnd === 'number' ? el.selectionEnd : String(el.value || '').length };
}

function fillAppSettingsForm(cfg) {
  var c = normalizeAppConfigShape(cfg);
  if (ui.appSettingsRootEl) ui.appSettingsRootEl.value = c.filesystem.root || '';
  if (ui.appSettingsOutputRootEl) ui.appSettingsOutputRootEl.value = c.filesystem.output_root || '';
  if (ui.appSettingsModelsEl) ui.appSettingsModelsEl.value = c.filesystem.models || '';
  if (ui.appSettingsTrainingDiffusionPipeWslEl) ui.appSettingsTrainingDiffusionPipeWslEl.value = c.training.diffusion_pipe_wsl || '';
  if (ui.appSettingsTrainingWslDistributionEl) ui.appSettingsTrainingWslDistributionEl.value = c.training.wsl_distribution || '';
  if (ui.appSettingsTrainingCondaExecutableEl) ui.appSettingsTrainingCondaExecutableEl.value = c.training.conda_executable || '';
  if (ui.appSettingsTrainingCondaEnvironmentEl) ui.appSettingsTrainingCondaEnvironmentEl.value = c.training.conda_environment || '';
  if (ui.appSettingsTrainingActivateScriptEl) ui.appSettingsTrainingActivateScriptEl.value = c.training.activate_script || '';
  if (ui.appSettingsTrainingH3SplitCachePhaseEl) ui.appSettingsTrainingH3SplitCachePhaseEl.checked = !!c.training.h3_split_cache_phase;
  if (ui.appSettingsTrainingRepeatReferenceEpochsEl) ui.appSettingsTrainingRepeatReferenceEpochsEl.value = c.training.repeat_reference_epochs;
  appSettingsTestCopyRoots.forEach(function (root) {
    var el = ui[root.uiKey];
    if (el) el.value = c.training.test_copy_roots[root.stage] || '';
  });
  if (ui.appSettingsTrainingTestCopySubfolderEl) ui.appSettingsTrainingTestCopySubfolderEl.value = c.training.test_copy_subfolder || '';
  appSettingsTrainingProfiles.forEach(function (profile) {
    var el = ui[profile.uiKey];
    if (el) el.checked = c.training.enabled_profiles.indexOf(profile.id) !== -1;
  });
  renderAppSettingsDirectorEndpoints(c.storyboard.director.remote_endpoints || []);
  if (ui.appSettingsStoryboardLlamaServerEl) ui.appSettingsStoryboardLlamaServerEl.value = c.storyboard.director.llama_server || '';
  if (ui.appSettingsStoryboardPortEl) ui.appSettingsStoryboardPortEl.value = c.storyboard.director.port;
  if (ui.appSettingsStoryboardContextSizeEl) ui.appSettingsStoryboardContextSizeEl.value = c.storyboard.director.context_size == null ? '' : c.storyboard.director.context_size;
  if (ui.appSettingsStoryboardMaxTokensEl) ui.appSettingsStoryboardMaxTokensEl.value = c.storyboard.director.max_tokens == null ? '' : c.storyboard.director.max_tokens;
  if (ui.appSettingsPrimerTemplateEl) ui.appSettingsPrimerTemplateEl.value = c.primer.template || '';
  if (ui.appSettingsCaptionSequenceEl) ui.appSettingsCaptionSequenceEl.value = c.caption_assist.preferred_sequence;
  refreshAppSettingsVisionModels(c.vision_model);
  renderAppSettingsCaptionSequenceGroups();
  if (typeof applyAppTheme === 'function') applyAppTheme(c.theme);
  if (ui.appSettingsDebugEl) ui.appSettingsDebugEl.checked = !!c.debug;
  if (ui.appSettingsEnableFaceAnalysisEl) ui.appSettingsEnableFaceAnalysisEl.checked = !!c.analysis.enableFaceAnalysis;
  if (ui.appSettingsEnableMediaPipeAnalysisEl) ui.appSettingsEnableMediaPipeAnalysisEl.checked = !!c.analysis.enableMediaPipeAnalysis;
  renderAppSettingsJson(c);
}

function collectAppSettingsFormConfig() {
  var base = normalizeAppConfigShape(appSettingsLoadedConfig || {});
  base.filesystem.root = ui.appSettingsRootEl ? ui.appSettingsRootEl.value : '';
  base.filesystem.output_root = ui.appSettingsOutputRootEl ? ui.appSettingsOutputRootEl.value : '';
  base.filesystem.models = ui.appSettingsModelsEl ? ui.appSettingsModelsEl.value : '';
  base.debug = !!(ui.appSettingsDebugEl && ui.appSettingsDebugEl.checked);
  base.theme = typeof getCurrentAppTheme === 'function' ? getCurrentAppTheme() : base.theme;
  base.training.diffusion_pipe_wsl = ui.appSettingsTrainingDiffusionPipeWslEl ? ui.appSettingsTrainingDiffusionPipeWslEl.value : '';
  base.training.wsl_distribution = ui.appSettingsTrainingWslDistributionEl ? ui.appSettingsTrainingWslDistributionEl.value : '';
  base.training.conda_executable = ui.appSettingsTrainingCondaExecutableEl ? ui.appSettingsTrainingCondaExecutableEl.value : '';
  base.training.conda_environment = ui.appSettingsTrainingCondaEnvironmentEl ? ui.appSettingsTrainingCondaEnvironmentEl.value : '';
  base.training.activate_script = ui.appSettingsTrainingActivateScriptEl ? ui.appSettingsTrainingActivateScriptEl.value : '';
  base.training.h3_split_cache_phase = !!(ui.appSettingsTrainingH3SplitCachePhaseEl && ui.appSettingsTrainingH3SplitCachePhaseEl.checked);
  var repeatReferenceEpochs = ui.appSettingsTrainingRepeatReferenceEpochsEl ? Number(ui.appSettingsTrainingRepeatReferenceEpochsEl.value) : 90;
  base.training.repeat_reference_epochs = Number.isInteger(repeatReferenceEpochs) && repeatReferenceEpochs > 0 ? repeatReferenceEpochs : 90;
  base.training.test_copy_roots = {};
  appSettingsTestCopyRoots.forEach(function (root) {
    var el = ui[root.uiKey];
    base.training.test_copy_roots[root.stage] = el ? el.value : '';
  });
  base.training.test_copy_subfolder = ui.appSettingsTrainingTestCopySubfolderEl ? ui.appSettingsTrainingTestCopySubfolderEl.value : '';
  base.training.enabled_profiles = appSettingsTrainingProfiles.filter(function (profile) {
    var el = ui[profile.uiKey];
    return !!(el && el.checked);
  }).map(function (profile) { return profile.id; });
  base.storyboard.director.mode = 'local';
  base.storyboard.director.endpoint = '';
  base.storyboard.director.remote_endpoints = collectAppSettingsDirectorEndpoints();
  base.storyboard.director.llama_server = ui.appSettingsStoryboardLlamaServerEl ? ui.appSettingsStoryboardLlamaServerEl.value : '';
  base.storyboard.director.port = Number(ui.appSettingsStoryboardPortEl ? ui.appSettingsStoryboardPortEl.value : 8189);
  var contextSizeValue = ui.appSettingsStoryboardContextSizeEl ? ui.appSettingsStoryboardContextSizeEl.value.trim() : '';
  var maxTokensValue = ui.appSettingsStoryboardMaxTokensEl ? ui.appSettingsStoryboardMaxTokensEl.value.trim() : '';
  base.storyboard.director.context_size = contextSizeValue === '' ? null : Number(contextSizeValue);
  base.storyboard.director.max_tokens = maxTokensValue === '' ? null : Number(maxTokensValue);
  base.primer.template = ui.appSettingsPrimerTemplateEl ? ui.appSettingsPrimerTemplateEl.value : '';
  base.vision_model = ui.appSettingsVisionModelEl ? ui.appSettingsVisionModelEl.value : base.vision_model;
  base.caption_assist.preferred_sequence = ui.appSettingsCaptionSequenceEl ? ui.appSettingsCaptionSequenceEl.value : DEFAULT_CAPTION_ASSIST_SEQUENCE;
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
    window.dispatchEvent(new CustomEvent('webcap:vision-model-changed', { detail: { modelId: String(saved.vision_model || '') } }));
    if (typeof refreshApplicationVisionModels === 'function') refreshApplicationVisionModels(false);
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

function updateShellFolderLabel(pathText) {
  var button = ui.shellFolderBtn;
  if (!button) return;
  var normalized = String(pathText || '').trim();
  var rootLabel = String(ROOT_FOLDER_LABEL || '').trim();
  var tooltipPath = normalized || '';
  if (rootLabel) {
    tooltipPath = tooltipPath ? (rootLabel + '/' + tooltipPath) : rootLabel;
  }
  button.title = tooltipPath
    ? ('Go to root folder. Current folder: ' + tooltipPath)
    : 'Go to root folder';
}

function openHelpReadmeInPreview() {
  openPrepActivity();
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
  if (ui.shellSettingsBtn) ui.shellSettingsBtn.onclick = openAppSettingsModal;
  if (ui.themeToggleBtn) {
    ui.themeToggleBtn.onclick = function () {
      toggleAppTheme();
      syncAppSettingsJsonFromForm();
    };
  }
  if (ui.shellHelpBtn) ui.shellHelpBtn.onclick = openHelpReadmeInPreview;
  if (ui.shellFolderBtn) {
    ui.shellFolderBtn.onclick = function () {
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
  if (ui.appSettingsDirectorEndpointAddBtnEl) ui.appSettingsDirectorEndpointAddBtnEl.onclick = addAppSettingsDirectorEndpoint;
  if (ui.appSettingsDirectorEndpointsEl) {
    ui.appSettingsDirectorEndpointsEl.addEventListener('click', function (event) {
      var remove = event.target.closest('[data-director-endpoint-remove]');
      if (!remove) return;
      remove.closest('[data-director-endpoint-row]').remove();
      syncAppSettingsJsonFromForm();
    });
    ui.appSettingsDirectorEndpointsEl.addEventListener('input', syncAppSettingsJsonFromForm);
    ui.appSettingsDirectorEndpointsEl.addEventListener('change', syncAppSettingsJsonFromForm);
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-app-settings-tab]'), function (button) {
    button.onclick = function () {
      setAppSettingsTab(button.getAttribute('data-app-settings-tab'), false);
    };
    button.onkeydown = function (event) {
      var tabs = ['general', 'models', 'training', 'director', 'system'];
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
    ui.appSettingsModalEl.addEventListener('mousedown', function (e) {
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
    ui.appSettingsOutputRootEl,
    ui.appSettingsModelsEl,
    ui.appSettingsTrainingDiffusionPipeWslEl,
    ui.appSettingsTrainingActivateScriptEl,
    ui.appSettingsTrainingWslDistributionEl,
    ui.appSettingsTrainingCondaExecutableEl,
    ui.appSettingsTrainingCondaEnvironmentEl,
    ui.appSettingsTrainingH3SplitCachePhaseEl,
    ui.appSettingsTrainingTestCopyH3RootEl,
    ui.appSettingsTrainingTestCopyKrea2RootEl,
    ui.appSettingsTrainingTestCopyWan21RootEl,
    ui.appSettingsTrainingTestCopyHiRootEl,
    ui.appSettingsTrainingTestCopyLoRootEl,
    ui.appSettingsTrainingTestCopySubfolderEl,
    ui.appSettingsTrainingProfileWan22El,
    ui.appSettingsTrainingProfileKrea2El,
    ui.appSettingsTrainingProfileWan21El,
    ui.appSettingsTrainingProfileH3El,
    ui.appSettingsStoryboardLlamaServerEl,
    ui.appSettingsStoryboardPortEl,
    ui.appSettingsStoryboardContextSizeEl,
    ui.appSettingsStoryboardMaxTokensEl,
    ui.appSettingsPrimerTemplateEl,
    ui.appSettingsCaptionSequenceEl,
    ui.appSettingsVisionModelEl,
    ui.appSettingsEnableFaceAnalysisEl,
    ui.appSettingsEnableMediaPipeAnalysisEl,
    ui.appSettingsDebugEl,
  ];
  syncFields.forEach(function (el) {
    if (!el) return;
    el.addEventListener('input', syncAppSettingsJsonFromForm);
    el.addEventListener('change', syncAppSettingsJsonFromForm);
  });
  if (ui.appSettingsCaptionSequenceEl) {
    ['focus', 'click', 'keyup', 'select'].forEach(function (eventName) { ui.appSettingsCaptionSequenceEl.addEventListener(eventName, captureAppSettingsCaptionSequenceCursor); });
    ui.appSettingsCaptionSequenceEl.addEventListener('input', function () { captureAppSettingsCaptionSequenceCursor(); renderAppSettingsCaptionSequenceGroups(); });
  }
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
