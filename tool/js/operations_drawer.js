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
  var section = '';
  function show(next) {
    section = next;
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
    // Keep each existing presenter alive while the shared shell is open.
    window.setActivityDrawerOpen(true, false, true);
    window.setInferenceQueueOpen(true, true);
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
    root.classList.add('hidden');
    root.setAttribute('aria-hidden', 'true');
    section = '';
    window.setActivityDrawerOpen(false, !!manual, true);
    window.setInferenceQueueOpen(false, true);
  }
  window.openOperationsDrawer = function (next) {
    if (['activity', 'queues', 'history'].indexOf(next) === -1) throw new Error('Invalid operations section: ' + next);
    // Auto-opening an already visible drawer must never replace the user's section.
    if (!root.classList.contains('hidden') && section) return;
    show(next);
  };
  window.selectOperationsSection = function (next) { show(next); };
  window.closeOperationsDrawer = close;
  root.querySelector('#operations-close').onclick = function () { close(true); };
  root.querySelectorAll('[data-operations-section]').forEach(function (button) {
    button.onclick = function () {
      show(section === button.dataset.operationsSection ? '' : button.dataset.operationsSection);
    };
  });
})();