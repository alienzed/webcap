(function () {
  'use strict';

  var templateDirty = false;
  var qaOpen = false;
  var open = false;
  var selected = 'analyze';
  var openedFolder = '';
  var distributionParent = null;
  var focusMigrationFolder = '';
  var focusMigrationStatus = '';

  function el(id) { return document.getElementById(id); }

  function snapshot() {
    var items = (state && Array.isArray(state.items)) ? state.items : [];
    var phrase = String(el('stats-required-phrase').value || '').trim();
    var balances = String(el('stats-phrases').value || '').split(/\r?\n/).map(function (p) { return p.trim(); }).filter(Boolean);
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
    var pending = totalGroups > reviewedGroups;
    return {
      items: items, visibleItems: visibleItems, total: items.length, phrase: phrase, balances: balances,
      sight: sight, configuredGroups: groups.length,
      visibleTotal: visibleItems.length, visibleCaptions: visibleCaptions,
      reviewedGroups: reviewedGroups, totalGroups: totalGroups,
      pending: pending
    };
  }

  function setHidden(node, hidden) { node.classList.toggle('hidden', !!hidden); }

  function run(destination) {
    var origin = el('set-dashboard-review').open ? 'review' : 'analyze';
    if (destination === 'train') { closeDashboard(); return openTrainingSurface('set'); }
    // Group configuration is a modal over the current workspace.
    if (destination === 'groups') return openChecklistKeywordsModal();
    closeDashboard();
    if (destination === 'prepare') return openDashboard('analyze');
    if (destination === 'annotation') return startFocusedAnnotation();
    if (destination === 'guided') return openGuidedTagPass({ source: 'set' });
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

  function renderDistribution(s) {
    var root = el('set-dashboard-distribution');
    var sources = [];
    var existing = new Map(Array.from(root.children).map(function (row) { return [row.dataset.phrase, row]; }));
    s.balances.forEach(function (phrase) {
      var files = [], captionCount = 0, tagCount = 0;
      s.visibleItems.forEach(function (item) {
        var caption = balanceWheelCaptionMatches(item, phrase);
        var tag = balanceWheelTagMatches(item, phrase);
        if (caption) captionCount++;
        if (tag) tagCount++;
        if (caption || tag) files.push(item.fileName);
      });
      var row = existing.get(phrase);
      if (!row) {
        row = document.createElement('div');
        row.className = 'set-dashboard-dist-row';
        row.dataset.phrase = phrase;
        var name = document.createElement('span');
        name.className = 'set-dashboard-dist-name';
        name.textContent = phrase;
        var track = document.createElement('span');
        track.className = 'set-dashboard-progress-track';
        var fill = document.createElement('span');
        fill.className = 'set-dashboard-progress-fill';
        track.appendChild(fill);
        var count = document.createElement('button');
        count.type = 'button';
        count.className = 'set-dashboard-dist-count';
        row.append(name, track, count);
        root.appendChild(row);
      }
      existing.delete(phrase);
      var button = row.lastElementChild;
      button.textContent = files.length + ' / ' + s.visibleTotal + ' →';
      button.title = captionCount + ' captions · ' + tagCount + ' tags · ' + files.length + ' either';
      sources.push(phrase + ': ' + button.title);
      button.setAttribute('aria-label', phrase + ': ' + button.title + '. Inspect matching media');
      button.disabled = !files.length;
      button.onclick = function () { inspectDistribution(files, phrase); };
      row.children[1].firstElementChild.style.width = (s.visibleTotal ? files.length * 100 / s.visibleTotal : 0) + '%';
      // Reconcile only actual order changes; do not replace interactive rows.
      if (root.children[s.balances.indexOf(phrase)] !== row) root.insertBefore(row, root.children[s.balances.indexOf(phrase)] || null);
    });
    existing.forEach(function (row) { row.remove(); });
    el('set-dashboard-distribution-sources').textContent = sources.join('\n');
  }

  function variableCoverage(variable, items) {
    var terms = variable.terms.map(function (term, index) {
      return { key: 'term:' + index, label: term, files: [], only: [], color: index };
    });
    var neither = [], multiple = [];
    items.forEach(function (item) {
      var assigned = new Set(getChecklistAssignedTagsForMediaKey(item.key, variable.group).map(function (term) {
        return normalizeChecklistTerm(term).toLowerCase();
      }));
      var matches = terms.filter(function (row) { return assigned.has(normalizeChecklistTerm(row.label).toLowerCase()); });
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
      color: variable.expected && items.length && neither.length / items.length > .25 ? 'warning' : 'neutral' });
    return { rows: rows, neither: neither.length, multiple: multiple.length,
      missingFiles: neither, multipleFiles: multiple };
  }

  function variableWarnings(variables, items) {
    var warnings = [];
    variables.forEach(function (variable) {
      var result = variableCoverage(variable, items);
      if (variable.exclusive && result.multiple) warnings.push({
        group: variable.group, kind: 'multiple', label: 'Multiple exclusive terms', files: result.multipleFiles
      });
      if (variable.expected && items.length && result.neither / items.length > .25) warnings.push({
        group: variable.group, kind: 'missing', label: 'Missing coverage', files: result.missingFiles
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
      (variable.exclusive ? 'Exclusive' : 'May coexist') + (variable.expected ? ' · Expected' : '');
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
    if (variable.expected && total && result.neither / total > .25) warnings.push(Math.round(100 * result.neither / total) + '% missing');
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
      var section = oldCards.get(variable.group);
      if (!section) {
        section = document.createElement('section');
        section.className = 'set-dashboard-variable-card'; section.dataset.group = variable.group;
        var title = document.createElement('h5');
        var kind = document.createElement('div'); kind.className = 'set-dashboard-variable-kind';
        var stack = document.createElement('div'); stack.className = 'set-dashboard-variable-stack';
        stack.setAttribute('aria-hidden', 'true');
        var legend = document.createElement('div'); legend.className = 'set-dashboard-variable-rows';
        var notice = document.createElement('div'); notice.className = 'set-dashboard-variable-notice';
        section.append(title, kind, stack, legend, notice);
        host.appendChild(section);
      }
      oldCards.delete(variable.group);
      renderVariableCard(section, variable, variableCoverage(variable, s.visibleItems), s.visibleTotal);
      if (host.children[index] !== section) host.insertBefore(section, host.children[index] || null);
    });
    oldCards.forEach(function (card) { card.remove(); });
  }

  function makeVariableCheckbox(label, checked, type, value) {
    var wrapper = document.createElement('label');
    var input = document.createElement('input');
    input.type = 'checkbox'; input.checked = checked; input.dataset.variableType = type;
    if (value !== undefined) input.value = value;
    wrapper.append(input, document.createTextNode(' ' + label));
    return wrapper;
  }

  function openVariableEditor() {
    var host = el('set-dashboard-variable-groups');
    host.replaceChildren();
    var saved = new Map((state.setVariables || []).map(function (row) { return [row.group, row]; }));
    var groups = Array.from(new Set(checklistItems.concat(Array.from(saved.keys()))));
    groups.forEach(function (group) {
      var row = saved.get(group) || { terms: [], exclusive: false, expected: false };
      var field = document.createElement('details');
      field.className = 'set-dashboard-variable-group';
      field.dataset.group = group;
      var summary = document.createElement('summary');
      summary.textContent = group;
      field.appendChild(summary);
      field.open = saved.has(group);
      var terms = Array.from(new Set(getChecklistKeywordTermsForRequirement(group).concat(row.terms)));
      terms.forEach(function (term) {
        field.appendChild(makeVariableCheckbox(term, row.terms.includes(term), 'term', term));
      });
      var options = document.createElement('div');
      options.className = 'set-dashboard-variable-options';
      options.append(makeVariableCheckbox('Mutually exclusive', row.exclusive, 'exclusive'), makeVariableCheckbox('Expected on most media', row.expected, 'expected'));
      field.appendChild(options);
      host.appendChild(field);
    });
    setHidden(el('set-dashboard-variable-editor'), false);
  }

  function applyVariableEditor() {
    var rows = Array.from(el('set-dashboard-variable-groups').children).map(function (field) {
      return {
        group: field.dataset.group,
        terms: Array.from(field.querySelectorAll('[data-variable-type="term"]:checked')).map(function (input) { return input.value; }),
        exclusive: field.querySelector('[data-variable-type="exclusive"]').checked,
        expected: field.querySelector('[data-variable-type="expected"]').checked
      };
    });
    state.setVariables = normalizeSetVariables(rows);
    scheduleSetDefinitionSave();
    setHidden(el('set-dashboard-variable-editor'), true);
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

  function renderStage() {
    if (!open) return;
    if (String(state.folder || '') !== openedFolder) { closeDashboard(); return; }
    var s = snapshot();
    el('set-dashboard-scope').textContent = s.visibleTotal + ' of ' + s.total + ' media' + (state.focusSet ? ' · Focus Set' : '');
    el('set-dashboard-curate').disabled = !s.visibleTotal;
    el('set-dashboard-train').disabled = !s.visibleTotal;
    renderDefinition(s);
    el('set-dashboard-definition-summary').textContent = window.getQaTrainingFocus() || 'Define training focus';
    if (!templateDirty) el('set-dashboard-template-draft').value = String(statsGetPrimerOptionsFromDom().template || '');
    if (el('set-dashboard-definition').open && !window.isSetIntelligenceOpen()) window.openSetIntelligence();
    var tagsStatus = el('set-dashboard-tags-status');
    var remaining = s.totalGroups - s.reviewedGroups;
    tagsStatus.textContent = !s.configuredGroups ? 'No groups configured' : remaining ? remaining + ' media/group assignments left to review' : '';
    setHidden(tagsStatus, !tagsStatus.textContent);
    setHidden(el('set-dashboard-tags-primary'), !s.configuredGroups || !s.visibleTotal);
    el('set-dashboard-tags-primary').textContent = remaining ? 'Continue annotation review' : 'Focused Annotation';
    var count = s.balances.length + (state.setVariables || []).length;
    el('set-dashboard-balance-summary').textContent = count ? count + ' priorities' : 'Add training priorities';
    renderDistribution(s);
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
      el('set-dashboard-definition').open = !window.getQaTrainingFocus() || !String(el('stats-required-phrase').value || '').trim();
      el('set-dashboard-balance-section').open = true;
      el('set-dashboard-review').open = false;
    }
    openedFolder = String(state.folder || '');
    if (preferredStage === 'review') el('set-dashboard-review').open = true;
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
    setHidden(el('set-dashboard-variable-editor'), true);
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
      if (el('set-dashboard-definition').open) renderStage();
      else if (window.isSetIntelligenceOpen()) window.closeSetIntelligence();
    });
    el('set-dashboard-review').addEventListener('toggle', syncQaSection);
    el('set-dashboard-training-focus').addEventListener('input', function () { if (open) renderDefinition(snapshot()); });
    el('set-dashboard-training-focus').addEventListener('change', function () {
      if (String(state.folder || '') !== openedFolder) return;
      window.setQaTrainingFocus(el('set-dashboard-training-focus').value);
      focusMigrationStatus = '';
      renderStage();
    });
    el('set-dashboard-configure-variables').onclick = openVariableEditor;
    el('set-dashboard-variable-apply').onclick = applyVariableEditor;
    el('set-dashboard-variable-cancel').onclick = function () { setHidden(el('set-dashboard-variable-editor'), true); };
    var destinations = {
      'set-dashboard-tags-primary': 'annotation', 'set-dashboard-tags-groups': 'groups',
      'set-dashboard-tags-guided': 'guided', 'set-dashboard-train': 'train',
      'set-dashboard-curate': 'curate', 'set-dashboard-review-captions': 'captions',
      'set-dashboard-review-report': 'report', 'set-dashboard-review-metadata': 'metadata',
      'set-dashboard-review-prune': 'prune', 'set-dashboard-review-duplicates': 'duplicates'
    };
    Object.keys(destinations).forEach(function (id) { el(id).onclick = function () { run(destinations[id]); }; });
    el('set-dashboard-template-draft').addEventListener('input', function () { templateDirty = true; });
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
    el('stats-phrases').addEventListener('input', function () { if (open) renderStage(); });
  }

  window.getSetVariableWarnings = variableWarnings;
  window.returnToSetDashboardDistribution = returnFromDistribution;
  window.openSetDashboard = openDashboard;
  window.refreshSetDashboard = renderStage;
  window.closeSetDashboard = closeDashboard;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();