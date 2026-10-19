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
    progressChildIds: Object.create(null),
    dismissedJobs: Object.create(null),
    selectedJobKey: '',
    detailsOpen: false,
    systemHistory: [],
    lastSystemSampleAt: 0,
    autoOpenSeen: Object.create(null)
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
      byKey[recentIdentity(item)] = Object.assign({}, item);
    });
    state.recentCompletions = Object.keys(byKey).map(function (key) {
      return byKey[key];
    }).sort(function (a, b) {
      return finishedAt(b) - finishedAt(a);
    }).slice(0, 50);
  }

  function publishProgress(snapshot) {
    if (!snapshot || !snapshot.id) throw new Error('Activity progress requires a stable ID.');
    state.localProgress[String(snapshot.id)] = Object.assign({}, snapshot);
    if (snapshot.childJobId) {
      state.progressChildIds[String(snapshot.childJobId)] = { owner: String(snapshot.id), expiresAt: 0 };
    }
    if (state.open) render();
    else { maybeAutoOpen(); render(); }
  }

  function finishProgress(id, status) {
    var item = state.localProgress[String(id || '')];
    if (!item) return;
    delete state.localProgress[String(id)];
    // Keep terminal child jobs suppressed until their recent receipts are seen.
    // Running parents retain their child IDs regardless of execution duration.
    Object.keys(state.progressChildIds).forEach(function (childId) {
      var child = state.progressChildIds[childId];
      if (child.owner === String(id)) child.expiresAt = Date.now() + 120000;
    });
    if (status === 'failed') {
      window.reportConsoleError('Activity', item.title + ' failed. See Diagnostics and Console.');
    }
    render();
  }

  function localItems() {
    return Object.keys(state.localProgress).map(function (id) { return state.localProgress[id]; });
  }

  function pruneProgressChildren() {
    var now = Date.now();
    Object.keys(state.progressChildIds).forEach(function (id) {
      var child = state.progressChildIds[id];
      if (child.expiresAt && child.expiresAt <= now) delete state.progressChildIds[id];
    });
  }

  function isProgressChild(item) {
    var id = String(item && item.id || '');
    return !!id && !!state.progressChildIds[id];
  }

  function directorFollowerSnapshot(item) {
    if (item.kind !== 'director' || item.lane !== 'llm') return null;
    return {
      id: 'managed:director:' + String(item.id),
      kind: 'director',
      title: activityTitle(item),
      status: item.status,
      detail: activityDetail(item),
      startedAt: item.startedAt || item.createdAt,
      original: item,
      phase: (isRemoteDirector(item) ? 'Remote · ' : 'Local · ') + (item.revisionProgress && item.revisionProgress.total ? 'Revising Scene ' + (Number(item.revisionProgress.completed || 0) + 1) + ' of ' + item.revisionProgress.total : String(item.runtimePhase || item.status || 'queued')),
      progress: item.revisionProgress && item.revisionProgress.total ? item.revisionProgress : null,
      progressLabel: item.revisionProgress && item.revisionProgress.total ? String(item.revisionProgress.completed || 0) + ' scenes complete' : '',
      liveTokens: item.liveTokens,
      promptTokensLive: item.promptTokensLive,
      promptProcessed: item.promptProcessed,
      contextSize: item.contextSize,
      outputLimit: item.outputLimit,
      promptTokens: item.promptTokens,
      outputTokens: item.outputTokens,
      queuePosition: item.queuePosition,
      finishReason: item.finishReason
    };
  }

  function firstCutProgressSnapshot(item) {
    var scenePhase = ['Refining Scenes', 'Queuing First Takes'].indexOf(item.phase) !== -1;
    return {
      id: item.id, kind: 'first-cut', title: 'Storyboard · First Cut',
      status: item.status, phase: (isRemoteDirector(item) ? 'Remote · ' : '') + String(item.phase || item.status || ''),
      detail: scenePhase && item.sceneCount ? 'Scene ' + (Number(item.sceneCompleted || 0) + 1) + ' of ' + item.sceneCount : String(item.detail || ''),
      startedAt: item.startedAt,
      progressLabel: item.stageIndex >= 0 ? 'Stage ' + (item.stageIndex + 1) + ' of ' + item.stageCount : String(item.status || ''),
      progress: scenePhase && item.sceneCount ? { completed: item.sceneCompleted, total: item.sceneCount } : null,
      original: item,
      liveTokens: item.liveTokens,
      promptTokensLive: item.promptTokensLive,
      promptProcessed: item.promptProcessed,
      contextSize: item.contextSize,
      outputLimit: item.outputLimit
    };
  }

  function currentActivityItems() {
    return (Array.isArray(state.payload.active) ? state.payload.active : [])
      .filter(function (item) { return !isProgressChild(item); })
      .concat(localItems());
  }

  function activityLane(item) {
    return String(item && (item.lane || item.kind) || 'background');
  }

  function activityJobKey(item) {
    return activityLane(item) + ':' + String(item && item.id || '');
  }

  function currentPrimaryItem() {
    var items = currentActivityItems();
    var selected = items.find(function (item) { return activityJobKey(item) === state.selectedJobKey; });
    if (selected) return selected;
    var owner = String(state.payload.gpuOwner || '');
    if (owner && owner !== 'none') {
      var matching = items.filter(function (item) { return activityLane(item) === owner; });
      if (matching.length) return matching[0];
    }
    return items.length ? items[items.length - 1] : null;
  }

  function isRemoteDirector(item) {
    if (!item || (item.kind !== 'director' && item.kind !== 'first-cut')) return false;
    var model = String(item.modelId || '');
    var runtimeId = model.indexOf('::') > 0 ? model.split('::', 1)[0] : 'local';
    return item.runtimeMode === 'remote' || runtimeId !== 'local';
  }

  function isLocalGpuActivity(item) {
    if (!item) return false;
    if (item.lane === 'training' || item.lane === 'inference') return true;
    return (item.kind === 'first-cut' || (item.kind === 'director' && item.lane === 'llm')) &&
      !isRemoteDirector(item);
  }

  function featuredActivityItems(active, primary) {
    if (!primary) return [];
    var featured = [primary];
    var local = active.find(isLocalGpuActivity);
    var remote = active.find(isRemoteDirector);
    // Promote only a genuine simultaneous local/remote pair; other jobs stay in details.
    if (local && remote) {
      [local, remote].forEach(function (item) {
        if (!featured.some(function (shown) { return activityJobKey(shown) === activityJobKey(item); })) {
          featured.push(item);
        }
      });
    }
    return featured;
  }

  function itemProgress(item) {
    return (item.kind === 'first-cut' ? firstCutProgressSnapshot(item) : null) || managedProgressSnapshot(item) || directorFollowerSnapshot(item) || item;
  }

  function itemOpen(item) {
    if (item.original) return openItem(item.original);
    if (item.kind === 'first-cut') return openItem(item);
    if (item.kind === 'test-batch') return openItem(item);
    if (item.kind === 'model-lab') return window.openDiagnosticsModal('assessment');
    if (item.kind === 'director-diagnostics') return window.openDiagnosticsModal(item.title === 'Director Benchmark' ? 'benchmark' : 'models');
    if (item.kind === 'set-intelligence') return window.openSetIntelligence();
    if (item.kind === 'deep-qa' || item.kind === 'qa-concept-check') {
      window.setWorkspaceSurface('reviewOutput');
      return window.setReviewDetailTab('qa');
    }
    if (item.kind !== 'vocabulary-discovery' && item.kind !== 'vision-tag-assist') return openItem(item);
  }

  function maybeAutoOpen() {
    var competingDrawer = ['director-chat-drawer'].concat(window.isOperationsDrawerMounted ? [] : ['inference-queue-drawer']).some(function (id) {
      var drawer = el(id);
      return drawer && !drawer.classList.contains('hidden');
    });
    currentActivityItems().forEach(function (item) {
      var lane = activityLane(item);
      var id = activityJobKey(item);
      if (state.autoOpenSeen[id]) return;
      state.autoOpenSeen[id] = true;
      // Never displace a workflow drawer for an automatically raised Activity panel.
      var shortInteractive = lane === 'llm' || item.kind === 'first-cut' || item.kind === 'director-diagnostics';
      if (!(window.isOperationsDrawerMounted && window.isOperationsDrawerVisible()) && !state.open && !competingDrawer && shortInteractive && !state.dismissedJobs[id]) {
        state.selectedJobKey = id;
        setOpen(true);
      }
    });
  }

  function updateSystemHistory(sample) {
    if (!sample || !sample.gpu || !sample.ram) return;
    var now = Date.now();
    if (now - state.lastSystemSampleAt < 1200) return;
    state.lastSystemSampleAt = now;
    var gpu = sample.gpu.available && Array.isArray(sample.gpu.gpus) ? sample.gpu.gpus[0] : null;
    var ram = sample.ram.available ? sample.ram : null;
    var ratio = function (a, b) {
      a = Number(a); b = Number(b);
      return isFinite(a) && isFinite(b) && b > 0 ? a / b * 100 : NaN;
    };
    state.systemHistory.push({
      time: now,
      ram: ram ? ratio(ram.used, ram.total) : NaN,
      vram: gpu ? ratio(gpu.memoryUsed, gpu.memoryTotal) : NaN,
      gpu: gpu && gpu.utilization != null ? Number(gpu.utilization) : NaN,
      thermal: gpu && gpu.temperature != null ? Number(gpu.temperature) : NaN
    });
    state.systemHistory = state.systemHistory.filter(function (p) { return p.time >= now - 60000; }).slice(-40);
    renderSystemTrend();
  }

  function renderSystemTrend() {
    var graph = el('activity-monitor-trend');
    if (!graph) return;
    var cutoff = Date.now() - 60000;
    state.systemHistory = state.systemHistory.filter(function (p) { return p.time >= cutoff; });
    var recent = state.systemHistory;
    var keys = { ram: 'ram', vram: 'vram', gpu: 'gpu', thermal: 'thermal' };
    Object.keys(keys).forEach(function (key) {
      var d = '';
      recent.forEach(function (p) {
        var value = p[key];
        if (!isFinite(value)) return;
        var x = Math.max(0, Math.min(120, (p.time - cutoff) / 60000 * 120));
        var y = 28 - Math.max(0, Math.min(100, value)) * .26;
        d += (d ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
      });
      graph.querySelector('.director-activity-trend-' + key + '-line').setAttribute('d', d);
    });
    graph.classList.toggle('is-unavailable', !recent.length);
    var latest = recent[recent.length - 1];
    graph.setAttribute('aria-label', latest
      ? 'Local system resource history. GPU ' + (isFinite(latest.gpu) ? Math.round(latest.gpu) + '%' : 'unavailable') +
        ', VRAM ' + (isFinite(latest.vram) ? Math.round(latest.vram) + '%' : 'unavailable') +
        ', RAM ' + (isFinite(latest.ram) ? Math.round(latest.ram) + '%' : 'unavailable')
      : 'Local system resource history unavailable');
  }

  function toggleProgressFollower() {
    if (window.isOperationsDrawerMounted) {
      if (window.isOperationsDrawerVisible()) window.selectOperationsSection('activity');
      else window.openOperationsDrawer('activity');
      return;
    }
    setOpen(!state.open, state.open ? true : 'manual-open');
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
      return finishedAt(item) > Math.max(state.lastSeen, sessionStartedAt);
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

  function formatJobDuration(start, end) {
    var a = Number(start);
    var b = Number(end);
    if (!isFinite(a) || !isFinite(b) || a <= 0 || b < a) return '';
    var seconds = Math.round(b - a);
    if (seconds < 60) return seconds + 's';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ' + String(seconds % 60) + 's';
    return Math.floor(seconds / 3600) + 'h ' + String(Math.floor(seconds % 3600 / 60)) + 'm';
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
    if (item.kind === 'model-lab') return 'Model Assessment';
    if (item.kind === 'first-cut') return 'Storyboard · First Cut';
    if (item.kind === 'test-batch') return 'Batch Test + VL';
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
    if (item.kind === 'test-batch') return 'Batch Test + VL';
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
    if (item.kind === 'model-lab') {
      if (item.modelCount) parts.push(item.modelCount + ' models');
      if (item.currentModelRef) parts.push(item.currentModelRef);
      if (item.currentKind) parts.push(item.currentKind.replace(/_/g, ' '));
      if (item.attemptCount) parts.push(item.attemptCount + ' probes recorded');
    } else if (item.kind === 'training') {
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
    if (['model-lab', 'training', 'storage', 'generate', 'test', 'storyboard'].indexOf(item.kind) === -1 ||
        (['generate', 'test', 'storyboard'].indexOf(item.kind) !== -1 && item.lane !== 'inference')) return null;
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
    if (item.kind === 'model-lab') {
      snapshot.title = 'Model Assessment';
      snapshot.detail = activityDetail(item);
      snapshot.phase = String(item.phase || item.status || 'running').replace(/_/g, ' ');
      var counts = ['attemptCount', 'completed', 'failed', 'skipped', 'interrupted'].map(function (key) {
        var value = Number(item[key]);
        return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
      });
      snapshot.progressLabel = counts[0] + ' probes recorded · ' +
        counts[1] + ' completed · ' + counts[2] + ' failed' +
        (counts[3] ? ' · ' + counts[3] + ' skipped' : '') +
        (counts[4] ? ' · ' + counts[4] + ' interrupted' : '');
      // Probe count is not a known total. An indeterminate bar is honest.
    } else if (item.kind === 'training') {
      var source = item.progress && typeof item.progress === 'object' ? item.progress : {};
      var stage = String(source.stage || item.stage || '').replace(/_/g, ' ');
      // The Training runner remains "starting" until its first step/epoch.
      // Before that, preserve an indeterminate bar rather than stale epoch data.
      if (item.status === 'starting') {
        if (stage === 'launch') {
          snapshot.phase = 'Starting';
        } else if (stage === 'caching') {
          snapshot.phase = 'Caching';
        } else {
          snapshot.phase = 'Loading model' + (stage && stage !== 'starting' ? ' · ' + stage : '');
          snapshot.progressLabel = 'Waiting for first training step';
        }
      } else {
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
      }
    } else if (item.kind === 'storage') {
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
    } else {
      var raw = item.progress && typeof item.progress === 'object' ? item.progress : {};
      snapshot.detail = activityDetail(item);
      snapshot.phase = item.status === 'stopping' ? 'Stopping' :
        (item.status === 'starting' ? 'Starting' : 'Generating');
      var steps = Number(raw.steps);
      var step = Number(raw.step);
      var percent = Number(raw.percent);
      if (raw.steps != null && raw.step != null && isFinite(steps) && steps > 0 &&
          isFinite(step) && step >= 0 && step <= steps) {
        snapshot.progress = { completed: step, total: steps };
        snapshot.progressLabel = Math.round(step) + ' / ' + Math.round(steps) + ' steps';
      } else if (raw.percent != null && isFinite(percent) && percent >= 0 && percent <= 100) {
        snapshot.progress = { completed: percent, total: 100 };
      }
      if (raw.percent != null && isFinite(percent) && percent >= 0 && percent <= 100) {
        snapshot.progressLabel += (snapshot.progressLabel ? ' · ' : '') + Math.round(percent) + '%';
      }
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
      takeId: String(item.takeId || ''),
      folder: String(item.folder || ''),
      sessionId: String(item.sessionId || ''),
      campaignId: String(item.campaignId || ''),
      storageId: String(item.storageId || ''),
      source: String(item.source || ''),
      modelId: String(item.modelId || '')
    };
    if (item.kind === 'model-lab') {
      window.openDiagnosticsModal('assessment');
      return;
    }
    if (item.kind === 'test-batch') {
      window.openTestBenchActivity({ folder: item.folder, modelId: item.modelId });
      return;
    }
    if ((item.kind === 'storyboard' || item.kind === 'first-cut') && typeof window.openStoryboardActivity === 'function') {
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

  function stopActivityItem(item) {
    if (!item || !item.id) return;
    var endpoint = item.kind === 'first-cut' ? '/fs/storyboard/first-cut' : '/fs/director/job';
    var payload = item.kind === 'first-cut'
      ? { operation: 'cancel', batchId: item.batchId }
      : { operation: 'cancel_job', jobId: item.id };
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body || body.ok === false) throw new Error(body && body.error || 'Could not stop Activity job.');
        return refresh();
      });
    }).catch(function (error) {
      window.reportConsoleError('Activity', error);
    });
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
    var duration = formatJobDuration(item.startedAt, item.finishedAt);
    var wait = formatJobDuration(item.createdAt, item.startedAt);
    var metadata = activityDetail(item);
    detail.textContent = [metadata, item.error ? 'Error: ' + item.error : '',
      duration ? 'Ran ' + duration : '', wait ? 'Queued ' + wait : ''].filter(Boolean).join(' · ')
      || String(item.status || '').replace(/_/g, ' ');
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
      if (isProgressChild(item)) {
        state.notified[recentKey(item)] = true;
        return;
      }
      var status = String(item.status || '');
      if (['completed', 'finished_early', 'failed', 'interrupted', 'stopped', 'cancelled'].indexOf(status) === -1) return;
      var key = recentKey(item);
      if (state.notified[key]) return;
      state.notified[key] = true;
      if (finishedAt(item) < sessionStartedAt) return;
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

  function syncActivityRailWork(active, unseen) {
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
    window.setShellManagedActivity(active, state.payload.gpuOwner, { open: state.open, unseen: unseen });
  }

  function syncFeaturedCard(card, item) {
    var snapshot = itemProgress(item);
    ProgressCard.update(card, snapshot, { onOpen: function () { itemOpen(snapshot); }, className: isRemoteDirector(item) ? 'activity-remote-card' : '' });
    // Keep a short, per-job in-memory token history. No new network polling.
    var existingStats = card.querySelector('[data-director-live-stats]');
    var directorJob = (snapshot.kind === 'director' || snapshot.kind === 'first-cut') && snapshot.original;
    var generated = directorJob && directorJob.liveTokens != null ? Number(directorJob.liveTokens) : NaN;
    if (directorJob) {
      var labels = [];
      if (Number(directorJob.queuePosition) > 0 && snapshot.status === 'queued') labels.push('Queue #' + directorJob.queuePosition);
      if (Number(directorJob.promptTokensLive || directorJob.promptTokens) > 0) labels.push('Prompt ' + Number(directorJob.promptTokensLive || directorJob.promptTokens).toLocaleString() + ' tokens');
      if (Number(directorJob.outputTokens) > 0) labels.push('Output ' + Number(directorJob.outputTokens).toLocaleString() + ' tokens');
      if (directorJob.finishReason) labels.push('Finish: ' + directorJob.finishReason);
      snapshot.progressLabel = labels.join(' · ');
      ProgressCard.update(card, snapshot, { onOpen: function () { itemOpen(snapshot); }, className: isRemoteDirector(item) ? 'activity-remote-card' : '' });
    }
    if (directorJob && !isRemoteDirector(item) && Number.isFinite(generated) && generated >= 0) {
      if (!existingStats) {
        existingStats = document.createElement('div');
        existingStats.className = 'activity-director-live-stats';
        existingStats.setAttribute('data-director-live-stats', '');
        card.querySelector('[data-progress-copy]').appendChild(existingStats);
        var metrics = document.createElement('div');
        metrics.className = 'activity-director-metrics';
        existingStats.appendChild(metrics);
        var heading = document.createElement('strong');
        heading.textContent = 'Live token throughput';
        existingStats.appendChild(heading);
        var graph = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        graph.setAttribute('viewBox', '0 0 300 90');
        graph.setAttribute('preserveAspectRatio', 'none');
        graph.setAttribute('role', 'img');
        graph.setAttribute('aria-label', 'Live token generation rate');
        var plot = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        plot.setAttribute('fill', 'none');
        plot.setAttribute('stroke', 'currentColor');
        plot.setAttribute('stroke-width', '3');
        graph.appendChild(plot);
        existingStats.appendChild(graph);
      }
      var key = activityJobKey(directorJob);
      if (!state.directorSamples) state.directorSamples = Object.create(null);
      var samples = state.directorSamples[key] || (state.directorSamples[key] = []);
      var now = Date.now();
      var previous = samples[samples.length - 1];
      // First Cut starts a new LLM request at each stage; token counters reset.
      if (previous && generated < previous.tokens) {
        samples.length = 0;
        previous = null;
      }
      if (!previous || generated !== previous.tokens) {
        samples.push({ time: now, tokens: generated });
        if (samples.length > 30) samples.shift();
      }
      var latest = samples[samples.length - 1];
      var priorSample = samples.length > 1 ? samples[samples.length - 2] : null;
      var rate = priorSample && latest.tokens >= priorSample.tokens && latest.time > priorSample.time
        ? (latest.tokens - priorSample.tokens) * 1000 / (latest.time - priorSample.time) : null;
      var metricsNode = existingStats.querySelector('.activity-director-metrics');
      metricsNode.replaceChildren();
      [
        [generated.toLocaleString(), 'Tokens generated'],
        [rate != null ? rate.toFixed(1) : '—', 'Tokens/sec'],
        [directorJob.contextSize ? Number(directorJob.contextSize).toLocaleString() : '—', 'Context window']
      ].forEach(function (metric) {
        var tile = document.createElement('div');
        var value = document.createElement('b');
        value.textContent = metric[0];
        var label = document.createElement('small');
        label.textContent = metric[1];
        tile.appendChild(value);
        tile.appendChild(label);
        metricsNode.appendChild(tile);
      });
      var speeds = samples.slice(1).map(function (sample, i) {
        var prior = samples[i];
        return Math.max(0, (sample.tokens - prior.tokens) * 1000 / Math.max(1, sample.time - prior.time));
      });
      var maximum = Math.max(1, ...speeds);
      var points = speeds.map(function (speed, i) {
        return (speeds.length === 1 ? 150 : i * 300 / (speeds.length - 1)).toFixed(1) + ',' +
          (85 - speed / maximum * 75).toFixed(1);
      });
      existingStats.querySelector('polyline').setAttribute('points', points.join(' '));
      existingStats.querySelector('svg').setAttribute('aria-label',
        speeds.length ? 'Recent token throughput samples' : 'Waiting for another token sample');
    } else if (existingStats) existingStats.remove();
    var stopButton = card.querySelector('[data-activity-stop]');
    var stoppable = (item.kind === 'first-cut' || item.kind === 'director' && item.lane === 'llm') &&
      ['running', 'starting', 'queued'].indexOf(item.status) !== -1;
    if (stoppable && !stopButton) {
      stopButton = document.createElement('button');
      stopButton.type = 'button';
      stopButton.className = 'activity-monitor-open';
      stopButton.setAttribute('data-activity-stop', '');
      card.appendChild(stopButton);
    }
    if (stopButton) {
      stopButton.hidden = !stoppable;
      stopButton.textContent = 'Stop';
      stopButton.onclick = stoppable ? function () {
        stopButton.disabled = true;
        stopButton.textContent = 'Stopping…';
        stopActivityItem(item).finally(function () { stopButton.disabled = false; });
      } : null;
    }
  }

  function renderFeaturedCards(host, featured) {
    var existing = Object.create(null);
    Array.prototype.forEach.call(host.querySelectorAll('[data-progress-card-id]'), function (card) {
      existing[card.getAttribute('data-progress-card-id')] = card;
    });
    var retained = Object.create(null);
    var cards = featured.map(function (item) {
      var key = String(itemProgress(item).id);
      var card = existing[key] || ProgressCard.create();
      syncFeaturedCard(card, item);
      retained[key] = true;
      return card;
    });
    Object.keys(existing).forEach(function (key) {
      if (!retained[key]) existing[key].remove();
    });
    // Poll updates preserve interactive DOM positions unless the visible job order changes.
    var mounted = Array.prototype.map.call(host.querySelectorAll('[data-progress-card-id]'), function (card) {
      return card.getAttribute('data-progress-card-id');
    });
    var ordered = cards.map(function (card) { return card.getAttribute('data-progress-card-id'); });
    if (mounted.join('\n') !== ordered.join('\n')) {
      cards.forEach(function (card) { host.appendChild(card); });
    }
    // One chart, owned by the local job. Never attach machine telemetry to remote work.
    var graph = el('activity-monitor-trend');
    var localIndex = featured.findIndex(isLocalGpuActivity);
    if (localIndex >= 0) {
      if (graph.previousElementSibling !== cards[localIndex]) cards[localIndex].after(graph);
    } else if (graph.parentElement !== host || graph !== host.lastElementChild) {
      host.appendChild(graph);
    }
    graph.classList.toggle('hidden', localIndex < 0);
  }

  function render() {
    var active = currentActivityItems();
    var pendingItems = window.isOperationsDrawerMounted ? [] : [].concat((state.payload.queues.inference || {}).jobs || [], (state.payload.queues.director || {}).jobs || []);
    var recent = sessionRecent();
    var queues = state.payload.queues || {};
    if (window.isOperationsDrawerMounted) {
      var waitingCount = ['inference', 'director', 'training'].reduce(function (sum, key) {
        var q = queues[key] || {};
        return sum + Number(q.queued || 0) + Number(q.backlog || 0);
      }, 0);
      window.updateOperationsCounts(active.length, waitingCount, recent.length);
    }
    var drawer = el('activity-monitor-drawer');
    var host = el('activity-monitor-list');
    var summary = el('activity-monitor-summary');
    if (!drawer || !host || !summary) throw new Error('Activity panel markup missing.');

    var primary = currentPrimaryItem();
    var featured = window.isOperationsDrawerMounted ? (primary ? [primary].concat(active.filter(function (item) { return activityJobKey(item) !== activityJobKey(primary); })) : []) : featuredActivityItems(active, primary);
    var primaryHost = el('activity-monitor-primary');
    var primaryQueue = el('activity-monitor-primary-queue');
    var details = el('activity-monitor-details');
    var detailsToggle = el('activity-monitor-details-toggle');
    var detailsCount = el('activity-monitor-details-count');
    if (!primaryHost || !primaryQueue || !details || !detailsToggle || !detailsCount) throw new Error('Activity panel markup missing.');
    if (state.open && !window.isOperationsDrawerMounted && !active.length && !pendingItems.length && !recent.length) {
      state.open = false;
      storeLastSeen(Date.now() / 1000);
    }
    var detailsVisible = window.isOperationsDrawerMounted ? window.operationsSectionIsHistory() : (state.detailsOpen || (!primary && (pendingItems.length || recent.length)));
    drawer.classList.toggle('hidden', !state.open);
    details.classList.toggle('hidden', !detailsVisible);
    detailsToggle.setAttribute('aria-expanded', detailsVisible ? 'true' : 'false');
    var otherCount = active.length - featured.length + pendingItems.length + recent.length;
    detailsCount.textContent = '(' + String(otherCount) + ')';
    detailsToggle.classList.toggle('hidden', !primary || otherCount === 0);
    drawer.setAttribute('aria-hidden', state.open ? 'false' : 'true');
    var unseen = unseenCount();
    syncActivityRailWork(active, unseen);
    summary.textContent = active.length
      ? String(active.length) + ' active · ' + (unseen ? String(unseen) + ' new' : 'up to date')
      : (unseen ? String(unseen) + ' new' : String(recent.length) + ' recent jobs');

    renderFeaturedCards(primaryHost, featured);
    if (primary) {
      var queueKey = activityLane(primary) === 'llm' ? 'director' : activityLane(primary);
      var queue = queues[queueKey] || {};
      var waiting = Number(queue.queued || 0);
      var backlog = Number(queue.backlog || 0);
      var nextJob = Array.isArray(queue.jobs) ? queue.jobs[0] : null;
      var queueLabel = queueKey === 'director' ? 'Director' : queueKey === 'inference' ? 'Inference' : 'Training';
      var queueParts = [];
      if (waiting) queueParts.push(String(waiting) + ' waiting');
      if (nextJob) queueParts.push('Next: ' + activityTitle(nextJob));
      if (backlog) queueParts.push(String(backlog) + ' backlog');
      if (queue.paused) queueParts.push('paused');
      primaryQueue.textContent = queueParts.length ? queueLabel + ' queue · ' + queueParts.join(' · ') : '';
    } else {
      primaryQueue.textContent = '';
    }
    renderSystemTrend();

    var nowSection = ensureActivitySection(host, 'now', 'Other active', active.length > featured.length ? String(active.length - featured.length) + ' active' : '');
    var featuredKeys = featured.map(activityJobKey);
    var otherActive = active.filter(function (item) { return featuredKeys.indexOf(activityJobKey(item)) === -1; });
    nowSection.classList.toggle('hidden', window.isOperationsDrawerMounted || !otherActive.length);
    var existingActive = Object.create(null);
    Array.prototype.forEach.call(nowSection.querySelectorAll('[data-activity-active-line]'), function (row) {
      existingActive[row.getAttribute('data-activity-active-line')] = row;
    });
    var nowRows = otherActive.map(function (item) {
      var key = activeCardKey(item);
      var row = existingActive[key];
      if (!row) {
        row = document.createElement('button');
        row.type = 'button';
        row.className = 'activity-monitor-pending-row';
        row.setAttribute('data-activity-active-line', key);
      }
      row.textContent = activityTitle(item) + ' · ' + String(item.status || 'running').replace(/_/g, ' ');
      row.title = activityDetail(item);
      row.onclick = function () { state.selectedJobKey = activityJobKey(item); render(); };
      return row;
    });
    reconcileActivityRows(nowSection, nowRows);

    var pendingSection = ensureActivitySection(host, 'pending', 'Queued', pendingItems.length ? String(pendingItems.length) + ' waiting' : '');
    pendingSection.classList.toggle('hidden', window.isOperationsDrawerMounted || !pendingItems.length);
    var existingPending = Object.create(null);
    Array.prototype.forEach.call(pendingSection.querySelectorAll('[data-activity-pending-key]'), function (node) {
      existingPending[node.getAttribute('data-activity-pending-key')] = node;
    });
    var pendingRows = pendingItems.map(function (job) {
      var key = activeCardKey(job);
      var button = existingPending[key];
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'activity-monitor-pending-row';
        button.setAttribute('data-activity-pending-key', key);
      }
      var label = activityTitle(job) + ' · queued';
      if (job.queuePosition) label += ' #' + String(job.queuePosition);
      button.textContent = label;
      button.title = activityDetail(job);
      button.onclick = function () { openItem(job); };
      return button;
    });
    reconcileActivityRows(pendingSection, pendingRows);

    var recentSection = ensureActivitySection(host, 'recent', 'Recent', unseen ? String(unseen) + ' new' : '');
    recentSection.classList.toggle('hidden', !recent.length);
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
      recent.slice(0, 50).forEach(function (item) {
        var key = recentKey(item);
        var row = existingRecent[key] || createRecentRow(item);
        row.setAttribute('data-activity-recent-key', key);
        row.querySelector('time').textContent = formatAge(finishedAt(item));
        recentRows.push(row);
      });
    }
    reconcileActivityRows(recentSection, recentRows);

    // Full queue controls remain in their owning workspaces; no hidden Queue Status redraw.
  }

  function refresh() {
    if (state.pending) return state.pendingPromise || Promise.resolve(state.payload);
    state.pending = true;
    state.pendingPromise = requestJson('/fs/activity?limit=50').then(function (payload) {
      state.payload = payload;
      pruneProgressChildren();
      captureRecent(payload.recent);
      window.reconcileTrainingRunnerActivity(Array.isArray(payload.active) ? payload.active : []);
      if (state.open) window.refreshShellSystemStatus();
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
      maybeAutoOpen();
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

  function setOpen(open, manualClose, internal) {
    if (window.isOperationsDrawerMounted && !internal) {
      if (open) window.openOperationsDrawer('activity');
      else window.closeOperationsDrawer(manualClose);
      return;
    }
    var wasOpen = state.open;
    state.open = !!open;
    if (state.open) {
      // Reopening Activity does not reset per-job dismissal decisions.
      if (!wasOpen) state.openedAt = Date.now() / 1000;
      if (!internal && typeof window.setDirectorChatOpen === 'function') window.setDirectorChatOpen(false);
      if (!internal && typeof window.setInferenceQueueOpen === 'function') window.setInferenceQueueOpen(false);
    } else if (wasOpen) {
      if (manualClose) {
        var item = currentPrimaryItem();
        if (item) state.dismissedJobs[activityJobKey(item)] = true;
      }
      storeLastSeen(Date.now() / 1000);
      state.openedAt = 0;
    }
    render();
    wake();
  }

  function bind() {
    var close = el('activity-monitor-close');
    var drawer = el('activity-monitor-drawer');
    if (!close || !drawer) throw new Error('Activity panel controls missing.');
    close.onclick = function () { setOpen(false, true); };
    el('activity-monitor-details-toggle').onclick = function () { state.detailsOpen = !state.detailsOpen; render(); };
    document.addEventListener('pointerdown', function (event) {
      if (window.isOperationsDrawerMounted || !state.open || drawer.contains(event.target) ||
          event.target.closest('.shell-workload-indicator')) return;
      setOpen(false, true);
    });
    window.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && state.open && !window.isOperationsDrawerMounted) setOpen(false, true);
    });
    window.addEventListener('webcap:inference-queue-changed', wake);
  }

  window.toggleActivityProgressFollower = toggleProgressFollower;
  window.updateActivitySystemTelemetry = updateSystemHistory;
  window.publishActivityProgress = publishProgress;
  window.finishActivityProgress = finishProgress;
  window.recordActivityCompletion = rememberRecentCompletion;
  window.focusActivityJob = function (jobId) {
    var matching = currentActivityItems().find(function (item) { return item.kind === 'director' && String(item.id) === String(jobId); });
    if (matching) state.selectedJobKey = activityJobKey(matching);
    else state.selectedJobKey = 'llm:' + String(jobId || '');
    if (window.isOperationsDrawerMounted) window.selectOperationsSection('activity');
    else setOpen(true);
  };
  window.focusActivityByJob = function (jobId) {
    var matching = currentActivityItems().find(function (item) { return String(item.id) === String(jobId); });
    if (matching) state.selectedJobKey = activityJobKey(matching);
    if (window.isOperationsDrawerMounted) window.selectOperationsSection('activity');
    else setOpen(true);
  };
  window.setActivityDrawerOpen = setOpen;
  window.refreshActivityMonitor = wake;
  bind();
  wake();
})();
