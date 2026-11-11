(function () {
  'use strict';

  var stages = ['analyze', 'caption', 'review'];
  var open = false;
  var selected = 'analyze';
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
    // Guidance lives in Caption; Sight and annotation live together in Analyze & Tag.
    if (!s.phrase || !s.balances.length) return 'caption';
    if ((!s.sight && s.captions < Math.ceil(s.total / 2)) ||
        (!s.configuredGroups && s.sight && s.captions < s.total) || s.pending) return 'analyze';
    if (s.captions < s.total) return 'caption';
    return 'review';
  }

  function setHidden(node, hidden) { node.classList.toggle('hidden', !!hidden); }

  function run(destination) {
    closeDashboard();
    if (destination === 'prepare') return openDashboard('analyze');
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
    if (destination === 'report' || destination === 'captions') {
      setWorkspaceSurface('reviewOutput');
      return setReviewDetailTab(destination === 'report' ? 'report' : 'captions');
    }
    throw new Error('Unknown Set Dashboard action: ' + destination);
  }

  function renderStage() {
    if (!open) return;
    if (String(state.folder || '') !== openedFolder) {
      closeDashboard();
      return;
    }
    var s = snapshot();
    if (selected !== 'analyze' && window.isSetIntelligenceOpen()) window.closeSetIntelligence();

    document.querySelectorAll('[data-set-dashboard-tab]').forEach(function (button) {
      var tab = button.getAttribute('data-set-dashboard-tab');
      var active = tab === selected;
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.setAttribute('tabindex', active ? '0' : '-1');
      button.classList.toggle('is-active', active);
      button.classList.toggle('has-work', (tab === 'analyze' && (s.pending || (!s.sight && s.captions < s.total))) ||
        (tab === 'caption' && (!s.phrase || !s.balances.length || s.captions < s.total)));
    });

    // Real evidence, with distinct denominators and scope labels. No readiness score.
    el('set-dashboard-sight-count').textContent = s.sight + ' / ' + s.total;
    el('set-dashboard-tags-count').textContent = s.totalGroups ? s.reviewedGroups + ' / ' + s.totalGroups : '—';
    el('set-dashboard-captions-count').textContent = s.captions + ' / ' + s.total;
    var title = el('set-dashboard-action-title');
    var status = el('set-dashboard-action-status');
    setHidden(status, true);
    ['analyze', 'caption', 'review'].forEach(function (tab) {
      setHidden(el('set-dashboard-' + tab), selected !== tab);
    });

    if (selected === 'analyze') {
      title.textContent = 'See what is present, then annotate it';
      if (!window.isSetIntelligenceOpen()) window.openSetIntelligence();
      var remaining = s.totalGroups - s.reviewedGroups;
      var tagsStatus = el('set-dashboard-tags-status');
      var tagsProgress = el('set-dashboard-tags-progress');
      var tagPrimary = el('set-dashboard-tags-primary');
      var guided = el('set-dashboard-tags-guided');
      var vocabulary = el('set-dashboard-tags-vocabulary');
      var groups = el('set-dashboard-tags-groups');
      var note = el('set-dashboard-tags-note');
      setHidden(note, !s.gpuBusy);
      if (s.gpuBusy) note.textContent = 'GPU work is active. Manual group and annotation work remains available.';
      setHidden(tagsProgress, !s.totalGroups);
      if (s.totalGroups) {
        el('set-dashboard-tags-progress-value').textContent = s.reviewedGroups + ' of ' + s.totalGroups;
        el('set-dashboard-tags-progress-fill').style.width = Math.round(s.reviewedGroups * 100 / s.totalGroups) + '%';
      }
      tagsStatus.textContent = !s.configuredGroups
        ? 'No configured groups with vocabulary terms yet.'
        : !s.visibleTotal
          ? 'No media matches the current filters. Group configuration remains available.'
          : remaining
            ? remaining + ' of ' + s.totalGroups + ' group assignments remain to be reviewed in the current view.'
            : 'All configured group assignments in the current view have been reviewed.';
      tagPrimary.textContent = s.configuredGroups && s.visibleTotal ? 'Focused Annotation' : 'Manage Groups';
      tagPrimary.onclick = function () { run(s.configuredGroups && s.visibleTotal ? 'annotation' : 'groups'); };
      // Discover Vocabulary and Guided Tagging are existing LLM/GPU workflows.
      // Do not advertise their launch as ready while a competing GPU task is running.
      setHidden(guided, !s.sight || s.gpuBusy);
      guided.onclick = function () { run('guided'); };
      setHidden(vocabulary, !s.sight || s.gpuBusy);
      vocabulary.onclick = function () { run('vocabulary'); };
      setHidden(groups, !s.configuredGroups);
      groups.onclick = function () { run('groups'); };
      return;
    }

    if (selected === 'caption') {
      var visibleMissing = s.visibleTotal - s.visibleCaptions;
      title.textContent = !s.visibleTotal ? 'Configure captions or adjust your selection'
        : visibleMissing ? 'Caption ' + visibleMissing + ' remaining media ' + (visibleMissing === 1 ? 'item' : 'items')
          : 'Refine and review your captions';
      var progress = el('set-dashboard-progress');
      setHidden(progress, !s.visibleTotal);
      if (s.visibleTotal) {
        el('set-dashboard-progress-text').textContent = 'Captioned media in the current view';
        el('set-dashboard-progress-value').textContent = s.visibleCaptions + ' of ' + s.visibleTotal;
        var percent = Math.round(100 * s.visibleCaptions / s.visibleTotal);
        el('set-dashboard-progress-fill').style.width = percent + '%';
        el('set-dashboard-progress-bar').setAttribute('aria-valuenow', String(percent));
      } else {
        el('set-dashboard-progress-bar').removeAttribute('aria-valuenow');
      }
      var primary = el('set-dashboard-primary');
      primary.textContent = !s.visibleTotal ? 'Edit filters' : visibleMissing ? 'Continue captioning' : 'Open Focused Caption';
      primary.onclick = function () {
        if (!s.visibleTotal) {
          closeDashboard();
          el('media-filter').focus();
        } else {
          run('caption');
        }
      };
      var secondary = el('set-dashboard-secondary');
      secondary.onclick = function () { run('captions'); };
      if (!s.visibleTotal) {
        status.textContent = 'The current filters exclude all media.';
        setHidden(status, false);
      } else if (!visibleMissing && s.captions < s.total) {
        status.textContent = 'Other media in this Set still need captions; adjust filters to include them.';
        setHidden(status, false);
      }
      el('set-dashboard-template-open').onclick = function () {
        // Keep the original template editor as the single owner.
        closeDashboard();
        setWorkspaceSurface('default');
        el('caption-helper-tab-requirements-btn').click();
        var section = el('primer-template-section');
        section.open = true;
        section.scrollIntoView({ block: 'nearest' });
        el('primer-template').focus();
      };
      return;
    }

    title.textContent = 'Review and improve this Set';
    el('set-dashboard-review-qa').onclick = function () { run('qa'); };
    el('set-dashboard-review-captions').onclick = function () { run('captions'); };
    el('set-dashboard-review-report').onclick = function () { run('report'); };
    el('set-dashboard-review-captions').disabled = !s.captions;
    el('set-dashboard-review-report').disabled = !s.captions;
    if (!s.captions) {
      status.textContent = 'No captions are present yet. QA is available for other Set checks.';
      setHidden(status, false);
    }
  }

  function openDashboard(preferredStage) {
    if (!isSetFolderPath(state.folder) || !Array.isArray(state.items) || !state.items.length) return;
    openedFolder = String(state.folder || '');
    returnFocus = document.activeElement;
    var s = snapshot();
    selected = stages.indexOf(preferredStage) !== -1 ? preferredStage : earliestStage(s);
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
    if (window.isSetIntelligenceOpen()) window.closeSetIntelligence();
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

  window.openSetDashboard = openDashboard;
  window.closeSetDashboard = closeDashboard;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();