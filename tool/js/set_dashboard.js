(function () {
  'use strict';

  var stages = ['guidance', 'understand', 'annotate', 'caption', 'review'];
  var open = false;
  var selected = 'guidance';
  var guidanceStep = 'phrase';
  var openedFolder = '';
  var returnFocus = null;

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
    var groups = (checklistItems || []).filter(function (name) {
      return getChecklistKeywordTermsForRequirement(name).length > 0;
    });
    var pending = groups.length > 0 && items.some(function (item) {
      return item && item.key && groups.some(function (name) {
        return !isChecklistRequirementCheckedForMediaKey(item.key, name);
      });
    });
    var trainingJob = getTrainingRunnerActiveJob();
    var shell = getShellWorkloadStatus();
    var queue = getInferenceQueueSnapshot();
    var trainingActive = !!trainingJob || !!shellWorkloadState.trainingActive ||
      (shell.key === 'active' && shell.lane === 'training');
    var gpuBusy = trainingActive || (shell.key === 'active' &&
      ['training', 'inference', 'llm'].indexOf(shell.lane) !== -1) ||
      (queue && Array.isArray(queue.jobs) && queue.jobs.some(function (job) {
        return ['starting', 'running', 'stopping'].indexOf(String(job.status || '')) !== -1;
      }));
    return {
      items: items, total: items.length, phrase: phrase, balances: balances,
      sight: sight, captions: captions, configuredGroups: groups.length,
      pending: pending, training: !!trainingActive, gpuBusy: !!gpuBusy
    };
  }

  function earliestStage(s) {
    if (!s.phrase || !s.balances.length) return 'guidance';
    // Partial Sight is useful. Do not demand full coverage or force mature Sets backwards.
    if (!s.sight && s.captions < Math.ceil(s.total / 2)) {
      return s.gpuBusy ? 'annotate' : 'understand';
    }
    if (!s.configuredGroups && s.sight && s.captions < s.total) return 'understand';
    if (s.pending && s.captions < s.total) return 'annotate';
    if (s.captions < s.total) return 'caption';
    return 'review';
  }

  function setHidden(node, hidden) { node.classList.toggle('hidden', !!hidden); }

  function guidanceInitialStep(s) {
    return !s.phrase ? 'phrase' : !s.balances.length ? 'balance' : 'template';
  }

  function run(destination) {
    closeDashboard();
    if (destination === 'prepare') return openSetIntelligence();
    if (destination === 'vocabulary') return openVisionSchemaAssist();
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
    if (destination === 'qa') {
      setWorkspaceSurface('reviewOutput');
      return setReviewDetailTab('qa');
    }
    if (destination === 'report') {
      setWorkspaceSurface('reviewOutput');
      return setReviewDetailTab('report');
    }
    throw new Error('Unknown Set Dashboard action: ' + destination);
  }

  function showGuidanceStep(step) {
    guidanceStep = step;
    renderStage();
    var focusTarget = step === 'phrase' ? el('stats-required-phrase')
      : step === 'balance' ? el('stats-phrases-add-input') : null;
    if (focusTarget) focusTarget.focus();
  }

  function renderStage() {
    if (!open) return;
    if (String(state.folder || '') !== openedFolder) {
      closeDashboard();
      return;
    }
    var s = snapshot();
    document.querySelectorAll('[data-set-dashboard-tab]').forEach(function (button) {
      var active = button.getAttribute('data-set-dashboard-tab') === selected;
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.classList.toggle('is-active', active);
      var tabName = button.getAttribute('data-set-dashboard-tab');
      var needs = (tabName === 'guidance' && (!s.phrase || !s.balances.length)) ||
        (tabName === 'understand' && !s.sight && s.captions < s.total) ||
        (tabName === 'annotate' && s.pending) ||
        (tabName === 'caption' && s.captions < s.total);
      button.classList.toggle('has-work', needs);
    });
    var title = el('set-dashboard-action-title');
    var primary = el('set-dashboard-primary');
    var secondary = el('set-dashboard-secondary');
    var status = el('set-dashboard-action-status');
    var guidance = el('set-dashboard-guidance');
    var phraseField = el('set-dashboard-phrase');
    var balanceField = el('set-dashboard-balance');
    var templateField = el('set-dashboard-template');
    setHidden(guidance, selected !== 'guidance');
    setHidden(phraseField, selected !== 'guidance' || guidanceStep !== 'phrase');
    setHidden(balanceField, selected !== 'guidance' || guidanceStep !== 'balance');
    setHidden(templateField, selected !== 'guidance' || guidanceStep !== 'template');
    setHidden(status, true);
    setHidden(secondary, true);
    primary.disabled = false;
    primary.onclick = null;
    secondary.onclick = null;

    function main(label, click) { primary.textContent = label; primary.onclick = click; }
    function other(label, click) { secondary.textContent = label; secondary.onclick = click; setHidden(secondary, false); }
    function notice(text) { status.textContent = text; setHidden(status, false); }

    if (selected === 'guidance') {
      if (guidanceStep === 'phrase') {
        title.textContent = 'Required key phrase';
        main(s.phrase ? 'Balance terms' : 'Set key phrase', function () {
          if (!el('stats-required-phrase').value.trim()) {
            el('stats-required-phrase').focus();
            return;
          }
          showGuidanceStep('balance');
        });
        if (s.phrase) other('Balance terms', function () { showGuidanceStep('balance'); });
      } else if (guidanceStep === 'balance') {
        title.textContent = 'Balance terms';
        main(s.balances.length ? 'Caption Template' : 'Add balance term', function () {
          if (!el('stats-phrases').value.trim()) {
            el('stats-phrases-add-input').focus();
            return;
          }
          showGuidanceStep('template');
        });
        if (s.phrase) other('Key phrase', function () { showGuidanceStep('phrase'); });
      } else {
        title.textContent = 'Caption Template';
        main('Edit Caption Template', function () {
          closeDashboard();
          setWorkspaceSurface('default');
          setCaptionHelperTab('requirements');
          var section = el('primer-template-section');
          section.open = true;
          section.scrollIntoView({ block: 'nearest' });
          el('primer-template').focus();
        });
        other('Edit key phrase', function () { showGuidanceStep('phrase'); });
      }
      return;
    }

    if (selected === 'understand') {
      if (s.gpuBusy) {
        title.textContent = 'Review saved Sight';
        notice('GPU work is active. New Set Intelligence will need to wait.');
        main('Inspect Set Intelligence', function () { run('prepare'); });
      } else {
        title.textContent = s.sight ? 'Review Set Intelligence' : 'Prepare Set';
        main('Open Set Intelligence', function () { run('prepare'); });
      }
      if (s.sight && !s.gpuBusy) other('Discover Vocabulary', function () { run('vocabulary'); });
      return;
    }

    if (selected === 'annotate') {
      if (!s.configuredGroups) {
        title.textContent = 'Establish annotation groups';
        if (s.gpuBusy) notice('GPU work is active. Group editing is available.');
        main(s.gpuBusy ? 'Manage Groups' : 'Discover Vocabulary', function () { run(s.gpuBusy ? 'groups' : 'vocabulary'); });
        if (s.sight && !s.gpuBusy) other('Guided Tagging', function () { run('guided'); });
      } else {
        title.textContent = s.pending ? 'Continue Focused Annotation' : 'Review annotations';
        main('Focused Annotation', function () { run('annotation'); });
        if (s.sight && !s.gpuBusy) other('Guided Tagging', function () { run('guided'); });
      }
      return;
    }

    if (selected === 'caption') {
      title.textContent = s.captions < s.total ? 'Continue captioning' : 'Review captions';
      main('Focused Caption', function () { run('caption'); });
      other('Caption Template', function () { selected = 'guidance'; showGuidanceStep('template'); });
      return;
    }

    title.textContent = 'Quality Assurance';
    main('Open Quality Assurance', function () { run('qa'); });
    if (s.captions) other('Caption Report', function () { run('report'); });
  }

  function openDashboard() {
    if (!isSetFolderPath(state.folder) || !Array.isArray(state.items) || !state.items.length) return;
    openedFolder = String(state.folder || '');
    returnFocus = document.activeElement;
    var s = snapshot();
    selected = earliestStage(s);
    guidanceStep = guidanceInitialStep(s);
    el('set-dashboard-name').textContent = openedFolder.split(/[\\/]/).filter(Boolean).pop() || 'Current Set';
    open = true;
    setHidden(el('set-dashboard-modal'), false);
    renderStage();
    var active = document.querySelector('[data-set-dashboard-tab="' + selected + '"]');
    if (active) active.focus();
  }

  function closeDashboard() {
    if (!open) return;
    open = false;
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
    close.addEventListener('click', closeDashboard);
    el('set-dashboard-modal').addEventListener('click', function (event) {
      if (event.target === el('set-dashboard-modal')) closeDashboard();
    });
    document.querySelectorAll('[data-set-dashboard-tab]').forEach(function (button) {
      button.addEventListener('click', function () {
        selected = button.getAttribute('data-set-dashboard-tab');
        if (selected === 'guidance') guidanceStep = guidanceInitialStep(snapshot());
        renderStage();
      });
    });
    document.addEventListener('keydown', function (event) {
      if (!open || event.key !== 'Escape') return;
      if (el('primer-template-candidate') && !el('primer-template-candidate').classList.contains('hidden')) return;
      event.preventDefault();
      closeDashboard();
    });
    window.addEventListener('webcap:media-metadata-updated', function () { if (open) renderStage(); });
    el('stats-required-phrase').addEventListener('change', function () { if (open) renderStage(); });
    el('stats-phrases').addEventListener('input', function () { if (open) renderStage(); });
  }

  window.openSetDashboard = openDashboard;
  window.closeSetDashboard = closeDashboard;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();