var primerMappingsRows = [];
var reviewRulesRows = [];
var primerMappingsDraftRows = [];
var reviewRulesDraftRows = [];

function cloneRows(rows) {
  return JSON.parse(JSON.stringify(Array.isArray(rows) ? rows : []));
}

function normalizeBool(value, defaultValue) {
  if (value === undefined || value === null) return !!defaultValue;
  return !!value;
}

function normalizePrimerMappingRow(row) {
  var src = row || {};
  var scope = String(src.scope || 'tag').toLowerCase();
  if (scope !== 'file' && scope !== 'tag') scope = 'tag';
  return {
    scope: scope,
    token: String(src.token || '').trim(),
    key: String(src.key || '').trim().toLowerCase(),
    value: String(src.value || '').trim(),
    enabled: normalizeBool(src.enabled, true)
  };
}

function normalizeReviewRuleRow(row) {
  var src = row || {};
  var scope = String(src.scope || 'file').toLowerCase();
  if (scope !== 'file' && scope !== 'caption') scope = 'file';
  return {
    scope: scope,
    trigger: String(src.trigger || '').trim(),
    required: String(src.required || '').trim(),
    enabled: normalizeBool(src.enabled, true)
  };
}

function primerMappingRowHasData(row) {
  if (!row) return false;
  return !!(row.token || row.key);
}

function reviewRuleRowHasData(row) {
  if (!row) return false;
  return !!(row.trigger || row.required);
}

function isCompletePrimerMappingRow(row) {
  return !!(row && row.token && row.key);
}

function isCompleteReviewRuleRow(row) {
  return !!(row && row.trigger && row.required);
}

function sanitizePrimerMappingsRows(rows) {
  var normalized = (Array.isArray(rows) ? rows : [])
    .map(normalizePrimerMappingRow)
    .filter(primerMappingRowHasData)
    .filter(isCompletePrimerMappingRow);
  return normalized;
}

function sanitizeReviewRulesRows(rows) {
  var normalized = (Array.isArray(rows) ? rows : [])
    .map(normalizeReviewRuleRow)
    .filter(reviewRuleRowHasData)
    .filter(isCompleteReviewRuleRow);
  return normalized;
}

function parseLegacyPrimerMappings(multiline) {
  return String(multiline || '')
    .split(/\r?\n/)
    .map(function (line) { return line.trim(); })
    .filter(Boolean)
    .map(function (line) {
      var idx = line.indexOf('=>');
      if (idx === -1) return null;
      var left = line.slice(0, idx).trim().toLowerCase();
      var right = line.slice(idx + 2).trim();
      var eq = right.indexOf('=');
      if (!left || eq <= 0) return null;
      var key = right.slice(0, eq).trim().toLowerCase();
      var value = right.slice(eq + 1).trim();
      if (!key) return null;
      var scope = 'file';
      var token = left;
      var colon = left.indexOf(':');
      if (colon > 0) {
        var maybeScope = left.slice(0, colon).trim();
        var maybeToken = left.slice(colon + 1).trim();
        if ((maybeScope === 'file' || maybeScope === 'tag') && maybeToken) {
          scope = maybeScope;
          token = maybeToken;
        }
      }
      return {
        scope: scope,
        token: token,
        key: key,
        value: value,
        enabled: true
      };
    })
    .filter(Boolean);
}

function parseLegacyReviewRules(multiline) {
  return parseTokenRules(multiline).map(function (rule) {
    return {
      scope: String(rule.scope || 'file'),
      trigger: String(rule.trigger || ''),
      required: String(rule.required || ''),
      enabled: true
    };
  });
  return [];
}

function triggerAdvancedRulesAutosave() {
  if (!state || !state.folder) return;
  if (typeof debouncedSaveFolderState === 'function') {
    debouncedSaveFolderState(function () {
      saveFolderStateForCurrentRoot();
    });
    return;
  }
  saveFolderStateForCurrentRoot();
}

function updatePrimerMappingsSummary() {
  if (!ui || !ui.primerMappingsSummaryEl) return;
  var total = primerMappingsRows.length;
  if (!total) {
    ui.primerMappingsSummaryEl.textContent = 'Legacy feature; no mappings configured.';
    return;
  }
  ui.primerMappingsSummaryEl.textContent = 'Legacy feature: ' + total + ' custom mapping' + (total === 1 ? '' : 's');
}

