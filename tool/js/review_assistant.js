(function () {
  var activeJobId = '';

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

  function waitForJob(job) {
    activeJobId = String(job.jobId || '');

    function poll(current) {
      var status = String(current.status || '');
      if (status === 'completed') return Promise.resolve(current);
      if (['failed', 'cancelled', 'stopped', 'interrupted'].indexOf(status) !== -1) {
        var error = new Error(current.error || ('Assistant job ' + status + '.'));
        error.jobStatus = status;
        throw error;
      }
      return new Promise(function (resolve) {
        setTimeout(resolve, status === 'queued' ? 2000 : 1000);
      }).then(function () {
        return requestJson('/fs/director/job?job=' + encodeURIComponent(activeJobId) + '&consume=1');
      }).then(function (payload) {
        return poll(payload.job);
      });
    }

    return poll(job).then(function (finished) {
      activeJobId = '';
      return finished;
    }, function (err) {
      activeJobId = '';
      throw err;
    });
  }

  function buildPrompt(instruction) {
    var items = getVisibleReviewItems();
    return [
      'You are reviewing one WebCap training Set. This is analysis only: do not rewrite captions.',
      '',
      'Review the supplied captions as a set, not one by one. Look for useful corpus-level issues a human may miss while scanning quickly:',
      '- inconsistent subject/identity wording, attributes, terminology, or descriptive granularity',
      '- meaningful coverage or balance skews in recurring concepts actually present in the captions',
      '- repeated/template-like captions, copy/paste residue, suspicious one-off wording, or outliers',
      '- missing captions and unusually sparse or verbose captions',
      '- recurring caption patterns that may create noisy or misleading training associations',
      '- useful groups of filenames that deserve inspection together',
      '',
      'Be evidence-based. Do not invent desired categories. Rare terms are not automatically problems. Mention filenames when useful.',
      '',
      'User focus: ' + String(instruction || 'Give me a concise full review.'),
      '',
      'CAPTIONS',
      buildCombinedCaptionsText(items)
    ].join('\n');
  }

  function runReview(request) {
    return requestJson('/fs/director/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: String(request.modelId || ''),
        messages: [{ role: 'user', content: buildPrompt(request.instruction) }]
      })
    }).then(function (payload) {
      return waitForJob(payload.job);
    }).then(function (job) {
      return { text: String(job.result && job.result.text || '') };
    });
  }

  function cancelReview() {
    return activeJobId ? resetLlmExecution() : Promise.resolve();
  }

  window.registerAssistantMode({
    id: 'review-dataset',
    label: 'Review Dataset',
    description: 'Read-only analysis of the current visible caption set.',
    placeholder: 'What should the review focus on?',
    presets: [
      {
        label: 'Full review',
        title: 'Review the visible caption set across all useful corpus-level signals',
        instruction: 'Give me a concise full review.'
      },
      {
        label: 'Consistency',
        title: 'Focus on naming drift, contradictions, terminology, and descriptive consistency',
        instruction: 'Focus on consistency: subject and identity wording, recurring attributes, terminology drift, contradictions, and inconsistent descriptive granularity.'
      },
      {
        label: 'Balance',
        title: 'Focus on meaningful coverage and balance skews in recurring caption concepts',
        instruction: 'Focus on coverage and balance: identify meaningful skews in recurring concepts that are actually present in the captions. Do not invent desired categories.'
      },
      {
        label: 'Outliers',
        title: 'Focus on unusual captions, repetition, missing captions, and annotation hygiene',
        instruction: 'Focus on outliers and annotation hygiene: repeated or template-like captions, copy/paste residue, suspicious one-off wording, missing captions, and unusually sparse or verbose captions.'
      }
    ],
    available: function () {
      return !document.getElementById('review-output-surface').classList.contains('hidden');
    },
    execute: runReview,
    cancel: cancelReview
  });

  document.getElementById('review-output-assistant-btn').onclick = function () {
    window.openAssistant({ mode: 'review-dataset' });
  };
})();
