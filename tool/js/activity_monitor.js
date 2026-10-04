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
    reportedErrors: Object.create(null)
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
      var client = item.client === 'generate' ? 'Generate' : item.client === 'storyboard' ? 'Storyboard' : item.client === 'test' ? 'Test' : item.client === 'chat' ? 'Chat' : '';
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

  function progressPercent(item) {
    if (item.kind === 'training') {
      var progress = item.progress && typeof item.progress === 'object' ? item.progress : {};
      var epoch = Number(progress.epoch);
      var epochs = Number(progress.epochs);
      if (isFinite(epoch) && isFinite(epochs) && epochs > 0) return Math.max(0, Math.min(100, epoch / epochs * 100));
    }
    if (item.kind === 'storage') {
      var measured = Number(item.itemsMeasured);
      var total = Number(item.itemsTotal);
      if (isFinite(measured) && isFinite(total) && total > 0) return Math.max(0, Math.min(100, measured / total * 100));
    }
    return null;
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

  function createActiveCard(item) {
    var article = document.createElement('article');
    var dot = document.createElement('span');
    dot.dataset.activityRole = 'dot';
    var copy = document.createElement('div');
    copy.className = 'activity-monitor-copy';
    var title = document.createElement('strong');
    title.dataset.activityRole = 'title';
    var detail = document.createElement('span');
    detail.dataset.activityRole = 'detail';
    var meta = document.createElement('small');
    meta.dataset.activityRole = 'meta';
    var track = document.createElement('div');
    track.className = 'activity-monitor-progress';
    track.dataset.activityRole = 'progress';
    var fill = document.createElement('span');
    fill.dataset.activityRole = 'progress-fill';
    track.appendChild(fill);
    copy.appendChild(title);
    copy.appendChild(detail);
    copy.appendChild(meta);
    copy.appendChild(track);
    var open = document.createElement('button');
    open.type = 'button';
    open.className = 'activity-monitor-open';
    open.dataset.activityRole = 'open';
    open.textContent = 'Open';
    article.appendChild(dot);
    article.appendChild(copy);
    article.appendChild(open);
    syncActiveCard(article, item);
    return article;
  }

  function syncActiveCard(article, item) {
    article.className = 'activity-monitor-card status-' + String(item.status || '');
    article.querySelector('[data-activity-role="dot"]').className =
      'activity-monitor-dot ' + (item.kind === 'storage' ? 'background' : 'active');
    article.querySelector('[data-activity-role="title"]').textContent = activityTitle(item);
    article.querySelector('[data-activity-role="detail"]').textContent =
      activityDetail(item) || String(item.status || '').replace(/_/g, ' ');
    var elapsed = formatElapsed(item.startedAt);
    article.querySelector('[data-activity-role="meta"]').textContent =
      [String(item.status || '').replace(/_/g, ' '), elapsed ? elapsed + ' elapsed' : ''].filter(Boolean).join(' · ');
    var percent = progressPercent(item);
    var track = article.querySelector('[data-activity-role="progress"]');
    track.classList.toggle('hidden', percent === null);
    article.querySelector('[data-activity-role="progress-fill"]').style.width =
      percent === null ? '0%' : percent.toFixed(1) + '%';
    article.querySelector('[data-activity-role="open"]').onclick = function () { openItem(item); };
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
    var icon = document.createElement('span');
    icon.className = 'activity-monitor-recent-icon';
    icon.dataset.activityRole = 'icon';
    var copy = document.createElement('span');
    copy.className = 'activity-monitor-recent-copy';
    var title = document.createElement('strong');
    title.dataset.activityRole = 'title';
    var detail = document.createElement('small');
    detail.dataset.activityRole = 'detail';
    copy.appendChild(title);
    copy.appendChild(detail);
    var age = document.createElement('time');
    age.dataset.activityRole = 'age';
    button.appendChild(icon);
    button.appendChild(copy);
    button.appendChild(age);
    syncRecentRow(button, item);
    return button;
  }

  function syncRecentRow(button, item) {
    var statusClass = recentStatusClass(item.status);
    button.className = 'activity-monitor-recent-row ' + statusClass;
    button.onclick = function () { openItem(item); };
    button.querySelector('[data-activity-role="icon"]').textContent = statusClass === 'failed' ? '!' : '✓';
    button.querySelector('[data-activity-role="title"]').textContent =
      activityTitle(item) + ' ' + recentStatusLabel(item.status);
    button.querySelector('[data-activity-role="detail"]').textContent =
      item.error || activityDetail(item) || String(item.status || '').replace(/_/g, ' ');
    button.querySelector('[data-activity-role="age"]').textContent = formatAge(finishedAt(item));
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
      var status = String(item.status || '');
      if (['completed', 'finished_early', 'failed', 'interrupted'].indexOf(status) === -1) return;
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
    button.dataset.activityQueueKey = key;
    var labelEl = document.createElement('strong');
    labelEl.textContent = label;
    var statusEl = document.createElement('span');
    statusEl.dataset.activityRole = 'queue-status';
    button.appendChild(labelEl);
    button.appendChild(statusEl);
    syncQueueStatus(button, label, key, queue);
    return button;
  }

  function syncQueueStatus(button, label, key, queue) {
    button.querySelector('[data-activity-role="queue-status"]').textContent = queueText(queue, key !== 'training');
    button.disabled = false;
    button.title = '';
    button.onclick = null;
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
  }

  function createQueueStatusBar(queues) {
    var row = document.createElement('div');
    row.className = 'activity-monitor-queue-status-bar';
    row.appendChild(createQueueStatus('Inference', 'inference', queues.inference));
    row.appendChild(createQueueStatus('Training', 'training', queues.training));
    row.appendChild(createQueueStatus('Director', 'director', queues.director));
    return row;
  }

  function syncQueueStatusBar(row, queues) {
    [['Inference', 'inference'], ['Training', 'training'], ['Director', 'director']].forEach(function (entry) {
      var button = row.querySelector('[data-activity-queue-key="' + entry[1] + '"]');
      syncQueueStatus(button, entry[0], entry[1], queues[entry[1]]);
    });
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
    var list = document.createElement('div');
    list.className = 'activity-monitor-director-queue';
    syncDirectorQueueList(list, queue);
    return list;
  }

  function syncDirectorQueueList(list, queue) {
    queue = queue || {};
    var jobs = Array.isArray(queue.jobs) ? queue.jobs : [];
    var existing = Object.create(null);
    Array.prototype.forEach.call(list.children, function (row) {
      var key = String(row.dataset.activityDirectorJobId || '');
      if (key) existing[key] = row;
    });
    var desired = [];
    jobs.forEach(function (job, index) {
      var key = String(job.id || job.jobId || '');
      var row = existing[key];
      if (!row) {
        row = document.createElement('div');
        row.className = 'activity-monitor-director-queue-row';
        row.dataset.activityDirectorJobId = key;
        var position = document.createElement('span');
        position.className = 'activity-monitor-director-queue-position';
        position.dataset.activityRole = 'position';
        var copy = document.createElement('div');
        copy.className = 'activity-monitor-director-queue-copy';
        var title = document.createElement('strong');
        title.dataset.activityRole = 'title';
        var detail = document.createElement('small');
        detail.dataset.activityRole = 'detail';
        copy.appendChild(title);
        copy.appendChild(detail);
        row.appendChild(position);
        row.appendChild(copy);
      }
      row.querySelector('[data-activity-role="position"]').textContent =
        '#' + String(Number(job.queuePosition || index + 1));
      row.querySelector('[data-activity-role="title"]').textContent =
        directorQueueClientLabel(job) + ' · ' + directorQueueOperationLabel(job);
      var parts = [];
      if (job.sceneId) parts.push('Scene ' + String(job.sceneId));
      if (job.modelId) parts.push(String(job.modelId));
      row.querySelector('[data-activity-role="detail"]').textContent = parts.join(' · ') || 'Waiting';
      desired.push(row);
      delete existing[key];
    });
    desired.forEach(function (row, index) {
      var current = list.children[index];
      if (current !== row) list.insertBefore(row, current || null);
    });
    Object.keys(existing).forEach(function (key) { existing[key].remove(); });
  }

  function appendSection(host, key, titleText, noteText) {
    var section = null;
    Array.prototype.some.call(host.children, function (child) {
      if (String(child.dataset.activitySectionKey || '') !== key) return false;
      section = child;
      return true;
    });
    if (!section) {
      section = document.createElement('section');
      section.className = 'activity-monitor-section';
      section.dataset.activitySectionKey = key;
      var heading = document.createElement('div');
      heading.className = 'activity-monitor-section-heading';
      var title = document.createElement('strong');
      title.dataset.activityRole = 'section-title';
      var note = document.createElement('span');
      note.dataset.activityRole = 'section-note';
      heading.appendChild(title);
      heading.appendChild(note);
      var content = document.createElement('div');
      content.dataset.activityRole = 'section-content';
      section.appendChild(heading);
      section.appendChild(content);
      host.appendChild(section);
    }
    section.querySelector('[data-activity-role="section-title"]').textContent = titleText;
    section.querySelector('[data-activity-role="section-note"]').textContent = noteText || '';
    return section;
  }

  function reconcileKeyedItems(host, items, keyFor, create, sync, emptyText) {
    var existing = Object.create(null);
    Array.prototype.forEach.call(host.children, function (node) {
      var key = String(node.dataset.activityItemKey || '');
      if (key) existing[key] = node;
    });
    var desired = [];
    if (!items.length) {
      var empty = existing.empty;
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'activity-monitor-empty';
        empty.dataset.activityItemKey = 'empty';
      }
      empty.textContent = emptyText;
      desired.push(empty);
      delete existing.empty;
    } else {
      items.forEach(function (item) {
        var key = keyFor(item);
        var node = existing[key] || create(item);
        node.dataset.activityItemKey = key;
        sync(node, item);
        desired.push(node);
        delete existing[key];
      });
    }
    desired.forEach(function (node, index) {
      var current = host.children[index];
      if (current !== node) host.insertBefore(node, current || null);
    });
    Object.keys(existing).forEach(function (key) { existing[key].remove(); });
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
  }

  function render() {
    var active = Array.isArray(state.payload.active) ? state.payload.active : [];
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

    var nowSection = appendSection(host, 'now', 'Now', active.length ? String(active.length) + ' active' : '');
    reconcileKeyedItems(
      nowSection.querySelector('[data-activity-role="section-content"]'),
      active,
      function (item) { return String(item.lane || item.kind || '') + ':' + String(item.id || ''); },
      createActiveCard,
      syncActiveCard,
      'Nothing is running right now.'
    );

    var recentItems = recent.slice(0, 12);
    var recentSection = appendSection(host, 'recent', 'Recent', unseen ? String(unseen) + ' new' : '');
    reconcileKeyedItems(
      recentSection.querySelector('[data-activity-role="section-content"]'),
      recentItems,
      recentKey,
      createRecentRow,
      syncRecentRow,
      'No recent managed work.'
    );

    var queueSection = appendSection(host, 'queue', 'Queue Status', '');
    queueSection.classList.add('activity-monitor-queue-section');
    var queueContent = queueSection.querySelector('[data-activity-role="section-content"]');
    var statusBar = queueContent.querySelector('[data-activity-queue-status-bar]');
    if (!statusBar) {
      statusBar = createQueueStatusBar(queues);
      statusBar.dataset.activityQueueStatusBar = '1';
      queueContent.appendChild(statusBar);
    } else {
      syncQueueStatusBar(statusBar, queues);
    }
    var directorList = queueContent.querySelector('[data-activity-director-queue]');
    var directorJobs = queues.director && Array.isArray(queues.director.jobs) ? queues.director.jobs : [];
    if (directorJobs.length) {
      if (!directorList) {
        directorList = createDirectorQueueList(queues.director);
        directorList.dataset.activityDirectorQueue = '1';
        queueContent.appendChild(directorList);
      } else {
        syncDirectorQueueList(directorList, queues.director);
      }
    } else if (directorList) {
      directorList.remove();
    }

    ['now', 'recent', 'queue'].forEach(function (key, index) {
      var section = null;
      Array.prototype.some.call(host.children, function (child) {
        if (String(child.dataset.activitySectionKey || '') !== key) return false;
        section = child;
        return true;
      });
      if (section && host.children[index] !== section) host.insertBefore(section, host.children[index] || null);
    });
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

  window.recordActivityCompletion = rememberRecentCompletion;
  window.setActivityDrawerOpen = setOpen;
  window.refreshActivityMonitor = wake;
  bind();
  wake();
})();
