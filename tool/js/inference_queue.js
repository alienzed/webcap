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
      return ['queued', 'starting', 'running', 'stopping'].indexOf(String(job.status || '')) !== -1;
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

  function jobContext(job) {
    var parts = [];
    if (job.client === 'storyboard') {
      if (job.label) parts.push(job.label);
      else if (job.sceneId) parts.push('Scene ' + job.sceneId);
    } else if (job.client === 'test') {
      if (job.label) parts.push(job.label);
      if (job.sessionId) parts.push(job.sessionId);
    } else if (job.label) {
      parts.push(job.label);
    }
    return parts.join(' · ') || 'Inference job';
  }

  function jobDetail(job) {
    var parts = [];
    if (job.modelId) parts.push(job.modelId);
    if (job.providerStatus) parts.push(String(job.providerStatus).replace(/_/g, ' '));
    return parts.join(' · ');
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
    var count = running + queued;
    var title = running
      ? ('Generating · ' + String(running) + ' running' + (queued ? ' · ' + String(queued) + ' queued' : ''))
      : (queued ? ('Inference Queue · ' + String(queued) + ' queued') : 'Inference Queue');
    Array.prototype.forEach.call(toggles, function (toggle) {
      var isRail = toggle.hasAttribute('data-inference-queue-rail');
      if (!isRail) toggle.textContent = count ? ('Inference Queue · ' + count) : 'Inference Queue';
      toggle.title = title;
      toggle.setAttribute('aria-label', title);
      toggle.setAttribute('aria-expanded', state.open ? 'true' : 'false');
      toggle.classList.toggle('inference-active', count > 0);
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

  function syncRow(row, job) {
    row.className = 'inference-queue-row status-' + String(job.status || '');
    var position = row.querySelector('[data-queue-position]');
    var title = row.querySelector('[data-queue-title]');
    var context = row.querySelector('[data-queue-context]');
    var detail = row.querySelector('[data-queue-detail]');
    var actions = row.querySelector('.inference-queue-actions');
    var status = String(job.status || '');

    if (position) {
      position.textContent = status === 'queued' && job.queuePosition
        ? '#' + String(job.queuePosition)
        : status.replace(/_/g, ' ');
    }
    if (title) title.textContent = jobClientLabel(job);
    if (context) context.textContent = jobContext(job);
    if (detail) detail.textContent = jobDetail(job);
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

    if (actions) {
      actions.innerHTML = '';
      if (status === 'queued') {
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'review-captions-btn';
        cancel.dataset.inferenceQueueAction = 'cancel';
        cancel.dataset.jobId = String(job.jobId || '');
        cancel.textContent = 'Cancel';
        actions.appendChild(cancel);
      } else if (['starting', 'running', 'stopping'].indexOf(status) !== -1) {
        var stop = document.createElement('button');
        stop.type = 'button';
        stop.className = 'review-captions-btn';
        stop.dataset.inferenceQueueAction = 'stop';
        stop.dataset.jobId = String(job.jobId || '');
        stop.textContent = status === 'stopping' ? 'Stopping…' : 'Stop';
        stop.disabled = status === 'stopping';
        actions.appendChild(stop);
      }
    }
  }

  function render() {
    var jobs = Array.isArray(state.queue.jobs) ? state.queue.jobs : [];
    renderToggle(jobs);
    syncShellInferenceState(jobs);

    var drawer = el('inference-queue-drawer');
    var host = el('inference-queue-list');
    var summary = el('inference-queue-summary');
    if (!drawer || !host || !summary) return;

    drawer.classList.toggle('hidden', !state.open);
    drawer.setAttribute('aria-hidden', state.open ? 'false' : 'true');

    var running = jobs.filter(function (job) {
      return ['starting', 'running', 'stopping'].indexOf(String(job.status || '')) !== -1;
    }).length;
    var queued = jobs.filter(function (job) { return String(job.status || '') === 'queued'; }).length;
    summary.textContent = state.queue.paused
      ? (String(state.queue.pauseReason || 'Inference is temporarily waiting.'))
      : (running || queued
        ? [running ? String(running) + ' running' : '', queued ? String(queued) + ' queued' : ''].filter(Boolean).join(' · ')
        : 'No queued inference');

    host.innerHTML = '';
    if (!jobs.length) {
      var empty = document.createElement('div');
      empty.className = 'inference-queue-empty';
      empty.textContent = 'No active or queued inference.';
      host.appendChild(empty);
      return;
    }
    jobs.forEach(function (job) {
      var row = createRow(job);
      syncRow(row, job);
      host.appendChild(row);
    });
  }

  function refresh() {
    if (state.pending) return Promise.resolve(state.queue);
    state.pending = true;
    return requestJson('/fs/inference').then(function (payload) {
      state.queue = payload.queue || { jobs: [], paused: false, pauseReason: '' };
      render();
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
    }, state.open ? 1500 : (hasActiveQueueWork() ? 2500 : 8000));
  }

  function setOpen(open) {
    state.open = !!open;
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
    return postJson('/fs/inference', {
      operation: operation,
      jobId: String(jobId || '')
    }).then(function () {
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
    var close = el('inference-queue-close');
    var list = el('inference-queue-list');
    if (!toggles.length || !close || !list) return;

    Array.prototype.forEach.call(toggles, function (toggle) {
      toggle.onclick = function () { setOpen(!state.open); };
    });
    close.onclick = function () { setOpen(false); };
    list.onclick = function (event) {
      var actionButton = event.target.closest('[data-inference-queue-action]');
      if (actionButton) {
        action(actionButton.dataset.inferenceQueueAction, actionButton.dataset.jobId);
        return;
      }
      var link = event.target.closest('[data-inference-queue-open]');
      if (link) openJobScreen(link);
    };
    window.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && state.open) setOpen(false);
    });
  }

  window.syncInferenceQueueSurface = syncSurface;
  window.refreshInferenceQueue = refresh;
  bind();
  if (typeof window.deriveShellNavigationState === 'function') {
    syncSurface(window.deriveShellNavigationState().activity);
  }
})();
