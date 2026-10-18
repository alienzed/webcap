(function () {
  'use strict';
  var lane = 'inference';
  var snapshots = { llm: null, training: null };
  var pending = false, timer = 0;
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
    if (which === 'llm') return [job.client || 'Director', job.operation || job.label].filter(Boolean).join(' · ') || 'LLM request';
    return [job.folder || 'Training', job.stage || job.modelType || job.model || ''].filter(Boolean).join(' · ');
  }
  function detail(job, which) {
    if (which === 'llm') return [job.modelId, job.label, job.error].filter(Boolean).join(' · ');
    var p = job.progress || {};
    return [
      job.resumeFromCheckpoint ? 'Resume' : '',
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
    return button;
  }
  function row(job, which) {
    var node = document.createElement('div');
    node.className = 'inference-queue-row job-queue-row status-' + String(job.status || 'queued');
    node.dataset.jobQueueId = String(job.jobId || job.id || '');
    node.appendChild(textNode('span', 'inference-queue-position', active(job) ? job.status : job.status === 'queued' ? '#' + (job.queuePosition || '') : job.status));
    var copy = textNode('div', 'inference-queue-copy', '');
    copy.appendChild(textNode('strong', '', title(job, which)));
    var details = detail(job, which);
    if (details) copy.appendChild(textNode('small', '', details));
    if (active(job)) copy.appendChild(textNode('small', '', elapsed(job)));
    node.appendChild(copy);
    var controls = textNode('div', 'inference-queue-actions', '');
    if (which === 'llm') controls.appendChild(actionButton(active(job) ? 'Stop' : 'Cancel', which, 'cancel_job', job));
    if (which === 'training') {
      if (job.status === 'queued') {
        controls.appendChild(actionButton('↑', which, 'up', job));
        controls.appendChild(actionButton('↓', which, 'down', job));
        controls.appendChild(actionButton('Cancel', which, 'cancel', job));
      } else if (active(job)) {
        controls.appendChild(actionButton('Stop', which, 'stop', job));
        controls.appendChild(actionButton('Pause', which, 'pause', job));
        controls.appendChild(actionButton('Finish', which, 'finish', job));
      }
    }
    node.appendChild(controls);
    return node;
  }
  function render(which) {
    var panel = document.getElementById('job-queue-panel-' + which);
    var jobs = jobsFor(which);
    var badge = document.querySelector('[data-job-queue-count="' + which + '"]');
    if (badge) badge.textContent = count(jobs) ? '(' + count(jobs) + ')' : '';
    if (which === 'inference') return;
    var payload = snapshots[which];
    var message = panel.querySelector('[data-job-queue-summary]');
    var list = panel.querySelector('[data-job-queue-list]');
    if (!payload) { message.textContent = 'Loading ' + which + ' queue…'; return; }
    message.textContent = which === 'llm'
      ? payload.pauseReason || payload.waitReason || (count(jobs) + ' requests')
      : payload.queuePauseReason || payload.runnerNotice || (count(jobs) + ' jobs');
    var controls = panel.querySelector('.job-queue-lane-actions');
    controls.classList.toggle('hidden', which === 'training' ? !payload.queuePaused : !jobs.length);
    var previous = new Map();
    Array.prototype.forEach.call(list.querySelectorAll('[data-job-queue-id]'), function (node) { previous.set(node.dataset.jobQueueId, node); });
    var wanted = jobs.filter(function (job) { return active(job) || job.status === 'queued'; })
      .sort(function (a, b) {
        return Number(active(b)) - Number(active(a)) || (Number(a.queuePosition || 0) - Number(b.queuePosition || 0));
      }).map(function (job) {
        var id = String(job.jobId || job.id || '');
        var fresh = row(job, which);
        var existing = previous.get(id);
        if (existing) {
          var oldCopy = existing.querySelector('.inference-queue-copy');
          var newCopy = fresh.querySelector('.inference-queue-copy');
          existing.className = fresh.className;
          existing.querySelector('.inference-queue-position').textContent = fresh.querySelector('.inference-queue-position').textContent;
          var oldTitle = oldCopy.querySelector('strong');
          oldTitle.textContent = newCopy.querySelector('strong').textContent;
          var oldDetails = oldCopy.querySelectorAll('small');
          var newDetails = newCopy.querySelectorAll('small');
          if (oldDetails.length !== newDetails.length) {
            oldCopy.replaceWith(newCopy);
          } else {
            newDetails.forEach(function (part, index) { oldDetails[index].textContent = part.textContent; });
          }
          if (existing.dataset.jobQueueStatus !== job.status) {
            existing.querySelector('.inference-queue-actions').replaceWith(fresh.querySelector('.inference-queue-actions'));
          }
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
    if (pending || drawer.classList.contains('hidden')) return Promise.resolve();
    pending = true;
    var sources = [
      ['llm', '/fs/director/queue'],
      ['training', '/fs/training_runner/status']
    ];
    return Promise.all(sources.map(function (entry) {
      return request(entry[1]).then(function (data) {
        snapshots[entry[0]] = entry[0] === 'llm' ? data.queue : data;
        render(entry[0]);
      }).catch(function (error) {
        if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Job Queues · ' + entry[0], error);
        document.querySelector('[data-job-queue-summary="' + entry[0] + '"]').textContent = error.message;
      });
    })).then(function () { pending = false; }, function (error) { pending = false; throw error; });
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
      if (typeof window.refreshTrainingRunnerStatus === 'function') window.refreshTrainingRunnerStatus();
      return refresh();
    });
  }
  drawer.addEventListener('click', function (event) {
    var tab = event.target.closest('[data-job-queue-tab]');
    if (tab) { select(tab.dataset.jobQueueTab); return; }
    var button = event.target.closest('[data-job-queue-action]');
    if (button) perform(button.dataset.jobQueueLane, button.dataset.jobQueueAction, button.dataset.jobQueueId || '')
      .catch(function (error) { if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Job Queues', error); });
  });
  drawer.addEventListener('keydown', function (event) {
    var tab = event.target.closest('[data-job-queue-tab]');
    if (!tab || ['ArrowLeft', 'ArrowRight'].indexOf(event.key) === -1) return;
    event.preventDefault();
    var all = ['inference', 'llm', 'training'];
    select(all[(all.indexOf(lane) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]);
    document.getElementById('job-queue-tab-' + lane).focus();
  });
  window.addEventListener('webcap:inference-queue-snapshot', function () { render('inference'); });
  timer = window.setInterval(function () { refresh(); }, 3000);
  select('inference');
}());