function updateReviewRulesSummary() {
  if (!ui || !ui.reviewRulesSummaryEl) return;
  var total = reviewRulesRows.length;
  var enabled = reviewRulesRows.filter(function (row) { return !!row.enabled; }).length;
  if (!total) {
    ui.reviewRulesSummaryEl.textContent = 'No review rules configured.';
    return;
  }
  ui.reviewRulesSummaryEl.textContent = total + ' rule' + (total === 1 ? '' : 's') + ' (' + enabled + ' enabled)';
}

function getPrimerMappingsRows() {
  return cloneRows(primerMappingsRows);
}

function getReviewRulesRows() {
  return cloneRows(reviewRulesRows);
}

function setPrimerMappingsRows(rows, triggerAutosave) {
  primerMappingsRows = sanitizePrimerMappingsRows(rows);
  updatePrimerMappingsSummary();
  if (triggerAutosave) {
    refreshPrimerPreviewForCurrentItem();
  }
  if (triggerAutosave) triggerAdvancedRulesAutosave();
}

function setReviewRulesRows(rows, triggerAutosave) {
  reviewRulesRows = sanitizeReviewRulesRows(rows);
  updateReviewRulesSummary();
  if (triggerAutosave) {
    triggerAdvancedRulesAutosave();
  }
}

function loadPrimerMappingsRows(rowsOrLegacy) {
  if (Array.isArray(rowsOrLegacy)) {
    setPrimerMappingsRows(rowsOrLegacy, false);
    return;
  }
  var legacyRows = parseLegacyPrimerMappings(rowsOrLegacy);
  setPrimerMappingsRows(legacyRows, false);
}

function loadReviewRulesRows(rowsOrLegacy) {
  if (Array.isArray(rowsOrLegacy)) {
    setReviewRulesRows(rowsOrLegacy, false);
    return;
  }
  var legacyRows = parseLegacyReviewRules(rowsOrLegacy);
  setReviewRulesRows(legacyRows, false);
}

function openAdvancedModal(modalEl) {
  if (!modalEl || !ui || !ui.advancedModalOverlayEl) return;
  ui.advancedModalOverlayEl.classList.remove('hidden');
  modalEl.classList.remove('hidden');
}

function closeAdvancedModal(modalEl) {
  if (!modalEl || !ui || !ui.advancedModalOverlayEl) return;
  modalEl.classList.add('hidden');
  var anyOpen = false;
  if (ui.primerMappingsModalEl && !ui.primerMappingsModalEl.classList.contains('hidden')) anyOpen = true;
  if (ui.reviewRulesModalEl && !ui.reviewRulesModalEl.classList.contains('hidden')) anyOpen = true;
  if (!anyOpen) {
    ui.advancedModalOverlayEl.classList.add('hidden');
  }
}

function createAdvancedCell(contentEl) {
  var cell = document.createElement('div');
  cell.className = 'advanced-grid-cell';
  cell.appendChild(contentEl);
  return cell;
}

function createCheckboxCell(checked, onChange) {
  var input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!checked;
  input.addEventListener('change', function () {
    onChange(!!input.checked);
  });
  return createAdvancedCell(input);
}

function getHelpPreviewTheme() {
  var theme = typeof getCurrentAppTheme === 'function' ? getCurrentAppTheme() : 'light';
  var isDark = String(theme || '').toLowerCase() === 'dark';
  return {
    theme: isDark ? 'dark' : 'light',
    bodyBg: isDark ? '#0f172a' : '#f8fafc',
    bodyColor: isDark ? '#e5e7eb' : '#1f2937',
    headingColor: isDark ? '#f8fafc' : '#111827',
    mutedColor: isDark ? '#94a3b8' : '#6b7280',
    codeBg: isDark ? '#111827' : '#e2e8f0',
    codeColor: isDark ? '#f8fafc' : '#0f172a'
  };
}

