(function () {
  'use strict';

  var templateDirty = false;
  var qaOpen = false;
  var open = false;
  var openedFolder = '';
  var distributionParent = null;
  var focusMigrationFolder = '';
  var focusMigrationStatus = '';
  var vocabularySignature = '';
  var expandedVocabularyGroups = new Set();

  function el(id) { return document.getElementById(id); }

  function snapshot() {
    var items = (state && Array.isArray(state.items)) ? state.items : [];
    var phrase = String(el('stats-required-phrase').value || '').trim();
    // Distribution and preparation use the current media scope.
    var visibleItems = getFilteredMediaItems(false).filter(function (item) { return !!(item && item.key); });
    var sight = visibleItems.filter(function (item) {
      var s = item && item.metadata && item.metadata.vision_sight;
      return s && s.description && s.inventory;
    }).length;
    // Focused Caption and Focused Annotation act on the visible scope.
    var visibleCaptions = visibleItems.filter(function (item) {
      return !!(item.hasCaption || String(item.caption || '').trim());
    }).length;
    var groups = (checklistItems || []).filter(function (name) {
      return getChecklistKeywordTermsForRequirement(name).length > 0;
    });
    var reviewedGroups = 0;
    visibleItems.forEach(function (item) {
      groups.forEach(function (name) {
        if (isChecklistRequirementCheckedForMediaKey(item.key, name)) reviewedGroups++;
      });
    });
    var totalGroups = visibleItems.length * groups.length;
    return {
      items: items, visibleItems: visibleItems, total: items.length, phrase: phrase,
      sight: sight, configuredGroups: groups.length,
      visibleTotal: visibleItems.length, visibleCaptions: visibleCaptions,
      reviewedGroups: reviewedGroups, totalGroups: totalGroups
    };
  }

  function setHidden(node, hidden) { node.classList.toggle('hidden', !!hidden); }

  function run(destination) {
    var origin = 'analyze';
    if (destination === 'train') return openTrainingSurface('set');
    if (destination === 'prepare') return openDashboard('analyze');
    if (destination === 'annotation') { closeDashboard(); return startFocusedAnnotation(); }
    if (destination === 'guided') { closeDashboard(); return openGuidedTagPass({ source: 'set' }); }
    if (destination === 'curate' || ['report', 'captions', 'metadata', 'prune', 'duplicates'].indexOf(destination) !== -1) {
      setWorkspaceSurface('reviewOutput');
      if (destination === 'curate') {
        setReviewDetailTab('qa');
        return window.qaStartCurationFromDashboard(origin);
      }
      return setReviewDetailTab(destination);
    }
    throw new Error('Unknown Set Dashboard action: ' + destination);
  }

  function inspectDistribution(files, label) {
    if (!files.length) return;
    // Keep the original return context when inspecting another count from a temporary subset.
    if (!state.focusSet || state.focusSet.reportType !== 'dashboardDistribution' ||
        !distributionParent || distributionParent.folder !== openedFolder) {
      distributionParent = { folder: openedFolder, focusSet: state.focusSet ? {
        keys: state.focusSet.keys.slice(), source: state.focusSet.source, reportType: state.focusSet.reportType
      } : null };
    }
    closeDashboard();
    activateFocusSet(files, 'Distribution · ' + label, 'dashboardDistribution');
    setWorkspaceSurface('default');
    openMediaGridSurface();
  }

  function returnFromDistribution() {
    if (!distributionParent || distributionParent.folder !== String(state.folder || '')) throw new Error('Distribution return context is missing.');
    state.focusSet = distributionParent.focusSet;
    distributionParent = null;
    updateFocusSetUi();
    renderFileList(ui.filterEl.value);
    pruneCandidatesScopeChanged();
    duplicateCandidatesScopeChanged();
    openDashboard('analyze');
  }

  function variableCoverage(variable, items) {
    var terms = variable.terms.map(function (term, index) {
      return { key: 'term:' + index, label: term, files: [], only: [], color: index };
    });
    var neither = [], multiple = [];
    items.forEach(function (item) {
      var assigned = setVariableAssignedTerms(item, variable.group);
      var matches = terms.filter(function (row) {
        return assigned.has(normalizeChecklistTerm(row.label).toLowerCase());
      });
      matches.forEach(function (row) { row.files.push(item.fileName); });
      if (!matches.length) neither.push(item.fileName);
      else if (matches.length === 1) matches[0].only.push(item.fileName);
      else multiple.push(item.fileName);
    });
    // Exclusive bars partition the population exactly once. Multi-label bars
    // retain independent membership counts; their sum can exceed the scope.
    var rows = terms.map(function (row) {
      return { key: row.key, label: row.label + (variable.exclusive && multiple.length ? ' only' : ''),
        files: variable.exclusive ? row.only : row.files, color: row.color };
    });
    if (variable.exclusive) rows.push({ key: 'multiple', label: 'Multiple', files: multiple, color: 'warning' });
    rows.push({ key: 'neither', label: 'Neither', files: neither,
      color: 'neutral' });
    return { rows: rows, neither: neither.length, multiple: multiple.length,
      missingFiles: neither, multipleFiles: multiple };
  }

  function variableWarnings(variables, items) {
    var warnings = [];
    variables.forEach(function (variable) {
      var result = variableCoverage(variable, items);
      if (variable.exclusive && result.multiple) warnings.push({
        key: setVariableKey(variable), group: variable.group, kind: 'multiple', label: 'Multiple exclusive terms', files: result.multipleFiles
      });
    });
    return warnings;
  }

  function distributionColor(color) {
    if (color === 'warning') return 'var(--dashboard-distribution-warning)';
    if (color === 'neutral') return 'var(--muted)';
    return 'var(--dashboard-distribution-' + (color % 5) + ')';
  }

  function renderVariableCard(section, variable, result, total) {
    var title = section.querySelector('h5');
    title.textContent = variable.group;
    section.querySelector('.set-dashboard-variable-kind').textContent =
      (variable.exclusive ? 'Exclusive' : 'May coexist');
    var stack = section.querySelector('.set-dashboard-variable-stack');
    setHidden(stack, !variable.exclusive || !total);
    var legend = section.querySelector('.set-dashboard-variable-rows');
    legend.classList.toggle('is-exclusive', variable.exclusive);
    var oldRows = new Map(Array.from(legend.children).map(function (row) { return [row.dataset.key, row]; }));
    var oldSegments = new Map(Array.from(stack.children).map(function (row) { return [row.dataset.key, row]; }));
    result.rows.forEach(function (row, index) {
      var share = total ? 100 * row.files.length / total : 0;
      var color = distributionColor(row.color);
      var entry = oldRows.get(row.key);
      if (!entry) {
        entry = document.createElement('button');
        entry.type = 'button'; entry.className = 'set-dashboard-variable-row'; entry.dataset.key = row.key;
        var label = document.createElement('span'); label.className = 'set-dashboard-variable-label';
        var swatch = document.createElement('i'); swatch.className = 'set-dashboard-variable-swatch';
        var name = document.createElement('span');
        label.append(swatch, name);
        var count = document.createElement('strong');
        var bar = document.createElement('span'); bar.className = 'set-dashboard-variable-track';
        var fill = document.createElement('span'); bar.appendChild(fill);
        entry.append(label, count, bar);
        legend.appendChild(entry);
      }
      oldRows.delete(row.key);
      var labelNode = entry.children[0];
      labelNode.children[0].style.backgroundColor = color;
      labelNode.children[1].textContent = row.label;
      entry.children[1].textContent = row.files.length + ' / ' + total;
      entry.children[2].firstElementChild.style.width = share + '%';
      entry.children[2].firstElementChild.style.backgroundColor = color;
      entry.disabled = !row.files.length;
      entry.title = row.label + ' · ' + Math.round(share) + '% · Inspect matching media';
      entry.setAttribute('aria-label', variable.group + ' · ' + row.label + ': inspect ' + row.files.length + ' media');
      entry.onclick = function () { inspectDistribution(row.files, variable.group + ' · ' + row.label); };
      if (legend.children[index] !== entry) legend.insertBefore(entry, legend.children[index] || null);

      var segment = oldSegments.get(row.key);
      if (variable.exclusive) {
        if (!segment) {
          segment = document.createElement('span');
          segment.dataset.key = row.key;
          stack.appendChild(segment);
        }
        oldSegments.delete(row.key);
        segment.style.width = share + '%';
        segment.style.backgroundColor = color;
        segment.title = row.label + ': ' + row.files.length;
        if (stack.children[index] !== segment) stack.insertBefore(segment, stack.children[index] || null);
      }
    });
    oldRows.forEach(function (node) { node.remove(); });
    oldSegments.forEach(function (node) { node.remove(); });
    var warnings = [];
    if (variable.exclusive && result.multiple) warnings.push(result.multiple + ' with multiple terms');
    var notice = section.querySelector('.set-dashboard-variable-notice');
    notice.textContent = warnings.join(' · ');
    setHidden(notice, !warnings.length);
  }

  function renderVariables(s) {
    var host = el('set-dashboard-variables');
    var variables = state.setVariables || [];
    setHidden(el('set-dashboard-variable-empty'), !!variables.length);
    var oldCards = new Map(Array.from(host.children).map(function (card) { return [card.dataset.group, card]; }));
    variables.forEach(function (variable, index) {
      var key = setVariableKey(variable);
      var section = oldCards.get(key);
      if (!section) {
        section = document.createElement('section');
        section.className = 'set-dashboard-variable-card'; section.dataset.group = key;
        var title = document.createElement('h5');
        var kind = document.createElement('div'); kind.className = 'set-dashboard-variable-kind';
        var stack = document.createElement('div'); stack.className = 'set-dashboard-variable-stack';
        stack.setAttribute('aria-hidden', 'true');
        var legend = document.createElement('div'); legend.className = 'set-dashboard-variable-rows';
        var notice = document.createElement('div'); notice.className = 'set-dashboard-variable-notice';
        section.append(title, kind, stack, legend, notice);
        host.appendChild(section);
      }
      oldCards.delete(key);
      renderVariableCard(section, variable, variableCoverage(variable, s.visibleItems), s.visibleTotal);
      if (host.children[index] !== section) host.insertBefore(section, host.children[index] || null);
    });
    oldCards.forEach(function (card) { card.remove(); });
  }

  // One group, one scoped edit. The group list owns vocabulary and the
  // Dashboard owns the selected training terms; neither changes item tags.
  function variableForGroup(group) {
    return (state.setVariables || []).find(function (row) { return row.group === group; }) ||
      {group:group, terms:[], exclusive:false};
  }

  function makeVariableCheckbox(label, checked) {
    var wrapper = document.createElement('label');
    var input = document.createElement('input');
    input.type = 'checkbox'; input.checked = checked;
    wrapper.append(input, document.createTextNode(' ' + label));
    return {node:wrapper,input:input};
  }

  function renderGroupVariableSummary(group, host) {
    var variable = variableForGroup(group);
    var summary = document.createElement('span');
    summary.className = 'set-dashboard-group-variable-status';
    summary.textContent = variable.terms.length
      ? variable.terms.length + ' selected · ' + (variable.exclusive ? 'Exclusive' : 'May coexist')
      : 'Vocabulary only';
    summary.classList.toggle('is-variable', !!variable.terms.length);
    host.appendChild(summary);
  }

  function renderGroupVariableEditor(group, host) {
    var variable = variableForGroup(group);
    var selected = new Set(variable.terms.map(function (term) { return normalizeChecklistTerm(term).toLowerCase(); }));
    var catalog = new Map();
    getChecklistKeywordTermsForRequirement(group).forEach(function (term) {
      catalog.set(normalizeChecklistTerm(term).toLowerCase(), {term:term,retained:false});
    });
    // Preserve explicit choices if the vocabulary is edited or temporarily hidden.
    variable.terms.forEach(function (term) {
      var key = normalizeChecklistTerm(term).toLowerCase();
      if (!catalog.has(key)) catalog.set(key,{term:term,retained:true});
    });
    var title = document.createElement('p');
    title.className = 'set-dashboard-variable-editor-label';
    title.textContent = 'Set Variable · Select training terms';
    host.appendChild(title);
    var terms = document.createElement('div');
    terms.className = 'set-dashboard-variable-terms';
    function identify(input, field, term) {
      input.id = 'set-variable-' + encodeURIComponent(JSON.stringify([group,field,term || '']));
    }
    var checks = [];
    catalog.forEach(function (entry, key) {
      var check = makeVariableCheckbox(entry.term + (entry.retained ? ' (saved)' : ''), selected.has(key));
      identify(check.input, 'term', entry.term);
      checks.push({term:entry.term,input:check.input});
      terms.appendChild(check.node);
    });
    if (!checks.length) {
      terms.textContent = 'Add vocabulary terms using the group menu.';
    }
    host.appendChild(terms);
    var options = document.createElement('div');
    options.className = 'set-dashboard-variable-options';
    var exclusive = makeVariableCheckbox('Mutually exclusive', variable.exclusive);
    identify(exclusive.input, 'exclusive');
    var reset = document.createElement('button');
    reset.type = 'button'; reset.className = 'set-dashboard-quiet set-dashboard-variable-reset';
    reset.textContent = 'Reset'; reset.title = 'Clear selected Set Variables in this group';
    reset.disabled = !variable.terms.length;
    options.append(exclusive.node,reset);
    host.appendChild(options);
    function selectedTerms() {
      var chosen = new Map(checks.filter(function (check) { return check.input.checked; }).map(function (check) {
        return [normalizeChecklistTerm(check.term).toLowerCase(), check.term];
      }));
      var terms = [];
      variableForGroup(group).terms.forEach(function (term) {
        var key = normalizeChecklistTerm(term).toLowerCase();
        if (chosen.has(key)) { terms.push(term); chosen.delete(key); }
      });
      return terms.concat(Array.from(chosen.values()));
    }
    function saveSelection() {
      var active = document.activeElement;
      var restoreFocus = active === this ? this.id : '';
      state.setVariables = replaceSetGroupVariable(state.setVariables, group, {
        terms:selectedTerms(), exclusive:exclusive.input.checked
      });
      scheduleSetDefinitionSave();
      updateBalanceDistributionWheel();
      renderStage();
      // The existing renderer refreshes group summaries and editor state.
      // Keep keyboard users on the checkbox they just changed.
      if (restoreFocus) {
        var next = document.getElementById(restoreFocus);
        if (next && !next.disabled) next.focus({preventScroll:true});
      }
    }
    checks.forEach(function (check) { check.input.onchange = saveSelection; });
    exclusive.input.onchange = saveSelection;
    exclusive.input.disabled = !variable.terms.length;
    reset.onclick = function () {
      checks.forEach(function (check) { check.input.checked = false; });
      exclusive.input.checked = false;
      saveSelection.call(reset);
    };
  }

  function renderVocabulary() {
    var signature = JSON.stringify([openedFolder, state.setVariables, checklistItems.map(function (group) {
      return [group, getChecklistKeywordTermsForRequirement(group), isChecklistRequirementHidden(group)];
    })]);
    if (signature === vocabularySignature) return;
    vocabularySignature = signature;
    renderChecklistGroupRows(el('set-dashboard-group-list'), {
      definition:true, expanded:expandedVocabularyGroups,
      renderDefinitionSummary:renderGroupVariableSummary,
      renderDefinitionEditor:renderGroupVariableEditor
    });
  }

  function addVocabularyGroup() {
    var input = el('set-dashboard-group-name');
    if (!String(input.value || '').trim()) return;
    if (!addChecklistGroup(input.value)) {
      setStatus('A vocabulary group with that name already exists.');
      return;
    }
    input.value = '';
    renderStage();
  }

  function renderDefinition(s) {
    var input = el('set-dashboard-training-focus');
    var value = window.getQaTrainingFocus();
    if (document.activeElement !== input) input.value = value;
    var missing = [];
    if (!input.value.trim()) missing.push('Training focus');
    if (!s.phrase) missing.push('Required key phrase');
    var definition = el('set-dashboard-definition-status');
    definition.textContent = missing.length ? missing.join(' and ') + ' missing' : '';
    setHidden(definition, !missing.length);
    input.classList.toggle('set-dashboard-missing', !input.value.trim());
    el('stats-required-phrase').classList.toggle('set-dashboard-missing', !s.phrase);
    el('set-dashboard-focus-migration').textContent = focusMigrationStatus;
    setHidden(el('set-dashboard-focus-migration'), !focusMigrationStatus);
  }

  // Share the existing requirement-key catalog, but insert into this unsaved
  // draft only. Save Template remains the explicit persistence boundary.
  var templatePlaceholderSignature = null;
  function renderTemplatePlaceholders() {
    var draft = el('set-dashboard-template-draft');
    var used = new Set((draft.value.match(/\{[^{}]+\}/g) || []).map(function (value) {
      return value.toLowerCase();
    }));
    var unused = getPrimerTemplatePlaceholderItems().filter(function (item) {
      return !used.has(item.placeholder.toLowerCase());
    });
    var signature = JSON.stringify(unused);
    if (signature === templatePlaceholderSignature) return;
    templatePlaceholderSignature = signature;
    var host = el('set-dashboard-template-placeholders');
    host.replaceChildren();
    unused.forEach(function (item) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'primer-template-placeholder-btn';
      button.textContent = item.label;
      button.title = 'Insert ' + item.placeholder;
      button.onclick = function () {
        draft.setRangeText(item.placeholder, draft.selectionStart, draft.selectionEnd, 'end');
        draft.focus();
        templateDirty = true;
        renderTemplatePlaceholders();
      };
      host.appendChild(button);
    });
  }

  function renderStage() {
    if (!open) return;
    if (String(state.folder || '') !== openedFolder) { closeDashboard(); return; }
    var s = snapshot();
    el('set-dashboard-scope').textContent = s.visibleTotal + ' of ' + s.total + ' media' + (state.focusSet ? ' · Focus Set' : '');
    el('set-dashboard-curate').disabled = !s.visibleTotal;
    el('set-dashboard-train').disabled = !s.visibleTotal;
    renderDefinition(s);
    el('set-dashboard-definition-summary').textContent = el('set-dashboard-definition').open ? '' : window.getQaTrainingFocus();
    var variables = state.setVariables || [];
    if (!templateDirty) el('set-dashboard-template-draft').value = String(statsGetPrimerOptionsFromDom().template || '');
    if (!window.isSetIntelligenceOpen()) window.openSetIntelligence();
    else window.refreshSetIntelligenceScope();
    if (el('set-dashboard-definition').open) {
      renderVocabulary();
      renderTemplatePlaceholders();
    }
    var missingCaptions = s.visibleTotal - s.visibleCaptions;
    if (!qaOpen) el('set-dashboard-qa-summary').textContent = missingCaptions ? missingCaptions + ' without captions' : 'Inspect findings';
    var tagsStatus = el('set-dashboard-tags-status');
    var remaining = s.totalGroups - s.reviewedGroups;
    tagsStatus.textContent = !s.configuredGroups ? 'No groups configured' : remaining ? remaining + ' group ' + (remaining === 1 ? 'assignment' : 'assignments') + ' left to review' : '';
    setHidden(tagsStatus, !tagsStatus.textContent);
    setHidden(el('set-dashboard-tags-primary'), !s.configuredGroups || !s.visibleTotal);
    el('set-dashboard-tags-primary').textContent = remaining ? 'Continue annotation review' : 'Focused Annotation';
    var count = variables.length;
    var warnings = variableWarnings(state.setVariables || [], s.visibleItems);
    el('set-dashboard-balance-summary').textContent = count ? count + (count === 1 ? ' variable' : ' variables') + (warnings.length ? ' · ' + warnings.length + ' coverage concerns' : '') : 'Define Set Variables';
    renderVariables(s);
  }

  function syncQaSection() {
    var next = open && el('set-dashboard-review').open;
    if (next === qaOpen) return;
    qaOpen = next;
    if (next) window.showQaInSetDashboard();
    else window.hideQaInSetDashboard();
  }

  function openDashboard(preferredStage) {
    if (!isSetFolderPath(state.folder) || !Array.isArray(state.items) || !state.items.length) return;
    if (setWorkspaceSurface('dashboard') === false) return;
    if (openedFolder !== String(state.folder || '')) {
      focusMigrationStatus = '';
      focusMigrationFolder = '';
      templateDirty = false;
      vocabularySignature = '';
      expandedVocabularyGroups.clear();
      el('set-dashboard-group-name').value = '';
      el('set-dashboard-definition').open = !window.getQaTrainingFocus() || !String(el('stats-required-phrase').value || '').trim() || !(state.setVariables || []).length;
      el('set-dashboard-balance-section').open = true;
      el('set-dashboard-review').open = false;
    }
    openedFolder = String(state.folder || '');
    if (preferredStage === 'review') el('set-dashboard-review').open = true;
    if (preferredStage === 'analyze' && !el('set-dashboard-definition').open && !el('set-dashboard-balance-section').open) el('set-dashboard-balance-section').open = true;
    if (preferredStage === 'reports') el('set-dashboard-reports').open = true;
    el('set-dashboard-name').textContent = openedFolder.split(/[\\/]/).filter(Boolean).pop() || 'Current Set';
    open = true;
    setHidden(el('set-dashboard-modal'), false);
    renderStage();
    syncQaSection();
    if (focusMigrationFolder !== openedFolder && state.setTrainingFocus == null) {
      focusMigrationFolder = openedFolder;
      focusMigrationStatus = '';
      var folder = openedFolder;
      window.loadLegacySetTrainingFocus().then(function (candidates) {
        if (String(state.folder || '') !== folder) return;
        focusMigrationStatus = candidates.length > 1 ? 'Previous QA reviews used different training focuses. Set your intended focus here.' : '';
        if (open) renderStage();
      }).catch(function (err) {
        reportConsoleError('Set Definition · training focus', err);
        if (String(state.folder || '') !== folder) return;
        focusMigrationFolder = '';
        focusMigrationStatus = 'Previous training focus could not be checked.';
        if (open) renderStage();
      });
    }

  }

  function closeDashboard(options) {
    if (!open) return;
    open = false;
    if (window.isSetIntelligenceOpen()) window.closeSetIntelligence();
    syncQaSection();
    setHidden(el('set-dashboard-modal'), true);
    el('set-dashboard-reports').open = false;
    if (!(options && options.keepSurface)) setWorkspaceSurface('default', {skipRemember: true});
  }

  function init() {
    var launcher = el('set-dashboard-open-btn');
    if (!launcher || !el('set-dashboard-modal')) {
      throw new Error('Set Dashboard UI is incomplete.');
    }
    launcher.addEventListener('click', openDashboard);
    el('set-dashboard-header-btn').addEventListener('click', openDashboard);
    el('set-dashboard-definition').addEventListener('toggle', function () {
      if (!open) return;
      renderStage();
    });
    el('set-dashboard-review').addEventListener('toggle', syncQaSection);
    el('set-dashboard-training-focus').addEventListener('input', function () { if (open) renderDefinition(snapshot()); });
    el('set-dashboard-training-focus').addEventListener('change', function () {
      if (String(state.folder || '') !== openedFolder) return;
      window.setQaTrainingFocus(el('set-dashboard-training-focus').value);
      focusMigrationStatus = '';
      renderStage();
    });
    el('set-dashboard-group-add').onclick = addVocabularyGroup;
    el('set-dashboard-group-settings').onclick = openChecklistKeywordsModal;
    el('set-dashboard-group-name').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); addVocabularyGroup(); }
    });
    var destinations = {
      'set-dashboard-tags-primary': 'annotation',
      'set-dashboard-tags-guided': 'guided', 'set-dashboard-train': 'train',
      'set-dashboard-curate': 'curate', 'set-dashboard-review-captions': 'captions',
      'set-dashboard-review-report': 'report', 'set-dashboard-review-metadata': 'metadata',
      'set-dashboard-review-prune': 'prune', 'set-dashboard-review-duplicates': 'duplicates'
    };
    Object.keys(destinations).forEach(function (id) { el(id).onclick = function (event) { if (id === 'set-dashboard-curate' && event) { event.preventDefault(); event.stopPropagation(); } run(destinations[id]); }; });
    el('set-dashboard-template-draft').addEventListener('input', function () { templateDirty = true; renderTemplatePlaceholders(); });
    el('set-dashboard-template-save').onclick = function () {
      setPrimerTemplateFromDashboard(el('set-dashboard-template-draft').value);
      templateDirty = false;
      renderStage();
    };
    el('set-dashboard-template-reset').onclick = function () {
      templateDirty = false;
      renderStage();
    };
    window.addEventListener('webcap:media-metadata-updated', function () { if (open) renderStage(); });
    el('stats-required-phrase').addEventListener('change', function () { if (open) renderStage(); });
    el('set-dashboard-variable-empty-action').onclick = function () {
      el('set-dashboard-definition').open = true;
      renderStage();
      el('set-dashboard-group-list').scrollIntoView({block:'nearest'});
    };
  }

  window.getSetVariableWarnings = variableWarnings;
  window.returnToSetDashboardDistribution = returnFromDistribution;
  window.openSetDashboard = openDashboard;
  window.refreshSetDashboard = renderStage;
  window.setSetDashboardQaSummary = function (findings, captionless) {
    el('set-dashboard-qa-summary').textContent = findings + (findings === 1 ? ' finding' : ' findings') + (captionless ? ' · ' + captionless + ' without captions' : '');
  };
  window.closeSetDashboard = closeDashboard;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();