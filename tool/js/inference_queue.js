(function () {
  'use strict';

  var state = {
    open: false,
    workspace: '',
    queue: { jobs: [], paused: false, pauseReason: '' },
    timer: 0,
    pending: false
  };

  function el(id) { return document.getElementById(id); }

  function isInferenceWorkspace(name) {
    return ['generate', 'test', 'storyboard'].indexOf(String(name || '')) !== -1;
  }

  function hasActiveQueueWork() {
    var jobs = Array.isArray(state.queue.jobs) ? state.queue.jobs : [];
    return jobs.some(function (job) {
      var status = String(job.status || '');
      return ['queued', 'starting', 'running', 'stopping'].indexOf(status) !== -1;
    });
  }

  function requestJson(url, options) {
    return fetch(url, options || {}).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok === false) {
          throw new Error((payload && payload.error) || 'Inference Queue request failed.');
        }
        return payload;
      });
    });
  }

  function postJson(url, payload) {
    return requestJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
  }

  function jobClientLabel(job) {
    if (job.client === 'storyboard') return 'Storyboard';
    if (job.client === 'test') return 'Test';
    return 'Generate';
  }

  function testWildcardSummary(job) {
    var values = Array.isArray(job && job.wildcardValues)
      ? job.wildcardValues.map(function (value) { return String(value || '').trim(); }).filter(Boolean)
      : [];
    if (!values.length) return '';
    var visible = values.slice(0, 4);
    if (values.length > visible.length) visible.push('+' + String(values.length - visible.length));
    return visible.join(' · ');
  }

  function jobContext(job) {
    var parts = [];
    if (job.client === 'storyboard') {
      if (job.label) parts.push(job.label);
      else if (job.sceneId) parts.push('Scene ' + job.sceneId);
    } else if (job.client === 'test') {
      var wildcardSummary = testWildcardSummary(job);
      if (wildcardSummary) parts.push(wildcardSummary);
      else if (job.label) parts.push(job.label);
      if (!wildcardSummary && job.sessionId) parts.push(job.sessionId);
    } else if (job.label) {
      parts.push(job.label);
    }
    return parts.join(' · ') || 'Inference job';
  }

  function jobDetail(job) {
    var parts = [];
    if (job.client === 'test' && job.wildcardValues && job.wildcardValues.length) {
      if (job.candidateKind === 'base') parts.push('Base');
      else if (job.candidateFile) parts.push(String(job.candidateFile));
    }
    if (job.modelId) parts.push(String(job.modelId).replace(/_/g, ' '));
    var progress = formatInferenceProgress(job.progress);
    if (progress) parts.push(progress);
    if (job.providerStatus) parts.push('Provider ' + String(job.providerStatus).replace(/_/g, ' '));
    return parts.join(' · ');
  }

  function jobStatusLabel(job) {
    var status = String(job && job.status || '');
    if (status === 'queued') return job.queuePosition ? 'Queue #' + String(job.queuePosition) : 'Queued';
    if (status === 'backlog') return 'Backlog';
    if (status === 'starting') return 'Starting';
    if (status === 'running') return 'Running';
    if (status === 'stopping') return 'Stopping';
    return status.replace(/_/g, ' ') || 'Unknown';
  }

  function formatJobAge(job) {
    var status = String(job && job.status || '');
    var since = ['starting', 'running', 'stopping'].indexOf(status) !== -1
      ? Number(job.startedAt || 0)
      : Number(job.createdAt || 0);
    if (!since) return '';
    var seconds = Math.max(0, Math.round(Date.now() / 1000 - since));
    if (seconds < 60) return String(seconds) + 's';
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return String(minutes) + 'm';
    var hours = Math.floor(minutes / 60);
    var remainder = minutes % 60;
    return String(hours) + 'h' + (remainder ? ' ' + String(remainder) + 'm' : '');
  }

  function syncShellInferenceState(jobs) {
    var running = jobs.some(function (job) {
      return ['starting', 'running', 'stopping'].indexOf(String(job.status || '')) !== -1;
    });
    if (typeof window.setShellInferenceActive === 'function') window.setShellInferenceActive(running);
  }

  function renderToggle(jobs) {
    var toggles = document.querySelectorAll('[data-inference-queue-toggle]');
    if (!toggles.length) return;
    var running = jobs.filter(function (job) {
      return ['starting', 'running', 'stopping'].indexOf(String(job.status || '')) !== -1;
    }).length;
    var queued = jobs.filter(function (job) { return String(job.status || '') === 'queued'; }).length;
    var backlogJobs = jobs.filter(function (job) { return String(job.status || '') === 'backlog'; });
    var backlog = backlogJobs.length;
    var count = running + queued + backlog;
    var activeCount = state.queue.paused ? running : (running + queued);
    var title = [
      running ? String(running) + ' running' : '',
      queued ? String(queued) + ' queued' : '',
      backlog ? String(backlog) + ' backlog' : ''
    ].filter(Boolean).join(' · ');
    title = title ? ('Inference · ' + title) : 'Inference Queue';
    Array.prototype.forEach.call(toggles, function (toggle) {
      var isRail = toggle.hasAttribute('data-inference-queue-rail');
      if (!isRail) toggle.textContent = count ? ('Inference Queue · ' + count) : 'Inference Queue';
      toggle.title = title;
      toggle.setAttribute('aria-label', title);
      toggle.setAttribute('aria-expanded', state.open ? 'true' : 'false');
      toggle.classList.toggle('inference-active', activeCount > 0);
      if (isRail) {
        var badge = toggle.querySelector('[data-inference-queue-badge]');
        if (badge) {
          badge.textContent = count > 99 ? '99+' : String(count);
          badge.classList.toggle('hidden', count === 0);
        }
      }
    });
  }

  function createRow(job) {
    var row = document.createElement('article');
    row.className = 'inference-queue-row';
    row.dataset.inferenceJobId = String(job.jobId || '');

    var position = document.createElement('div');
    position.className = 'inference-queue-position';
    position.dataset.queuePosition = '1';

    var copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'inference-queue-copy inference-queue-link';
    copy.dataset.inferenceQueueOpen = '1';
    copy.title = 'Open this job\'s screen';
    var title = document.createElement('strong');
    title.dataset.queueTitle = '1';
    var context = document.createElement('span');
    context.dataset.queueContext = '1';
    var detail = document.createElement('small');
    detail.dataset.queueDetail = '1';
    copy.appendChild(title);
    copy.appendChild(context);
    copy.appendChild(detail);

    var actions = document.createElement('div');
    actions.className = 'inference-queue-actions';

    row.appendChild(position);
    row.appendChild(copy);
    row.appendChild(actions);
    return row;
  }

  function syncActionButtons(actions, specs) {
    var existing = Object.create(null);
    Array.prototype.forEach.call(actions.children, function (button) {
      var key = String(button.dataset.inferenceQueueActionKey || '');
      if (key) existing[key] = button;
    });
    var desired = [];
    specs.forEach(function (spec) {
      var button = existing[spec.key];
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.inferenceQueueActionKey = spec.key;
      }
      button.className = spec.className || 'review-captions-btn';
      button.dataset.inferenceQueueAction = spec.action;
      button.dataset.jobId = spec.jobId || '';
      button.textContent = spec.text;
      button.title = spec.title || '';
      if (spec.ariaLabel) button.setAttribute('aria-label', spec.ariaLabel);
      else button.removeAttribute('aria-label');
      button.disabled = !!spec.disabled;
      desired.push(button);
      delete existing[spec.key];
    });
    desired.forEach(function (button, index) {
      var current = actions.children[index];
      if (current !== button) actions.insertBefore(button, current || null);
    });
    Object.keys(existing).forEach(function (key) { existing[key].remove(); });
  }

  function syncRow(row, job, queuedCount) {
    row.className = 'inference-queue-row status-' + String(job.status || '');
    var position = row.querySelector('[data-queue-position]');
    var title = row.querySelector('[data-queue-title]');
    var context = row.querySelector('[data-queue-context]');
    var detail = row.querySelector('[data-queue-detail]');
    var actions = row.querySelector('.inference-queue-actions');
    var status = String(job.status || '');

    if (position) {
      position.textContent = jobStatusLabel(job);
      position.title = position.textContent;
    }
    if (title) title.textContent = jobClientLabel(job);
    if (context) {
      context.textContent = jobContext(job);
      context.title = job.client === 'test' && Array.isArray(job.wildcardValues) && job.wildcardValues.length
        ? job.wildcardValues.join(' · ')
        : context.textContent;
    }
    if (detail) {
      var detailText = jobDetail(job);
      var age = formatJobAge(job);
      if (age) {
        detailText = [detailText, (['starting', 'running', 'stopping'].indexOf(status) !== -1 ? 'Active ' : 'Waiting ') + age].filter(Boolean).join(' · ');
      }
      detail.textContent = detailText;
    }
    var link = row.querySelector('[data-inference-queue-open]');
    if (link) {
      link.dataset.client = String(job.client || 'generate');
      link.dataset.storyId = String(job.storyId || '');
      link.dataset.sceneId = String(job.sceneId || '');
      link.dataset.folder = String(job.folder || '');
      link.dataset.source = String(job.source || '');
      link.dataset.sessionId = String(job.sessionId || '');
      link.title = 'Open ' + jobClientLabel(job);
    }

    if (!actions) return;
    var jobId = String(job.jobId || '');
    var specs = [];
    if (status === 'backlog') {
      specs.push({ key: 'add', action: 'add_to_queue', jobId: jobId, text: 'Add to Queue' });
      specs.push({ key: 'cancel', action: 'cancel', jobId: jobId, text: 'Cancel' });
    } else if (status === 'queued') {
      specs.push({
        key: 'up', action: 'reorder_up', jobId: jobId, text: '↑',
        className: 'review-captions-btn inference-queue-icon-action',
        title: 'Move earlier', ariaLabel: 'Move inference job earlier',
        disabled: Number(job.queuePosition || 0) <= 1
      });
      specs.push({
        key: 'down', action: 'reorder_down', jobId: jobId, text: '↓',
        className: 'review-captions-btn inference-queue-icon-action',
        title: 'Move later', ariaLabel: 'Move inference job later',
        disabled: Number(job.queuePosition || 0) >= Number(queuedCount || 0)
      });
      specs.push({ key: 'cancel', action: 'cancel', jobId: jobId, text: 'Cancel' });
    } else if (['starting', 'running', 'stopping'].indexOf(status) !== -1) {
      specs.push({
        key: 'stop', action: 'stop', jobId: jobId,
        text: status === 'stopping' ? 'Stopping…' : 'Stop',
        disabled: status === 'stopping'
      });
    }
    syncActionButtons(actions, specs);
  }

  function keyedChild(host, key, create) {
    var found = null;
    Array.prototype.some.call(host.children, function (child) {
      if (String(child.dataset.inferenceQueueKey || '') !== key) return false;
      found = child;
      return true;
    });
    if (!found) {
      found = create();
      found.dataset.inferenceQueueKey = key;
    }
    return found;
  }

  function createQueueHeading(kind, label, action, actionLabel) {
    var heading = document.createElement('div');
    heading.className = 'inference-backlog-heading' + (kind === 'queued' ? ' inference-queued-heading' : '');
    var copy = document.createElement('div');
    var title = document.createElement('strong');
    title.textContent = label;
    var count = document.createElement('span');
    count.dataset.inferenceQueueSectionCount = '1';
    copy.appendChild(title);
    copy.appendChild(count);
    heading.appendChild(copy);
    var actions = document.createElement('div');
    actions.className = 'inference-queue-section-actions';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'review-captions-btn';
    button.dataset.inferenceQueueAction = action;
    button.textContent = actionLabel;
    actions.appendChild(button);
    heading.appendChild(actions);
    return heading;
  }

  function reconcileQueueChildren(host, jobs, queuedJobs, backlogJobs, queuedCount) {
    var desired = [];
    function keep(key, create) {
      var node = keyedChild(host, key, create);
      desired.push(node);
      return node;
    }

    if (!jobs.length) {
      var empty = keep('empty', function () {
        var node = document.createElement('div');
        node.className = 'inference-queue-empty';
        return node;
      });
      empty.textContent = 'No queued or backlogged inference.';
    } else {
      jobs.filter(function (job) {
        var status = String(job.status || '');
        return status !== 'queued' && status !== 'backlog';
      }).forEach(function (job) {
        var row = keep('job:' + String(job.jobId || ''), function () { return createRow(job); });
        syncRow(row, job, queuedCount);
      });

      if (queuedJobs.length) {
        var queuedHeading = keep('section:queued', function () {
          return createQueueHeading('queued', 'Queue', 'move_all_to_backlog', 'Move all to Backlog');
        });
        queuedHeading.querySelector('[data-inference-queue-section-count]').textContent = String(queuedJobs.length);
      }
      queuedJobs.forEach(function (job) {
        var row = keep('job:' + String(job.jobId || ''), function () { return createRow(job); });
        syncRow(row, job, queuedCount);
      });

      if (backlogJobs.length) {
        var backlogHeading = keep('section:backlog', function () {
          return createQueueHeading('backlog', 'Backlog', 'add_all_to_queue', 'Add all to Queue');
        });
        backlogHeading.querySelector('[data-inference-queue-section-count]').textContent = String(backlogJobs.length);
      }
      backlogJobs.forEach(function (job) {
        var row = keep('job:' + String(job.jobId || ''), function () { return createRow(job); });
        syncRow(row, job, queuedCount);
      });
    }

    desired.forEach(function (node, index) {
      var current = host.children[index];
      if (current !== node) host.insertBefore(node, current || null);
    });
    var desiredKeys = Object.create(null);
    desired.forEach(function (node) { desiredKeys[String(node.dataset.inferenceQueueKey || '')] = true; });
    Array.prototype.slice.call(host.children).forEach(function (node) {
      if (!desiredKeys[String(node.dataset.inferenceQueueKey || '')]) node.remove();
    });
  }

  function render() {
    var jobs = Array.isArray(state.queue.jobs) ? state.queue.jobs : [];
    renderToggle(jobs);
    syncShellInferenceState(jobs);

    var drawer = el('inference-queue-drawer');
    var host = el('inference-queue-list');
    var summary = el('inference-queue-summary');
    var pauseButton = el('inference-queue-pause');
    var clearButton = el('inference-queue-clear');
    if (!drawer || !host || !summary || !pauseButton || !clearButton) return;

    drawer.classList.toggle('hidden', !state.open);
    drawer.setAttribute('aria-hidden', state.open ? 'false' : 'true');

    var running = jobs.filter(function (job) {
      return ['starting', 'running', 'stopping'].indexOf(String(job.status || '')) !== -1;
    }).length;
    var queuedJobs = jobs.filter(function (job) { return String(job.status || '') === 'queued'; });
    var backlogJobs = jobs.filter(function (job) { return String(job.status || '') === 'backlog'; });
    var queued = queuedJobs.length;
    var backlog = backlogJobs.length;
    var counts = [
      running ? String(running) + ' running' : '',
      queued ? String(queued) + ' queued' : '',
      backlog ? String(backlog) + ' backlog' : ''
    ].filter(Boolean).join(' · ');
    summary.textContent = state.queue.paused
      ? String(state.queue.pauseReason || 'Inference is temporarily waiting.')
      : (String(state.queue.waitReason || '').trim() || counts || 'No inference work');

    var hasPending = queued > 0 || backlog > 0;
    pauseButton.textContent = state.queue.paused ? 'Resume' : 'Pause';
    pauseButton.dataset.inferenceQueueAction = state.queue.paused ? 'resume_queue' : 'pause_queue';
    pauseButton.title = state.queue.paused
      ? 'Resume inference scheduling'
      : 'Pause inference scheduling after the current job';
    pauseButton.classList.toggle('hidden', !jobs.length && !state.queue.paused);
    clearButton.classList.toggle('hidden', !hasPending);
    clearButton.disabled = !hasPending;

    reconcileQueueChildren(host, jobs, queuedJobs, backlogJobs, queued);
  }

  function refresh() {
    if (state.pending) return Promise.resolve(state.queue);
    state.pending = true;
    return requestJson('/fs/inference').then(function (payload) {
      state.queue = payload.queue || { jobs: [], paused: false, pauseReason: '' };
      render();
      window.dispatchEvent(new CustomEvent('webcap:inference-queue-snapshot', {
        detail: { queue: state.queue }
      }));
      return state.queue;
    }).catch(function (err) {
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Inference Queue', err);
      return state.queue;
    }).then(function (queue) {
      state.pending = false;
      return queue;
    });
  }

  function schedule() {
    if (state.timer) clearTimeout(state.timer);
    state.timer = 0;
    state.timer = setTimeout(function () {
      refresh().then(schedule);
    }, state.open ? 2000 : (hasActiveQueueWork() ? 4000 : 15000));
  }

  function setOpen(open) {
    state.open = !!open;
    if (state.open && typeof window.setDirectorChatOpen === 'function') window.setDirectorChatOpen(false);
    if (state.open && typeof window.setActivityDrawerOpen === 'function') {
      window.setActivityDrawerOpen(false);
    }
    if (state.open) {
      refresh().then(schedule);
      return;
    }
    render();
    schedule();
  }

  function syncSurface(workspace) {
    state.workspace = String(workspace || '');
    render();
    refresh().then(schedule);
  }

  function openJobScreen(link) {
    var client = String(link && link.dataset.client || 'generate');
    setOpen(false);
    if (client === 'storyboard') {
      if (typeof window.openStoryboardActivity !== 'function') throw new Error('Storyboard is not available.');
      window.openStoryboardActivity();
      return;
    }
    if (client === 'test') {
      if (typeof window.openTestBenchActivity !== 'function') throw new Error('Test Generations is not available.');
      window.openTestBenchActivity();
      return;
    }
    if (typeof window.openGenerateActivity !== 'function') throw new Error('Generate is not available.');
    window.openGenerateActivity();
  }

  function action(operation, jobId) {
    var payload = {
      operation: operation,
      jobId: String(jobId || '')
    };
    if (operation === 'reorder_up' || operation === 'reorder_down') {
      payload.operation = 'reorder';
      payload.direction = operation === 'reorder_up' ? 'up' : 'down';
    }
    return postJson('/fs/inference', payload).then(function () {
      window.dispatchEvent(new CustomEvent('webcap:inference-queue-changed', {
        detail: { operation: operation, jobId: String(jobId || '') }
      }));
      return refresh();
    }).catch(function (err) {
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Inference Queue', err);
    });
  }

  function bind() {
    var toggles = document.querySelectorAll('[data-inference-queue-toggle]');
    var drawer = el('inference-queue-drawer');
    var close = el('inference-queue-close');
    var pause = el('inference-queue-pause');
    var clear = el('inference-queue-clear');
    var list = el('inference-queue-list');
    if (!toggles.length || !drawer || !close || !pause || !clear || !list) return;

    Array.prototype.forEach.call(toggles, function (toggle) {
      toggle.onclick = function () { setOpen(!state.open); };
    });
    close.onclick = function () { setOpen(false); };
    pause.onclick = function () {
      action(pause.dataset.inferenceQueueAction || 'pause_queue');
    };
    clear.onclick = function () { action('clear_all'); };
    list.onclick = function (event) {
      var actionButton = event.target.closest('[data-inference-queue-action]');
      if (actionButton) {
        action(actionButton.dataset.inferenceQueueAction, actionButton.dataset.jobId);
        return;
      }
      var link = event.target.closest('[data-inference-queue-open]');
      if (link) openJobScreen(link);
    };
    document.addEventListener('pointerdown', function (event) {
      if (!state.open || drawer.contains(event.target)) return;
      var toggle = event.target.closest('[data-inference-queue-toggle]');
      if (toggle) return;
      setOpen(false);
    });
    window.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && state.open) setOpen(false);
    });
  }

  window.syncInferenceQueueSurface = syncSurface;
  window.refreshInferenceQueue = refresh;
  window.getInferenceQueueSnapshot = function () { return state.queue; };
  window.setInferenceQueueOpen = setOpen;
  bind();
  if (typeof window.deriveShellNavigationState === 'function') {
    syncSurface(window.deriveShellNavigationState().activity);
  }
})();