function renderAdvancedHelpPreview(title, bodyHtml) {
  // Reuse the existing clear flow so non-media preview content behaves consistently.
  clearEditorAndPreview();
  renderFileList(ui && ui.filterEl ? ui.filterEl.value : '');

  var doc = ui && ui.previewEl ? (ui.previewEl.contentDocument || ui.previewEl.contentdocument) : null;
  if (!doc) {
    setStatus('Help preview unavailable.');
    return;
  }
  var theme = getHelpPreviewTheme();
  doc.open();
  doc.write(
    '<!DOCTYPE html><html data-theme="' + theme.theme + '"><head><meta charset="UTF-8">' +
    '<style>' +
    'html{color-scheme:' + theme.theme + ';}' +
    'body{font-family:system-ui;margin:0;padding:16px;background:' + theme.bodyBg + ';color:' + theme.bodyColor + ';line-height:1.4;}' +
    'h3{margin:0 0 10px 0;color:' + theme.headingColor + ';}' +
    'h4{color:' + theme.headingColor + ';}' +
    'code{background:' + theme.codeBg + ';color:' + theme.codeColor + ';padding:0 4px;border-radius:4px;}' +
    'a{color:' + (theme.theme === 'dark' ? '#93c5fd' : '#1266d6') + ';}' +
    'p,li{color:' + theme.bodyColor + ';}' +
    'small,.muted{color:' + theme.mutedColor + ';}' +
    '</style></head>' +
    '<body>' +
    '<h3>' + escapeHtml(String(title || 'Help')) + '</h3>' +
    String(bodyHtml || '') +
    '</body></html>'
  );
  doc.close();
  setStatus('Help loaded.');
}

function openPrimerMappingsHelpInPreview() {
  var defaultsTotal = 0;
  if (typeof getRequirementDefaultPrimerMappings === 'function') {
    defaultsTotal = getRequirementDefaultPrimerMappings().length;
  }
  renderAdvancedHelpPreview(
    'Mappings Help (Legacy)',
    '<p style="margin:0 0 10px 0;"><strong>Legacy feature:</strong> mappings still work, but they are being deprecated in favor of annotations, affixes, and the caption template.</p>' +
    '<p style="margin:0 0 10px 0;">Use mappings only for older sets or edge cases that annotations cannot express yet.</p>' +
    '<h4 style="margin:12px 0 6px 0;font-size:14px;">How It Works</h4>' +
    '<ol style="margin:0 0 8px 18px;padding:0;">' +
    '<li style="margin:0 0 6px 0;">Write a Caption Template with placeholders like <code>{view}</code> and <code>{lighting}</code>.</li>' +
    '<li style="margin:0 0 6px 0;">Add mapping rows that connect a trigger (usually a tag) to a placeholder key.</li>' +
    '<li style="margin:0 0 6px 0;">When a row matches, that placeholder gets filled automatically.</li>' +
    '</ol>' +
    '<h4 style="margin:12px 0 6px 0;font-size:14px;">Fields This Uses</h4>' +
    '<ul style="margin:0 0 8px 18px;padding:0;">' +
    '<li style="margin:0 0 6px 0;"><strong>Caption Template</strong>: where placeholders are written.</li>' +
    '<li style="margin:0 0 6px 0;"><strong>Mappings rows</strong>: your manual mapping rules.</li>' +
    '<li style="margin:0 0 6px 0;"><strong>Requirements keywords</strong>: auto default mappings for common terms.</li>' +
    '<li style="margin:0 0 6px 0;"><strong>Item tags</strong>: main match source for defaults and tag-scope rows.</li>' +
    '</ul>' +
    '<h4 style="margin:12px 0 6px 0;font-size:14px;">Important Rules</h4>' +
    '<ul style="margin:0 0 8px 18px;padding:0;">' +
    '<li style="margin:0 0 6px 0;">Manual rows run first, then requirement defaults.</li>' +
    '<li style="margin:0 0 6px 0;">Current requirement default rows available: <strong>' + defaultsTotal + '</strong>.</li>' +
    '<li style="margin:0 0 6px 0;">Default scope for new rows is <strong>tag</strong>.</li>' +
    '<li style="margin:0 0 6px 0;">If Value is blank, Token is used as the value.</li>' +
    '<li style="margin:0 0 6px 0;">Enabled off means the row is skipped.</li>' +
    '</ul>' +
    '<h4 style="margin:12px 0 6px 0;font-size:14px;">Simple Example</h4>' +
    '<p style="margin:0 0 6px 0;">Template has <code>{lighting}</code>.</p>' +
    '<p style="margin:0 0 6px 0;">Mapping row: scope <strong>tag</strong>, token <code>indoor</code>, key <code>lighting</code>, value <code>indoor lighting</code>.</p>' +
    '<p style="margin:0;">If item has tag <code>indoor</code>, template fills <code>{lighting}</code> with <code>indoor lighting</code>.</p>'
  );
}

