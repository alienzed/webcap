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
  var scope = String(src.scope || 'file').toLowerCase();
  if (scope !== 'file' && scope !== 'tag') scope = 'file';
  return {
    scope: scope,
    token: String(src.token || '').trim(),
    key: String(src.key || '').trim().toLowerCase(),
    value: String(src.value || '').trim(),
    fallback: normalizeBool(src.fallback, false),
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
  return !!(row.token || row.key || row.value);
}

function reviewRuleRowHasData(row) {
  if (!row) return false;
  return !!(row.trigger || row.required);
}

function isCompletePrimerMappingRow(row) {
  return !!(row && row.token && row.key && row.value);
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
      if (!key || !value) return null;
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
        fallback: false,
        enabled: true
      };
    })
    .filter(Boolean);
}

function parseLegacyReviewRules(multiline) {
  if (typeof parseTokenRules === 'function') {
    return parseTokenRules(multiline).map(function (rule) {
      return {
        scope: String(rule.scope || 'file'),
        trigger: String(rule.trigger || ''),
        required: String(rule.required || ''),
        enabled: true
      };
    });
  }
  return [];
}

function triggerAdvancedRulesAutosave() {
  if (!state || !state.folder) return;
  if (typeof debouncedSaveFolderState === 'function') {
    debouncedSaveFolderState(function () {
      if (typeof saveFolderStateForCurrentRoot === 'function') {
        saveFolderStateForCurrentRoot();
      }
    });
    return;
  }
  if (typeof saveFolderStateForCurrentRoot === 'function') {
    saveFolderStateForCurrentRoot();
  }
}

function updatePrimerMappingsSummary() {
  if (!ui || !ui.primerMappingsSummaryEl) return;
  var total = primerMappingsRows.length;
  var enabled = primerMappingsRows.filter(function (row) { return !!row.enabled; }).length;
  if (!total) {
    ui.primerMappingsSummaryEl.textContent = 'No mappings configured.';
    return;
  }
  ui.primerMappingsSummaryEl.textContent = total + ' mapping' + (total === 1 ? '' : 's') + ' (' + enabled + ' enabled)';
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
    triggerAdvancedRulesAutosave();
  }
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

function renderPrimerMappingsDraft() {
  if (!ui || !ui.primerMappingsModalBodyEl) return;
  var bodyEl = ui.primerMappingsModalBodyEl;
  bodyEl.innerHTML = '';
  var catalogTokens = getCaptionHelperCatalogTerms();

  var header = document.createElement('div');
  header.className = 'advanced-grid-row advanced-grid-row-header';
  ['Scope', 'Token', 'Key', 'Value', 'Fallback', 'Enabled', ''].forEach(function (text) {
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
      var tokenWrap = document.createElement('div');
      tokenWrap.style.display = 'flex';
      tokenWrap.style.flexDirection = 'column';
      tokenWrap.style.gap = '4px';
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
      var tokenHint = document.createElement('div');
      tokenHint.className = 'small';
      tokenHint.textContent = 'Choose an exact catalog term.';
      tokenWrap.appendChild(tokenSelect);
      tokenWrap.appendChild(tokenHint);
      gridRow.appendChild(createAdvancedCell(tokenWrap));
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
    value.placeholder = 'e.g. face down';
    value.value = row.value;
    value.addEventListener('input', function () {
      primerMappingsDraftRows[idx].value = value.value;
    });
    gridRow.appendChild(createAdvancedCell(value));

    gridRow.appendChild(createCheckboxCell(row.fallback, function (nextValue) {
      primerMappingsDraftRows[idx].fallback = nextValue;
    }));
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

  var addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.id = 'primer-mappings-modal-add-btn';
  addBtn.textContent = '+ Add mapping';
  addBtn.addEventListener('click', function () {
    primerMappingsDraftRows.push(normalizePrimerMappingRow({}));
    renderPrimerMappingsDraft();
  });
  bodyEl.appendChild(addBtn);
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

  var addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.id = 'review-rules-modal-add-btn';
  addBtn.textContent = '+ Add rule';
  addBtn.addEventListener('click', function () {
    reviewRulesDraftRows.push(normalizeReviewRuleRow({}));
    renderReviewRulesDraft();
  });
  bodyEl.appendChild(addBtn);
}

function openPrimerMappingsModal() {
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
  if (ui.reviewRulesSaveBtnEl && !ui.reviewRulesSaveBtnEl.__advancedRulesBound) {
    ui.reviewRulesSaveBtnEl.__advancedRulesBound = true;
    ui.reviewRulesSaveBtnEl.addEventListener('click', saveReviewRulesModal);
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
