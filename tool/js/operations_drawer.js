(function () {
  'use strict';
  // Presentation only: the existing Activity and Queue owners retain all job state.
  var root = document.createElement('aside');
  root.id = 'operations-drawer';
  root.className = 'operations-drawer hidden';
  root.setAttribute('aria-label', 'Activity and Job Queues');
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML =
    '<header class="operations-header"><div><strong>Activity &amp; Queues</strong><small>Current work and this session</small></div><button type="button" id="operations-close" aria-label="Close Activity and Queues">×</button></header>' +
    '<div class="operations-sections">' +
    '<button type="button" class="operations-toggle" data-operations-section="activity" aria-expanded="false">Activity <span aria-hidden="true">⌄</span></button><div id="operations-activity" class="operations-content"></div>' +
    '<button type="button" class="operations-toggle" data-operations-section="queues" aria-expanded="false">Job Queues <span aria-hidden="true">⌄</span></button><div id="operations-queues" class="operations-content"></div>' +
    '<button type="button" class="operations-toggle" data-operations-section="history" aria-expanded="false">Recent <span aria-hidden="true">⌄</span></button><div id="operations-history" class="operations-content"></div>' +
    '</div>';
  var activity = document.getElementById('activity-monitor-drawer');
  var queues = document.getElementById('inference-queue-drawer');
  if (!activity || !queues) throw new Error('Unified operations requires existing Activity and Job Queues.');
  document.getElementById('app-overlay-root').appendChild(root);
  document.getElementById('operations-activity').appendChild(activity);
  document.getElementById('operations-queues').appendChild(queues);
  window.isOperationsDrawerMounted = true;
  var section = '';
  var enabled = false;
  // Keep Recent owned by Activity; reparent only its stable DOM host.
  document.getElementById('operations-history').appendChild(document.getElementById('activity-monitor-details'));
  function show(next) {
    section = next;
    if (!enabled) {
      enabled = true;
      window.setActivityDrawerOpen(true, false, true);
      window.setInferenceQueueOpen(true, true);
    }
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
    // Keep each existing presenter alive while the shared shell is open.
    document.getElementById('activity-monitor-details').classList.toggle('hidden', next !== 'history');
    if (next === 'history') window.refreshActivityMonitor();
    root.querySelectorAll('[data-operations-section]').forEach(function (button) {
      var expanded = button.dataset.operationsSection === section;
      button.setAttribute('aria-expanded', String(expanded));
      button.querySelector('span').textContent = expanded ? '⌃' : '⌄';
    });
    root.querySelectorAll('.operations-content').forEach(function (pane) {
      pane.classList.toggle('operations-expanded', pane.id === 'operations-' + section);
    });
  }
  function close(manual) {
    var sectionBeforeClose = section;
    root.classList.add('hidden');
    root.setAttribute('aria-hidden', 'true');
    section = '';
    enabled = false;
    window.setActivityDrawerOpen(false, !!manual && sectionBeforeClose === 'activity', true);
    window.setInferenceQueueOpen(false, true);
  }
  window.operationsSectionIsHistory = function () { return section === 'history'; };
  window.isOperationsDrawerVisible = function () { return !root.classList.contains('hidden'); };
  window.openOperationsDrawer = function (next) {
    if (['activity', 'queues', 'history'].indexOf(next) === -1) throw new Error('Invalid operations section: ' + next);
    // Auto-opening an already visible drawer must never replace the user's section.
    if (!root.classList.contains('hidden') && section) return;
    show(next);
  };
  window.selectOperationsSection = function (next) { show(next); };
  window.closeOperationsDrawer = close;
  // A single outer dismissal owner prevents the two original drawers from
  // closing each other when switching sections or using the shell controls.
  document.addEventListener('pointerdown', function (event) {
    if (root.classList.contains('hidden') || root.contains(event.target)) return;
    if (event.target.closest('.shell-workload-indicator, [data-inference-queue-toggle]')) return;
    close(true);
  });
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !root.classList.contains('hidden')) close(true);
  });
  root.querySelector('#operations-close').onclick = function () { close(true); };
  root.querySelectorAll('[data-operations-section]').forEach(function (button) {
    button.onclick = function () {
      show(section === button.dataset.operationsSection ? '' : button.dataset.operationsSection);
    };
  });
})();