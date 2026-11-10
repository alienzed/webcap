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
      visibleTotal: visibleItems.length, visibleCaptions: visibleCaptions,
      reviewedGroups: reviewedGroups, totalGroups: totalGroups,
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
    if (s.pending) return 'annotate';
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
      button.setAttribute('tabindex', active ? '0' : '-1');
      button.classList.toggle('is-active', active);
      var tabName = button.getAttribute('data-set-dashboard-tab');
      var needs = (tabName === 'guidance' && (!s.phrase || !s.balances.length)) ||
        (tabName === 'understand' && !s.sight && s.captions < s.total) ||
        (tabName === 'annotate' && s.pending) ||
        (tabName === 'caption' && s.captions < s.total);
      button.classList.toggle('has-work', needs);
    });
    var title = el('set-dashboard-action-title');
    var overview = el('set-dashboard-overview');
    var progress = el('set-dashboard-progress');
    var progressText = el('set-dashboard-progress-text');
    var progressBar = el('set-dashboard-progress-bar');
    var progressFill = el('set-dashboard-progress-fill');
    var progressValue = el('set-dashboard-progress-value');
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
    setHidden(progress, true);
    progressBar.removeAttribute('aria-valuenow');
    function showProgress(done, total, label) {
      if (!total) return;
      setHidden(progress, false);
      progressText.textContent = label;
      progressValue.textContent = done + ' of ' + total;
      var percent = Math.round(100 * done / total);
      progressFill.style.width = percent + '%';
      progressBar.setAttribute('aria-valuenow', String(percent));
    }
    // A factual signal, not a global readiness score or a strict stage gate.
    var overviewParts = [s.captions + ' of ' + s.total + ' captioned'];
    if (s.sight) overviewParts.push(s.sight + ' with saved Sight');
    overview.textContent = overviewParts.join(' · ');
    primary.disabled = false;
    primary.onclick = null;
    secondary.onclick = null;

    function main(label, click) { primary.textContent = label; primary.onclick = click; }
    function other(label, click) { secondary.textContent = label; secondary.onclick = click; setHidden(secondary, false); }
    function notice(text) { status.textContent = text; setHidden(status, false); }

    if (selected === 'guidance') {
      if (guidanceStep === 'phrase') {
        title.textContent = s.phrase ? 'Your key phrase is configured' : 'Give this Set a consistent key phrase';
        main(s.phrase ? 'Balance terms' : 'Set key phrase', function () {
          if (!el('stats-required-phrase').value.trim()) {
            el('stats-required-phrase').focus();
            return;
          }
          showGuidanceStep('balance');
        });
      } else if (guidanceStep === 'balance') {
        title.textContent = s.balances.length ? 'Your balance terms are configured' : 'Add terms to help balance your captions';
        main(s.balances.length ? 'Caption Template' : 'Add balance term', function () {
          if (!el('stats-phrases').value.trim()) {
            el('stats-phrases-add-input').focus();
            return;
          }
          showGuidanceStep('template');
        });
        if (s.phrase) other('Key phrase', function () { showGuidanceStep('phrase'); });
      } else {
        title.textContent = 'Shape the captions with your template';
        main('Edit Caption Template', function () {
          closeDashboard();
          setWorkspaceSurface('default');
          el('caption-helper-tab-requirements-btn').click();
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
        title.textContent = 'Explore the observations you already have';
        notice('GPU work is active. New Set Intelligence will need to wait.');
        main('Inspect Set Intelligence', function () { run('prepare'); });
      } else {
        title.textContent = s.sight ? 'Explore what Set Intelligence found' : 'Understand the media in this Set';
        main('Open Set Intelligence', function () { run('prepare'); });
      }
      if (s.sight) showProgress(s.sight, s.total, 'Media with saved Sight (not verified coverage)');
      if (s.sight && !s.gpuBusy) other('Discover Vocabulary', function () { run('vocabulary'); });
      return;
    }

    if (selected === 'annotate') {
      if (!s.configuredGroups) {
        title.textContent = 'Give your annotations a consistent structure';
        if (s.gpuBusy) notice('GPU work is active. Group editing is available.');
        main(s.gpuBusy || !s.sight ? 'Manage Groups' : 'Discover Vocabulary', function () { run(s.gpuBusy || !s.sight ? 'groups' : 'vocabulary'); });
        if (s.sight && !s.gpuBusy) other('Guided Tagging', function () { run('guided'); });
      } else {
        var remaining = s.totalGroups - s.reviewedGroups;
        title.textContent = remaining ? 'Review ' + remaining + ' remaining group assignments' : 'Your visible annotation groups are reviewed';
        showProgress(s.reviewedGroups, s.totalGroups, 'Configured group reviews in the current view');
        main('Focused Annotation', function () { run('annotation'); });
        if (s.sight && !s.gpuBusy) other('Guided Tagging', function () { run('guided'); });
      }
      return;
    }

    if (selected === 'caption') {
      var missingVisible = s.visibleTotal - s.visibleCaptions;
      title.textContent = !s.visibleTotal ? 'No media matches the current filters'
        : missingVisible
          ? 'Caption ' + missingVisible + ' remaining media ' + (missingVisible === 1 ? 'item' : 'items')
          : 'Review the captions in your current view';
      showProgress(s.visibleCaptions, s.visibleTotal, 'Captioned media in the current view');
      if (!s.visibleTotal) {
        notice('Change your filters to include media before starting Focused Caption.');
      } else if (!missingVisible && s.captions < s.total) {
        notice('Other media in this Set still need captions. Adjust your filters to include them.');
      }
      main(!s.visibleTotal ? 'Return to Set' : missingVisible ? 'Continue captioning' : 'Open Focused Caption', function () {
        if (!s.visibleTotal) {
          closeDashboard();
          setWorkspaceSurface('default');
          return;
        }
        run('caption');
      });
      other('Caption Template', function () { selected = 'guidance'; showGuidanceStep('template'); });
      return;
    }

    title.textContent = 'Review the quality of your prepared Set';
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
        var candidates = Array.prototype.slice.call(el('set-dashboard-modal').querySelectorAll('button, input, textarea'));
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

  window.openSetDashboard = openDashboard;
  window.closeSetDashboard = closeDashboard;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();