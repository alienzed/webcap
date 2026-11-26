(function () {
  'use strict';

  var stages = ['analyze', 'review', 'reports'];
  var open = false;
  var selected = 'analyze';
  var openedFolder = '';
  var returnFocus = null;
  var distributionParent = null;
  var focusMigrationFolder = '';
  var focusMigrationStatus = '';

  function el(id) { return document.getElementById(id); }

  function snapshot() {
    var items = (state && Array.isArray(state.items)) ? state.items : [];
    var phrase = String(el('stats-required-phrase').value || '').trim();
    var balances = String(el('stats-phrases').value || '').split(/\r?\n/).map(function (p) { return p.trim(); }).filter(Boolean);
    var sight = items.filter(function (item) {
      var s = item && item.metadata && item.metadata.vision_sight;
      return s && s.description && s.inventory;
    }).length;
    var captions = items.filter(function (item) { return !!(item && (item.hasCaption || String(item.caption || '').trim())); }).length;
    // Focused Caption and Focused Annotation act on the visible scope, not every Set item.
    var visibleItems = getFilteredMediaItems(false).filter(function (item) { return !!(item && item.key); });
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
      sight: sight, captions: captions, configuredGroups: groups.length,
      visibleTotal: visibleItems.length, visibleCaptions: visibleCaptions,
      reviewedGroups: reviewedGroups, totalGroups: totalGroups,
      pending: pending
    };
  }

  function setHidden(node, hidden) { node.classList.toggle('hidden', !!hidden); }

  function run(destination) {
    closeDashboard();
    if (destination === 'prepare') return openDashboard('analyze');
    if (destination === 'annotation') return startFocusedAnnotation();
    if (destination === 'groups') return openChecklistKeywordsModal();
    if (destination === 'guided') return openGuidedTagPass({ source: 'set' });
    if (destination === 'caption') {
      var visible = getFilteredMediaItems(false);
      var missing = visible.find(function (item) {
        return item && item.key && !(item.hasCaption || String(item.caption || '').trim());
      });
      return startFocusedCaption(missing ? missing.key : '');
    }
    if (destination === 'qa' || destination === 'curate' || ['report', 'captions', 'metadata', 'prune', 'duplicates'].indexOf(destination) !== -1) {
      setWorkspaceSurface('reviewOutput');
      if (destination === 'curate') {
        setReviewDetailTab('qa');
        return window.qaStartCurationFromDashboard('analyze');
      }
      return setReviewDetailTab(destination);
    }
    throw new Error('Unknown Set Dashboard action: ' + destination);
  }

  function inspectDistribution(files, label) {
    if (!files.length) return;
    distributionParent = { folder: openedFolder, focusSet: state.focusSet ? {
      keys: state.focusSet.keys.slice(), source: state.focusSet.source, reportType: state.focusSet.reportType
    } : null };
    closeDashboard();
    activateFocusSet(files, 'Distribution · ' + label, 'dashboardDistribution');
    setWorkspaceSurface('default');
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
      button.textContent = files.length + ' / ' + s.visibleTotal;
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
    var rows = variable.terms.map(function (term) { return { label: term, files: [] }; });
    var neither = [], multiple = [];
    items.forEach(function (item) {
      var assigned = new Set(getChecklistAssignedTagsForMediaKey(item.key, variable.group).map(function (term) {
        return String(term).trim().toLowerCase();
      }));
      var matches = 0;
      rows.forEach(function (row) {
        if (assigned.has(row.label.toLowerCase())) { row.files.push(item.fileName); matches++; }
      });
      if (!matches) neither.push(item.fileName);
      if (matches > 1) multiple.push(item.fileName);
    });
    if (variable.exclusive) rows.push({ label: 'Multiple exclusive terms', files: multiple });
    rows.push({ label: 'None of the selected terms', files: neither });
    return { rows: rows, neither: neither.length, multiple: multiple.length };
  }

  function variableRow(host, label, files, total, group) {
    var row = document.createElement('div');
    row.className = 'set-dashboard-dist-row';
    var title = document.createElement('span');
    title.textContent = label;
    var bar = document.createElement('span');
    bar.className = 'set-dashboard-progress-track';
    var fill = document.createElement('span');
    fill.className = 'set-dashboard-progress-fill';
    fill.style.width = (total ? files.length * 100 / total : 0) + '%';
    bar.appendChild(fill);
    var count = document.createElement('button');
    count.type = 'button';
    count.className = 'set-dashboard-dist-count';
    count.textContent = files.length + ' / ' + total;
    count.disabled = !files.length;
    count.setAttribute('aria-label', group + ' · ' + label + ': inspect ' + files.length + ' media');
    count.onclick = function () { inspectDistribution(files, group + ' · ' + label); };
    row.append(title, bar, count);
    host.appendChild(row);
  }

  function renderVariables(s) {
    var host = el('set-dashboard-variables');
    var variables = state.setVariables || [];
    setHidden(el('set-dashboard-variable-empty'), !!variables.length);
    // This view has no editable controls; keep the configuration form separate.
    host.replaceChildren();
    variables.forEach(function (variable) {
      var section = document.createElement('section');
      section.className = 'set-dashboard-variable-card';
      var title = document.createElement('h5');
      title.textContent = variable.group;
      section.appendChild(title);
      var kind = document.createElement('div');
      kind.className = 'set-dashboard-distribution-note';
      kind.textContent = (variable.exclusive ? 'Mutually exclusive' : 'May coexist') + (variable.expected ? ' · Expected on most media' : '');
      section.appendChild(kind);
      var result = variableCoverage(variable, s.visibleItems);
      result.rows.forEach(function (row) { variableRow(section, row.label, row.files, s.visibleTotal, variable.group); });
      var warnings = [];
      // Advisory heuristic from the approved prototype; individual absence is valid.
      if (variable.expected && s.visibleTotal && result.neither / s.visibleTotal > .25) warnings.push(Math.round(result.neither * 100 / s.visibleTotal) + '% without selected terms');
      if (variable.exclusive && result.multiple) warnings.push(result.multiple + ' media with multiple exclusive terms');
      if (warnings.length) {
        var notice = document.createElement('div');
        notice.className = 'set-dashboard-warning';
        notice.textContent = warnings.join(' · ');
        section.appendChild(notice);
      }
      host.appendChild(section);
    });
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
    if (selected !== 'analyze' && window.isSetIntelligenceOpen()) window.closeSetIntelligence();
    document.querySelectorAll('[data-set-dashboard-tab]').forEach(function (button) {
      var active = button.getAttribute('data-set-dashboard-tab') === selected;
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.setAttribute('tabindex', active ? '0' : '-1');
      button.classList.toggle('is-active', active);
    });
    stages.forEach(function (tab) { setHidden(el('set-dashboard-' + tab), selected !== tab); });
    el('set-dashboard-scope').textContent = s.visibleTotal + ' of ' + s.total + ' media' + (state.focusSet ? ' · Focus Set' : '');
    el('set-dashboard-sight-count').textContent = s.sight + ' / ' + s.total;
    var annotationPercent = s.totalGroups ? Math.floor(s.reviewedGroups * 100 / s.totalGroups) : null;
    el('set-dashboard-tags-count').textContent = annotationPercent === null ? '—' : annotationPercent + '%';
    el('set-dashboard-captions-count').textContent = s.captions + ' / ' + s.total;
    if (selected !== 'analyze') return;
    renderDefinition(s);
    el('set-dashboard-template-preview').textContent = String(statsGetPrimerOptionsFromDom().template || '');
    if (!window.isSetIntelligenceOpen()) window.openSetIntelligence();
    var tagsStatus = el('set-dashboard-tags-status');
    setHidden(el('set-dashboard-tags-progress'), annotationPercent === null);
    if (annotationPercent !== null) {
      el('set-dashboard-tags-progress-value').textContent = annotationPercent + '%';
      el('set-dashboard-tags-progress-fill').style.width = annotationPercent + '%';
    }
    tagsStatus.textContent = !s.configuredGroups ? 'No groups configured' : !s.visibleTotal ? 'No media in the current view' : '';
    setHidden(tagsStatus, !tagsStatus.textContent);
    setHidden(el('set-dashboard-tags-primary'), !s.configuredGroups || !s.visibleTotal);
    var missing = s.visibleTotal - s.visibleCaptions;
    setHidden(el('set-dashboard-progress'), !s.visibleTotal);
    el('set-dashboard-progress-text').textContent = 'Captioned media in current view';
    el('set-dashboard-progress-value').textContent = s.visibleCaptions + ' / ' + s.visibleTotal;
    var percent = s.visibleTotal ? Math.round(100 * s.visibleCaptions / s.visibleTotal) : 0;
    el('set-dashboard-progress-fill').style.width = percent + '%';
    el('set-dashboard-progress-bar').setAttribute('aria-valuenow', String(percent));
    el('set-dashboard-primary').disabled = !s.visibleTotal;
    el('set-dashboard-curate').disabled = !s.visibleTotal;
    el('set-dashboard-secondary').disabled = !s.visibleCaptions;
    renderDistribution(s);
    renderVariables(s);
  }

  function openDashboard(preferredStage) {
    if (!isSetFolderPath(state.folder) || !Array.isArray(state.items) || !state.items.length) return;
    if (openedFolder !== String(state.folder || '')) focusMigrationStatus = '';
    openedFolder = String(state.folder || '');
    returnFocus = document.activeElement;
    selected = stages.indexOf(preferredStage) !== -1 ? preferredStage : 'analyze';
    el('set-dashboard-name').textContent = openedFolder.split(/[\\/]/).filter(Boolean).pop() || 'Current Set';
    open = true;
    setHidden(el('set-dashboard-modal'), false);
    renderStage();
    if (selected === 'review') window.showQaInSetDashboard();
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
        focusMigrationStatus = 'Previous training focus could not be checked. You can still set it here.';
        if (open) renderStage();
      });
    }
    var active = document.querySelector('[data-set-dashboard-tab="' + selected + '"]');
    if (active) active.focus();
  }

  function closeDashboard() {
    if (!open) return;
    open = false;
    setHidden(el('set-dashboard-variable-editor'), true);
    if (window.isSetIntelligenceOpen()) window.closeSetIntelligence();
    window.hideQaInSetDashboard();
    setHidden(el('set-dashboard-modal'), true);
    var target = returnFocus;
    returnFocus = null;
    if (target && target.isConnected) target.focus();
  }

  function init() {
    var launcher = el('set-dashboard-open-btn');
    var close = el('set-dashboard-close');
    if (!launcher || !close || !el('set-dashboard-modal')) {
      throw new Error('Set Dashboard UI is incomplete.');
    }
    launcher.addEventListener('click', openDashboard);
    el('set-dashboard-training-focus').addEventListener('input', function () { if (open) renderDefinition(snapshot()); });
    el('set-dashboard-training-focus').addEventListener('change', function () {
      window.setQaTrainingFocus(el('set-dashboard-training-focus').value);
      focusMigrationStatus = '';
      renderStage();
    });
    el('set-dashboard-configure-variables').onclick = openVariableEditor;
    el('set-dashboard-variable-apply').onclick = applyVariableEditor;
    el('set-dashboard-variable-cancel').onclick = function () { setHidden(el('set-dashboard-variable-editor'), true); };
    var destinations = {
      'set-dashboard-tags-primary': 'annotation', 'set-dashboard-tags-groups': 'groups',
      'set-dashboard-tags-guided': 'guided', 'set-dashboard-primary': 'caption',
      'set-dashboard-secondary': 'captions',
      'set-dashboard-curate': 'curate', 'set-dashboard-review-captions': 'captions',
      'set-dashboard-review-report': 'report', 'set-dashboard-review-metadata': 'metadata',
      'set-dashboard-review-prune': 'prune', 'set-dashboard-review-duplicates': 'duplicates'
    };
    Object.keys(destinations).forEach(function (id) { el(id).onclick = function () { run(destinations[id]); }; });
    el('set-dashboard-template-open').onclick = function () {
      closeDashboard();
      setWorkspaceSurface('default');
      el('caption-helper-tab-requirements-btn').click();
      var section = el('primer-template-section');
      section.open = true;
      section.scrollIntoView({ block: 'nearest' });
      el('primer-template').focus();
    };
    close.addEventListener('click', closeDashboard);
    el('set-dashboard-modal').addEventListener('click', function (event) {
      if (event.target === el('set-dashboard-modal')) closeDashboard();
    });
    document.querySelectorAll('[data-set-dashboard-tab]').forEach(function (button) {
      button.addEventListener('click', function () {
        var previous = selected;
        selected = button.getAttribute('data-set-dashboard-tab');
        if (previous === 'review' && selected !== 'review') window.hideQaInSetDashboard();
        renderStage();
        if (selected === 'review' && previous !== 'review') window.showQaInSetDashboard();
      });
      button.addEventListener('keydown', function (event) {
        var index = stages.indexOf(button.getAttribute('data-set-dashboard-tab'));
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        var nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? stages.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + stages.length) % stages.length;
        var next = document.querySelector('[data-set-dashboard-tab="' + stages[nextIndex] + '"]');
        next.click();
        next.focus();
      });
    });
    document.addEventListener('keydown', function (event) {
      if (!open) return;
      if (event.key === 'Escape') {
        if (el('primer-template-candidate') && !el('primer-template-candidate').classList.contains('hidden')) return;
        event.preventDefault();
        closeDashboard();
        return;
      }
      if (event.key === 'Tab') {
        var candidates = Array.prototype.slice.call(el('set-dashboard-modal').querySelectorAll('button, input, textarea, select, summary, a[href], [tabindex]'));
        var visible = candidates.filter(function (node) {
          return !node.disabled && node.getClientRects().length > 0 && node.getAttribute('tabindex') !== '-1';
        });
        if (!visible.length) return;
        if (event.shiftKey && document.activeElement === visible[0]) {
          event.preventDefault();
          visible[visible.length - 1].focus();
        } else if (!event.shiftKey && document.activeElement === visible[visible.length - 1]) {
          event.preventDefault();
          visible[0].focus();
        }
      }
    });
    window.addEventListener('webcap:media-metadata-updated', function () { if (open) renderStage(); });
    el('stats-required-phrase').addEventListener('change', function () { if (open) renderStage(); });
    el('stats-phrases').addEventListener('input', function () { if (open) renderStage(); });
  }

  window.returnToSetDashboardDistribution = returnFromDistribution;
  window.openSetDashboard = openDashboard;
  window.closeSetDashboard = closeDashboard;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();