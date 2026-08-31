// Training Review is the normal launch surface. It keeps the compact UI state
// in the existing folder state while the backend remains the source of truth
// for membership, safety checks, and TOML rendering.

function trainingReviewPayload() {
  var selected = getVisibleMediaSelectionForTraining();
  var fallback = buildTrainingFallbackCaptions(selected);
  var profile = getSelectedTrainingModelProfile();
  var selectedRun = getTrainingProfileRunForStage(profile, trainingWorkspaceState.runStages);
  var checkpoint = document.getElementById('training-run-checkpoint-select');
  return {
    folder: state.folder,
    profileId: profile ? profile.id : '',
    runId: selectedRun ? selectedRun.id : '',
    selected_media: selected,
    total_media_count: Array.isArray(state.items) ? state.items.length : 0,
    selection_criteria: buildTrainingSelectionCriteria(),
    fallback_captions: fallback.fallbackCaptions,
    resumeActionId: trainingWorkspaceState.reviewStartingPoint === 'resume' && checkpoint && checkpoint.selectedOptions && checkpoint.selectedOptions[0]
      ? String(checkpoint.selectedOptions[0].getAttribute('data-action-id') || '') : ''
  };
}

function trainingReviewRequest(path, payload) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (data) {
      if (!response.ok || data.ok === false) throw new Error(data.error || 'Training Review request failed.');
      return data;
    });
  });
}

function reviewInitializerStage() {
  if (trainingWorkspaceState.reviewInitializerStage) return trainingWorkspaceState.reviewInitializerStage;
  var stages = Object.keys((trainingWorkspaceState.review || {}).review && (trainingWorkspaceState.review || {}).review.stages || {});
  return stages.length === 1 ? stages[0] : (stages.indexOf('lo') !== -1 ? 'lo' : stages[0] || '');
}