function openReviewRulesHelpInPreview() {
  renderAdvancedHelpPreview(
    'Rules Help',
    '<p style="margin:0 0 10px 0;">Rules check caption quality. They do not auto-fill the template.</p>' +
    '<h4 style="margin:12px 0 6px 0;font-size:14px;">How It Works</h4>' +
    '<ul style="margin:0 0 8px 18px;padding:0;">' +
    '<li style="margin:0 0 6px 0;"><strong>file</strong> scope: if filename has Trigger, caption must include Required Phrase.</li>' +
    '<li style="margin:0 0 6px 0;"><strong>caption</strong> scope: if caption has Trigger, caption must include Required Phrase.</li>' +
    '<li style="margin:0 0 6px 0;">Enabled off means the rule is skipped.</li>' +
    '</ul>' +
    '<h4 style="margin:12px 0 6px 0;font-size:14px;">Simple Example</h4>' +
    '<p style="margin:0 0 6px 0;">Rule row: scope <strong>file</strong>, trigger <code>closeup</code>, required phrase <code>face</code>.</p>' +
    '<p style="margin:0 0 6px 0;">If filename includes <code>closeup</code> and caption is missing <code>face</code>, the review report flags it.</p>' +
    '<p style="margin:0;">This helps catch missing details before training.</p>'
  );
}

function addPrimerMappingDraftRow() {
  primerMappingsDraftRows.push(normalizePrimerMappingRow({}));
  renderPrimerMappingsDraft();
}

function addReviewRuleDraftRow() {
  reviewRulesDraftRows.push(normalizeReviewRuleRow({}));
  renderReviewRulesDraft();
}

function renderPrimerMappingsDraft() {
  if (!ui || !ui.primerMappingsModalBodyEl) return;
  var bodyEl = ui.primerMappingsModalBodyEl;
  bodyEl.innerHTML = '';
  var catalogTokens = getCaptionHelperCatalogTerms();

  var header = document.createElement('div');
  header.className = 'advanced-grid-row advanced-grid-row-header';
  ['Scope', 'Token', 'Key', 'Value (optional)', 'Enabled', ''].forEach(function (text) {
    var col = document.createElement('div');
    col.className = 'advanced-grid-header-cell';
    col.textContent = text;
    header.appendChild(col);
  });
  bodyEl.appendChild(header);

  primerMappingsDraftRows.forEach(function (row, idx) {
    var gridRow = document.createElement('div');
    gridRow.className = 'advanced-grid-row';

    var scope = document.createElement('select');
    ['file', 'tag'].forEach(function (value) {
      var opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      if (row.scope === value) opt.selected = true;
      scope.appendChild(opt);
    });
    scope.addEventListener('change', function () {
      primerMappingsDraftRows[idx].scope = scope.value;
      renderPrimerMappingsDraft();
    });
    gridRow.appendChild(createAdvancedCell(scope));

    if (row.scope === 'tag') {
      var tokenSelect = document.createElement('select');
      var tokenPlaceholderOpt = document.createElement('option');
      tokenPlaceholderOpt.value = '';
      tokenPlaceholderOpt.textContent = 'Select tag...';
      tokenSelect.appendChild(tokenPlaceholderOpt);
      var seenToken = {};
      catalogTokens.forEach(function (tokenValue) {
        var clean = String(tokenValue || '').trim();
        var low = clean.toLowerCase();
        if (!clean || seenToken[low]) return;
        seenToken[low] = true;
        var opt = document.createElement('option');
        opt.value = clean;
        opt.textContent = clean;
        tokenSelect.appendChild(opt);
      });
      if (row.token && !seenToken[String(row.token).toLowerCase()]) {
        var customOpt = document.createElement('option');
        customOpt.value = row.token;
        customOpt.textContent = row.token;
        tokenSelect.appendChild(customOpt);
      }
      tokenSelect.value = row.token || '';
      tokenSelect.addEventListener('change', function () {
        primerMappingsDraftRows[idx].token = tokenSelect.value;
      });
      gridRow.appendChild(createAdvancedCell(tokenSelect));
    } else {
      var token = document.createElement('input');
      token.type = 'text';
      token.placeholder = 'e.g. fd';
      token.value = row.token;
      token.addEventListener('input', function () {
        primerMappingsDraftRows[idx].token = token.value;
      });
      gridRow.appendChild(createAdvancedCell(token));
    }

    var key = document.createElement('input');
    key.type = 'text';
    key.placeholder = 'e.g. view';
    key.value = row.key;
    key.addEventListener('input', function () {
      primerMappingsDraftRows[idx].key = key.value;
    });
    gridRow.appendChild(createAdvancedCell(key));

    var value = document.createElement('input');
    value.type = 'text';
    value.placeholder = 'optional (defaults to token)';
    value.value = row.value;
    value.addEventListener('input', function () {
      primerMappingsDraftRows[idx].value = value.value;
    });
    gridRow.appendChild(createAdvancedCell(value));

    gridRow.appendChild(createCheckboxCell(row.enabled, function (nextValue) {
      primerMappingsDraftRows[idx].enabled = nextValue;
    }));

    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'stats-phrase-mini-btn';
    removeBtn.title = 'Remove mapping';
    removeBtn.textContent = 'x';
    removeBtn.addEventListener('click', function () {
      primerMappingsDraftRows.splice(idx, 1);
      renderPrimerMappingsDraft();
    });
    gridRow.appendChild(createAdvancedCell(removeBtn));
    bodyEl.appendChild(gridRow);
  });
}

