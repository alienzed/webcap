(function () {
  'use strict';

  var sessionStartedAt = Date.now() / 1000;
  var state = {
    open: false,
    payload: { active: [], recent: [], queues: {} },
    timer: 0,
    pending: false,
    pendingPromise: null,
    lastSeen: sessionStartedAt,
    openedAt: 0,
    recentCompletions: [],
    notified: Object.create(null),
    reportedErrors: Object.create(null),
    localProgress: Object.create(null),
    progressChildIds: Object.create(null)
  };

  function el(id) { return document.getElementById(id); }

  function storeLastSeen(value) {
    state.lastSeen = Number(value) || Date.now() / 1000;
  }

  function sessionRecent() {
    return state.recentCompletions.slice();
  }

  function recentIdentity(item) {
    var id = String(item && item.id || '').trim();
    if (!id) return recentKey(item);
    return [String(item.lane || item.kind || ''), id].join(':');
  }

  function rememberRecentCompletion(item) {
    if (!item || !item.id) return;
    captureRecent([Object.assign({}, item, {
      finishedAt: finishedAt(item) || Date.now() / 1000,
      updatedAt: finishedAt(item) || Date.now() / 1000
    })]);
    notifyRecent(sessionRecent());
    render();
  }

  function captureRecent(items) {
    var byKey = Object.create(null);
    state.recentCompletions.forEach(function (item) {
      byKey[recentIdentity(item)] = item;
    });
    (Array.isArray(items) ? items : []).forEach(function (item) {
      if (finishedAt(item) < sessionStartedAt) return;
      byKey[recentIdentity(item)] = Object.assign({}, item);
    });
    state.recentCompletions = Object.keys(byKey).map(function (key) {
      return byKey[key];
    }).sort(function (a, b) {
      return finishedAt(b) - finishedAt(a);
    }).slice(0, 24);
  }

  function publishProgress(snapshot) {
    if (!snapshot || !snapshot.id) throw new Error('Activity progress requires a stable ID.');
    state.localProgress[String(snapshot.id)] = Object.assign({}, snapshot);
    if (snapshot.childJobId) state.progressChildIds[String(snapshot.childJobId)] = true;
    renderProgressFollower();
    if (state.open) render();
  }

  function finishProgress(id, status) {
    var item = state.localProgress[String(id || '')];
    if (!item) return;
    delete state.localProgress[String(id)];
    if (status === 'failed') {
      window.reportConsoleError('Activity', item.title + ' failed. See Diagnostics and Console.');
    }
    renderProgressFollower();
    if (state.open) render();
  }

  function localItems() {
    return Object.keys(state.localProgress).map(function (id) { return state.localProgress[id]; });
  }

  function isProgressChild(item) {
    var id = String(item && item.id || '');
    return !!id && (state.progressChildIds[id] || localItems().some(function (progress) {
      return String(progress.childJobId || '') === id;
    }));
  }

  function renderProgressFollower() {
    var root = el('app-overlay-root');
    if (!root) throw new Error('Activity overlay root is missing.');
    var host = el('activity-progress-follower');
    var managed = (Array.isArray(state.payload.active) ? state.payload.active : [])
      .filter(function (item) { return !isProgressChild(item); })
      .map(managedProgressSnapshot).filter(Boolean);
    var items = managed.concat(localItems());
    if (!items.length) {
      if (host) host.remove();
      return;
    }
    // Follow the most recently started work; stable start times prevent card
    // switching on each refresh. Other operations remain in the Activity drawer.
    items.sort(function (a, b) {
      return Number(a.startedAt || 0) - Number(b.startedAt || 0);
    });
    var item = items[items.length - 1];
    if (!host) {
      host = document.createElement('div');
      host.id = 'activity-progress-follower';
      host.className = 'activity-progress-follower';
      root.appendChild(host);
    }
    var card = host.querySelector('[data-progress-card-id]');
    if (!card || card.getAttribute('data-progress-card-id') !== String(item.id)) {
      card = ProgressCard.create({ compact: true });
      host.replaceChildren(card);
    }
    ProgressCard.update(card, item, {
      compact: true,
      onOpen: function () {
        if (item.kind === 'director-diagnostics') {
          window.openDiagnosticsModal(item.title === 'Director Benchmark' ? 'benchmark' : 'models');
        } else if (item.original) {
          openItem(item.original);
        } else {
          setOpen(true);
        }
      }
    });
  }

  function requestJson(url) {
    return fetch(url).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok === false) {
          throw new Error((payload && payload.error) || 'Activity request failed.');
        }
        return payload;
      });
    });
  }

  function finishedAt(item) {
    var value = Number(item && (item.finishedAt || item.updatedAt));
    return isFinite(value) ? value : 0;
  }

  function unseenCount() {
    return sessionRecent().filter(function (item) {
      return finishedAt(item) > state.lastSeen;
    }).length;
  }

  function activeCount() {
    return Array.isArray(state.payload.active) ? state.payload.active.length : 0;
  }

  function formatElapsed(startedAt) {
    var started = Number(startedAt);
    if (!isFinite(started) || started <= 0) return '';
    var seconds = Math.max(0, Math.round(Date.now() / 1000 - started));
    if (seconds < 60) return String(seconds) + 's';
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return String(minutes) + 'm';
    var hours = Math.floor(minutes / 60);
    return String(hours) + 'h ' + String(minutes % 60) + 'm';
  }

  function formatAge(timestamp) {
    var value = Number(timestamp);
    if (!isFinite(value) || value <= 0) return '';
    var seconds = Math.max(0, Math.round(Date.now() / 1000 - value));
    if (seconds < 60) return seconds < 5 ? 'now' : String(seconds) + 's';
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return String(minutes) + 'm';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return String(hours) + 'h';
    return String(Math.floor(hours / 24)) + 'd';
  }

  function bytesLabel(value) {
    var bytes = Number(value);
    if (!isFinite(bytes) || bytes <= 0) return '';
    var units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    var unit = 0;
    while (bytes >= 1024 && unit < units.length - 1) {
      bytes /= 1024;
      unit += 1;
    }
    return (bytes >= 10 || unit === 0 ? bytes.toFixed(0) : bytes.toFixed(1)) + ' ' + units[unit];
  }

  function kindLabel(item) {
    if (item.kind === 'storyboard') return 'Storyboard';
    if (item.kind === 'test') return 'Test';
    if (item.kind === 'generate') return 'Generate';
    if (item.kind === 'training') return 'Training';
    if (item.kind === 'storage') return 'Storage';
    if (item.kind === 'director') return 'Director';
    return 'Activity';
  }

  function activityTitle(item) {
    var kind = kindLabel(item);
    if (item.kind === 'director') {
      var client = item.client === 'generate' ? 'Generate'
        : item.client === 'storyboard' ? 'Storyboard'
        : item.client === 'test' ? 'Test'
        : item.client === 'chat' ? 'Chat'
        : item.client === 'schema' ? 'Schema Assist'
        : '';
      return client ? kind + ' · ' + client : kind;
    }
    return item.label ? kind + ' · ' + String(item.label) : kind;
  }

  function activityDetail(item) {
    var parts = [];
    if (item.kind === 'training') {
      if (item.folder) parts.push(item.folder);
      var progress = item.progress && typeof item.progress === 'object' ? item.progress : {};
      var epoch = Number(progress.epoch);
      var epochs = Number(progress.epochs);
      if (isFinite(epoch) && epoch > 0) {
        parts.push('Epoch ' + Math.round(epoch) + (isFinite(epochs) && epochs > 0 ? ' / ' + Math.round(epochs) : ''));
      } else if (item.stage) {
        parts.push(item.stage);
      }
    } else if (item.kind === 'storage') {
      if (item.phase) parts.push(String(item.phase).replace(/_/g, ' '));
      if (item.itemsTotal) parts.push(String(item.itemsMeasured || 0) + ' / ' + String(item.itemsTotal) + ' items');
      var measured = bytesLabel(item.bytesScanned);
      if (measured) parts.push(measured + ' scanned');
    } else {
      if (item.modelId) parts.push(item.modelId);
      if (item.operation) parts.push(String(item.operation).replace(/_/g, ' '));
      if (item.kind === 'director' && item.finishReason) parts.push('finish=' + String(item.finishReason));
      if (item.kind === 'director' && Number(item.promptTokens) > 0) parts.push('prompt=' + String(item.promptTokens));
      if (item.kind === 'director' && Number(item.outputTokens) > 0) parts.push('output=' + String(item.outputTokens));
      if (item.folder) parts.push(item.folder);
      if (item.sceneId && !item.label) parts.push('Scene ' + item.sceneId);
    }
    return parts.join(' · ');
  }

  // Convert existing managed work to the same presentation contract as Diagnostics.
  // The backend and owning workspace remain authoritative; no new progress polling.
  function managedProgressSnapshot(item) {
    if (item.kind !== 'training' && item.kind !== 'storage') return null;
    var snapshot = {
      id: 'managed:' + String(item.kind) + ':' + String(item.id),
      kind: item.kind,
      title: activityTitle(item),
      status: String(item.status || 'running'),
      startedAt: item.startedAt,
      detail: String(item.folder || ''),
      phase: '',
      progressLabel: '',
      progress: null
    };
    if (item.kind === 'training') {
      var source = item.progress && typeof item.progress === 'object' ? item.progress : {};
      var stage = String(source.stage || item.stage || '').replace(/_/g, ' ');
      snapshot.phase = (item.status === 'stopping' ? 'Stopping' : 'Training') +
        (stage ? ' · ' + stage : '');
      var epoch = Number(source.epoch);
      var epochs = Number(source.epochs);
      var hasEpoch = source.epoch != null && source.epochs != null &&
        isFinite(epoch) && epoch >= 0 && isFinite(epochs) && epochs > 0;
      if (hasEpoch) snapshot.progressLabel = 'Epoch ' + Math.round(epoch) + ' / ' + Math.round(epochs);
      var overall = Number(source.overallPercent);
      if (source.overallPercent != null && isFinite(overall) && overall >= 0 && overall <= 100) {
        snapshot.progress = { completed: overall, total: 100 };
        snapshot.progressLabel += (snapshot.progressLabel ? ' · ' : '') +
          (source.source === 'steps' ? '~' : '') + Math.round(overall) + '% overall';
      } else if (hasEpoch) {
        snapshot.progress = { completed: epoch, total: epochs };
        snapshot.progressLabel += ' · current stage';
      }
    } else {
      snapshot.phase = (item.status === 'cancelling' ? 'Cancelling' :
        String(item.phase || 'Measuring').replace(/_/g, ' '));
      var measured = Number(item.itemsMeasured);
      var total = Number(item.itemsTotal);
      if (item.itemsTotal != null && isFinite(total) && total > 0 &&
          item.itemsMeasured != null && isFinite(measured) && measured >= 0) {
        snapshot.progress = { completed: measured, total: total };
        snapshot.progressLabel = String(measured) + ' / ' + String(total) + ' items measured';
      }
      var scanned = bytesLabel(item.bytesScanned);
      if (scanned) snapshot.progressLabel += (snapshot.progressLabel ? ' · ' : '') + scanned + ' scanned';
    }
    snapshot.original = item;
    return snapshot;
  }

  function openItem(item) {
    setOpen(false);
    if (!item) return;
    var target = {
      jobId: String(item.id || ''),
      storyId: String(item.storyId || ''),
      sceneId: String(item.sceneId || ''),
      folder: String(item.folder || ''),
      sessionId: String(item.sessionId || ''),
      source: String(item.source || ''),
      modelId: String(item.modelId || '')
    };
    if (item.kind === 'storyboard' && typeof window.openStoryboardActivity === 'function') {
      window.openStoryboardActivity(target);
      return;
    }
    if (item.kind === 'test' && typeof window.openTestBenchActivity === 'function') {
      window.openTestBenchActivity(target);
      return;
    }
    if (item.kind === 'generate' && typeof window.openGenerateActivity === 'function') {
      window.openGenerateActivity(target);
      return;
    }
    if (item.kind === 'training' && typeof window.openTrainingSurface === 'function') {
      window.openTrainingSurface(item.folder ? 'set' : 'global', target);
      return;
    }
    if (item.kind === 'storage' && typeof window.openStorageActivity === 'function') {
      window.openStorageActivity();
      return;
    }
    if (item.kind === 'director') {
      if (item.client !== 'chat') target.jobId = '';
      if (item.client === 'generate' && typeof window.openGenerateActivity === 'function') {
        window.openGenerateActivity(target);
      } else if (item.client === 'test' && typeof window.openTestBenchActivity === 'function') {
        window.openTestBenchActivity(target);
      } else if (item.client === 'chat' && typeof window.openDirectorChatActivity === 'function') {
        window.openDirectorChatActivity(target);
      } else if (item.client === 'storyboard' && typeof window.openStoryboardActivity === 'function') {
        window.openStoryboardActivity(target);
      }
    }
  }

  function activeCardKey(item) {
    return [String(item.lane || item.kind || ''), String(item.kind || ''), String(item.id || '')].join(':');
  }

  function syncActiveCard(card, item) {
    card.setAttribute('data-activity-active-key', activeCardKey(item));
    card.className = 'activity-monitor-card status-' + String(item.status || '');
    card.querySelector('.activity-monitor-dot').className = 'activity-monitor-dot active';
    card.querySelector('.activity-monitor-copy strong').textContent = activityTitle(item);
    card.querySelector('.activity-monitor-copy span').textContent =
      activityDetail(item) || String(item.status || '').replace(/_/g, ' ');
    var elapsed = formatElapsed(item.startedAt);
    card.querySelector('.activity-monitor-copy small').textContent =
      [String(item.status || '').replace(/_/g, ' '), elapsed ? elapsed + ' elapsed' : ''].filter(Boolean).join(' · ');
    card.querySelector('.activity-monitor-open').onclick = function () { openItem(item); };
    return card;
  }

  function createActiveCard(item) {
    var article = document.createElement('article');
    article.className = 'activity-monitor-card status-' + String(item.status || '');

    var dot = document.createElement('span');
    dot.className = 'activity-monitor-dot ' + (item.kind === 'storage' ? 'background' : 'active');

    var copy = document.createElement('div');
    copy.className = 'activity-monitor-copy';
    var title = document.createElement('strong');
    title.textContent = activityTitle(item);
    var detail = document.createElement('span');
    detail.textContent = activityDetail(item) || String(item.status || '').replace(/_/g, ' ');
    var meta = document.createElement('small');
    var elapsed = formatElapsed(item.startedAt);
    meta.textContent = [String(item.status || '').replace(/_/g, ' '), elapsed ? elapsed + ' elapsed' : ''].filter(Boolean).join(' · ');
    copy.appendChild(title);
    copy.appendChild(detail);
    copy.appendChild(meta);

    var open = document.createElement('button');
    open.type = 'button';
    open.className = 'activity-monitor-open';
    open.textContent = 'Open';
    open.onclick = function () { openItem(item); };

    article.appendChild(dot);
    article.appendChild(copy);
    article.appendChild(open);
    return syncActiveCard(article, item);
  }

  function recentStatusClass(status) {
    return ['failed', 'interrupted'].indexOf(String(status || '')) !== -1 ? 'failed' : 'complete';
  }

  function recentStatusLabel(status) {
    status = String(status || '');
    if (status === 'failed') return 'failed';
    if (status === 'interrupted') return 'interrupted';
    if (status === 'cancelled') return 'cancelled';
    if (status === 'stopped') return 'stopped';
    if (status === 'finished_early') return 'finished early';
    return 'completed';
  }

  function createRecentRow(item) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'activity-monitor-recent-row ' + recentStatusClass(item.status);
    button.onclick = function () { openItem(item); };

    var icon = document.createElement('span');
    icon.className = 'activity-monitor-recent-icon';
    icon.textContent = recentStatusClass(item.status) === 'failed' ? '!' : '✓';

    var copy = document.createElement('span');
    copy.className = 'activity-monitor-recent-copy';
    var title = document.createElement('strong');
    title.textContent = activityTitle(item) + ' ' + recentStatusLabel(item.status);
    var detail = document.createElement('small');
    detail.textContent = item.error || activityDetail(item) || String(item.status || '').replace(/_/g, ' ');
    copy.appendChild(title);
    copy.appendChild(detail);

    var age = document.createElement('time');
    age.textContent = formatAge(finishedAt(item));

    button.appendChild(icon);
    button.appendChild(copy);
    button.appendChild(age);
    return button;
  }

  function recentKey(item) {
    return [String(item.lane || item.kind || ''), String(item.id || ''), String(finishedAt(item))].join(':');
  }

  function toastRecent(item) {
    var failed = recentStatusClass(item.status) === 'failed';
    var host = el('activity-toast-stack');
    if (!host) {
      host = document.createElement('div');
      host.id = 'activity-toast-stack';
      host.className = 'activity-toast-stack';
      host.setAttribute('aria-live', 'polite');
      host.setAttribute('aria-label', 'Notifications');
      el('app-overlay-root').appendChild(host);
    }
    var toast = document.createElement('div');
    toast.className = 'activity-toast ' + (failed ? 'failed' : 'complete');
    var icon = document.createElement('span');
    icon.className = 'activity-toast-icon';
    icon.textContent = failed ? '!' : '✓';
    var copy = document.createElement('div');
    copy.className = 'activity-toast-copy';
    var title = document.createElement('strong');
    title.textContent = activityTitle(item) + ' ' + recentStatusLabel(item.status);
    var detail = document.createElement('span');
    detail.textContent = item.error || activityDetail(item) || '';
    copy.appendChild(title);
    if (detail.textContent) copy.appendChild(detail);
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'activity-toast-close';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.textContent = '×';
    var timer = 0;
    function dismiss() {
      if (timer) clearTimeout(timer);
      toast.remove();
    }
    close.onclick = dismiss;
    toast.appendChild(icon);
    toast.appendChild(copy);
    toast.appendChild(close);
    host.prepend(toast);
    while (host.children.length > 3) host.lastElementChild.remove();
    timer = setTimeout(dismiss, failed ? 8000 : 5000);
  }

  function notifyRecent(items) {
    items.forEach(function (item) {
      if (isProgressChild(item)) return;
      var status = String(item.status || '');
      if (['completed', 'finished_early', 'failed', 'interrupted', 'stopped', 'cancelled'].indexOf(status) === -1) return;
      var key = recentKey(item);
      if (state.notified[key]) return;
      state.notified[key] = true;
      toastRecent(item);

      var message = activityTitle(item) + ' ' + recentStatusLabel(item.status);
      var detail = item.error || activityDetail(item) || '';
      if (detail) message += ' · ' + detail;
      if (recentStatusClass(item.status) === 'failed') {
        window.reportConsoleError('Activity', message);
      } else {
        window.reportConsoleInfo('Activity', message);
      }
    });
  }

  function queueText(queue, includeRunning) {
    queue = queue || {};
    if (queue.unavailable) return 'Unavailable';
    var parts = [];
    if (includeRunning && Number(queue.running || 0)) parts.push(String(queue.running) + ' running');
    if (Number(queue.queued || 0)) parts.push(String(queue.queued) + ' queued');
    if (Number(queue.backlog || 0)) parts.push(String(queue.backlog) + ' backlog');
    if (queue.paused) parts.push('paused');
    return parts.join(' · ') || 'Empty';
  }

  function queueHasWork(queue, includeRunning) {
    queue = queue || {};
    if (queue.unavailable) return false;
    return !!(
      (includeRunning && Number(queue.running || 0)) ||
      Number(queue.queued || 0) ||
      Number(queue.backlog || 0) ||
      queue.paused
    );
  }

  function createQueueStatus(label, key, queue) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'activity-monitor-queue-status';

    var labelEl = document.createElement('strong');
    labelEl.textContent = label;
    var statusEl = document.createElement('span');
    statusEl.textContent = queueText(queue, key !== 'training');
    button.appendChild(labelEl);
    button.appendChild(statusEl);

    var hasWork = queueHasWork(queue, key !== 'training');
    if (queue && queue.unavailable) {
      button.disabled = true;
      button.title = label + ' state is unavailable; see Console for details.';
    } else if (key === 'inference' && hasWork) {
      button.onclick = function () {
        setOpen(false);
        window.setInferenceQueueOpen(true);
      };
      button.title = 'Open Inference Queue';
    } else if (key === 'training' && hasWork) {
      button.onclick = function () {
        setOpen(false);
        window.openTrainingSurface('global');
      };
      button.title = 'Open Training';
    } else {
      button.disabled = true;
      if (key === 'director' && hasWork) button.title = 'Queued Director requests are listed below.';
    }
    return button;
  }

  function createQueueStatusBar(queues) {
    var row = document.createElement('div');
    row.className = 'activity-monitor-queue-status-bar';
    row.appendChild(createQueueStatus('Inference', 'inference', queues.inference));
    row.appendChild(createQueueStatus('Training', 'training', queues.training));
    row.appendChild(createQueueStatus('Director', 'director', queues.director));
    return row;
  }

  function directorQueueOperationLabel(job) {
    var operation = String(job && job.operation || '');
    var labels = {
      expand_concept: 'Expand Concept',
      define_invariants: 'Define Invariants',
      develop_story: 'Develop Scenes',
      repair_scenes: 'Revise Scenes',
      write_prompt: 'Write Scene Prompt',
      refine_prompt: 'Refine Scene Prompt',
      freeform_chat: 'Chat'
    };
    return labels[operation] || String(job && job.label || operation || 'Director request').replace(/_/g, ' ');
  }

  function directorQueueClientLabel(job) {
    var client = String(job && job.client || '');
    return client === 'storyboard' ? 'Storyboard'
      : client === 'generate' ? 'Generate'
      : client === 'test' ? 'Test'
      : client === 'chat' ? 'Chat'
      : 'Director';
  }

  function createDirectorQueueList(queue) {
    queue = queue || {};
    var jobs = Array.isArray(queue.jobs) ? queue.jobs : [];
    if (!jobs.length) return null;

    var list = document.createElement('div');
    list.className = 'activity-monitor-director-queue';

    jobs.forEach(function (job, index) {
      var row = document.createElement('div');
      row.className = 'activity-monitor-director-queue-row';

      var position = document.createElement('span');
      position.className = 'activity-monitor-director-queue-position';
      position.textContent = '#' + String(Number(job.queuePosition || index + 1));

      var copy = document.createElement('div');
      copy.className = 'activity-monitor-director-queue-copy';

      var title = document.createElement('strong');
      title.textContent = directorQueueClientLabel(job) + ' · ' + directorQueueOperationLabel(job);

      var detail = document.createElement('small');
      var parts = [];
      if (job.sceneId) parts.push('Scene ' + String(job.sceneId));
      if (job.modelId) parts.push(String(job.modelId));
      detail.textContent = parts.join(' · ') || 'Waiting';

      copy.appendChild(title);
      copy.appendChild(detail);
      row.appendChild(position);
      row.appendChild(copy);
      list.appendChild(row);
    });
    return list;
  }

  function appendSection(host, titleText, noteText) {
    var section = document.createElement('section');
    section.className = 'activity-monitor-section';
    var heading = document.createElement('div');
    heading.className = 'activity-monitor-section-heading';
    var title = document.createElement('strong');
    title.textContent = titleText;
    var note = document.createElement('span');
    note.textContent = noteText || '';
    heading.appendChild(title);
    heading.appendChild(note);
    section.appendChild(heading);
    host.appendChild(section);
    return section;
  }

  function ensureActivitySection(host, key, title, note) {
    var section = Array.prototype.find.call(host.children, function (child) {
      return child.getAttribute('data-activity-section') === key;
    });
    if (!section) {
      section = appendSection(host, title, note);
      section.setAttribute('data-activity-section', key);
    }
    section.querySelector('.activity-monitor-section-heading span').textContent = note || '';
    return section;
  }

  function reconcileActivityRows(section, wanted) {
    // Keep mounted cards and controls stable while polling.
    wanted.forEach(function (node, index) {
      if (section.children[index + 1] !== node) {
        section.insertBefore(node, section.children[index + 1] || null);
      }
    });
    Array.prototype.slice.call(section.children, 1).forEach(function (node) {
      if (wanted.indexOf(node) === -1) node.remove();
    });
  }

  function syncActivityRailWork(active) {
    var activeIds = Object.create(null);
    (active || []).forEach(function (item) {
      var kind = String(item && item.kind || '');
      if (kind === 'director') kind = String(item && item.client || 'storyboard');
      var id = {
        generate: 'activity-generate-btn',
        training: 'activity-training-btn',
        test: 'activity-test-btn',
        storyboard: 'activity-storyboard-btn',
        storage: 'activity-storage-btn',
        chat: 'director-chat-rail-btn'
      }[kind];
      if (id) activeIds[id] = true;
    });

    [
      'activity-generate-btn',
      'activity-training-btn',
      'activity-test-btn',
      'activity-storyboard-btn',
      'activity-storage-btn',
      'director-chat-rail-btn'
    ].forEach(function (id) {
      var button = el(id);
      if (button) button.classList.toggle('has-active-work', !!activeIds[id]);
    });
    if (typeof window.setShellTrainingActive === 'function') {
      window.setShellTrainingActive(!!activeIds['activity-training-btn']);
    }
    window.setShellManagedActivity(active, state.payload.gpuOwner);
  }

  function render() {
    var active = (Array.isArray(state.payload.active) ? state.payload.active : []).filter(function (item) {
      return !isProgressChild(item);
    }).concat(localItems());
    var recent = sessionRecent();
    var queues = state.payload.queues || {};
    var drawer = el('activity-monitor-drawer');
    var host = el('activity-monitor-list');
    var summary = el('activity-monitor-summary');
    var toggle = el('activity-monitor-rail-btn');
    var badge = toggle && toggle.querySelector('[data-activity-monitor-badge]');
    if (!drawer || !host || !summary || !toggle || !badge) return;

    drawer.classList.toggle('hidden', !state.open);
    drawer.setAttribute('aria-hidden', state.open ? 'false' : 'true');
    toggle.setAttribute('aria-expanded', state.open ? 'true' : 'false');
    toggle.classList.toggle('activity-running', active.length > 0);
    syncActivityRailWork(active);

    var unseen = unseenCount();
    badge.textContent = unseen > 99 ? '99+' : String(unseen);
    badge.classList.toggle('hidden', unseen === 0 || state.open);
    summary.textContent = active.length
      ? String(active.length) + ' active · ' + (unseen ? String(unseen) + ' new' : 'up to date')
      : (unseen ? String(unseen) + ' new this session' : 'Current work and this session');

    var retainedProgressCards = Object.create(null);
    Array.prototype.forEach.call(host.querySelectorAll('[data-progress-card-id]'), function (card) {
      retainedProgressCards[card.getAttribute('data-progress-card-id')] = card;
    });
    var retainedActiveCards = Object.create(null);
    Array.prototype.forEach.call(host.querySelectorAll('[data-activity-active-key]'), function (card) {
      retainedActiveCards[card.getAttribute('data-activity-active-key')] = card;
    });

    var nowSection = ensureActivitySection(host, 'now', 'Now', active.length ? String(active.length) + ' active' : '');
    var nowRows = [];
    if (!active.length) {
      var emptyNow = nowSection.querySelector('.activity-monitor-empty');
      if (!emptyNow) {
        emptyNow = document.createElement('div');
        emptyNow.className = 'activity-monitor-empty';
        emptyNow.textContent = 'Nothing is running right now.';
      }
      nowRows.push(emptyNow);
    } else {
      active.forEach(function (item) {
        var managedSnapshot = managedProgressSnapshot(item);
        if (managedSnapshot || item.kind === 'director-diagnostics') {
          var progressItem = managedSnapshot || item;
          var card = retainedProgressCards[String(progressItem.id)] || ProgressCard.create();
          ProgressCard.update(card, progressItem, { onOpen: function () {
            if (item.kind === 'director-diagnostics') {
              setOpen(false);
              window.openDiagnosticsModal(item.title === 'Director Benchmark' ? 'benchmark' : 'models');
            } else openItem(item);
          } });
          nowRows.push(card);
        } else {
          var existingCard = retainedActiveCards[activeCardKey(item)];
          nowRows.push(existingCard ? syncActiveCard(existingCard, item) : createActiveCard(item));
        }
      });
    }
    reconcileActivityRows(nowSection, nowRows);

    var recentSection = ensureActivitySection(host, 'recent', 'Recent', unseen ? String(unseen) + ' new' : '');
    var recentRows = [];
    if (!recent.length) {
      var emptyRecent = recentSection.querySelector('.activity-monitor-empty');
      if (!emptyRecent) {
        emptyRecent = document.createElement('div');
        emptyRecent.className = 'activity-monitor-empty';
        emptyRecent.textContent = 'No recent managed work.';
      }
      recentRows.push(emptyRecent);
    } else {
      var existingRecent = Object.create(null);
      Array.prototype.forEach.call(recentSection.querySelectorAll('[data-activity-recent-key]'), function (row) {
        existingRecent[row.getAttribute('data-activity-recent-key')] = row;
      });
      recent.slice(0, 12).forEach(function (item) {
        var key = recentKey(item);
        var row = existingRecent[key] || createRecentRow(item);
        row.setAttribute('data-activity-recent-key', key);
        row.querySelector('time').textContent = formatAge(finishedAt(item));
        recentRows.push(row);
      });
    }
    reconcileActivityRows(recentSection, recentRows);

    var queueSection = ensureActivitySection(host, 'queues', 'Queue Status', '');
    queueSection.classList.add('activity-monitor-queue-section');
    var queueSignature = JSON.stringify(queues);
    if (queueSection.getAttribute('data-activity-queue-signature') !== queueSignature) {
      var queueRows = [createQueueStatusBar(queues)];
      var directorQueueList = createDirectorQueueList(queues.director);
      if (directorQueueList) queueRows.push(directorQueueList);
      reconcileActivityRows(queueSection, queueRows);
      queueSection.setAttribute('data-activity-queue-signature', queueSignature);
    }
  }

  function refresh() {
    if (state.pending) return state.pendingPromise || Promise.resolve(state.payload);
    state.pending = true;
    state.pendingPromise = requestJson('/fs/activity?limit=24&since=' + encodeURIComponent(String(sessionStartedAt))).then(function (payload) {
      state.payload = payload;
      captureRecent(payload.recent);
      window.reconcileTrainingRunnerActivity(Array.isArray(payload.active) ? payload.active : []);
      var activeErrorKeys = Object.create(null);
      (Array.isArray(payload.errors) ? payload.errors : []).forEach(function (item) {
        var key = String(item.area || 'activity') + ':' + String(item.error || '');
        activeErrorKeys[key] = true;
        if (state.reportedErrors[key]) return;
        state.reportedErrors[key] = true;
        window.reportConsoleError('Activity', String(item.area || 'Activity') + ' unavailable: ' + String(item.error || 'Unknown error'));
      });
      Object.keys(state.reportedErrors).forEach(function (key) {
        if (!activeErrorKeys[key]) delete state.reportedErrors[key];
      });
      notifyRecent(sessionRecent());
      render();
      renderProgressFollower();
      return payload;
    }).catch(function (err) {
      if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Activity', err);
      return state.payload;
    }).then(function (payload) {
      state.pending = false;
      state.pendingPromise = null;
      return payload;
    });
    return state.pendingPromise;
  }

  function hasQueuedOrPausedWork() {
    var queues = state.payload.queues || {};
    return ['inference', 'training', 'director'].some(function (key) {
      var queue = queues[key] || {};
      return Number(queue.running || 0) > 0 ||
        Number(queue.queued || 0) > 0 ||
        Number(queue.backlog || 0) > 0 ||
        !!queue.paused;
    });
  }

  function schedule() {
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(function () {
      refresh().then(schedule);
    }, state.open ? 3000 : ((activeCount() || hasQueuedOrPausedWork()) ? 8000 : 30000));
  }

  function wake() {
    if (state.pending) {
      return state.pendingPromise.then(function () {
        return refresh();
      }).then(function (payload) {
        schedule();
        return payload;
      });
    }
    return refresh().then(function (payload) {
      schedule();
      return payload;
    });
  }

  function setOpen(open) {
    var wasOpen = state.open;
    state.open = !!open;
    if (state.open) {
      if (!wasOpen) state.openedAt = Date.now() / 1000;
      if (typeof window.setDirectorChatOpen === 'function') window.setDirectorChatOpen(false);
      if (typeof window.setInferenceQueueOpen === 'function') window.setInferenceQueueOpen(false);
    } else if (wasOpen) {
      storeLastSeen(Date.now() / 1000);
      state.openedAt = 0;
    }
    render();
    wake();
  }

  function bind() {
    var toggle = el('activity-monitor-rail-btn');
    var close = el('activity-monitor-close');
    var drawer = el('activity-monitor-drawer');
    if (!toggle || !close || !drawer) return;
    toggle.onclick = function () { setOpen(!state.open); };
    close.onclick = function () { setOpen(false); };
    document.addEventListener('pointerdown', function (event) {
      if (!state.open || drawer.contains(event.target) || toggle.contains(event.target)) return;
      setOpen(false);
    });
    window.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && state.open) setOpen(false);
    });
    window.addEventListener('webcap:inference-queue-changed', wake);
  }

  window.publishActivityProgress = publishProgress;
  window.finishActivityProgress = finishProgress;
  window.recordActivityCompletion = rememberRecentCompletion;
  window.setActivityDrawerOpen = setOpen;
  window.refreshActivityMonitor = wake;
  bind();
  wake();
})();
