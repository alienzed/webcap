// Training Review is a view onto the set-owned TOMLs. It keeps no parallel
// bucket authority in folder state.

var TRAINING_REVIEW_ASPECT_ORDER = ['43', '34', '169', '916', 'square'];
var TRAINING_REVIEW_IMPACT_BANDS = [
  ['down20', '20%+ down'], ['down', '5–20% down'], ['near', 'Near native'], ['up', '5–20% up'], ['up20', '20%+ up']
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

function reviewAvailableViews(payload) {
  var views = [];
  if (Object.keys(reviewViewGroups(payload, 'images')).length) views.push('images');
  Object.keys(((payload.distribution || {}).videos || {})).forEach(function (role) {
    if (Object.keys(reviewViewGroups(payload, role)).length) views.push(role);
  });
  return views;
}

function reviewActiveView(payload) {
  var views = reviewAvailableViews(payload);
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

function reviewNeutralTargetChipHtml(bucket, selectedCount) {
  return '<button type="button" class="training-review-target-chip neutral" data-review-target="' + bucket.join(',') + '"' + (selectedCount >= 3 ? ' disabled title="Use at most three targets per cohort."' : '') + '>' + escapeHtml(bucket[0] + ' × ' + bucket[1]) + '</button>';
}

function reviewTargetsHtml(payload, view, aspect) {
  var plan = payload.plan || {};
  var selected = reviewSelectedBuckets(plan, view, aspect);
  var candidates = reviewCandidates(payload, view, aspect);
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
  visible = visible.filter(function (bucket) { return neutral.some(function (item) { return sameReviewBucket(item, bucket); }); }).slice(0, 4);
  var remaining = neutral.filter(function (bucket) { return !visible.some(function (item) { return sameReviewBucket(item, bucket); }); });
  function selectedChip(bucket) {
    var color = reviewTargetColor(selected, bucket);
    var removeDisabled = selected.length <= 1;
    return '<span class="training-review-selected-target ' + color + '"><button type="button" class="training-review-step" data-review-step="-1" data-review-target="' + bucket.join(',') + '" aria-label="Move target lower">‹</button><button type="button" class="training-review-target-chip selected" data-review-target="' + bucket.join(',') + '"' + (removeDisabled ? ' disabled title="Choose another target before removing this one."' : '') + '>' + escapeHtml(bucket[0] + ' × ' + bucket[1]) + '</button><button type="button" class="training-review-step" data-review-step="1" data-review-target="' + bucket.join(',') + '" aria-label="Move target higher">›</button></span>';
  }
  function neutralChip(bucket) { return reviewNeutralTargetChipHtml(bucket, selected.length); }
  return '<section class="training-review-targets"><div class="training-review-label-row"><strong>Training targets</strong><span>Choose up to three. Arrows move a selected target one rung.</span></div><div class="training-review-target-groups"><div class="training-review-target-row"><span>Selected</span><div class="training-review-chip-strip">' + selected.map(selectedChip).join('') + '</div></div><div class="training-review-target-row"><span>Add target</span><div class="training-review-chip-strip">' + visible.map(neutralChip).join('') + '</div></div>' + (remaining.length ? '<details class="training-review-more-targets"><summary>Other supported sizes (' + remaining.length + ')</summary><div class="training-review-chip-strip">' + remaining.map(neutralChip).join('') + '</div></details>' : '') + '</div></section>';
}

function reviewChartHtml(group, selected, candidates, aspect) {
  var rows = group && group.native || [];
  if (!rows.length) return '<section class="training-review-chart-empty">No eligible media is visible in this cohort.</section>';
  var shapes = (group.targets || []).map(function (item) { return item.shape || []; });
  var candidateEdges = (candidates || []).map(function (item) { return Math.min(Number(item[0]), Number(item[1])); }).filter(Boolean);
  var edges = candidateEdges.length ? candidateEdges : rows.map(function (item) { return Number(item.nativeShortEdge || item.edge || 0); }).filter(Boolean).concat(shapes.map(function (item) { return Math.min(Number(item[0]), Number(item[1])); }).filter(Boolean));
  var low = Math.min.apply(Math, edges);
  var high = Math.max.apply(Math, edges);
  var padding = candidateEdges.length ? 0 : Math.max(24, Math.round((high - low || low) * 0.08));
  low = Math.max(1, low - padding);
  high += padding;
  function position(value) { return Math.max(1.5, Math.min(98.5, ((Number(value) - low) / Math.max(1, high - low)) * 97)); }
  var bins = Array.apply(null, Array(12)).map(function () { return 0; });
  rows.forEach(function (row) { var bin = Math.min(11, Math.max(0, Math.floor(((Number(row.edge) - low) / Math.max(1, high - low)) * 12))); bins[bin] += 1; });
  var maximum = Math.max.apply(Math, [1].concat(bins));
  var stacks = {};
  var histogram = bins.map(function (count, index) { return '<i class="training-review-hist-bin" style="left:' + (index / 12 * 100) + '%;width:' + (100 / 12) + '%;height:' + Math.round((count / maximum) * 72) + '%"></i>'; }).join('');
  var dots = rows.map(function (row) {
    var edge = Number(row.edge || 0);
    var bin = Math.min(11, Math.max(0, Math.floor(((edge - low) / Math.max(1, high - low)) * 12)));
    var ordinal = stacks[bin] || 0;
    stacks[bin] = ordinal + 1;
    var target = row.assignedTarget || row.target || [];
    var lane = (ordinal % 5) - 2;
    var level = Math.floor(ordinal / 5);
    var scale = Math.round((Number(row.scaleRatio || 1) - 1) * 100);
    var detail = 'Native ' + row.width + ' × ' + row.height + ' · short edge ' + edge + ' px' + (target.length ? ' · target ' + target[0] + ' × ' + target[1] + ' · ' + (scale >= 0 ? '+' : '') + scale + '%' : ' · not eligible for this role');
    return '<i class="training-review-chart-dot ' + reviewTargetColor(selected, target) + '" style="left:' + position(edge) + '%;bottom:' + (11 + level * 15) + 'px;margin-left:' + (lane * 5) + 'px" title="' + escapeHtml(detail) + '"></i>';
  }).join('');
  var markers = (group.targets || []).map(function (target) {
    var shape = target.shape || [];
    var edge = Math.min(Number(shape[0]), Number(shape[1]));
    return '<b class="training-review-chart-marker ' + reviewTargetColor(selected, shape) + '" style="left:' + position(edge) + '%"><span>' + escapeHtml(shape[0] + ' × ' + shape[1]) + '</span><em>' + escapeHtml(String(target.assignedCount || 0)) + '</em></b>';
  }).join('');
  return '<section class="training-review-chart"><div class="training-review-chart-heading"><div><strong>Native fit for ' + escapeHtml(formatReviewAspect(aspect)) + '</strong><span>Short edge in pixels</span></div><div class="training-review-legend"><span><i class="native"></i>Native media</span><span><i class="target"></i>Bucket target</span></div></div><div class="training-review-plot">' + histogram + dots + markers + '</div><div class="training-review-chart-axis"><span>' + escapeHtml(Math.round(low) + ' px') + '</span><span>Native short edge</span><span>' + escapeHtml(Math.round(high) + ' px') + '</span></div></section>';
}

function reviewImpactHtml(payload, view) {
  var impact = view === 'images' ? (((payload.distribution || {}).impact || {}).images || {}) : (((((payload.distribution || {}).impact || {}).videos || {})[view]) || {});
  var total = TRAINING_REVIEW_IMPACT_BANDS.reduce(function (sum, item) { return sum + Number(impact[item[0]] || 0); }, 0);
  if (!total) return '';
  return '<section class="training-review-impact"><div class="training-review-label-row"><strong>Scale impact · all cohort tabs</strong><span>' + total + ' eligible item' + (total === 1 ? '' : 's') + '</span></div><div class="training-review-impact-bar">' + TRAINING_REVIEW_IMPACT_BANDS.map(function (item) { var count = Number(impact[item[0]] || 0); return '<span class="impact-' + item[0] + '" style="width:' + (count / total * 100) + '%"><b>' + count + '</b></span>'; }).join('') + '</div><div class="training-review-impact-labels">' + TRAINING_REVIEW_IMPACT_BANDS.map(function (item) { return '<span>' + escapeHtml(item[1]) + '</span>'; }).join('') + '</div></section>';
}

function reviewWarningsHtml(payload, view) {
  var warnings = (payload.warnings || []).filter(function (warning) { return !warning.view || warning.view === view; });
  if (!warnings.length) return '';
  return '<section class="training-review-warnings"><strong>Worth noticing</strong>' + warnings.map(function (warning) { return '<div>' + escapeHtml(warning.message || '') + '</div>'; }).join('') + '</section>';
}

function reviewModalHtml(payload) {
  var custom = payload.customDataset || false;
  if (custom) return '<section class="training-review-custom"><strong>Bucket controls are unavailable for this custom dataset TOML.</strong><span>' + escapeHtml(custom.message || 'Edit the raw dataset TOML or reset it to the current defaults.') + '</span><div><button type="button" class="review-captions-btn" data-review-open-dataset="' + escapeHtml(custom.datasetName || '') + '">Open raw TOML</button><button type="button" class="review-captions-btn" data-review-reset-dataset="' + escapeHtml(custom.datasetName || '') + '">Reset dataset</button></div></section>';
  var plan = payload.plan || {};
  var view = reviewActiveView(payload);
  var groups = reviewViewGroups(payload, view);
  var aspect = reviewActiveAspect(payload, view);
  var role = view === 'images' ? null : reviewRole(plan, view);
  var views = reviewAvailableViews(payload);
  var viewCount = Object.keys(groups).reduce(function (total, ar) { return total + Number((groups[ar] || {}).count || 0); }, 0);
  var cohortCount = Object.keys(groups).length;
  function label(id) { return id === 'images' ? 'Images' : id.charAt(0).toUpperCase() + id.slice(1); }
  return '<section class="training-review-workbench"><div class="training-review-overview"><div><strong>Dataset buckets</strong><span>' + viewCount + ' ' + escapeHtml(label(view).toLowerCase()) + ' · ' + cohortCount + ' cohort' + (cohortCount === 1 ? '' : 's') + '</span></div><div class="training-review-tabs" role="tablist">' + views.map(function (id) { return '<button type="button" class="training-review-tab' + (id === view ? ' active' : '') + '" data-review-view="' + escapeHtml(id) + '" aria-selected="' + (id === view ? 'true' : 'false') + '">' + escapeHtml(label(id)) + '</button>'; }).join('') + '</div></div>' +
    (role ? '<div class="training-review-role-summary"><label><input type="checkbox" data-review-role-enabled="' + escapeHtml(role.id) + '"' + (role.enabled ? ' checked' : '') + '> ' + escapeHtml(label(role.id)) + ' enabled</label><span>Fixed at ' + escapeHtml(String(role.frames)) + ' frames</span></div>' : '') +
    '<div class="training-review-cohort-tabs" role="tablist">' + TRAINING_REVIEW_ASPECT_ORDER.filter(function (id) { return !!groups[id]; }).map(function (id) { return '<button type="button" class="training-review-cohort-tab' + (id === aspect ? ' active' : '') + '" data-review-aspect="' + escapeHtml(id) + '" aria-selected="' + (id === aspect ? 'true' : 'false') + '">' + escapeHtml(formatReviewAspect(id)) + ' <span>· ' + Number((groups[id] || {}).count || 0) + '</span></button>'; }).join('') + '</div>' +
    reviewTargetsHtml(payload, view, aspect) + reviewChartHtml(groups[aspect] || {}, reviewSelectedBuckets(plan, view, aspect), reviewCandidates(payload, view, aspect), aspect) + reviewImpactHtml(payload, view) + reviewWarningsHtml(payload, view) + '</section>';
}

function trainingReviewSummaryHtml(payload) {
  var imageEntries = [];
  Object.keys((payload.review || {}).stages || {}).forEach(function (stage) { imageEntries = imageEntries.concat(((payload.review || {}).stages[stage].datasetEntries || []).filter(function (entry) { return entry.kind === 'image'; })); });
  var items = imageEntries.reduce(function (sum, entry) { return sum + Number(entry.eligibleCount || entry.count || 0); }, 0);
  var blockers = payload.blockers || [];
  var custom = payload.customDataset || false;
  var note = custom ? 'Custom dataset TOML · edit it under Advanced configuration, or Reset dataset.' : blockers.length ? String(blockers[0].message || 'Training Review needs attention.') : imageEntries.length + ' image target' + (imageEntries.length === 1 ? '' : 's') + ' · ' + items + ' image item' + (items === 1 ? '' : 's');
  return '<div class="training-review-summary"><div class="training-review-summary-copy"><strong>Bucket plan <span class="training-review-saved">' + escapeHtml(trainingWorkspaceState.reviewSaveStatus === 'saving' ? 'Saving…' : trainingWorkspaceState.reviewSaveStatus === 'error' ? 'Save error' : 'Saved') + '</span></strong><span' + (custom || blockers.length || (payload.warnings || []).length ? ' class="training-review-summary-warning"' : '') + '>' + escapeHtml(note) + '</span></div><button type="button" class="review-captions-btn training-review-open-btn" data-open-training-review>Adjust buckets</button></div>';
}

function closeTrainingReviewModal() {
  var els = getTrainingWorkspaceEls();
  trainingWorkspaceState.reviewModalOpen = false;
  els.reviewModal.classList.add('hidden');
  els.reviewModal.setAttribute('aria-hidden', 'true');
  var button = els.review.querySelector('[data-open-training-review]');
  if (button) button.focus();
}

function openTrainingReviewModal() {
  var els = getTrainingWorkspaceEls();
  trainingWorkspaceState.reviewModalOpen = true;
  els.reviewModal.classList.remove('hidden');
  els.reviewModal.setAttribute('aria-hidden', 'false');
  els.reviewModalClose.onclick = closeTrainingReviewModal;
  els.reviewModalDone.onclick = closeTrainingReviewModal;
  renderTrainingReview();
  els.reviewModalClose.focus();
}

function bindTrainingReviewModal(payload) {
  var modal = getTrainingWorkspaceEls().reviewModalContent;
  modal.querySelectorAll('[data-review-view]').forEach(function (button) { button.onclick = function () { trainingWorkspaceState.reviewMediaView = button.getAttribute('data-review-view'); trainingWorkspaceState.reviewAspect = ''; renderTrainingReview(); }; });
  modal.querySelectorAll('[data-review-aspect]').forEach(function (button) { button.onclick = function () { trainingWorkspaceState.reviewAspect = button.getAttribute('data-review-aspect'); renderTrainingReview(); }; });
  modal.querySelectorAll('[data-review-target]').forEach(function (button) { button.onclick = function () {
    if (button.disabled) return;
    var target = String(button.getAttribute('data-review-target') || '').split(',').map(Number);
    var view = reviewActiveView(payload);
    var aspect = reviewActiveAspect(payload, view);
    var selected = hasReviewBucket(payload.plan, view, aspect, target);
    if (setReviewBucket(payload.plan, view, aspect, target, !selected)) saveTrainingReview({ plan: payload.plan });
  }; });
  modal.querySelectorAll('[data-review-step]').forEach(function (button) { button.onclick = function () {
    var target = String(button.getAttribute('data-review-target') || '').split(',').map(Number);
    var view = reviewActiveView(payload);
    var aspect = reviewActiveAspect(payload, view);
    if (stepReviewBucket(payload.plan, payload.ladders || {}, view, aspect, target, Number(button.getAttribute('data-review-step')))) saveTrainingReview({ plan: payload.plan });
  }; });
  modal.querySelectorAll('[data-review-role-enabled]').forEach(function (input) { input.onchange = function () { reviewRole(payload.plan, input.getAttribute('data-review-role-enabled')).enabled = input.checked; saveTrainingReview({ plan: payload.plan }); }; });
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
  var payload = trainingWorkspaceState.review;
  if (!payload) {
    var message = trainingWorkspaceState.reviewError ? '<section class="training-review-error">' + escapeHtml(trainingWorkspaceState.reviewError) + '<button type="button" class="review-captions-btn" data-review-retry>Retry</button></section>' : 'Preparing bucket plan…';
    els.review.innerHTML = message;
    els.reviewModalContent.innerHTML = message;
    els.review.querySelectorAll('[data-review-retry]').forEach(function (button) { button.onclick = function () { refreshTrainingReview().catch(function () {}); }; });
    els.reviewModalContent.querySelectorAll('[data-review-retry]').forEach(function (button) { button.onclick = function () { refreshTrainingReview().catch(function () {}); }; });
    return;
  }
  renderTrainingStartingPointControls(payload);
  els.review.innerHTML = trainingReviewSummaryHtml(payload);
  els.review.querySelector('[data-open-training-review]').onclick = openTrainingReviewModal;
  els.reviewModalContent.innerHTML = reviewModalHtml(payload);
  bindTrainingReviewModal(payload);
  reviewTrainButtonState(payload);
}

function renderTrainingReviewSaveStatus() {
  document.querySelectorAll('.training-review-saved').forEach(function (status) { status.textContent = trainingWorkspaceState.reviewSaveStatus === 'saving' ? 'Saving…' : trainingWorkspaceState.reviewSaveStatus === 'error' ? 'Save error' : 'Saved'; });
  var button = getTrainingWorkspaceEls().queueJobBtn;
  if (button && trainingWorkspaceState.reviewSavePending) button.disabled = true;
}

function refreshTrainingReview() {
  if (!isTrainingWorkspaceActive() || !state.folder) return Promise.resolve(null);
  var folder = state.folder;
  trainingWorkspaceState.reviewPending = true;
  trainingWorkspaceState.reviewError = '';
  renderTrainingReview();
  return trainingReviewRequest('/fs/training_review', trainingReviewPayload()).then(function (payload) {
    if (state.folder !== folder || !isTrainingWorkspaceActive()) return null;
    trainingWorkspaceState.review = payload;
    trainingWorkspaceState.reviewPending = false;
    renderTrainingReview();
    return payload;
  }).catch(function (err) {
    if (state.folder !== folder || !isTrainingWorkspaceActive()) return null;
    trainingWorkspaceState.reviewPending = false;
    trainingWorkspaceState.review = null;
    trainingWorkspaceState.reviewError = String(err && err.message ? err.message : err);
    renderTrainingReview();
    throw err;
  });
}

function saveTrainingReview(change) {
  var current = trainingWorkspaceState.review;
  if (!current || current.customDataset) return Promise.resolve(null);
  var folder = state.folder;
  var baseRequest = trainingReviewPayload();
  var snapshot = JSON.parse(JSON.stringify({ plan: change.plan || current.plan, reset: change.reset || '' }));
  trainingWorkspaceState.reviewSavePending += 1;
  trainingWorkspaceState.reviewSaveStatus = 'saving';
  renderTrainingReviewSaveStatus();
  var prior = trainingWorkspaceState.reviewSaveQueue || Promise.resolve();
  var task = prior.catch(function () {}).then(function () {
    var request = JSON.parse(JSON.stringify(baseRequest));
    request.plan = snapshot.plan;
    if (snapshot.reset) request.reset = snapshot.reset;
    return trainingReviewRequest('/fs/training_review/update', request);
  }).then(function (payload) {
    if (state.folder !== folder || !isTrainingWorkspaceActive()) return null;
    trainingWorkspaceState.review = payload;
    return payload;
  }).catch(function (err) {
    if (state.folder !== folder || !isTrainingWorkspaceActive()) return null;
    trainingWorkspaceState.reviewSaveStatus = 'error';
    setStatus('Could not save Training Review: ' + String(err && err.message ? err.message : err));
    return refreshTrainingReview().then(function () { return null; }, function () { return null; });
  }).finally(function () {
    trainingWorkspaceState.reviewSavePending = Math.max(0, trainingWorkspaceState.reviewSavePending - 1);
    if (!trainingWorkspaceState.reviewSavePending && trainingWorkspaceState.reviewSaveStatus !== 'error') trainingWorkspaceState.reviewSaveStatus = 'saved';
    renderTrainingReview();
  });
  trainingWorkspaceState.reviewSaveQueue = task;
  return task;
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
  if (event.key === 'Escape' && trainingWorkspaceState.reviewModalOpen) closeTrainingReviewModal();
});
