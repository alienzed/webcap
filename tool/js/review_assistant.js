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

  function buildReviewCorpus(items) {
    return (items || []).map(function (item) {
      var key = item && (item.key || item.fileName);
      var grouped = getChecklistAssignmentEntriesForMediaKey(key);
      var groupedText = grouped.map(function (entry) {
        return String(entry.requirement || '') + ': ' + String(entry.term || '');
      }).filter(Boolean);
      var allTags = getTagsForMediaKey(key);
      return [
        'FILE: ' + String(item && item.fileName || ''),
        'CAPTION: ' + String(item && item.caption || ''),
        groupedText.length ? 'GROUPED TAGS: ' + groupedText.join(' | ') : '',
        allTags.length ? 'ALL TAGS: ' + allTags.join(', ') : ''
      ].filter(Boolean).join('\n');
    }).join('\n\n');
  }

  function buildPrompt(instruction) {
    var items = window.getQaTrainingItemsForAssistant();
    var trainingFocus = String(window.getQaTrainingFocus() || '').trim();
    return [
      'You are reviewing one WebCap training Set. This is analysis only: do not rewrite captions.',
      '',
      'The goal is training quality. Prioritize issues that could weaken learning, create accidental associations, dilute useful variation, or make a concept too sparse to learn reliably.',
      'Treat underrepresentation and overrepresentation differently. A rare concept may fail to train; a common concept is only concerning when it crowds out useful variation or creates an unintended association.',
      '',
      'Review the supplied training selection as a set, not one item at a time. Use captions and annotation tags together. Look for:',
      '- training-relevant underrepresented concepts',
      '- overrepresented patterns that may crowd out desired variation',
      '- inconsistent subject/identity wording, attributes, terminology, or descriptive granularity',
      '- near-universal tag/group relationships with suspicious exceptions',
      '- repeated/template-like captions, copy/paste residue, suspicious one-off wording, or outliers',
      '- recurring patterns that may create noisy or misleading training associations',
      '- useful groups of filenames that deserve inspection together',
      '',
      'Be evidence-based. Do not invent desired categories. Rare terms are not automatically problems. Mention filenames when useful.',
      '',
      'Training focus: ' + (trainingFocus || 'Not specified; use generic training-quality priorities.'),
      'User focus: ' + String(instruction || 'Give me a concise full review.'),
      '',
      'TRAINING SELECTION',
      buildReviewCorpus(items)
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
    description: 'Read-only analysis of the current training selection.',
    placeholder: 'What should the review focus on?',
    presets: [
      {
        label: 'Full review',
        title: 'Review the current training selection across useful training-quality signals',
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
      var surface = document.getElementById('review-output-surface');
      return !!surface && !surface.classList.contains('hidden');
    },
    execute: runReview,
    cancel: cancelReview
  });

  function bindReviewAssistantButton() {
    var button = document.getElementById('review-output-assistant-btn');
    if (!button) throw new Error('QA Deep Scan button is missing.');
    button.onclick = function () {
      window.openAssistant({ mode: 'review-dataset' });
    };
  }

  window.bindReviewAssistantButton = bindReviewAssistantButton;
})();