function renderReviewRulesDraft() {
  if (!ui || !ui.reviewRulesModalBodyEl) return;
  var bodyEl = ui.reviewRulesModalBodyEl;
  bodyEl.innerHTML = '';

  var header = document.createElement('div');
  header.className = 'advanced-grid-row advanced-grid-row-header';
  ['Scope', 'Trigger', 'Required Phrase', 'Enabled', ''].forEach(function (text) {
    var col = document.createElement('div');
    col.className = 'advanced-grid-header-cell';
    col.textContent = text;
    header.appendChild(col);
  });
  bodyEl.appendChild(header);

  reviewRulesDraftRows.forEach(function (row, idx) {
    var gridRow = document.createElement('div');
    gridRow.className = 'advanced-grid-row advanced-grid-row-review';

    var scope = document.createElement('select');
    ['file', 'caption'].forEach(function (value) {
      var opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      if (row.scope === value) opt.selected = true;
      scope.appendChild(opt);
    });
    scope.addEventListener('change', function () {
      reviewRulesDraftRows[idx].scope = scope.value;
    });
    gridRow.appendChild(createAdvancedCell(scope));

    var trigger = document.createElement('input');
    trigger.type = 'text';
    trigger.placeholder = 'e.g. fd';
    trigger.value = row.trigger;
    trigger.addEventListener('input', function () {
      reviewRulesDraftRows[idx].trigger = trigger.value;
    });
    gridRow.appendChild(createAdvancedCell(trigger));

    var required = document.createElement('input');
    required.type = 'text';
    required.placeholder = 'e.g. face down';
    required.value = row.required;
    required.addEventListener('input', function () {
      reviewRulesDraftRows[idx].required = required.value;
    });
    gridRow.appendChild(createAdvancedCell(required));

    gridRow.appendChild(createCheckboxCell(row.enabled, function (nextValue) {
      reviewRulesDraftRows[idx].enabled = nextValue;
    }));

    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'stats-phrase-mini-btn';
    removeBtn.title = 'Remove rule';
    removeBtn.textContent = 'x';
    removeBtn.addEventListener('click', function () {
      reviewRulesDraftRows.splice(idx, 1);
      renderReviewRulesDraft();
    });
    gridRow.appendChild(createAdvancedCell(removeBtn));
    bodyEl.appendChild(gridRow);
  });

}

function openPrimerMappingsModal() {
  setStatus('Mappings are a legacy feature and may be removed in a future cleanup.');
  primerMappingsDraftRows = getPrimerMappingsRows();
  if (!primerMappingsDraftRows.length) {
    primerMappingsDraftRows.push(normalizePrimerMappingRow({}));
  }
  renderPrimerMappingsDraft();
  openAdvancedModal(ui && ui.primerMappingsModalEl);
}

function closePrimerMappingsModal() {
  closeAdvancedModal(ui && ui.primerMappingsModalEl);
}

