(function () {
  'use strict';
  var lane = 'inference';
  var snapshots = { llm: null, training: null };
  var pending = false;
  var pendingRefresh = null;
  var opening = 0;
  var drawer = document.getElementById('inference-queue-drawer');
  var summary = document.getElementById('inference-queue-summary');
  var oldPause = document.getElementById('inference-queue-pause');
  var oldClear = document.getElementById('inference-queue-clear');

  function request(url, options) {
    return fetch(url, options || {}).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok || !data || data.ok === false) throw new Error((data && data.error) || 'Job queue request failed');
        return data;
      });
    });
  }
  function post(url, body) {
    return request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  function active(job) { return ['starting', 'running', 'stopping'].indexOf(String(job.status || '')) !== -1; }
  function count(jobs) { return jobs.filter(function (job) { return active(job) || job.status === 'queued' || job.status === 'backlog'; }).length; }
  function updateLaneTab(which) {
    var jobs = jobsFor(which);
    var tab = document.getElementById('job-queue-tab-' + which);
    var badge = tab.querySelector('[data-job-queue-count]');
    var running = jobs.some(active);
    var payload = which === 'inference' ? window.getInferenceQueueSnapshot() : snapshots[which];
    var paused = !!(payload && (which === 'training' ? payload.queuePaused : payload.paused));
    var waiting = !running && !paused && jobs.some(function (job) { return job.status === 'queued'; });
    badge.textContent = count(jobs) ? '(' + count(jobs) + ')' : '';
    tab.classList.toggle('job-queue-tab-running', running);
    tab.classList.toggle('job-queue-tab-paused', !running && paused);
    tab.title = which + ' · ' + (running ? 'Running' : paused ? 'Paused' : waiting ? 'Waiting' : 'Idle');
    var indicator = tab.querySelector('.job-queue-tab-state');
    if (!indicator) {
      indicator = textNode('span', 'job-queue-tab-state', '');
      indicator.setAttribute('aria-hidden', 'true');
      tab.appendChild(indicator);
    }
    indicator.textContent = running ? '●' : paused ? 'Ⅱ' : waiting ? '◦' : '';
    indicator.title = tab.title;
  }
  function textNode(tag, klass, value) {
    var node = document.createElement(tag);
    node.className = klass;
    node.textContent = value == null ? '' : String(value);
    return node;
  }
  function jobsFor(which) {
    if (which === 'inference') return ((window.getInferenceQueueSnapshot && window.getInferenceQueueSnapshot()) || {}).jobs || [];
    var payload = snapshots[which];
    return payload && Array.isArray(payload.jobs) ? payload.jobs : [];
  }
  function title(job, which) {
    if (which === 'llm') {
      var operation = String(job.operation || job.label || '').replace(/_/g, ' ').trim();
      operation = operation.replace(/\b\w/g, function (char) { return char.toUpperCase(); });
      return [String(job.client || 'Director').replace(/\b\w/g, function (char) { return char.toUpperCase(); }), operation].filter(Boolean).join(' · ') || 'LLM request';
    }
    return [job.folder || 'Training', job.stage || job.modelType || job.model || ''].filter(Boolean).join(' · ');
  }
  function detail(job, which) {
    if (which === 'llm') return [job.modelId, job.label, job.error].filter(Boolean).join(' · ');
    var p = job.progress || {};
    return [
      job.resumeFromCheckpoint ? 'From checkpoint' : '',
      p.epoch != null && p.epochs ? 'Epoch ' + p.epoch + '/' + p.epochs : '',
      p.step != null && p.plannedSteps ? 'Step ' + p.step + '/' + p.plannedSteps : '',
      job.error || job.sourceUnavailable
    ].filter(Boolean).join(' · ');
  }
  function elapsed(job) {
    var started = job.startedAt || job.createdAt;
    if (!started) return '';
    var ms = typeof started === 'number' ? (started < 1e11 ? started * 1000 : started) : Date.parse(started);
    if (!Number.isFinite(ms)) return '';
    var secs = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    return Math.floor(secs / 60) + 'm ' + String(secs % 60).padStart(2, '0') + 's';
  }
  function actionButton(label, which, operation, job) {
    var button = textNode('button', 'review-captions-btn', label);
    button.type = 'button';
    button.dataset.jobQueueAction = operation;
    button.dataset.jobQueueLane = which;
    if (job) button.dataset.jobQueueId = String(job.jobId || job.id || '');
    if (operation === 'up' || operation === 'down') {
      button.classList.add('inference-queue-icon-action');
      button.title = operation === 'up' ? 'Move earlier' : 'Move later';
      button.setAttribute('aria-label', (operation === 'up' ? 'Move earlier' : 'Move later') + ' in ' + which + ' queue');
    }
    return button;
  }
  function row(job, which, position, totalQueued) {
    var node = document.createElement('div');
    node.className = 'inference-queue-row job-queue-row status-' + String(job.status || 'queued');
    node.dataset.jobQueueId = String(job.jobId || job.id || '');
    node.dataset.queueDragLane = which;
    node.dataset.queueDragId = String(job.jobId || job.id || '');
    var copy = textNode('div', 'inference-queue-copy', '');
    var heading = textNode('div', 'inference-queue-heading', '');
    heading.appendChild(textNode('span', 'inference-queue-position', active(job) ? job.status : job.status === 'queued' ? '#' + (position || job.queuePosition || '') : job.status));
    heading.appendChild(textNode('strong', '', title(job, which)));
    copy.appendChild(heading);
    var details = detail(job, which);
    if (which === 'llm') heading.querySelector('strong').title = [job.client, job.operation].filter(Boolean).join(' · ');
    if (details) copy.appendChild(textNode('small', '', details));
    if (active(job)) copy.appendChild(textNode('small', '', elapsed(job)));
    if (which === 'training' && job.status === 'queued') {
      var handle = textNode('span', 'job-queue-drag-handle', '\u283f');
      handle.title = 'Drag to reorder queued training';
      handle.draggable = true;
      handle.setAttribute('aria-hidden', 'true');
      node.appendChild(handle);
    }
    node.appendChild(copy);
    var controls = textNode('div', 'inference-queue-actions', '');
    if (which === 'llm') controls.appendChild(actionButton(active(job) ? 'Stop' : 'Cancel', which, 'cancel_job', job));
    if (which === 'training') {
      if (job.status === 'queued') {
        var up = actionButton('↑', which, 'up', job);
        var down = actionButton('↓', which, 'down', job);
        up.disabled = position <= 1;
        down.disabled = position >= totalQueued;
        controls.appendChild(up);
        controls.appendChild(down);
        controls.appendChild(actionButton('Cancel', which, 'cancel', job));
      } else if (active(job) && job.status !== 'stopping' && !job.actionRequested) {
        controls.appendChild(actionButton('Stop', which, 'stop', job));
        if (['hi', 'lo', 'krea2', 'wan21', 'h3'].indexOf(String(job.stage || '')) !== -1) {
          if (!snapshots.training.queuePaused) controls.appendChild(actionButton('Pause', which, 'pause', job));
          controls.appendChild(actionButton('Finish', which, 'finish', job));
        }
      }
    }
    if (controls.children.length) node.appendChild(controls);
    return node;
  }
  function render(which) {
    var panel = document.getElementById('job-queue-panel-' + which);
    var jobs = jobsFor(which);
    updateLaneTab(which);
    if (which === 'inference') return;
    var payload = snapshots[which];
    var message = panel.querySelector('[data-job-queue-summary]');
    var list = panel.querySelector('[data-job-queue-list]');
    if (!payload) { message.textContent = 'Loading ' + which + ' queue…'; return; }
    message.textContent = which === 'llm'
      ? payload.pauseReason || payload.waitReason || (count(jobs) + ' requests')
      : payload.queuePauseReason || payload.runnerNotice || (count(jobs) + ' jobs');
    var controls = panel.querySelector('.job-queue-lane-actions');
    controls.classList.toggle('hidden', which === 'training' ? (!payload.queuePaused || jobs.some(active)) : !jobs.length);
    var previous = new Map();
    Array.prototype.forEach.call(list.querySelectorAll('.job-queue-row[data-job-queue-id]'), function (node) { previous.set(node.dataset.jobQueueId, node); });
    var queuedCount = jobs.filter(function (job) { return job.status === 'queued'; }).length;
    var position = 0;
    var wanted = jobs.filter(function (job) { return active(job) || job.status === 'queued'; })
      .sort(function (a, b) { return Number(active(b)) - Number(active(a)); })
      .map(function (job) {
        var queuePosition = job.status === 'queued' ? ++position : 0;
        var id = String(job.jobId || job.id || '');
        var fresh = row(job, which, queuePosition, queuedCount);
        var existing = previous.get(id);
        if (existing) {
          var oldCopy = existing.querySelector('.inference-queue-copy');
          var newCopy = fresh.querySelector('.inference-queue-copy');
          existing.className = fresh.className;
          existing.querySelector('.inference-queue-position').textContent = fresh.querySelector('.inference-queue-position').textContent;
          var oldTitle = oldCopy.querySelector('strong');
          oldTitle.textContent = newCopy.querySelector('strong').textContent;
          oldTitle.title = newCopy.querySelector('strong').title;
          var oldDetails = oldCopy.querySelectorAll('small');
          var newDetails = newCopy.querySelectorAll('small');
          if (oldDetails.length !== newDetails.length) {
            oldCopy.replaceWith(newCopy);
          } else {
            newDetails.forEach(function (part, index) { oldDetails[index].textContent = part.textContent; });
          }
          var oldActions = existing.querySelector('.inference-queue-actions');
          var newActions = fresh.querySelector('.inference-queue-actions');
          if (!newActions && oldActions) oldActions.remove();
          else if (newActions && !oldActions) existing.appendChild(newActions);
          else if (newActions && oldActions && oldActions.outerHTML !== newActions.outerHTML) oldActions.replaceWith(newActions);
          var oldHandle = existing.querySelector('.job-queue-drag-handle');
          var newHandle = fresh.querySelector('.job-queue-drag-handle');
          if (oldHandle && !newHandle) oldHandle.remove();
          else if (!oldHandle && newHandle) existing.insertBefore(newHandle, existing.firstChild);
          existing.dataset.jobQueueStatus = job.status;
          return existing;
        }
        fresh.dataset.jobQueueStatus = job.status;
        return fresh;
      });
    if (!wanted.length) wanted.push(textNode('div', 'inference-queue-empty', 'No ' + which + ' work queued.'));
    var keep = new Set(wanted);
    Array.prototype.forEach.call(list.children, function (node) { if (!keep.has(node)) node.remove(); });
    wanted.forEach(function (node, index) { if (list.children[index] !== node) list.insertBefore(node, list.children[index] || null); });
  }
  function preferredLane() {
    var names = ['inference', 'llm', 'training'];
    function mostRecent(which, runningOnly) {
      return jobsFor(which).filter(function (job) {
        return runningOnly ? active(job) : job.status === 'queued' || job.status === 'backlog';
      }).reduce(function (latest, job) {
        var raw = job.startedAt || job.createdAt || 0;
        var stamp = typeof raw === 'number' ? raw : Date.parse(raw);
        return Math.max(latest, Number.isFinite(stamp) ? stamp : 0);
      }, 0);
    }
    var running = names.filter(function (which) { return jobsFor(which).some(active); });
    if (running.length) return running.sort(function (a, b) { return mostRecent(b, true) - mostRecent(a, true); })[0];
    var queued = names.filter(function (which) { return jobsFor(which).some(function (job) {
      return job.status === 'queued' || job.status === 'backlog';
    }); });
    if (queued.length) return queued.sort(function (a, b) { return mostRecent(b, false) - mostRecent(a, false); })[0];
    return lane;
  }
  function select(which) {
    if (['inference', 'llm', 'training'].indexOf(which) < 0) throw new Error('Unknown job queue lane ' + which);
    lane = which;
    ['inference', 'llm', 'training'].forEach(function (name) {
      var tab = document.getElementById('job-queue-tab-' + name);
      tab.setAttribute('aria-selected', String(name === lane));
      tab.tabIndex = name === lane ? 0 : -1;
      document.getElementById('job-queue-panel-' + name).classList.toggle('hidden', name !== lane);
    });
    oldPause.classList.toggle('hidden', which !== 'inference');
    oldClear.classList.toggle('hidden', which !== 'inference');
    if (which !== 'inference') summary.textContent = which === 'llm' ? 'Director requests' : 'Managed training';
    else if (window.refreshInferenceQueue) window.refreshInferenceQueue();
    render(which);
    refresh();
  }
  function refresh() {
    if (pending) return pendingRefresh;
    if (drawer.classList.contains('hidden')) return Promise.resolve();
    pending = true;
    var sources = [
      ['llm', '/fs/director/queue'],
      ['training', '/fs/training_runner/status']
    ];
    pendingRefresh = Promise.all(sources.map(function (entry) {
      return request(entry[1]).then(function (data) {
        snapshots[entry[0]] = entry[0] === 'llm' ? data.queue : data;
        render(entry[0]);
      }).catch(function (error) {
        if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Job Queues · ' + entry[0], error);
        document.querySelector('[data-job-queue-summary="' + entry[0] + '"]').textContent = error.message;
      });
    })).then(function () { pending = false; pendingRefresh = null; }, function (error) { pending = false; pendingRefresh = null; throw error; });
    return pendingRefresh;
  }
  function perform(which, operation, id) {
    if (which === 'llm') {
      if (operation === 'reset' && !window.confirm('Stop the active LLM request and clear all queued requests?')) return;
      return post('/fs/director/job', { operation: operation, jobId: id }).then(function () { return refresh(); });
    }
    if (operation === 'cancel' && !window.confirm('Remove this queued training job?')) return;
    if (['stop', 'pause', 'finish'].indexOf(operation) !== -1 && !window.confirm(operation === 'pause'
      ? 'Pause training after a checkpoint is saved?'
      : operation === 'finish' ? 'Finish training early after saving a checkpoint?' : 'Stop this training job?')) return;
    var url, payload;
    if (operation === 'resume_queue') { url = '/fs/training_runner/resume_queue'; payload = {}; }
    else if (operation === 'up' || operation === 'down') { url = '/fs/training_runner/reorder'; payload = { jobId: id, direction: operation }; }
    else { url = '/fs/training_runner/stop'; payload = { jobId: id, cancel: operation === 'cancel', pause: operation === 'pause', finish: operation === 'finish' }; }
    return post(url, payload).then(function () {
      window.refreshTrainingRunnerStatus();
      return refresh();
    });
  }
  // The same native handle/half-row drop pattern as Checklist; one drawer
  // controller keeps both reorderable lanes consistent without a new library.
  var drag = null;
  var moving = false;
  function clearDrag() {
    drawer.querySelectorAll('.queue-drop-before, .queue-drop-after, .is-dragging')
      .forEach(function (row) { row.classList.remove('queue-drop-before', 'queue-drop-after', 'is-dragging'); });
    drag = null;
  }
  function queueRows(which) {
    var list = which === 'inference'
      ? document.getElementById('inference-queue-list')
      : document.querySelector('#job-queue-panel-training [data-job-queue-list]');
    return list ? Array.from(list.querySelectorAll('[data-queue-drag-lane="' + which + '"].status-queued')) : [];
  }
  drawer.addEventListener('dragstart', function (event) {
    var handle = event.target.closest('.job-queue-drag-handle');
    var row = handle && handle.closest('[data-queue-drag-lane]');
    if (!row || row.classList.contains('status-queued') === false || moving) {
      event.preventDefault();
      return;
    }
    var which = row.dataset.queueDragLane;
    if (which === 'llm' || queueRows(which).length < 2) { event.preventDefault(); return; }
    drag = { lane: which, id: row.dataset.queueDragId };
    row.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', drag.id);
  });
  drawer.addEventListener('dragover', function (event) {
    if (!drag) return;
    var row = event.target.closest('[data-queue-drag-lane]');
    if (!row || row.dataset.queueDragLane !== drag.lane || !row.classList.contains('status-queued')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    drawer.querySelectorAll('.queue-drop-before, .queue-drop-after').forEach(function (item) {
      item.classList.remove('queue-drop-before', 'queue-drop-after');
    });
    var rect = row.getBoundingClientRect();
    row.classList.add(event.clientY < rect.top + rect.height / 2 ? 'queue-drop-before' : 'queue-drop-after');
  });
  drawer.addEventListener('drop', function (event) {
    if (!drag) return;
    event.preventDefault();
    var row = event.target.closest('[data-queue-drag-lane]');
    var source = drag;
    var target = row && row.dataset.queueDragLane === source.lane && row.classList.contains('status-queued') ? row : null;
    var after = target && target.classList.contains('queue-drop-after');
    var beforeRows = queueRows(source.lane);
    clearDrag();
    if (!target || moving) return;
    var from = beforeRows.findIndex(function (item) { return item.dataset.queueDragId === source.id; });
    var to = beforeRows.indexOf(target) + (after ? 1 : 0);
    if (from < 0 || to < 0) return;
    if (from < to) to -= 1;
    if (from === to) return;
    moving = true;
    var request = source.lane === 'inference'
      ? window.reorderInferenceQueueToPosition(source.id, to)
      : post('/fs/training_runner/reorder', { jobId: source.id, position: to }).then(function () {
          window.refreshTrainingRunnerStatus();
          return refresh();
        });
    Promise.resolve(request).catch(function (error) {
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Job Queue reorder', error);
    }).finally(function () { moving = false; });
  });
  drawer.addEventListener('dragend', clearDrag);
  drawer.addEventListener('dragleave', function (event) {
    if (event.relatedTarget && drawer.contains(event.relatedTarget)) return;
    drawer.querySelectorAll('.queue-drop-before, .queue-drop-after').forEach(function (item) {
      item.classList.remove('queue-drop-before', 'queue-drop-after');
    });
  });
  drawer.addEventListener('click', function (event) {
    var tab = event.target.closest('[data-job-queue-tab]');
    if (tab) { opening++; select(tab.dataset.jobQueueTab); return; }
    var button = event.target.closest('[data-job-queue-action]');
    if (button) Promise.resolve(perform(button.dataset.jobQueueLane, button.dataset.jobQueueAction, button.dataset.jobQueueId || ''))
      .catch(function (error) { if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Job Queues', error); });
  });
  drawer.addEventListener('keydown', function (event) {
    var tab = event.target.closest('[data-job-queue-tab]');
    if (!tab || ['ArrowLeft', 'ArrowRight'].indexOf(event.key) === -1) return;
    event.preventDefault();
    var all = ['inference', 'llm', 'training'];
    opening++;
    select(all[(all.indexOf(lane) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]);
    document.getElementById('job-queue-tab-' + lane).focus();
  });
  window.addEventListener('webcap:job-queues-opened', function () {
    var attempt = ++opening;
    // Inference refresh makes the drawer visible; then retrieve the other lanes.
    window.refreshInferenceQueue().then(function () { return refresh(); }).then(function () {
      if (attempt === opening && !drawer.classList.contains('hidden')) select(preferredLane());
    });
  });
  window.addEventListener('webcap:inference-queue-snapshot', function () { render('inference'); });
  window.setInterval(function () { refresh(); }, 3000);
  select('inference');
}());
