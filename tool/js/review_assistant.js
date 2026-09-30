(function () {
  var activeJobId = '';
  var DEFAULT_REVIEW_INSTRUCTION = 'Perform a full read-only review of this caption set. Focus on consistency, semantic coverage, balance, repetition, annotation hygiene, outliers, and noisy training signals.';

  function el(id) {
    return document.getElementById(id);
  }

  function requestJson(url, options) {
    return fetch(url, options || {}).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok === false) {
          throw new Error(payload && payload.error ? payload.error : (response.statusText || 'Request failed'));
        }
        return payload;
      });
    });
  }

  function reviewWorkspaceAvailable() {
    var workspace = el('review-output-surface');
    if (!workspace || workspace.classList.contains('hidden')) return false;
    var availability = getReviewAvailability();
    return !!(availability && availability.enabled);
  }

  function jobRequest(jobId) {
    return requestJson('/fs/director/job?job=' + encodeURIComponent(jobId) + '&consume=1').then(function (payload) {
      if (!payload.job) throw new Error('Review Dataset job response is missing its job.');
      return payload.job;
    });
  }

  function waitForJob(job) {
    if (!job || !job.jobId) throw new Error('Review Dataset did not return a queued job.');
    activeJobId = String(job.jobId);

    function poll(current) {
      var status = String(current && current.status || '');
      if (status === 'completed') return current;
      if (['failed', 'cancelled', 'stopped', 'interrupted'].indexOf(status) !== -1) {
        var error = new Error(current.error || ('Review Dataset job ' + status + '.'));
        error.jobStatus = status;
        throw error;
      }
      var delay = status === 'queued' ? 2000 : 1000;
      return new Promise(function (resolve) { setTimeout(resolve, delay); })
        .then(function () { return jobRequest(activeJobId); })
        .then(poll);
    }

    return poll(job).then(function (finished) {
      activeJobId = '';
      return finished;
    }, function (err) {
      activeJobId = '';
      throw err;
    });
  }

  function runReviewDataset(request) {
    var availability = getReviewAvailability();
    if (!availability.enabled) return Promise.reject(new Error(availability.message || 'Review Dataset is unavailable.'));

    var items = getVisibleReviewItems();
    var files = items.map(function (item) { return String(item && item.fileName || '').trim(); }).filter(Boolean);
    if (!files.length) return Promise.reject(new Error('Review Dataset requires at least one visible media file.'));

    return requestJson('/fs/review/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folder: state.folder,
        files: files,
        instruction: String(request && request.instruction || '').trim(),
        directorModel: String(request && request.modelId || '').trim()
      })
    }).then(function (payload) {
      return waitForJob(payload.job);
    }).then(function (job) {
      var result = job && job.result && typeof job.result === 'object' ? job.result : {};
      if (!String(result.text || '').trim()) throw new Error('Review Dataset returned an empty report.');
      return { text: String(result.text) };
    });
  }

  function cancelReviewDataset() {
    if (!activeJobId) return Promise.resolve();
    return requestJson('/fs/director/job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'stop_or_cancel',
        jobId: activeJobId
      })
    });
  }

  window.registerAssistantMode({
    id: 'review-dataset',
    label: 'Review Dataset',
    description: 'Read-only analysis of the current visible caption set. Captions are never changed.',
    placeholder: 'What should the caption-set review focus on?',
    successMessage: 'Dataset caption review completed.',
    presets: [
      {
        label: 'Full review',
        title: 'Audit the whole visible caption set for useful corpus-level issues',
        instruction: DEFAULT_REVIEW_INSTRUCTION
      },
      {
        label: 'Consistency',
        title: 'Focus on naming drift, recurring attribute consistency, and inconsistent granularity',
        instruction: 'Review this caption set for consistency problems: stable identity terms, naming drift, contradictions, synonym drift, and inconsistent descriptive granularity. Do not rewrite captions.'
      },
      {
        label: 'Balance',
        title: 'Focus on recurring semantic dimensions and concrete skews in the caption corpus',
        instruction: 'Review this caption set for concrete balance and coverage skews inside semantic dimensions that are actually present. Identify dominant and sparse recurring modes without inventing categories. Do not rewrite captions.'
      },
      {
        label: 'Outliers',
        title: 'Focus on unusual captions, missing captions, copy/paste residue, and annotation hygiene',
        instruction: 'Review this caption set for outliers and annotation hygiene problems: missing captions, unusual wording, suspicious one-off terminology, exact or near-template repetition, formatting artifacts, and unusually short or long captions. Do not rewrite captions.'
      }
    ],
    available: reviewWorkspaceAvailable,
    execute: runReviewDataset,
    cancel: cancelReviewDataset
  });

  var button = el('review-output-assistant-btn');
  if (!button) throw new Error('Review Dataset Assistant button is missing.');

  button.onclick = function () {
    var availability = getReviewAvailability();
    if (!availability.enabled) {
      setStatus(availability.message + '.');
      return;
    }
    window.openAssistant({
      mode: 'review-dataset',
      instruction: DEFAULT_REVIEW_INSTRUCTION
    });
  };
})();