function savePrimerMappingsModal() {
  setPrimerMappingsRows(primerMappingsDraftRows, true);
  closePrimerMappingsModal();
}

function openReviewRulesModal() {
  reviewRulesDraftRows = getReviewRulesRows();
  if (!reviewRulesDraftRows.length) {
    reviewRulesDraftRows.push(normalizeReviewRuleRow({}));
  }
  renderReviewRulesDraft();
  openAdvancedModal(ui && ui.reviewRulesModalEl);
}

function closeReviewRulesModal() {
  closeAdvancedModal(ui && ui.reviewRulesModalEl);
}

function saveReviewRulesModal() {
  setReviewRulesRows(reviewRulesDraftRows, true);
  closeReviewRulesModal();
}

function wireAdvancedMappingsRulesUi() {
  if (!ui) return;
  updatePrimerMappingsSummary();
  updateReviewRulesSummary();

  var mappingsInfoBtn = document.getElementById('primer-mappings-info-btn');
  if (mappingsInfoBtn && !mappingsInfoBtn.__advancedInfoBound) {
    mappingsInfoBtn.__advancedInfoBound = true;
    mappingsInfoBtn.addEventListener('click', openPrimerMappingsHelpInPreview);
  }
  var rulesInfoBtn = document.getElementById('review-rules-info-btn');
  if (rulesInfoBtn && !rulesInfoBtn.__advancedInfoBound) {
    rulesInfoBtn.__advancedInfoBound = true;
    rulesInfoBtn.addEventListener('click', openReviewRulesHelpInPreview);
  }

  if (ui.primerMappingsEditBtnEl && !ui.primerMappingsEditBtnEl.__advancedMappingsBound) {
    ui.primerMappingsEditBtnEl.__advancedMappingsBound = true;
    ui.primerMappingsEditBtnEl.addEventListener('click', openPrimerMappingsModal);
  }
  if (ui.reviewRulesEditBtnEl && !ui.reviewRulesEditBtnEl.__advancedRulesBound) {
    ui.reviewRulesEditBtnEl.__advancedRulesBound = true;
    ui.reviewRulesEditBtnEl.addEventListener('click', openReviewRulesModal);
  }
  if (ui.primerMappingsSaveBtnEl && !ui.primerMappingsSaveBtnEl.__advancedMappingsBound) {
    ui.primerMappingsSaveBtnEl.__advancedMappingsBound = true;
    ui.primerMappingsSaveBtnEl.addEventListener('click', savePrimerMappingsModal);
  }
  var primerMappingsAddBtnEl = document.getElementById('primer-mappings-modal-add-btn');
  if (primerMappingsAddBtnEl && !primerMappingsAddBtnEl.__advancedMappingsBound) {
    primerMappingsAddBtnEl.__advancedMappingsBound = true;
    primerMappingsAddBtnEl.addEventListener('click', addPrimerMappingDraftRow);
  }
  if (ui.reviewRulesSaveBtnEl && !ui.reviewRulesSaveBtnEl.__advancedRulesBound) {
    ui.reviewRulesSaveBtnEl.__advancedRulesBound = true;
    ui.reviewRulesSaveBtnEl.addEventListener('click', saveReviewRulesModal);
  }
  var reviewRulesAddBtnEl = document.getElementById('review-rules-modal-add-btn');
  if (reviewRulesAddBtnEl && !reviewRulesAddBtnEl.__advancedRulesBound) {
    reviewRulesAddBtnEl.__advancedRulesBound = true;
    reviewRulesAddBtnEl.addEventListener('click', addReviewRuleDraftRow);
  }
  if (ui.advancedModalOverlayEl && !ui.advancedModalOverlayEl.__advancedBound) {
    ui.advancedModalOverlayEl.__advancedBound = true;
    ui.advancedModalOverlayEl.addEventListener('click', function () {
      closePrimerMappingsModal();
      closeReviewRulesModal();
    });
  }
  if (!document.__advancedMappingsRulesCloseBound) {
    document.__advancedMappingsRulesCloseBound = true;
    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || !target.dataset) return;
      if (target.dataset.closeModal === 'primer-mappings-modal') {
        closePrimerMappingsModal();
        return;
      }
      if (target.dataset.closeModal === 'review-rules-modal') {
        closeReviewRulesModal();
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', function () {
  wireAdvancedMappingsRulesUi();
});
