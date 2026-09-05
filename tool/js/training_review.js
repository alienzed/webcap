// Training Review is a view onto the set-owned TOMLs. It keeps no parallel
// bucket authority in folder state.

var TRAINING_REVIEW_ASPECT_ORDER = ['43', '34', '169', '916', 'square'];
var TRAINING_REVIEW_IMPACT_BANDS = [
  ['down20', '20%+ downscale'], ['down', '5–20% downscale'], ['near', 'Within 5%'], ['up', '5–20% upscale'], ['up20', '20%+ upscale']
];

function trainingReviewPayload() {
  var selected = getVisibleMediaSelectionForTraining();
  var fallback = buildTrainingFallbackCaptions(selected);
  var profile = getSelectedTrainingModelProfile();
  var selectedRun = getTrainingProfileRunForStage(profile, trainingWorkspaceState.runStages);
  return {
    folder: state.folder,
    profileId: profile ? profile.id : '',
    runId: selectedRun ? selectedRun.id : '',
    selected_media: selected,
    total_media_count: Array.isArray(state.items) ? state.items.length : 0,
    selection_criteria: buildTrainingSelectionCriteria(),
    fallback_captions: fallback.fallbackCaptions
  };
}

function trainingReviewRequest(path, payload) {
  return fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  }).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (data) {
      var reviewPayload = !!(data && data.review && typeof data.review === 'object');
      if (!response.ok || (data.ok === false && !reviewPayload)) throw new Error(data.error || 'Training Review request failed.');
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
  var folder = state.folder;
  return fetch('/fs/training_initializers?folder=' + encodeURIComponent(folder) + '&profileId=' + encodeURIComponent(profile.id) + '&stage=' + encodeURIComponent(stage))
    .then(function (response) { return response.json().then(function (payload) {
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not load saved LoRAs.');
      return payload.exports || [];
    }); })
    .then(function (exports) {
      if (state.folder !== folder || !isTrainingWorkspaceActive()) return [];
      trainingWorkspaceState.reviewInitializers = exports;
      return exports;
    })
    .catch(function (err) {
      if (state.folder !== folder || !isTrainingWorkspaceActive()) return [];
      trainingWorkspaceState.reviewInitializers = [];
      setStatus('Could not load saved LoRAs: ' + String(err.message || err));
      return [];
    });
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
  var stages = payload && payload.review && payload.review.stages || {};
  if (startPoint === 'initializer') {
    var initStage = reviewInitializerStage();
    var exports = trainingWorkspaceState.reviewInitializers || [];
    initializerFields.innerHTML = '<label class="training-run-option">Apply to<select data-review-initializer-stage>' + Object.keys(stages).map(function (stage) {
      return '<option value="' + escapeHtml(stage) + '"' + (stage === initStage ? ' selected' : '') + '>' + escapeHtml(stage.toUpperCase()) + '</option>';
    }).join('') + '</select></label>' +
      (exports.length ? '<label class="training-run-option">Set checkpoint<select data-review-initializer-export><option value="">Choose checkpoint…</option>' + exports.map(function (item) {
        var weight = item.weights && item.weights.length === 1 ? ' · ' + item.weights[0].name : '';
        return '<option value="' + escapeHtml(item.exportId) + '"' + (item.exportId === trainingWorkspaceState.reviewInitializerExportId ? ' selected' : '') + '>' + escapeHtml(item.runName + ' · ' + item.stage.toUpperCase() + ' · epoch' + item.epoch + weight) + '</option>';
      }).join('') + '</select></label>' : '') +
      '<label class="training-run-option">LoRA file or folder<input type="text" data-review-initializer-custom-path value="' + escapeHtml(String(trainingWorkspaceState.reviewInitializerCustomPath || '')) + '" placeholder="Path to a .safetensors file or its folder"></label>' +
      '<label class="training-run-option">Constant LR<input type="number" min="0" step="any" data-review-constant-lr value="' + escapeHtml(String(trainingWorkspaceState.reviewForceConstantLr || '')) + '"></label>';
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
      if (exportSelect.value) trainingWorkspaceState.reviewInitializerCustomPath = '';
      renderTrainingStartingPointControls(trainingWorkspaceState.review);
      renderTrainingReview();
    };
    var customPath = initializerFields.querySelector('[data-review-initializer-custom-path]');
    if (customPath) customPath.onchange = function () {
      trainingWorkspaceState.reviewInitializerCustomPath = customPath.value;
      if (customPath.value.trim()) trainingWorkspaceState.reviewInitializerExportId = '';
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
    trainingWorkspaceState.reviewInitializerCustomPath = '';
    var checkpoint = document.getElementById('training-run-checkpoint-select');
    var customResume = document.getElementById('training-run-resume-input');
    if (select.value !== 'resume' && checkpoint) checkpoint.value = '';
    if (select.value !== 'resume' && customResume) customResume.value = '';
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

function formatReviewAspect(ar) {
  return ({ '43': '4:3', '34': '3:4', '169': '16:9', '916': '9:16', square: 'Square' })[ar] || ar;
}

function reviewStageId(plan) { return Object.keys(plan && plan.stages || {})[0] || ''; }
function reviewRole(plan, name) { return (plan && plan.videoRoles || []).filter(function (item) { return item.id === name; })[0] || null; }
function sameReviewBucket(a, b) { return Number(a && a[0]) === Number(b && b[0]) && Number(a && a[1]) === Number(b && b[1]); }

function reviewSelectedBuckets(plan, view, aspect) {
  if (view === 'images') return (((plan.stages || {})[reviewStageId(plan)] || {}).imageBuckets || {})[aspect] || [];
  return ((reviewRole(plan, view) || {}).buckets || {})[aspect] || [];
}

function hasReviewBucket(plan, view, aspect, bucket) {
  return reviewSelectedBuckets(plan, view, aspect).some(function (item) { return sameReviewBucket(item, bucket); });
}

function setReviewBucket(plan, view, aspect, bucket, enabled) {
  var selected = reviewSelectedBuckets(plan, view, aspect);
  var next = selected.filter(function (item) { return !sameReviewBucket(item, bucket); });
  if (enabled) {
    if (next.length >= 3) { setStatus('Use at most three targets in one aspect-ratio cohort.'); return false; }
    next.push([Number(bucket[0]), Number(bucket[1])]);
  } else if (!next.length) {
    setStatus('Keep one target selected for this cohort.');
    return false;
  }
  if (view === 'images') {
    var stage = reviewStageId(plan);
    plan.stages[stage].imageBuckets = plan.stages[stage].imageBuckets || {};
    plan.stages[stage].imageBuckets[aspect] = next;
  } else {
    var role = reviewRole(plan, view);
    role.buckets = role.buckets || {};
    role.buckets[aspect] = next;
  }
  return true;
}

function stepReviewBucket(plan, ladders, view, aspect, bucket, direction) {
  var candidates = view === 'images' ? ((ladders.images || {})[aspect] || []) : (((ladders.videos || {})[view] || {})[aspect] || []);
  var selected = reviewSelectedBuckets(plan, view, aspect);
  var index = candidates.findIndex(function (item) { return sameReviewBucket(item, bucket); });
  if (index < 0) {
    var nearest = candidates.reduce(function (best, item) {
      var distance = Math.pow(Number(item[0]) - Number(bucket[0]), 2) + Math.pow(Number(item[1]) - Number(bucket[1]), 2);
      return !best || distance < best.distance ? { bucket: item, distance: distance } : best;
    }, null);
    if (!nearest) return false;
    var next = selected.map(function (item) { return sameReviewBucket(item, bucket) ? [Number(nearest.bucket[0]), Number(nearest.bucket[1])] : item; });
    next = next.filter(function (item, itemIndex) { return next.findIndex(function (other) { return sameReviewBucket(other, item); }) === itemIndex; });
    if (view === 'images') plan.stages[reviewStageId(plan)].imageBuckets[aspect] = next;
    else reviewRole(plan, view).buckets[aspect] = next;
    return true;
  }
  for (var cursor = index + direction; cursor >= 0 && cursor < candidates.length; cursor += direction) {
    if (!selected.some(function (item) { return sameReviewBucket(item, candidates[cursor]); })) {
      var replacement = candidates[cursor];
      var next = selected.map(function (item) { return sameReviewBucket(item, bucket) ? [Number(replacement[0]), Number(replacement[1])] : item; });
      if (view === 'images') plan.stages[reviewStageId(plan)].imageBuckets[aspect] = next;
      else reviewRole(plan, view).buckets[aspect] = next;
      return true;
    }
  }
  return false;
}

function reviewViewGroups(payload, view) {
  return view === 'images' ? ((payload.distribution || {}).images || {}) : ((((payload.distribution || {}).videos || {})[view]) || {});
}

function reviewViewItems(payload) {
  var views = [];
  var imageGroups = reviewViewGroups(payload, 'images');
  if (Object.keys(imageGroups).length) views.push({ id: 'images', available: true, count: Object.keys(imageGroups).reduce(function (total, ar) { return total + Number((imageGroups[ar] || {}).count || 0); }, 0) });
  Object.keys(((payload.distribution || {}).videos || {})).forEach(function (role) {
    var groups = reviewViewGroups(payload, role);
    if (!Object.keys(groups).length) return;
    var count = Object.keys(groups).reduce(function (total, ar) { return total + Number((groups[ar] || {}).count || 0); }, 0);
    var eligibleCount = Object.keys(groups).reduce(function (total, ar) { return total + Number((groups[ar] || {}).eligibleCount || 0); }, 0);
    views.push({ id: role, count: count, eligibleCount: eligibleCount });
  });
  return views;
}

function reviewAvailableViews(payload) { return reviewViewItems(payload).map(function (item) { return item.id; }); }

function reviewActiveView(payload) {
  var views = reviewAvailableViews(payload).filter(function (item) {
    var role = item === 'images' ? null : reviewRole((payload || {}).plan || {}, item);
    return !role || role.enabled;
  });
  if (views.indexOf(trainingWorkspaceState.reviewMediaView) === -1) trainingWorkspaceState.reviewMediaView = views[0] || 'images';
  return trainingWorkspaceState.reviewMediaView;
}

function reviewActiveAspect(payload, view) {
  var groups = reviewViewGroups(payload, view);
  var aspects = TRAINING_REVIEW_ASPECT_ORDER.filter(function (aspect) { return !!groups[aspect]; });
  if (aspects.indexOf(trainingWorkspaceState.reviewAspect) === -1) trainingWorkspaceState.reviewAspect = aspects[0] || '';
  return trainingWorkspaceState.reviewAspect;
}

function reviewTargetColor(selected, target) {
  var index = selected.findIndex(function (item) { return sameReviewBucket(item, target); });
  return index < 0 ? 'target-neutral' : 'target-' + Math.min(index, 2);
}

function reviewCandidates(payload, view, aspect) {
  var ladders = payload.ladders || { images: {}, videos: {} };
  return view === 'images' ? ((ladders.images || {})[aspect] || []) : (((ladders.videos || {})[view] || {})[aspect] || []);
}

function reviewVideoLimitNote(payload, view, aspect) {
  if (view === 'images') return '';
  var limit = (((payload.videoLimits || {})[view] || {})[aspect]) || null;
  if (!limit || !limit.effectiveCeiling || !limit.automaticDefaultCeiling) return '';
  var source = limit.source === 'calibration' ? 'Calibrated' : 'Conservative';
  var maximum = limit.effectiveCeiling[0] + ' × ' + limit.effectiveCeiling[1];
  var automatic = limit.automaticDefaultCeiling[0] + ' × ' + limit.automaticDefaultCeiling[1];
  var campaign = limit.source === 'calibration' && limit.campaign ? ' · ' + limit.campaign : '';
  return '<span title="' + escapeHtml(source + campaign) + '">' + escapeHtml(source + ' · default ' + automatic + ' · max ' + maximum) + '</span>';
}

function reviewBucketPressureLevel(payload, view, aspect, bucket) {
  var limit = (((payload.videoLimits || {})[view] || {})[aspect]) || null;
  if (view === 'images' || !limit || !limit.effectiveCeiling) return '';
  var ladder = reviewCandidates(payload, view, aspect);
  var maximumIndex = ladder.findIndex(function (item) { return sameReviewBucket(item, limit.effectiveCeiling); });
  var index = ladder.findIndex(function (item) { return sameReviewBucket(item, bucket); });
  var distance = index - maximumIndex;
  return maximumIndex < 0 || index < 0 ? '' : distance === 0 ? 'pressure-high' : distance === 1 ? 'pressure-medium' : distance === 2 ? 'pressure-low' : '';
}

function reviewBucketPressureNote(payload, view, aspect, bucket) {
  if (view === 'images') return '';
  var limit = (((payload.videoLimits || {})[view] || {})[aspect]) || null;
  var ladder = reviewCandidates(payload, view, aspect);
  var maximumIndex = limit && limit.effectiveCeiling ? ladder.findIndex(function (item) { return sameReviewBucket(item, limit.effectiveCeiling); }) : -1;
  var index = ladder.findIndex(function (item) { return sameReviewBucket(item, bucket); });
  if (maximumIndex < 0 || index < 0) return '';
  var distance = index - maximumIndex;
  return distance <= 0 ? 'At tested limit · very little GPU headroom' : distance === 1 ? 'Near tested limit · limited GPU headroom' : distance === 2 ? 'Moderate GPU headroom' : 'More GPU headroom';
}

function reviewProjectedTarget(view, row, targets) {
  if (view === 'images') {
    return targets.reduce(function (closest, target) {
      return !closest || Math.abs(Math.log(Math.min(target[0], target[1]) / Math.min(row.width, row.height))) < Math.abs(Math.log(Math.min(closest[0], closest[1]) / Math.min(row.width, row.height))) ? target : closest;
    }, null);
  }
  var native = reviewNativeVideoTarget(row, targets);
  if (native || view === 'detail') return native;
  var ordered = targets.slice().sort(function (a, b) { return b[0] * b[1] - a[0] * a[1]; });
  return ordered[ordered.length - 1] || null;
}

function reviewNativeVideoTarget(row, targets) {
  var ordered = targets.slice().sort(function (a, b) { return b[0] * b[1] - a[0] * a[1]; });
  return ordered.filter(function (target) { return Number(row.width) >= target[0] && Number(row.height) >= target[1]; })[0] || null;
}

function reviewDetailFrameEligible(row, frames) {
  return Number(row.frames || 0) >= Number(frames || 0);
}

function reviewDetailEligibility(row, targets, frames) {
  if (!reviewDetailFrameEligible(row, frames)) {
    return {
      eligible: false,
      reason: Number(row.frames || 0) ? Number(row.frames || 0) + ' frames; this role requires ' + Number(frames || 0) + '.' : 'Frame count unavailable.'
    };
  }
  if (targets.length && !reviewNativeVideoTarget(row, targets)) {
    var floor = targets.reduce(function (lowest, target) {
      return !lowest || target[0] * target[1] < lowest[0] * lowest[1] ? target : lowest;
    }, null);
    return { eligible: false, reason: 'Native resolution is below the lowest selected Detail target ' + floor[0] + ' × ' + floor[1] + '; Detail does not upscale source video.' };
  }
  return { eligible: true, reason: '' };
}

function reviewEmptyImpactCounts() {
  return { down20: 0, down: 0, near: 0, up: 0, up20: 0 };
}

function reviewImpactBand(scaleRatio) {
  if (scaleRatio < 0.80) return 'down20';
  if (scaleRatio < 0.95) return 'down';
  if (scaleRatio <= 1.05) return 'near';
  if (scaleRatio <= 1.20) return 'up';
  return 'up20';
}

function reviewDistributionGroup(rows, targets, view, prior) {
  var assignedCounts = targets.map(function () { return 0; });
  var impact = reviewEmptyImpactCounts();
  var native = (rows || []).map(function (source) {
    var row = Object.assign({}, source);
    var detailEligibility = view === 'detail' ? reviewDetailEligibility(row, targets, prior && prior.frames) : null;
    row.eligible = detailEligibility ? detailEligibility.eligible : !!row.eligible;
    if (detailEligibility) row.eligibilityReason = detailEligibility.reason;
    var target = row.eligible ? reviewProjectedTarget(view, row, targets) : null;
    var nativeShortEdge = Number(row.nativeShortEdge || row.edge || Math.min(Number(row.width), Number(row.height)) || 0);
    var scaleRatio = target && nativeShortEdge ? Math.min(Number(target[0]), Number(target[1])) / nativeShortEdge : 1;
    var impactBand = reviewImpactBand(scaleRatio);
    row.edge = nativeShortEdge;
    row.nativeShortEdge = nativeShortEdge;
    row.target = target ? [Number(target[0]), Number(target[1])] : [];
    row.assignedTarget = row.target.slice();
    row.scaleRatio = scaleRatio;
    row.impactBand = impactBand;
    if (target) {
      var index = targets.findIndex(function (candidate) { return sameReviewBucket(candidate, target); });
      if (index >= 0) assignedCounts[index] += 1;
      impact[impactBand] += 1;
    }
    return row;
  });
  var group = Object.assign({}, prior || {});
  group.count = native.length;
  group.eligibleCount = native.filter(function (row) { return row.eligible; }).length;
  group.native = native;
  group.targets = targets.map(function (target, index) {
    return { shape: [Number(target[0]), Number(target[1])], assignedCount: assignedCounts[index] };
  });
  group.impact = impact;
  return group;
}

function reviewAssignmentWarnings(distribution, existingWarnings) {
  var warnings = (existingWarnings || []).filter(function (warning) {
    return warning.code !== 'substantial_upscale' && warning.code !== 'small_bucket';
  });
  var views = [{ view: 'images', groups: distribution.images || {} }];
  Object.keys(distribution.videos || {}).forEach(function (role) {
    views.push({ view: role, groups: distribution.videos[role] || {} });
  });
  views.forEach(function (entry) {
    Object.keys(entry.groups).forEach(function (aspect) {
      var group = entry.groups[aspect] || {};
      var eligible = (group.native || []).filter(function (row) { return row.eligible && (row.target || []).length; });
      var substantialUpscale = eligible.filter(function (row) { return row.impactBand === 'up20'; }).length;
      if (substantialUpscale) {
        var label = entry.view === 'images' ? 'image' : entry.view + ' video';
        warnings.push({
          code: 'substantial_upscale', view: entry.view, ar: aspect,
          message: substantialUpscale + ' of ' + eligible.length + ' ' + label + ' item(s) in ' + formatReviewAspect(aspect) + ' need more than 20% enlargement.', files: []
        });
      }
      if (eligible.length >= 8) (group.targets || []).forEach(function (target) {
        var assigned = Number(target.assignedCount || 0);
        if (!assigned || assigned > Math.max(2, Math.floor(eligible.length * 0.10))) return;
        var shape = target.shape || [];
        warnings.push({
          code: 'small_bucket', view: entry.view, ar: aspect,
          message: shape[0] + '×' + shape[1] + ' receives only ' + assigned + ' item(s) in ' + formatReviewAspect(aspect) + '.', files: []
        });
      });
    });
  });
  return warnings;
}

function recomputeTrainingReviewDistribution(payload) {
  var distribution = payload.distribution || { images: {}, videos: {}, impact: { images: {}, videos: {} } };
  distribution.images = distribution.images || {};
  distribution.videos = distribution.videos || {};
  var impact = { images: reviewEmptyImpactCounts(), videos: {} };
  Object.keys(distribution.images).forEach(function (aspect) {
    var prior = distribution.images[aspect] || {};
    var group = reviewDistributionGroup(prior.native, reviewSelectedBuckets(payload.plan || {}, 'images', aspect), 'images', prior);
    distribution.images[aspect] = group;
    TRAINING_REVIEW_IMPACT_BANDS.forEach(function (band) { impact.images[band[0]] += Number(group.impact[band[0]] || 0); });
  });
  Object.keys(distribution.videos).forEach(function (roleId) {
    impact.videos[roleId] = reviewEmptyImpactCounts();
    Object.keys(distribution.videos[roleId] || {}).forEach(function (aspect) {
      var prior = distribution.videos[roleId][aspect] || {};
      var group = reviewDistributionGroup(prior.native, reviewSelectedBuckets(payload.plan || {}, roleId, aspect), roleId, prior);
      distribution.videos[roleId][aspect] = group;
      TRAINING_REVIEW_IMPACT_BANDS.forEach(function (band) { impact.videos[roleId][band[0]] += Number(group.impact[band[0]] || 0); });
    });
  });
  distribution.impact = impact;
  payload.distribution = distribution;
  payload.warnings = reviewAssignmentWarnings(distribution, payload.warnings);
}

function updateTrainingReviewDraft(change) {
  var draft = trainingWorkspaceState.reviewDraft;
  if (!draft || !change(draft.plan)) return;
  trainingWorkspaceState.reviewDraftDirty = true;
  recomputeTrainingReviewDistribution(draft);
  renderTrainingReview();
}

function reviewCandidateImpactTitle(payload, view, aspect, selected, candidate) {
  var changed = 0;
  var closer = 0;
  var majorUpscaleReduced = 0;
  var eligible = 0;
  var projectedTargets = selected.concat([candidate]);
  var group = (reviewViewGroups(payload, view)[aspect] || {});
  (((group || {}).native) || []).forEach(function (row) {
    var projectedEligibility = view === 'detail' ? reviewDetailEligibility(row, projectedTargets, group.frames) : { eligible: row.eligible };
    if (!projectedEligibility.eligible) return;
    eligible += 1;
    var current = row.assignedTarget || row.target || [];
    var projected = reviewProjectedTarget(view, row, projectedTargets);
    if (!projected || sameReviewBucket(current, projected)) return;
    changed += 1;
    if (!current.length) return;
    var edge = Math.min(Number(row.width), Number(row.height));
    var currentDistance = Math.abs(Math.log(Math.min(current[0], current[1]) / edge));
    var projectedDistance = Math.abs(Math.log(Math.min(projected[0], projected[1]) / edge));
    if (projectedDistance < currentDistance) closer += 1;
    if (Math.min(current[0], current[1]) / edge > 1.2 && Math.min(projected[0], projected[1]) / edge <= 1.2) majorUpscaleReduced += 1;
  });
  var pressure = reviewBucketPressureNote(payload, view, aspect, candidate);
  if (!changed) return 'Would not change current assignments.' + (pressure ? ' ' + pressure + '.' : '');
  var text = 'Would become the target for ' + changed + ' of ' + eligible + ' item' + (eligible === 1 ? '' : 's') + '; ' + closer + ' would train closer to native resolution.';
  if (majorUpscaleReduced) text += ' Removes >20% upscale for ' + majorUpscaleReduced + ' item' + (majorUpscaleReduced === 1 ? '' : 's') + '.';
  if (pressure) text += ' ' + pressure + '.';
  return text;
}

function reviewNeutralTargetChipHtml(payload, view, aspect, selected, bucket) {
  var disabled = selected.length >= 3;
  var title = reviewCandidateImpactTitle(payload, view, aspect, selected, bucket);
  if (disabled) title = 'Use at most three targets per cohort. ' + title;
  return '<button type="button" class="training-review-target-chip neutral ' + reviewBucketPressureLevel(payload, view, aspect, bucket) + '" data-review-target="' + bucket.join(',') + '"' + (disabled ? ' disabled' : '') + ' title="' + escapeHtml(title) + '">' + escapeHtml(bucket[0] + ' × ' + bucket[1]) + '</button>';
}

function reviewTargetsHtml(payload, view, aspect) {
  var plan = payload.plan || {};
  var selected = reviewSelectedBuckets(plan, view, aspect);
  var candidates = reviewCandidates(payload, view, aspect);
  var limitNote = reviewVideoLimitNote(payload, view, aspect);
  var neutral = candidates.filter(function (bucket) { return !hasReviewBucket(plan, view, aspect, bucket); });
  var visible = [];
  function addVisible(bucket) {
    if (bucket && !visible.some(function (item) { return sameReviewBucket(item, bucket); })) visible.push(bucket);
  }
  selected.forEach(function (bucket) {
    var index = candidates.findIndex(function (item) { return sameReviewBucket(item, bucket); });
    addVisible(candidates[index - 1]);
    addVisible(candidates[index + 1]);
  });
  var nativeEdges = (((reviewViewGroups(payload, view)[aspect] || {}).native) || []).map(function (item) { return Number(item.nativeShortEdge || item.edge || 0); }).filter(Boolean);
  if (nativeEdges.length) {
    var low = Math.min.apply(Math, nativeEdges);
    var high = Math.max.apply(Math, nativeEdges);
    [low, high].forEach(function (edge) {
      addVisible(candidates.reduce(function (nearest, bucket) {
        return !nearest || Math.abs(Math.min(bucket[0], bucket[1]) - edge) < Math.abs(Math.min(nearest[0], nearest[1]) - edge) ? bucket : nearest;
      }, null));
    });
  }
  visible = visible.filter(function (bucket) { return neutral.some(function (item) { return sameReviewBucket(item, bucket); }); }).sort(function (a, b) {
    return candidates.findIndex(function (item) { return sameReviewBucket(item, a); }) - candidates.findIndex(function (item) { return sameReviewBucket(item, b); });
  }).slice(0, 4);
  function selectedChip(bucket) {
    var color = reviewTargetColor(selected, bucket);
    var removeDisabled = selected.length <= 1;
    var pressure = reviewBucketPressureNote(payload, view, aspect, bucket);
    var decreaseTitle = 'Decrease one rung' + (pressure ? '. ' + pressure : '');
    var increaseTitle = 'Increase one rung' + (pressure ? '. ' + pressure : '');
    return '<span class="training-review-selected-target ' + color + ' ' + reviewBucketPressureLevel(payload, view, aspect, bucket) + '"><button type="button" class="training-review-step" data-review-step="1" data-review-target="' + bucket.join(',') + '" aria-label="Decrease one rung" title="' + escapeHtml(decreaseTitle) + '">−</button><button type="button" class="training-review-target-chip selected" data-review-target="' + bucket.join(',') + '"' + (removeDisabled ? ' disabled title="Choose another target before removing this one."' : pressure ? ' title="' + escapeHtml(pressure) + '"' : '') + '>' + escapeHtml(bucket[0] + ' × ' + bucket[1]) + '</button><button type="button" class="training-review-step" data-review-step="-1" data-review-target="' + bucket.join(',') + '" aria-label="Increase one rung" title="' + escapeHtml(increaseTitle) + '">+</button></span>';
  }
  function neutralChip(bucket) { return reviewNeutralTargetChipHtml(payload, view, aspect, selected, bucket); }
  return '<section class="training-review-targets"><div class="training-review-label-row"><strong>Training targets</strong><div class="training-review-target-utilities">' + limitNote + '</div></div><div class="training-review-target-instructions">Choose up to three. +/− moves a selected target one rung.</div><div class="training-review-target-groups"><div class="training-review-target-row"><span>Selected</span><div class="training-review-chip-strip">' + (selected.length ? selected.map(selectedChip).join('') : '<span class="training-review-empty-selection">No target selected.</span>') + '</div></div><div class="training-review-target-add"><div class="training-review-target-row"><span>Add target</span><div class="training-review-chip-strip">' + visible.map(neutralChip).join('') + '</div></div></div></div></section>';
}

function reviewDotPopoverHtml(row) {
  var target = row.assignedTarget || row.target || [];
  var scaleRatio = Number(row.scaleRatio || 1);
  var scale = Math.round((scaleRatio - 1) * 100);
  var resize = Math.abs(scale) < 1 ? 'No meaningful resize · 1.00×' : (scale > 0 ? 'Upscale ' : 'Downscale ') + scaleRatio.toFixed(2) + '× · ' + (scale > 0 ? '+' : '') + scale + '%';
  var impact = TRAINING_REVIEW_IMPACT_BANDS.filter(function (item) { return item[0] === row.impactBand; })[0];
  return '<strong>' + escapeHtml(row.file || 'Source media') + '</strong><span>Native · ' + escapeHtml(row.width + ' × ' + row.height) + '</span>' +
    (target.length ? '<span>Target · ' + escapeHtml(target[0] + ' × ' + target[1]) + '</span><span>' + escapeHtml(resize) + (impact ? ' · ' + escapeHtml(impact[1]) : '') + '</span>' : '') +
    (Number(row.frames || 0) ? '<span>' + escapeHtml(String(row.frames)) + ' frames</span>' : '') +
    '<span>' + (row.eligible ? 'Eligible' : 'Not eligible') + (row.eligibilityReason ? ' · ' + escapeHtml(row.eligibilityReason) : '') + '</span>';
}

function hideReviewDotPopover(modal) {
  var popover = modal.querySelector('.training-review-dot-popover');
  if (!popover || popover.classList.contains('hidden')) return false;
  popover.classList.add('hidden');
  popover.setAttribute('aria-hidden', 'true');
  return true;
}

function showReviewDotPopover(modal, payload, dot) {
  var view = reviewActiveView(payload);
  var aspect = reviewActiveAspect(payload, view);
  var row = ((reviewViewGroups(payload, view)[aspect] || {}).native || [])[Number(dot.getAttribute('data-review-dot-index'))];
  var plot = dot.closest('.training-review-plot');
  var popover = plot.querySelector('.training-review-dot-popover');
  if (!row) throw new Error('Training Review dot has no matching source row.');
  popover.innerHTML = reviewDotPopoverHtml(row);
  popover.style.left = dot.style.left;
  popover.style.bottom = (Number(String(dot.style.bottom || '').replace('px', '')) + 18) + 'px';
  popover.classList.remove('hidden');
  popover.setAttribute('aria-hidden', 'false');
}

function reviewChartHtml(payload, view, group, selected, aspect) {
  var rows = group && group.native || [];
  if (!rows.length) return '<section class="training-review-chart-empty">No eligible media is visible in this cohort.</section>';
  var shapes = (group.targets || []).map(function (item) { return item.shape || []; });
  var sourceEdges = rows.map(function (item) { return Number(item.nativeShortEdge || item.edge || 0); }).filter(Boolean);
  var candidateEdges = reviewCandidates(payload, view, aspect).map(function (item) { return Math.min(Number(item[0]), Number(item[1])); }).filter(Boolean);
  var selectedEdges = shapes.map(function (item) { return Math.min(Number(item[0]), Number(item[1])); }).filter(Boolean);
  var limit = view === 'images' ? null : (((payload.videoLimits || {})[view] || {})[aspect]) || null;
  var maximumEdge = limit && limit.effectiveCeiling ? Math.min(Number(limit.effectiveCeiling[0]), Number(limit.effectiveCeiling[1])) : Math.max.apply(Math, candidateEdges.concat(selectedEdges));
  if (!isFinite(maximumEdge) || !maximumEdge) maximumEdge = Math.max.apply(Math, sourceEdges);
  var defaultEdge = limit && limit.automaticDefaultCeiling ? Math.min(Number(limit.automaticDefaultCeiling[0]), Number(limit.automaticDefaultCeiling[1])) : 0;
  var floorEdge = candidateEdges.length ? Math.min.apply(Math, candidateEdges) : 0;
  var leftValues = sourceEdges.filter(function (edge) { return edge <= maximumEdge; }).concat(candidateEdges, selectedEdges, [floorEdge, defaultEdge, maximumEdge]).filter(Boolean);
  var sourceLow = Math.min.apply(Math, leftValues);
  var leftSpan = Math.max(64, maximumEdge - sourceLow);
  var tickSteps = [32, 64, 96, 128, 160, 192, 256];
  var step = tickSteps.filter(function (value) { return value >= leftSpan / 5; })[0] || 256;
  var low = Math.max(0, Math.floor((sourceLow - step * .5) / step) * step);
  if (maximumEdge - low < step * 3) low = Math.max(0, maximumEdge - step * 3);
  var aboveMaximum = sourceEdges.filter(function (edge) { return edge > maximumEdge; }).sort(function (a, b) { return a - b; });
  var nextPopulation = aboveMaximum[0] || 0;
  var emptyGap = nextPopulation - maximumEdge;
  // Only skip a visibly substantial empty interval after the effective maximum.
  var hasBreak = !!nextPopulation && emptyGap >= Math.max(step * 2, (maximumEdge - low) * .35);
  var highSource = sourceEdges.length ? Math.max.apply(Math, sourceEdges) : maximumEdge;
  var rightStep = tickSteps.filter(function (value) { return value >= Math.max(32, highSource - nextPopulation) / 3; })[0] || 256;
  var rightLow = hasBreak ? nextPopulation : 0;
  var rightHigh = hasBreak ? Math.ceil((highSource + rightStep * .5) / rightStep) * rightStep : 0;
  if (hasBreak && rightHigh - rightLow < rightStep * 2) rightHigh = rightLow + rightStep * 2;
  var normalHigh = Math.ceil((Math.max(maximumEdge, highSource) + step) / step) * step;
  if (!hasBreak && normalHigh - low < step * 3) normalHigh = low + step * 3;
  var high = hasBreak ? maximumEdge : normalHigh;
  var segments = hasBreak
    ? [{ low: low, high: high, start: 1.5, end: 70, bins: 10 }, { low: rightLow, high: rightHigh, start: 76, end: 98.5, bins: 5 }]
    : [{ low: low, high: high, start: 1.5, end: 98.5, bins: 12 }];
  function segmentForEdge(edge) { return hasBreak && Number(edge) > maximumEdge ? segments[1] : segments[0]; }
  function position(value) {
    var segment = segmentForEdge(Number(value));
    return segment.start + ((Number(value) - segment.low) / Math.max(1, segment.high - segment.low)) * (segment.end - segment.start);
  }
  var ticks = [];
  segments.forEach(function (segment) {
    var tickSize = segment === segments[0] ? step : rightStep;
    for (var tick = segment.low; tick <= segment.high; tick += tickSize) ticks.push(tick);
    if (ticks[ticks.length - 1] !== segment.high) ticks.push(segment.high);
  });
  function binForEdge(edge) {
    var segment = segmentForEdge(edge);
    var index = Math.min(segment.bins - 1, Math.max(0, Math.floor((edge - segment.low) / Math.max(1, (segment.high - segment.low) / segment.bins))));
    return segments.indexOf(segment) + ':' + index;
  }
  function binBounds(key) {
    var values = key.split(':').map(Number);
    var segment = segments[values[0]];
    var width = (segment.high - segment.low) / segment.bins;
    return [segment.low + values[1] * width, segment.low + (values[1] + 1) * width];
  }
  var bins = {};
  rows.forEach(function (row) { var key = binForEdge(Number(row.nativeShortEdge || row.edge || 0)); bins[key] = Number(bins[key] || 0) + 1; });
  var maximum = Math.max.apply(Math, [1].concat(Object.keys(bins).map(function (key) { return bins[key]; })));
  var stacks = {};
  var orderedTargets = (group.targets || []).slice().sort(function (a, b) {
    return Math.min(a.shape[0], a.shape[1]) - Math.min(b.shape[0], b.shape[1]);
  });
  var zones = orderedTargets.map(function (target, index) {
    var edge = Math.min(target.shape[0], target.shape[1]);
    var prior = index ? Math.min(orderedTargets[index - 1].shape[0], orderedTargets[index - 1].shape[1]) : low;
    var next = index + 1 < orderedTargets.length ? Math.min(orderedTargets[index + 1].shape[0], orderedTargets[index + 1].shape[1]) : high;
    var start = index ? (prior + edge) / 2 : low;
    var end = index + 1 < orderedTargets.length ? (edge + next) / 2 : high;
    return '<i class="training-review-target-zone ' + reviewTargetColor(selected, target.shape) + '" style="left:' + position(start) + '%;width:' + Math.max(0, position(end) - position(start)) + '%"></i>';
  }).join('');
  var gridlines = ticks.map(function (value) { return '<i class="training-review-chart-gridline" style="left:' + position(value) + '%"></i>'; }).join('');
  var histogram = Object.keys(bins).map(function (key) {
    var count = bins[key];
    var bounds = binBounds(key);
    var start = position(bounds[0]);
    var end = position(bounds[1]);
    return '<i class="training-review-hist-bin" style="left:' + start + '%;width:' + Math.max(0, end - start) + '%;height:' + Math.round((count / maximum) * 72) + '%"></i>';
  }).join('');
  var dots = rows.map(function (row, rowIndex) {
    var edge = Number(row.nativeShortEdge || row.edge || 0);
    var bin = binForEdge(edge);
    var ordinal = stacks[bin] || 0;
    stacks[bin] = ordinal + 1;
    var target = row.assignedTarget || row.target || [];
    var bounds = binBounds(bin);
    var binStart = position(bounds[0]);
    var binEnd = position(bounds[1]);
    var lane = ((ordinal % 5) - 2) * .42;
    var dotLeft = Math.max(binStart + .7, Math.min(binEnd - .7, position(edge) + lane));
    var level = Math.floor(ordinal / 5);
    var scaleRatio = Number(row.scaleRatio || 1);
    var scale = Math.round((scaleRatio - 1) * 100);
    var resize = Math.abs(scale) < 1 ? 'No meaningful resize · 1.00×' : (scale > 0 ? 'Upscale ' : 'Downscale ') + scaleRatio.toFixed(2) + '× · ' + (scale > 0 ? '+' : '') + scale + '%';
    var resolutionExcluded = view === 'detail' && !row.eligible && reviewDetailFrameEligible(row, group.frames);
    return '<button type="button" class="training-review-chart-dot ' + reviewTargetColor(selected, target) + ' impact-' + escapeHtml(row.impactBand || 'near') + (resolutionExcluded ? ' detail-resolution-ineligible' : '') + '" style="left:' + dotLeft + '%;bottom:' + (11 + level * 15) + 'px" data-review-dot-index="' + rowIndex + '" aria-label="Inspect ' + escapeHtml(row.file || 'source media') + '"></button>';
  }).join('');
  var markers = (group.targets || []).map(function (target) {
    var shape = target.shape || [];
    var edge = Math.min(Number(shape[0]), Number(shape[1]));
    return '<b class="training-review-chart-marker ' + reviewTargetColor(selected, shape) + ' ' + reviewBucketPressureLevel(payload, view, aspect, shape) + '" style="left:' + position(edge) + '%"><span>' + escapeHtml(shape[0] + ' × ' + shape[1]) + '</span><em>' + escapeHtml(String(target.assignedCount || 0)) + '</em></b>';
  }).join('');
  function envelopeMarker(kind, edge, label, title) {
    return edge ? '<b class="training-review-envelope-marker ' + kind + '" style="left:' + position(edge) + '%" title="' + escapeHtml(title) + '"><span>' + escapeHtml(label) + '</span></b>' : '';
  }
  var envelope = view === 'images' ? '' : envelopeMarker('floor', floorEdge, 'Floor', 'Lowest selectable supported rung') + envelopeMarker('default', defaultEdge, defaultEdge === maximumEdge ? 'Default / max' : 'Default', defaultEdge === maximumEdge ? 'Automatic default ceiling and effective maximum' : 'Automatic default ceiling') + (defaultEdge === maximumEdge ? '' : envelopeMarker('maximum', maximumEdge, 'Max', limit && limit.source === 'calibration' ? 'Calibrated maximum' : 'Effective maximum'));
  var tickLabels = ticks.map(function (value) { return '<span style="left:' + position(value) + '%">' + escapeHtml(String(value)) + '</span>'; }).join('');
  var axisBreak = hasBreak ? '<i class="training-review-axis-break" style="left:' + ((segments[0].end + segments[1].start) / 2) + '%" aria-label="Resolution scale skips an empty interval"><b></b><b></b></i>' : '';
  var detailFloor = view === 'detail' && selected.length ? selected.reduce(function (lowest, target) {
    return !lowest || target[0] * target[1] < lowest[0] * lowest[1] ? target : lowest;
  }, null) : null;
  var detailExcluded = detailFloor ? rows.filter(function (row) { return !row.eligible && reviewDetailFrameEligible(row, group.frames); }).length : 0;
  var detailHint = detailFloor ? '<span class="training-review-detail-floor">Detail floor: ' + escapeHtml(detailFloor[0] + ' × ' + detailFloor[1]) + ' · sources below the lowest selected target are excluded; Detail never upscales.' + (detailExcluded ? ' ' + detailExcluded + ' excluded.' : '') + '</span>' : '';
  return '<section class="training-review-chart"><div class="training-review-chart-heading"><div><strong>Native fit for ' + escapeHtml(formatReviewAspect(aspect)) + '</strong><span>Bars group nearby native short edges; each dot is one source file.</span>' + detailHint + '</div><div class="training-review-legend"><span><i class="histogram"></i>Native range</span><span><i class="native"></i>Native media</span><span><i class="target"></i>Bucket target</span></div></div><div class="training-review-plot">' + zones + gridlines + histogram + dots + markers + envelope + axisBreak + '<div class="training-review-dot-popover hidden" role="status" aria-live="polite" aria-hidden="true"></div></div><div class="training-review-chart-axis"><div class="training-review-chart-ticks">' + tickLabels + axisBreak + '</div><span>Native short edge (px)</span></div></section>';
}

function reviewImpactHtml(payload, view) {
  var impact = view === 'images' ? (((payload.distribution || {}).impact || {}).images || {}) : (((((payload.distribution || {}).impact || {}).videos || {})[view]) || {});
  var total = TRAINING_REVIEW_IMPACT_BANDS.reduce(function (sum, item) { return sum + Number(impact[item[0]] || 0); }, 0);
  if (!total) return '';
  return '<section class="training-review-impact"><div class="training-review-label-row"><strong>Scale impact · all cohort tabs</strong><span>' + total + ' eligible item' + (total === 1 ? '' : 's') + '</span></div><div class="training-review-impact-direction"><span>Smaller target</span><span>Larger target</span></div><div class="training-review-impact-cells">' + TRAINING_REVIEW_IMPACT_BANDS.map(function (item) { var count = Number(impact[item[0]] || 0); var percent = Math.round(count / total * 100); return '<div class="training-review-impact-cell impact-' + item[0] + (count ? '' : ' is-empty') + '" title="' + count + ' of ' + total + ' eligible items"><b>' + count + '</b><em>' + percent + '%</em><span>' + escapeHtml(item[1]) + '</span></div>'; }).join('') + '</div></section>';
}

function reviewSubstantialUpscaleRows(payload, view, aspect) {
  return (((reviewViewGroups(payload, view)[aspect] || {}).native) || []).filter(function (row) {
    return row && row.eligible && row.impactBand === 'up20' && (row.assignedTarget || row.target || []).length;
  });
}

function reviewCanStepBucket(payload, view, aspect, bucket, direction) {
  var candidates = reviewCandidates(payload, view, aspect);
  var selected = reviewSelectedBuckets(payload.plan || {}, view, aspect);
  var index = candidates.findIndex(function (item) { return sameReviewBucket(item, bucket); });
  for (var cursor = index + direction; index >= 0 && cursor >= 0 && cursor < candidates.length; cursor += direction) {
    if (!selected.some(function (selectedBucket) { return sameReviewBucket(selectedBucket, candidates[cursor]); })) return true;
  }
  return false;
}

function reviewRailViews(payload) {
  return reviewViewItems(payload).filter(function (item) {
    var role = item.id === 'images' ? null : reviewRole((payload || {}).plan || {}, item.id);
    return !role || role.enabled;
  });
}

function reviewRailLabel(view) {
  return view === 'images' ? 'Images' : view.charAt(0).toUpperCase() + view.slice(1);
}

function reviewRailNotices(payload) {
  var notices = [];
  reviewRailViews(payload).forEach(function (item) {
    var view = item.id;
    var groups = reviewViewGroups(payload, view);
    TRAINING_REVIEW_ASPECT_ORDER.filter(function (aspect) { return !!groups[aspect]; }).forEach(function (aspect) {
      var group = groups[aspect] || {};
      var selected = reviewSelectedBuckets(payload.plan || {}, view, aspect);
      var upscaleRows = reviewSubstantialUpscaleRows(payload, view, aspect);
      var targets = upscaleRows.map(function (row) { return row.assignedTarget || row.target || []; });
      var commonTarget = targets.length && targets.every(function (target) { return sameReviewBucket(target, targets[0]); }) ? targets[0] : null;
      if (upscaleRows.length) notices.push({
        view: view, aspect: aspect, title: 'Substantial upscale',
        message: upscaleRows.length + ' eligible item' + (upscaleRows.length === 1 ? '' : 's') + ' need more than 20% enlargement.',
        lowerTarget: commonTarget && reviewCanStepBucket(payload, view, aspect, commonTarget, 1) ? commonTarget : null
      });
      selected.forEach(function (target) {
        var pressure = reviewBucketPressureLevel(payload, view, aspect, target);
        if (pressure !== 'pressure-high' && pressure !== 'pressure-medium') return;
        notices.push({
          view: view, aspect: aspect, title: pressure === 'pressure-high' ? 'At tested limit' : 'Near tested limit',
          message: target[0] + ' × ' + target[1] + ' · ' + reviewBucketPressureNote(payload, view, aspect, target)
        });
      });
      if (view === 'detail') {
        var resolutionExcluded = (group.native || []).filter(function (row) { return !row.eligible && reviewDetailFrameEligible(row, group.frames); }).length;
        if (resolutionExcluded) notices.push({
          view: view, aspect: aspect, title: 'Detail sources excluded',
          message: resolutionExcluded + ' source' + (resolutionExcluded === 1 ? '' : 's') + ' fall below the selected Detail floor.'
        });
        var ladder = reviewCandidates(payload, view, aspect);
        selected.forEach(function (target) {
          if (ladder.length > 1 && sameReviewBucket(target, ladder[ladder.length - 1])) notices.push({
            view: view, aspect: aspect, title: 'Very low Detail target',
            message: target[0] + ' × ' + target[1] + ' is at the bottom of the supported ladder and may work against Detail’s higher-resolution purpose.'
          });
        });
      }
      (payload.warnings || []).filter(function (warning) {
        return warning.code !== 'substantial_upscale' && warning.view === view && warning.ar === aspect;
      }).forEach(function (warning) {
        notices.push({ view: view, aspect: aspect, title: warning.code === 'small_bucket' ? 'Lightly used target' : 'Worth noticing', message: warning.message || '' });
      });
    });
  });
  return notices;
}

function reviewRailHtml(payload) {
  var notices = reviewRailNotices(payload);
  var planGroups = reviewRailViews(payload).map(function (item) {
    var view = item.id;
    var groups = reviewViewGroups(payload, view);
    var rows = TRAINING_REVIEW_ASPECT_ORDER.filter(function (aspect) { return !!groups[aspect]; }).map(function (aspect) {
      var selected = reviewSelectedBuckets(payload.plan || {}, view, aspect);
      return '<button type="button" class="training-review-rail-plan-row" data-review-rail-view="' + escapeHtml(view) + '" data-review-rail-aspect="' + escapeHtml(aspect) + '"><span>' + escapeHtml(formatReviewAspect(aspect)) + '</span><strong>' + escapeHtml(selected.length ? selected.map(function (target) { return target[0] + ' × ' + target[1]; }).join(' · ') : 'No target') + '</strong></button>';
    }).join('');
    return rows ? '<section class="training-review-rail-plan-group"><strong>' + escapeHtml(reviewRailLabel(view)) + '</strong>' + rows + '</section>' : '';
  }).join('');
  var noticeHtml = notices.length ? '<section class="training-review-rail-section training-review-rail-notices"><strong>Worth noticing</strong><div class="training-review-rail-notice-list">' + notices.map(function (notice) {
    return '<div class="training-review-rail-notice"><span>' + escapeHtml(reviewRailLabel(notice.view) + ' · ' + formatReviewAspect(notice.aspect)) + '</span><b>' + escapeHtml(notice.title) + '</b><p>' + escapeHtml(notice.message) + '</p><div><button type="button" class="training-review-rail-review" data-review-rail-view="' + escapeHtml(notice.view) + '" data-review-rail-aspect="' + escapeHtml(notice.aspect) + '">Review</button>' + (notice.lowerTarget ? '<button type="button" class="training-review-rail-review" data-review-lower-upscale-target="' + escapeHtml(notice.lowerTarget.join(',')) + '">Lower one rung</button>' : '') + '</div></div>';
  }).join('') + '</div></section>' : '';
  return '<aside class="training-review-rail">' + noticeHtml + '<section class="training-review-rail-section training-review-selected-plan"><strong>Selected plan</strong><div class="training-review-rail-plan-list">' + (planGroups || '<span class="training-review-muted">No enabled categories.</span>') + '</div></section></aside>';
}

function reviewModalHtml(payload) {
  var custom = payload.customDataset || false;
  if (custom) return '<section class="training-review-custom"><strong>Bucket controls are unavailable for this custom dataset TOML.</strong><span>' + escapeHtml(custom.message || 'Edit the raw dataset TOML or reset it to the current defaults.') + '</span><div><button type="button" class="review-captions-btn" data-review-open-dataset="' + escapeHtml(custom.datasetName || '') + '">Open raw TOML</button><button type="button" class="review-captions-btn" data-review-reset-dataset="' + escapeHtml(custom.datasetName || '') + '">Reset dataset</button></div></section>';
  var plan = payload.plan || {};
  var view = reviewActiveView(payload);
  var groups = reviewViewGroups(payload, view);
  var aspect = reviewActiveAspect(payload, view);
  var role = view === 'images' ? null : reviewRole(plan, view);
  var views = reviewViewItems(payload);
  var viewCount = Object.keys(groups).reduce(function (total, ar) { return total + Number((groups[ar] || {}).count || 0); }, 0);
  var eligibleCount = Object.keys(groups).reduce(function (total, ar) { return total + Number((groups[ar] || {}).eligibleCount || 0); }, 0);
  var missingFrameCount = Object.keys(groups).reduce(function (total, ar) { return total + Number((groups[ar] || {}).missingFrameCount || 0); }, 0);
  var shortFrameCount = Object.keys(groups).reduce(function (total, ar) { return total + Number((groups[ar] || {}).shortFrameCount || 0); }, 0);
  function label(id) { return id === 'images' ? 'Images' : id.charAt(0).toUpperCase() + id.slice(1); }
  var roleNotes = [];
  if (role && missingFrameCount) roleNotes.push(missingFrameCount + ' video' + (missingFrameCount === 1 ? ' has' : 's have') + ' no readable frame count.');
  if (role && shortFrameCount) roleNotes.push(shortFrameCount + ' video' + (shortFrameCount === 1 ? ' is' : 's are') + ' shorter than ' + role.frames + ' frames.');
  if (role && !eligibleCount && !roleNotes.length) roleNotes.push('No current video reaches this role’s ' + role.frames + '-frame requirement.');
  return '<section class="training-review-layout"><section class="training-review-workbench"><div class="training-review-scope"><div class="training-review-tabs" role="tablist">' + views.map(function (item) {
    var itemRole = item.id === 'images' ? null : reviewRole(plan, item.id);
    var itemEligible = Number(item.eligibleCount || 0);
    var itemCount = Number(item.count || 0);
    var itemTitle = itemRole ? itemRole.frames + ' frames · ' + itemEligible + ' of ' + itemCount + ' videos eligible' : itemCount + ' image' + (itemCount === 1 ? '' : 's');
    if (item.id === view && roleNotes.length) itemTitle += '. ' + roleNotes.join(' ');
    if (!itemRole) return '<button type="button" class="training-review-tab training-review-image-tab' + (item.id === view ? ' active' : '') + '" data-review-view="' + escapeHtml(item.id) + '" aria-selected="' + (item.id === view ? 'true' : 'false') + '" title="' + escapeHtml(itemTitle) + '">' + escapeHtml(label(item.id)) + ' <span>· ' + itemCount + '</span></button>';
    return '<div class="training-review-role-pill' + (item.id === view ? ' active' : '') + (itemRole.enabled ? '' : ' disabled') + '" title="' + escapeHtml(itemTitle) + '"><label class="training-review-role-toggle"><input type="checkbox" data-review-role-enabled="' + escapeHtml(itemRole.id) + '"' + (itemRole.enabled ? ' checked' : '') + ' aria-label="Enable ' + escapeHtml(label(item.id)) + ' role"></label><button type="button" class="training-review-tab" data-review-view="' + escapeHtml(item.id) + '" aria-selected="' + (item.id === view ? 'true' : 'false') + '"' + (itemRole.enabled ? '' : ' disabled') + '>' + escapeHtml(label(item.id)) + ' <span>· ' + itemEligible + '</span></button></div>';
  }).join('') + '</div><div class="training-review-cohort-row"><span class="training-review-cohort-label">' + escapeHtml(label(view) + ' ratios') + '</span><div class="training-review-cohort-tabs" role="tablist">' + TRAINING_REVIEW_ASPECT_ORDER.filter(function (id) { return !!groups[id]; }).map(function (id) {
    var cohortEligible = Number((groups[id] || {}).eligibleCount || 0);
    var tiny = cohortEligible < 4;
    return '<button type="button" class="training-review-cohort-tab' + (id === aspect ? ' active' : '') + '" data-review-aspect="' + escapeHtml(id) + '" aria-selected="' + (id === aspect ? 'true' : 'false') + '"' + (tiny ? ' title="Only ' + cohortEligible + ' eligible items in this cohort."' : '') + '>' + escapeHtml(formatReviewAspect(id)) + ' <span>· ' + cohortEligible + '</span>' + (tiny ? ' <b class="training-review-tiny-cohort" aria-label="Only ' + cohortEligible + ' eligible items in this cohort.">!</b>' : '') + '</button>';
  }).join('') + '</div></div></div>' +
    reviewTargetsHtml(payload, view, aspect) + reviewChartHtml(payload, view, groups[aspect] || {}, reviewSelectedBuckets(plan, view, aspect), aspect) + reviewImpactHtml(payload, view) + '</section>' + reviewRailHtml(payload) + '</section>';
}

function trainingReviewSummaryHtml(payload) {
  var imageTargetCount = 0;
  Object.keys((payload.plan || {}).stages || {}).forEach(function (stage) {
    Object.keys((((payload.plan || {}).stages || {})[stage].imageBuckets) || {}).forEach(function (aspect) {
      imageTargetCount += ((((payload.plan || {}).stages || {})[stage].imageBuckets || {})[aspect] || []).length;
    });
  });
  var videoTargetCount = 0;
  ((payload.plan || {}).videoRoles || []).forEach(function (role) {
    if (!role.enabled) return;
    Object.keys(role.buckets || {}).forEach(function (aspect) { videoTargetCount += ((role.buckets || {})[aspect] || []).length; });
  });
  var imageItems = Object.keys(((payload.distribution || {}).images) || {}).reduce(function (sum, aspect) {
    return sum + Number((((payload.distribution || {}).images || {})[aspect] || {}).count || 0);
  }, 0);
  var videoFiles = {};
  Object.keys(((payload.distribution || {}).videos) || {}).forEach(function (role) {
    Object.keys((((payload.distribution || {}).videos || {})[role]) || {}).forEach(function (aspect) {
      (((((payload.distribution || {}).videos || {})[role] || {})[aspect] || {}).native || []).forEach(function (row) {
        if (row && row.file) videoFiles[String(row.file)] = true;
      });
    });
  });
  var videoItems = Object.keys(videoFiles).length;
  var blockers = payload.blockers || [];
  var custom = payload.customDataset || false;
  var planParts = [];
  if (imageItems || imageTargetCount) planParts.push(imageTargetCount + ' image target' + (imageTargetCount === 1 ? '' : 's') + ' · ' + imageItems + ' image' + (imageItems === 1 ? '' : 's'));
  if (videoItems || videoTargetCount) planParts.push(videoTargetCount + ' video target' + (videoTargetCount === 1 ? '' : 's') + ' · ' + videoItems + ' video' + (videoItems === 1 ? '' : 's'));
  var note = custom ? 'Custom dataset TOML · edit it under Advanced configuration, or Reset dataset.' : blockers.length ? String(blockers[0].message || 'Training Review needs attention.') : (planParts.join(' · ') || 'No visible media in this bucket plan.');
  return '<div class="training-review-summary"><div class="training-review-summary-copy"><strong>Bucket plan <span class="training-review-saved">' + escapeHtml(trainingWorkspaceState.reviewSaveStatus === 'saving' ? 'Saving…' : trainingWorkspaceState.reviewSaveStatus === 'error' ? 'Save error' : 'Saved') + '</span></strong><span' + (custom || blockers.length || (payload.warnings || []).length ? ' class="training-review-summary-warning"' : '') + '>' + escapeHtml(note) + '</span></div><div class="training-review-summary-actions">' + (custom ? '' : '<button type="button" class="training-review-reset-defaults" data-review-reset-buckets>Reset Buckets</button>') + '<button type="button" class="review-captions-btn training-review-open-btn" data-open-training-review>Adjust buckets</button></div></div>';
}

function closeTrainingReviewModal() {
  var els = getTrainingWorkspaceEls();
  if (trainingWorkspaceState.reviewSavePending) return;
  trainingWorkspaceState.reviewModalOpen = false;
  trainingWorkspaceState.reviewDraft = null;
  trainingWorkspaceState.reviewDraftDirty = false;
  els.reviewModal.classList.add('hidden');
  els.reviewModal.setAttribute('aria-hidden', 'true');
  var button = els.review.querySelector('[data-open-training-review]');
  if (button) button.focus();
}

function openTrainingReviewModal() {
  var els = getTrainingWorkspaceEls();
  if (!trainingWorkspaceState.review || trainingWorkspaceState.reviewModalOpen) return;
  trainingWorkspaceState.reviewDraft = JSON.parse(JSON.stringify(trainingWorkspaceState.review));
  trainingWorkspaceState.reviewDraftDirty = false;
  trainingWorkspaceState.reviewModalOpen = true;
  els.reviewModal.classList.remove('hidden');
  els.reviewModal.setAttribute('aria-hidden', 'false');
  els.reviewModalClose.onclick = closeTrainingReviewModal;
  els.reviewModalDone.onclick = saveTrainingReviewDraft;
  els.reviewModalDone.disabled = false;
  renderTrainingReview();
  els.reviewModalClose.focus();
}

function saveTrainingReviewDraft() {
  var draft = trainingWorkspaceState.reviewDraft;
  if (!draft || !trainingWorkspaceState.reviewDraftDirty) {
    closeTrainingReviewModal();
    renderTrainingReview();
    return;
  }
  if (trainingWorkspaceState.reviewSavePending) return;
  var folder = state.folder;
  var request = trainingReviewPayload();
  request.plan = JSON.parse(JSON.stringify(draft.plan));
  trainingWorkspaceState.reviewSavePending = 1;
  trainingWorkspaceState.reviewSaveStatus = 'saving';
  renderTrainingReviewSaveStatus();
  var els = getTrainingWorkspaceEls();
  if (els.reviewModalDone) els.reviewModalDone.disabled = true;
  return trainingReviewRequest('/fs/training_review/update', request).then(function (payload) {
    if (state.folder !== folder || !isTrainingWorkspaceActive()) return;
    trainingWorkspaceState.review = payload;
    trainingWorkspaceState.reviewDraft = null;
    trainingWorkspaceState.reviewDraftDirty = false;
    trainingWorkspaceState.reviewModalOpen = false;
    els.reviewModal.classList.add('hidden');
    els.reviewModal.setAttribute('aria-hidden', 'true');
    trainingWorkspaceState.reviewSaveStatus = 'saved';
    renderTrainingReview();
  }).catch(function (err) {
    if (state.folder !== folder || !isTrainingWorkspaceActive()) return;
    trainingWorkspaceState.reviewSaveStatus = 'error';
    setStatus('Could not save Training Review: ' + String(err && err.message ? err.message : err));
    renderTrainingReview();
  }).finally(function () {
    trainingWorkspaceState.reviewSavePending = 0;
    renderTrainingReview();
    if (trainingWorkspaceState.reviewModalOpen) els.reviewModalDone.disabled = false;
  });
}

function bindTrainingReviewModal(payload) {
  var els = getTrainingWorkspaceEls();
  var modal = els.reviewModalContent;
  modal.querySelectorAll('[data-review-view]').forEach(function (button) { button.onclick = function () { trainingWorkspaceState.reviewMediaView = button.getAttribute('data-review-view'); trainingWorkspaceState.reviewAspect = ''; renderTrainingReview(); }; });
  modal.querySelectorAll('[data-review-aspect]').forEach(function (button) { button.onclick = function () { trainingWorkspaceState.reviewAspect = button.getAttribute('data-review-aspect'); renderTrainingReview(); }; });
  modal.querySelectorAll('[data-review-rail-view]').forEach(function (button) { button.onclick = function () {
    trainingWorkspaceState.reviewMediaView = button.getAttribute('data-review-rail-view');
    trainingWorkspaceState.reviewAspect = button.getAttribute('data-review-rail-aspect');
    renderTrainingReview();
  }; });
  modal.querySelectorAll('[data-review-target]').forEach(function (button) { button.onclick = function () {
    if (button.disabled) return;
    var target = String(button.getAttribute('data-review-target') || '').split(',').map(Number);
    var view = reviewActiveView(payload);
    var aspect = reviewActiveAspect(payload, view);
    var selected = hasReviewBucket(payload.plan, view, aspect, target);
    updateTrainingReviewDraft(function (plan) { return setReviewBucket(plan, view, aspect, target, !selected); });
  }; });
  modal.querySelectorAll('[data-review-step]').forEach(function (button) { button.onclick = function () {
    var target = String(button.getAttribute('data-review-target') || '').split(',').map(Number);
    var view = reviewActiveView(payload);
    var aspect = reviewActiveAspect(payload, view);
    updateTrainingReviewDraft(function (plan) { return stepReviewBucket(plan, payload.ladders || {}, view, aspect, target, Number(button.getAttribute('data-review-step'))); });
  }; });
  modal.querySelectorAll('[data-review-role-enabled]').forEach(function (input) { input.onchange = function () {
    var roleId = input.getAttribute('data-review-role-enabled');
    updateTrainingReviewDraft(function (plan) {
      var role = reviewRole(plan, roleId);
      role.enabled = input.checked;
      if (!input.checked && trainingWorkspaceState.reviewMediaView === role.id) {
        trainingWorkspaceState.reviewMediaView = reviewAvailableViews({ plan: plan, distribution: payload.distribution }).filter(function (candidate) {
          var candidateRole = candidate === 'images' ? null : reviewRole(plan, candidate);
          return candidate !== role.id && (!candidateRole || candidateRole.enabled);
        })[0] || 'images';
        trainingWorkspaceState.reviewAspect = '';
      }
      return true;
    });
  }; });
  modal.querySelectorAll('[data-review-lower-upscale-target]').forEach(function (button) { button.onclick = function () {
    var target = String(button.getAttribute('data-review-lower-upscale-target') || '').split(',').map(Number);
    var view = reviewActiveView(payload);
    var aspect = reviewActiveAspect(payload, view);
    updateTrainingReviewDraft(function (plan) { return stepReviewBucket(plan, payload.ladders || {}, view, aspect, target, 1); });
  }; });
  modal.querySelectorAll('[data-review-dot-index]').forEach(function (dot) {
    dot.onclick = function () { showReviewDotPopover(modal, payload, dot); };
    dot.onfocus = function () { showReviewDotPopover(modal, payload, dot); };
  });
  els.reviewModal.onclick = function (event) {
    if (!event.target.closest('[data-review-dot-index]') && !event.target.closest('.training-review-dot-popover')) hideReviewDotPopover(modal);
  };
  modal.querySelectorAll('[data-review-open-dataset]').forEach(function (button) { button.onclick = function () { closeTrainingReviewModal(); selectTrainingWorkspaceConfigFile(button.getAttribute('data-review-open-dataset')); }; });
  modal.querySelectorAll('[data-review-reset-dataset]').forEach(function (button) { button.onclick = function () {
    var fileName = button.getAttribute('data-review-reset-dataset');
    if (!window.confirm('Reset ' + fileName + ' from the currently visible media? Your edits to this file will be replaced.')) return;
    if (state.currentConfigFile && state.currentConfigFile.folder === state.folder && state.currentConfigFile.file === fileName) cancelEditorAutosaveForConfig(state.folder, fileName);
    resetTrainingReviewBuckets().then(function () { closeTrainingReviewModal(); refreshTrainingWorkspace(); }).catch(function (err) { setStatus('Could not reset dataset: ' + String(err.message || err)); });
  }; });
}

function reviewTrainButtonState(payload) {
  var button = getTrainingWorkspaceEls().queueJobBtn;
  if (!button) return;
  var checkpoint = document.getElementById('training-run-checkpoint-select');
  var manualResume = document.getElementById('training-run-resume-input');
  var startPoint = trainingWorkspaceState.reviewStartingPoint || 'fresh';
  button.disabled = !!trainingWorkspaceState.reviewSavePending || !payload.ok || (startPoint === 'initializer' && !trainingWorkspaceState.reviewInitializerExportId && !String(trainingWorkspaceState.reviewInitializerCustomPath || '').trim()) || (startPoint === 'resume' && !(checkpoint && checkpoint.value) && !(manualResume && manualResume.value.trim()));
}

function renderTrainingReview() {
  var els = getTrainingWorkspaceEls();
  if (!els.review || !els.reviewModalContent) return;
  var canonicalPayload = trainingWorkspaceState.review;
  if (!canonicalPayload) {
    var message = trainingWorkspaceState.reviewError ? '<section class="training-review-error">' + escapeHtml(trainingWorkspaceState.reviewError) + '<button type="button" class="review-captions-btn" data-review-retry>Retry</button></section>' : 'Preparing bucket plan…';
    els.review.innerHTML = message;
    els.reviewModalContent.innerHTML = message;
    els.review.querySelectorAll('[data-review-retry]').forEach(function (button) { button.onclick = function () { refreshTrainingReview().catch(function () {}); }; });
    els.reviewModalContent.querySelectorAll('[data-review-retry]').forEach(function (button) { button.onclick = function () { refreshTrainingReview().catch(function () {}); }; });
    return;
  }
  renderTrainingStartingPointControls(canonicalPayload);
  els.review.innerHTML = trainingReviewSummaryHtml(canonicalPayload);
  els.review.querySelector('[data-open-training-review]').onclick = openTrainingReviewModal;
  var resetBuckets = els.review.querySelector('[data-review-reset-buckets]');
  if (resetBuckets) resetBuckets.onclick = function () {
    if (!window.confirm('Reset all bucket selections to WebCap defaults?')) return;
    resetTrainingReviewBuckets().then(function () { renderTrainingReview(); }).catch(function (err) { setStatus('Could not reset bucket selections: ' + String(err.message || err)); });
  };
  var modalPayload = trainingWorkspaceState.reviewModalOpen && trainingWorkspaceState.reviewDraft ? trainingWorkspaceState.reviewDraft : canonicalPayload;
  els.reviewModalContent.innerHTML = reviewModalHtml(modalPayload);
  bindTrainingReviewModal(modalPayload);
  reviewTrainButtonState(canonicalPayload);
}

function renderTrainingReviewSaveStatus() {
  document.querySelectorAll('.training-review-saved').forEach(function (status) { status.textContent = trainingWorkspaceState.reviewSaveStatus === 'saving' ? 'Saving…' : trainingWorkspaceState.reviewSaveStatus === 'error' ? 'Save error' : 'Saved'; });
  var button = getTrainingWorkspaceEls().queueJobBtn;
  if (button && trainingWorkspaceState.reviewSavePending) button.disabled = true;
}

function refreshTrainingReview() {
  if (!isTrainingWorkspaceActive() || !state.folder) return Promise.resolve(null);
  var folder = state.folder;
  var requestId = Number(trainingWorkspaceState.reviewRequestId || 0) + 1;
  trainingWorkspaceState.reviewRequestId = requestId;
  trainingWorkspaceState.reviewPending = true;
  trainingWorkspaceState.reviewError = '';
  renderTrainingReview();
  return trainingReviewRequest('/fs/training_review', trainingReviewPayload()).then(function (payload) {
    if (state.folder !== folder || !isTrainingWorkspaceActive() || trainingWorkspaceState.reviewRequestId !== requestId) return null;
    trainingWorkspaceState.review = payload;
    trainingWorkspaceState.reviewPending = false;
    renderTrainingReview();
    return payload;
  }).catch(function (err) {
    if (state.folder !== folder || !isTrainingWorkspaceActive() || trainingWorkspaceState.reviewRequestId !== requestId) return null;
    trainingWorkspaceState.reviewPending = false;
    trainingWorkspaceState.review = null;
    trainingWorkspaceState.reviewError = String(err && err.message ? err.message : err);
    renderTrainingReview();
    throw err;
  });
}

function resetTrainingReviewBuckets() {
  var request = trainingReviewPayload();
  request.reset = 'buckets';
  return trainingReviewRequest('/fs/training_review/update', request).then(function (payload) {
    trainingWorkspaceState.review = payload;
    return payload;
  });
}

document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape' && trainingWorkspaceState.reviewModalOpen) {
    if (hideReviewDotPopover(getTrainingWorkspaceEls().reviewModalContent)) {
      event.preventDefault();
      return;
    }
    closeTrainingReviewModal();
  }
});