function fetchTrainingReviewInitializers() {
  var profile = getSelectedTrainingModelProfile();
  var stage = reviewInitializerStage();
  if (!profile || !stage) return Promise.resolve([]);
  return fetch('/fs/training_initializers?folder=' + encodeURIComponent(state.folder) + '&profileId=' + encodeURIComponent(profile.id) + '&stage=' + encodeURIComponent(stage))
    .then(function (response) { return response.json().then(function (payload) { if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not load saved LoRAs.'); return payload.exports || []; }); })
    .then(function (exports) { trainingWorkspaceState.reviewInitializers = exports; return exports; })
    .catch(function (err) { trainingWorkspaceState.reviewInitializers = []; setStatus('Could not load saved LoRAs: ' + String(err.message || err)); return []; });
}

function renderTrainingStartingPointControls(payload) {
  var select = document.getElementById('training-run-starting-point-select');
  var resumeFields = document.getElementById('training-run-resume-fields');
  var initializerFields = document.getElementById('training-run-initializer-fields');
  if (!select || !resumeFields || !initializerFields) return;
  var startPoint = trainingWorkspaceState.reviewStartingPoint || 'fresh';
  select.value = startPoint;
  resumeFields.classList.toggle('hidden', startPoint !== 'resume');
  initializerFields.classList.toggle('hidden', startPoint !== 'initializer');
  var review = payload && payload.review || {};
  var stages = review.stages || {};
  if (startPoint === 'initializer') {
    var initStage = reviewInitializerStage();
    var exports = trainingWorkspaceState.reviewInitializers || [];
    var chosen = exports.filter(function (item) { return item.exportId === trainingWorkspaceState.reviewInitializerExportId; })[0];
    var warning = chosen && Number(trainingWorkspaceState.reviewForceConstantLr || 0) >= Number(chosen.optimizerLr || Infinity)
      ? '<span class="training-review-inline-warning">This LR is not lower than the source run.</span>' : '';
    initializerFields.innerHTML = '<label class="training-run-option">Apply to<select data-review-initializer-stage>' + Object.keys(stages).map(function (stage) {
      return '<option value="' + escapeHtml(stage) + '"' + (stage === initStage ? ' selected' : '') + '>' + escapeHtml(stage.toUpperCase()) + '</option>';
    }).join('') + '</select></label>' +
      '<label class="training-run-option">Saved LoRA<select data-review-initializer-export><option value="">Choose export…</option>' + exports.map(function (item) {
        var weight = item.weights && item.weights.length === 1 ? ' · ' + item.weights[0].name : '';
        return '<option value="' + escapeHtml(item.exportId) + '"' + (item.exportId === trainingWorkspaceState.reviewInitializerExportId ? ' selected' : '') + (item.compatible ? '' : ' disabled') + '>' +
          escapeHtml(item.runName + ' · ' + item.stage.toUpperCase() + ' · epoch' + item.epoch + weight + (item.compatible ? '' : ' · ' + item.reason)) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="training-run-option">Constant LR<input type="number" min="0" step="any" data-review-constant-lr value="' + escapeHtml(String(trainingWorkspaceState.reviewForceConstantLr || '')) + '">' + warning + '</label>';
    var stageSelect = initializerFields.querySelector('[data-review-initializer-stage]');
    if (stageSelect) stageSelect.onchange = function () {
      trainingWorkspaceState.reviewInitializerStage = stageSelect.value;
      trainingWorkspaceState.reviewInitializerExportId = '';
      trainingWorkspaceState.reviewForceConstantLr = String(((stages[stageSelect.value] || {}).settings || {}).optimizerLr || '');
      fetchTrainingReviewInitializers().then(function () { renderTrainingStartingPointControls(trainingWorkspaceState.review); renderTrainingReview(); });
    };
    var exportSelect = initializerFields.querySelector('[data-review-initializer-export]');
    if (exportSelect) exportSelect.onchange = function () {
      trainingWorkspaceState.reviewInitializerExportId = exportSelect.value;
      renderTrainingStartingPointControls(trainingWorkspaceState.review);
      renderTrainingReview();
    };
    var constantLr = initializerFields.querySelector('[data-review-constant-lr]');
    if (constantLr) constantLr.onchange = function () {
      trainingWorkspaceState.reviewForceConstantLr = constantLr.value;
      renderTrainingStartingPointControls(trainingWorkspaceState.review);
      renderTrainingReview();
    };
  } else {
    initializerFields.innerHTML = '';
  }
  select.onchange = function () {
    trainingWorkspaceState.reviewStartingPoint = select.value;
    trainingWorkspaceState.reviewInitializerExportId = '';
    var checkpoint = document.getElementById('training-run-checkpoint-select');
    if (select.value !== 'resume' && checkpoint) checkpoint.value = '';
    syncManagedTrainingResumeUi();
    if (select.value === 'initializer') {
      var stage = reviewInitializerStage();
      trainingWorkspaceState.reviewForceConstantLr = String(((stages[stage] || {}).settings || {}).optimizerLr || '');
      refreshTrainingReview().then(fetchTrainingReviewInitializers).then(function () { renderTrainingStartingPointControls(trainingWorkspaceState.review); renderTrainingReview(); });
    } else if (select.value === 'fresh') {
      refreshTrainingReview();
    } else {
      renderTrainingStartingPointControls(trainingWorkspaceState.review);
      renderTrainingReview();
    }
  };
}

function selectedReviewBucket(plan, stage, kind, role, ar, bucket) {
  if (kind === 'image') {
    var images = plan && plan.stages && plan.stages[stage] && plan.stages[stage].imageBuckets;
    return !!(images && images[ar] || []).some(function (item) { return Number(item[0]) === bucket[0] && Number(item[1]) === bucket[1]; });
  }
  var roles = plan && Array.isArray(plan.videoRoles) ? plan.videoRoles : [];
  var entry = roles.filter(function (item) { return item.id === role; })[0];
  return !!(entry && entry.buckets && entry.buckets[ar] || []).some(function (item) { return Number(item[0]) === bucket[0] && Number(item[1]) === bucket[1]; });
}

function setReviewBucket(plan, stage, kind, role, ar, bucket, enabled) {
  if (kind === 'image') {
    var stagePlan = plan.stages[stage];
    stagePlan.imageBuckets = stagePlan.imageBuckets || {};
    var items = stagePlan.imageBuckets[ar] || [];
    stagePlan.imageBuckets[ar] = items.filter(function (item) { return Number(item[0]) !== bucket[0] || Number(item[1]) !== bucket[1]; });
    if (enabled) stagePlan.imageBuckets[ar].push([bucket[0], bucket[1]]);
    return;
  }
  var entry = plan.videoRoles.filter(function (item) { return item.id === role; })[0];
  if (!entry) return;
  entry.buckets = entry.buckets || {};
  var rows = entry.buckets[ar] || [];
  entry.buckets[ar] = rows.filter(function (item) { return Number(item[0]) !== bucket[0] || Number(item[1]) !== bucket[1]; });
  if (enabled) entry.buckets[ar].push([bucket[0], bucket[1]]);
}

function reviewEntryKey(entry) {
  return [entry.kind, entry.role, entry.ar, (entry.bucket || []).join('x')].join('|');
}

function reviewEntriesByKey(review) {
  var output = {};
  Object.keys(review && review.stages || {}).forEach(function (stage) {
    (review.stages[stage].datasetEntries || []).forEach(function (entry) {
      var key = stage + '|' + reviewEntryKey(entry);
      if (!output[key]) output[key] = { eligibleCount: 0, files: [] };
      output[key].eligibleCount += Number(entry.eligibleCount || 0);
      output[key].files = output[key].files.concat(entry.files || []);
    });
  });
  return output;
}

function formatReviewAspect(ar) {
  return ({ '43': '4:3', '34': '3:4', '169': '16:9', '916': '9:16', square: 'square' })[ar] || ar;
}

function reviewCountsHaveItems(counts) {
  return Object.keys(counts || {}).some(function (key) { return Number(counts[key] || 0) > 0; });
}

function reviewBucketRows(review, plan, ladders, candidateCounts, stage, kind, role, ar) {
  var candidates = kind === 'image'
    ? (ladders.images[ar] || [])
    : ((ladders.videos[role] && ladders.videos[role][ar]) || []);
  var entries = reviewEntriesByKey(review);
  return candidates.map(function (bucket) {
    var checked = selectedReviewBucket(plan, stage, kind, role, ar, bucket);
    var key = stage + '|' + reviewEntryKey({ kind: kind, role: role, ar: ar, bucket: kind === 'image' ? [bucket[0], bucket[1]] : [bucket[0], bucket[1], (plan.videoRoles.filter(function (item) { return item.id === role; })[0] || {}).frames] });
    var entry = entries[key];
    var countKey = bucket[0] + 'x' + bucket[1];
    var prospective = kind === 'image'
      ? Number((((candidateCounts.images || {})[stage] || {})[ar] || {})[countKey] || 0)
      : Number((((candidateCounts.videos || {})[role] || {})[ar] || {})[countKey] || 0);
    if (!checked && prospective <= 0) return '';
    var count = entry ? Number(entry.eligibleCount || 0) : prospective;
    return '<label class="training-review-bucket' + (checked ? ' selected' : '') + '">' +
      '<input type="checkbox" data-review-bucket="1" data-stage="' + escapeHtml(stage) + '" data-kind="' + escapeHtml(kind) + '" data-role="' + escapeHtml(role) + '" data-ar="' + escapeHtml(ar) + '" data-bucket="' + bucket.join(',') + '"' + (checked ? ' checked' : '') + '>' +
      '<span>' + escapeHtml(bucket[0] + '×' + bucket[1]) + '</span><em>' + count + ' item' + (count === 1 ? '' : 's') + (checked ? '' : ' if enabled') + '</em></label>';
  }).join('');
}

function renderTrainingReview() {
  var el = getTrainingWorkspaceEls().review;
  if (!el) return;
  var payload = trainingWorkspaceState.review;
  renderTrainingStartingPointControls(payload);
  if (!payload) {
    el.textContent = trainingWorkspaceState.reviewPending ? 'Preparing training review...' : 'Training Review is unavailable.';
    return;
  }
  var review = payload.review || {};
  var plan = payload.plan || {};
  var warnings = payload.warnings || [];
  var blockers = payload.blockers || [];
  var customDataset = payload.customDataset || false;
  var readOnly = !!payload.readOnly;
  var stages = review.stages || {};
  var startPoint = trainingWorkspaceState.reviewStartingPoint || 'fresh';
  var saveStatus = readOnly ? 'Immutable prior run' : trainingWorkspaceState.reviewSaveStatus === 'saving' ? 'Saving…' : trainingWorkspaceState.reviewSaveStatus === 'error' ? 'Save error' : 'Saved';
  var html = '<div class="training-review-head"><div><strong>Reviewed plan</strong><span>' + escapeHtml(Object.keys(stages).length + ' stage' + (Object.keys(stages).length === 1 ? '' : 's')) + '</span></div><span class="training-review-saved">' + escapeHtml(saveStatus) + '</span></div>';
  if (blockers.length) html += '<section class="training-review-notices blockers"><strong>Blockers</strong>' + blockers.map(function (item) { return '<div>' + escapeHtml(item.message || '') + (item.files && item.files.length ? ': ' + escapeHtml(item.files.join(', ')) : '') + '</div>'; }).join('') + '</section>';
  if (warnings.length) html += '<section class="training-review-notices warnings"><strong>Critical Warnings</strong>' + warnings.map(function (item) { return '<div>' + escapeHtml(item.message || '') + (item.files && item.files.length ? ': ' + escapeHtml(item.files.join(', ')) : '') + '</div>'; }).join('') + '</section>';
  if (customDataset) html += '<section class="training-review-notices warnings"><strong>Custom dataset</strong><div>' + escapeHtml(customDataset.message || 'This dataset is read-only in Training Review until buckets are reset.') + '</div></section>';
  html += '<section class="training-review-settings"><div class="training-review-section-title">Training intent</div>';
  Object.keys(stages).forEach(function (stage) {
    var data = stages[stage];
    var settings = data.settings || {};
    html += '<div class="training-review-stage"><strong>' + escapeHtml(stage.toUpperCase()) + '</strong>' +
      '<label>Target steps <input type="number" min="1" data-review-target="' + escapeHtml(stage) + '" value="' + escapeHtml(String((plan.stages && plan.stages[stage] || {}).targetSteps || data.targetSteps || '')) + '"></label>' +
      '<label>Optimizer LR <input type="number" step="any" min="0" data-review-setting="optimizerLr" data-stage="' + escapeHtml(stage) + '" value="' + escapeHtml(String(settings.optimizerLr || '')) + '"></label>' +
      '<label>LR behavior <select data-review-lr-behavior data-stage="' + escapeHtml(stage) + '"><option value="scheduled"' + (settings.forceConstantLr === '' || settings.forceConstantLr === undefined ? ' selected' : '') + '>Scheduled</option><option value="constant"' + (settings.forceConstantLr !== '' && settings.forceConstantLr !== undefined ? ' selected' : '') + '>Constant</option></select></label>' +
      '<label>LoRA rank <input type="number" min="1" data-review-setting="adapterRank" data-stage="' + escapeHtml(stage) + '" value="' + escapeHtml(String(settings.adapterRank || '')) + '"></label>' +
      '<label>Dropout <input type="number" step="any" min="0" max="1" data-review-setting="adapterDropout" data-stage="' + escapeHtml(stage) + '" value="' + escapeHtml(String(settings.adapterDropout === undefined ? '' : settings.adapterDropout)) + '"></label>' +
      '<span class="training-review-estimate">' + escapeHtml(data.epochs + ' epochs · ' + data.estimatedSteps + ' estimated steps · ' + data.estimatedImageExposures + ' image / ' + data.estimatedVideoExposures + ' video exposures') + '</span></div>';
  });
  var ladders = payload.ladders || { images: {}, videos: {} };
  var candidateCounts = payload.candidateCounts || { images: {}, videos: {} };
  var aspects = Object.keys(ladders.images || {}).sort();
  var firstStage = Object.keys(stages)[0] || '';
  var hasVideoCandidates = Object.keys(candidateCounts.videos || {}).some(function (role) {
    return Object.keys(candidateCounts.videos[role] || {}).some(function (ar) {
      return reviewCountsHaveItems(candidateCounts.videos[role][ar]);
    });
  });
  html += '</section>';
  if ((plan.videoRoles || []).length && hasVideoCandidates) {
    html += '<section class="training-review-buckets"><div class="training-review-section-title">Video roles</div>';
    (plan.videoRoles || []).forEach(function (role) {
      html += '<details class="training-review-stage-buckets" open><summary>' + escapeHtml(role.id) + '</summary><div class="training-review-role">' +
        '<label><input type="checkbox" data-review-role="' + escapeHtml(role.id) + '"' + (role.enabled ? ' checked' : '') + '> enabled</label>' +
        '<label>frames <input type="number" min="1" data-review-frames="' + escapeHtml(role.id) + '" value="' + escapeHtml(String(role.frames)) + '"></label>' +
        '<label>weight <input type="number" step="0.05" min="0.01" data-review-weight="' + escapeHtml(role.id) + '" value="' + escapeHtml(String(role.weight)) + '"></label></div>';
      aspects.filter(function (ar) {
        var counts = (((candidateCounts.videos || {})[role.id] || {})[ar] || {});
        return reviewCountsHaveItems(counts);
      }).forEach(function (ar) {
        html += '<div class="training-review-aspect"><strong>' + escapeHtml(formatReviewAspect(ar)) + '</strong><div class="training-review-ladder">' +
          reviewBucketRows(review, plan, ladders, candidateCounts, firstStage, 'video', role.id, ar) + '</div></div>';
      });
      html += '</details>';
    });
    html += '</section>';
  }
  html += '<section class="training-review-buckets"><div class="training-review-section-title">Image buckets and membership</div>';
  Object.keys(stages).forEach(function (stage) {
    var stageData = stages[stage];
    var activeImages = (stageData.datasetEntries || []).filter(function (entry) { return entry.kind === 'image'; }).length;
    html += '<details class="training-review-stage-buckets" open><summary>' + escapeHtml(stage.toUpperCase()) + ' · ' + activeImages + ' active image buckets</summary>';
    aspects.filter(function (ar) {
      var counts = ((((candidateCounts.images || {})[stage] || {})[ar]) || {});
      return reviewCountsHaveItems(counts);
    }).forEach(function (ar) {
      html += '<div class="training-review-aspect"><strong>' + escapeHtml(formatReviewAspect(ar)) + '</strong><div class="training-review-ladder">' +
        reviewBucketRows(review, plan, ladders, candidateCounts, stage, 'image', 'image', ar) + '</div></div>';
    });
    html += '</details>';
  });
  html += '</section><details class="training-review-files"><summary>Exact included files</summary>';
  Object.keys(stages).forEach(function (stage) {
    (stages[stage].datasetEntries || []).forEach(function (entry) {
      html += '<details><summary>' + escapeHtml(stage.toUpperCase() + ' · ' + entry.kind + ' · ' + entry.role + ' · ' + (entry.bucket || []).join('×') + ' · ' + entry.eligibleCount + ' items') + '</summary><div>' + escapeHtml((entry.files || []).join(', ')) + '</div></details>';
    });
  });
  html += '</details>';
  var effectiveToml = payload.effectiveToml || {};
  if (Object.keys(effectiveToml).length) {
    html += '<details class="training-review-effective"><summary>Effective TOML diagnostic</summary>';
    Object.keys(effectiveToml).forEach(function (stage) {
      var item = effectiveToml[stage] || {};
      html += '<details class="training-review-effective-stage"><summary>' + escapeHtml(stage.toUpperCase()) + '</summary>' +
        '<strong>' + escapeHtml(item.configName || 'config.toml') + '</strong><pre>' + escapeHtml(item.configText || '') + '</pre>' +
        '<strong>' + escapeHtml(item.datasetName || 'dataset.toml') + '</strong><pre>' + escapeHtml(item.datasetText || '') + '</pre></details>';
    });
    html += '</details>';
  }
  html += '<div class="training-review-actions"><button type="button" data-review-reset="settings">Reset settings</button><button type="button" data-review-reset="buckets">Reset buckets</button><button type="button" data-review-reset="all">Reset all</button></div>';
  el.innerHTML = html;
  el.querySelectorAll('[data-review-bucket]').forEach(function (input) {
    if (customDataset || readOnly) input.disabled = true;
    input.onchange = function () {
      var bucket = String(input.getAttribute('data-bucket') || '').split(',').map(Number);
      setReviewBucket(plan, input.getAttribute('data-stage'), input.getAttribute('data-kind'), input.getAttribute('data-role'), input.getAttribute('data-ar'), bucket, input.checked);
      saveTrainingReview({ plan: plan });
    };
  });
  el.querySelectorAll('[data-review-target]').forEach(function (input) {
    if (customDataset || readOnly) input.disabled = true;
    input.onchange = function () { plan.stages[input.getAttribute('data-review-target')].targetSteps = Number(input.value); saveTrainingReview({ plan: plan }); };
  });
  el.querySelectorAll('[data-review-setting]').forEach(function (input) {
    if (readOnly) input.disabled = true;
    input.onchange = function () { var stage = input.getAttribute('data-stage'); var settings = {}; settings[stage] = {}; settings[stage][input.getAttribute('data-review-setting')] = input.value; saveTrainingReview({ plan: plan, settings: settings }); };
  });
  el.querySelectorAll('[data-review-lr-behavior]').forEach(function (input) {
    if (readOnly) input.disabled = true;
    input.onchange = function () {
      var stage = input.getAttribute('data-stage');
      var lrInput = el.querySelector('[data-review-setting="optimizerLr"][data-stage="' + stage + '"]');
      var settings = {}; settings[stage] = { forceConstantLr: input.value === 'constant' ? String(lrInput && lrInput.value || '') : '' };
      saveTrainingReview({ plan: plan, settings: settings });
    };
  });
  el.querySelectorAll('[data-review-role]').forEach(function (input) {
    if (customDataset || readOnly) input.disabled = true;
    input.onchange = function () { plan.videoRoles.filter(function (role) { return role.id === input.getAttribute('data-review-role'); })[0].enabled = input.checked; saveTrainingReview({ plan: plan }); };
  });
  el.querySelectorAll('[data-review-frames]').forEach(function (input) {
    if (customDataset || readOnly) input.disabled = true;
    input.onchange = function () { plan.videoRoles.filter(function (role) { return role.id === input.getAttribute('data-review-frames'); })[0].frames = Number(input.value); saveTrainingReview({ plan: plan }); };
  });
  el.querySelectorAll('[data-review-weight]').forEach(function (input) {
    if (customDataset || readOnly) input.disabled = true;
    input.onchange = function () { plan.videoRoles.filter(function (role) { return role.id === input.getAttribute('data-review-weight'); })[0].weight = Number(input.value); saveTrainingReview({ plan: plan }); };
  });
  el.querySelectorAll('[data-review-reset]').forEach(function (button) {
    if (readOnly) button.disabled = true;
    button.onclick = function () { if (window.confirm('Reset ' + button.getAttribute('data-review-reset') + ' for this model?')) saveTrainingReview({ reset: button.getAttribute('data-review-reset') }); };
  });
  var trainButton = getTrainingWorkspaceEls().queueJobBtn;
  var checkpoint = document.getElementById('training-run-checkpoint-select');
  if (trainButton) trainButton.disabled = !!trainingWorkspaceState.reviewSavePending || !payload.ok || (startPoint === 'initializer' && !trainingWorkspaceState.reviewInitializerExportId) || (startPoint === 'resume' && !(checkpoint && checkpoint.value));
}

function renderTrainingReviewSaveStatus() {
  var el = getTrainingWorkspaceEls().review;
  var status = el && el.querySelector('.training-review-saved');
  if (!status) return;
  status.textContent = trainingWorkspaceState.reviewSaveStatus === 'saving' ? 'Saving…' : trainingWorkspaceState.reviewSaveStatus === 'error' ? 'Save error' : 'Saved';
  var trainButton = getTrainingWorkspaceEls().queueJobBtn;
  if (trainButton && trainingWorkspaceState.reviewSavePending) trainButton.disabled = true;
}

function refreshTrainingReview() {
  if (!isTrainingWorkspaceActive() || !state.folder) return Promise.resolve(null);
  trainingWorkspaceState.reviewPending = true;
  renderTrainingReview();
  var request = trainingReviewPayload();
  return trainingReviewRequest('/fs/training_review', request).then(function (payload) {
    trainingWorkspaceState.review = payload;
    trainingWorkspaceState.reviewPending = false;
    renderTrainingReview();
    return payload;
  }).catch(function (err) {
    trainingWorkspaceState.reviewPending = false;
    trainingWorkspaceState.review = null;
    renderTrainingReview();
    throw err;
  });
}

function saveTrainingReview(change) {
  var current = trainingWorkspaceState.review;
  if (!current || current.readOnly) return Promise.resolve(null);
  var snapshot = JSON.parse(JSON.stringify({
    plan: change.plan || current.plan,
    settings: change.settings || null,
    reset: change.reset || ''
  }));
  trainingWorkspaceState.reviewSavePending += 1;
  trainingWorkspaceState.reviewSaveStatus = 'saving';
  renderTrainingReviewSaveStatus();
  var prior = trainingWorkspaceState.reviewSaveQueue || Promise.resolve();
  var task = prior.catch(function () {}).then(function () {
    var latest = trainingWorkspaceState.review;
    var payload = trainingReviewPayload();
    payload.revision = Number((latest && latest.plan || {}).revision || 0);
    payload.plan = snapshot.plan;
    if (snapshot.settings) payload.settings = snapshot.settings;
    if (snapshot.reset) payload.reset = snapshot.reset;
    return trainingReviewRequest('/fs/training_review/update', payload);
  }).then(function (result) {
    trainingWorkspaceState.review = result;
    state.trainingPlan = state.trainingPlan || {};
    state.trainingPlan.version = 1;
    state.trainingPlan.profiles = state.trainingPlan.profiles || {};
    state.trainingPlan.profiles[result.profileId] = result.plan;
    return result;
  }).catch(function (err) {
    trainingWorkspaceState.reviewSaveStatus = 'error';
    setStatus('Could not save Training Review: ' + String(err && err.message ? err.message : err));
    return refreshTrainingReview().then(function () { return null; }, function () { return null; });
  }).finally(function () {
    trainingWorkspaceState.reviewSavePending = Math.max(0, trainingWorkspaceState.reviewSavePending - 1);
    if (!trainingWorkspaceState.reviewSavePending && trainingWorkspaceState.reviewSaveStatus !== 'error') trainingWorkspaceState.reviewSaveStatus = 'saved';
    if (!trainingWorkspaceState.reviewSavePending) renderTrainingReview();
    else renderTrainingReviewSaveStatus();
  });
  trainingWorkspaceState.reviewSaveQueue = task;
  return task;
}
