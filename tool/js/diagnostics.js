var diagnosticsActiveTab = 'health';
var diagnosticsLoadedConfig = null;
var diagnosticsAssessmentSelected = { director: new Set(), vision: new Set() };
var diagnosticsAssessmentCatalog = { directors: [], visions: [] };
var diagnosticsAssessmentRunId = '';
var diagnosticsAssessmentRunStatus = '';
var diagnosticsAssessmentStoppingId = '';
var diagnosticsAssessmentSort = { key: 'speed', descending: true };
var diagnosticsAssessmentExpanded = new Set();
var diagnosticsAssessmentReviewRefresh = 0;
var diagnosticsAssessmentRuntime = 'local';

function diagnosticsEl(id) {
  return document.getElementById(id);
}

function diagnosticsProbeMetrics(attempt) {
  var result = attempt && attempt.result || {};
  var tokens = Number((result.usage || {}).completion_tokens || 0);
  var decodeSpeed = Number((result.timings || {}).predicted_per_second || 0);
  var requestSeconds = Number(result.requestSeconds || 0);
  var duration = requestSeconds || (Date.parse(attempt && attempt.finishedAt) - Date.parse(attempt && attempt.startedAt)) / 1000;
  return {
    speed: decodeSpeed > 0 ? decodeSpeed : tokens > 0 && duration > 0 ? tokens / duration : 0,
    tokens: tokens,
    hint: decodeSpeed > 0 ? 'Runtime-reported generation speed.' : requestSeconds > 0
      ? 'Effective request throughput, including prompt processing, model loading and network time; not decode-only speed.'
      : 'Effective probe throughput, including queue wait, prompt processing, model loading and network time; not decode-only speed.'
  };
}

function diagnosticsAssessmentCounts(row, tests) {
  var families = {
    writing: ['director_scene_plan_2048'],
    structured: ['language_synthesis', 'language_challenge'],
    vision: row.assessmentNeedsGroupAware ? ['vision_open', 'vision_group_aware'] : ['vision_open']
  };
  var role = row.dataset.assessmentRole;
  var needed = role === 'both' ? ['writing', 'structured', 'vision'] : role === 'director' ? ['writing', 'structured'] : ['vision'];
  var good = 0, bad = 0, running = 0, missing = 0;
  needed.forEach(function (family) {
    var total = 0, completed = 0, problems = 0, active = 0;
    families[family].forEach(function (kind) {
      var counts = (tests[kind] || {}).counts || {};
      Object.keys(counts).forEach(function (status) {
        var count = Number(counts[status] || 0);
        total += count;
        if (status === 'completed') completed += count;
        else if (status === 'running') active += count;
        else problems += count;
      });
    });
    var requiredKinds = families[family].filter(function (kind) {
      return kind === 'director_scene_plan_2048' || kind === 'language_synthesis' || kind === 'language_challenge' ||
        kind === 'vision_open' || kind === 'vision_group_aware';
    });
    var coverage = requiredKinds.every(function (kind) { return (tests[kind] || {}).counts && Number((tests[kind].counts || {}).completed || 0) > 0; });
    if (!total) missing += 1;
    else if (problems) bad += 1;
    else if (active) running += 1;
    else if (completed === total && coverage) good += 1;
    else missing += 1;
  });
  var state = bad ? 'Issues' : running ? 'Running' : missing ? 'Not qualified' : 'Passed';
  row.assessmentSort.result = ({'Issues':0, 'Not qualified':1, 'Running':2, 'Passed':3})[state];
  var host = row.querySelector('[data-assessment-qualification]');
  host.replaceChildren();
  function mark(title, tone, hint) {
    var span = document.createElement('span');
    span.className = 'model-assessment-qualification model-assessment-' + tone;
    span.textContent = title;
    span.title = hint;
    host.appendChild(span);
  }
  mark((role === 'both' ? 'Director + Vision ' : role === 'director' ? 'Director ' : 'Vision ') + state,
    state === 'Passed' ? 'passed' : state === 'Issues' ? 'issues' : 'untested',
    role === 'both' ? 'Requires verified Storyboard JSON and Schema Assist plus Vision.' : role === 'director' ? 'Requires Storyboard JSON and Schema Assist; quality judgment is separate.' : 'Requires completed open and group-aware Vision probes; this is not caption-accuracy grading.');
  // Historical prose calibrations are not proof of structured Scene capacity.
  row.dataset.assessmentSanity = state;
}
function diagnosticsAssessmentSize(bytes) {
  var amount = Number(bytes || 0);
  return amount > 0 ? (amount / 1073741824).toFixed(1) + ' GiB' : '—';
}
function diagnosticsAssessmentReviewLabel(review) {
  if (!review) return 'Not judged';
  if (review.status === 'running') return 'Judging…';
  if (review.status === 'failed') return 'Review failed';
  if (review.status !== 'completed') return 'Not judged';
  return (review.tasks || []).map(function (task) {
    return task.task + ' ' + task.score + '/5';
  }).join(' · ') || 'Not judged';
}
function diagnosticsAssessmentJudge(runId, modelRef) {
  var select = diagnosticsEl('diagnostics-assessment-judge-model');
  var judge = select.value;
  if (!judge) { diagnosticsEl('diagnostics-assessment-selection').textContent = 'Choose a judge model first.'; return; }
  if (!runId) { diagnosticsEl('diagnostics-assessment-selection').textContent = 'No completed Model Lab evidence for this model.'; return; }
  diagnosticsEl('diagnostics-assessment-selection').textContent = 'Starting quality review…';
  modelLabPost({action: 'judge', runId: runId, modelRef: modelRef, judgeModelRef: judge})
    .then(function () {
      diagnosticsEl('diagnostics-assessment-selection').textContent = 'Quality review started. Judgments are advisory, separate from technical qualification.';
      refreshUnifiedModelAssessment();
    }).catch(function (error) {
      diagnosticsEl('diagnostics-assessment-selection').textContent = 'Quality review failed: ' + error.message;
      reportConsoleError('Model quality review', error);
    });
}

function diagnosticsAssessmentSortAndFilter() {
  var table = diagnosticsEl('diagnostics-assessment-results').querySelector('.model-assessment-table');
  if (!table) return;
  var query = diagnosticsEl('diagnostics-assessment-filter').value.trim().toLowerCase();
  var bodies = Array.from(table.querySelectorAll('tbody[data-assessment-model]'));
  bodies.sort(function (a, b) {
    var key = diagnosticsAssessmentSort.key;
    var x = a.assessmentSort[key], y = b.assessmentSort[key];
    if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
    if (y === null || y === undefined) return -1;
    var cmp = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return diagnosticsAssessmentSort.descending ? -cmp : cmp;
  });
  bodies.forEach(function (body) {
    body.hidden = (diagnosticsAssessmentRuntime !== 'all' && body.dataset.assessmentRuntime !== diagnosticsAssessmentRuntime) || (!!query && !body.dataset.assessmentSearch.includes(query));
    table.appendChild(body); // Move paired main/evidence rows together; never recreate interactive DOM.
  });
  diagnosticsAssessmentSyncHeaderSelection();
  table.querySelectorAll('thead th[data-assessment-sort]').forEach(function (heading) {
    heading.setAttribute('aria-sort', heading.dataset.assessmentSort === diagnosticsAssessmentSort.key
      ? diagnosticsAssessmentSort.descending ? 'descending' : 'ascending' : 'none');
  });
}

function diagnosticsRenderAssessmentProgress(run) {
  if (String(run.id) !== diagnosticsAssessmentRunId || diagnosticsActiveTab !== 'assessment' ||
      diagnosticsEl('diagnostics-modal').classList.contains('hidden')) return;
  var host = diagnosticsEl('diagnostics-assessment-activity');
  var card = host.querySelector('[data-progress-card-id]');
  if (!card) { card = ProgressCard.create(); host.replaceChildren(card); }
  host.classList.remove('hidden');
  var terminal = ['completed', 'failed', 'error', 'stopped', 'interrupted', 'cancelled'].indexOf(String(run.status)) !== -1;
  ProgressCard.update(card, modelLabProgressSnapshot(run), {
    compact: terminal,
    className: 'model-assessment-progress-card'
  });
  card.querySelector('[data-progress-dot]').className = 'activity-monitor-dot ' +
    (run.status === 'completed' ? 'assessment-finished' :
      terminal ? 'assessment-terminal' : 'active');
  var wasRunning = diagnosticsAssessmentRunStatus === 'running';
  diagnosticsAssessmentRunStatus = String(run.status);
  diagnosticsEl('diagnostics-assessment-run').disabled = run.status === 'running';
  if (run.status !== 'running' && diagnosticsAssessmentStoppingId === String(run.id)) diagnosticsAssessmentStoppingId = '';
  var stop = diagnosticsEl('diagnostics-assessment-stop');
  stop.classList.toggle('hidden', run.status !== 'running');
  stop.hidden = run.status !== 'running';
  stop.disabled = run.status !== 'running' || diagnosticsAssessmentStoppingId === String(run.id);
  stop.textContent = diagnosticsAssessmentStoppingId === String(run.id) ? 'Stopping…' : 'Stop Assessment';
  if (wasRunning && run.status !== 'running') refreshUnifiedModelAssessment().catch(function () {});
}

function diagnosticsAssessmentProgressError(runId, error) {
  if (String(runId) !== diagnosticsAssessmentRunId || diagnosticsActiveTab !== 'assessment' ||
      diagnosticsEl('diagnostics-modal').classList.contains('hidden')) return;
  var card = diagnosticsEl('diagnostics-assessment-activity').querySelector('[data-progress-card-id]');
  if (!card) return;
  card.querySelector('[data-progress-phase]').textContent = 'Progress unavailable · Refresh to reconnect';
  card.querySelector('[data-progress-detail]').textContent = String(error.message || error);
}

function setDiagnosticsTab(tabName, focusTab) {
  var next = ['health', 'assessment', 'h3'].indexOf(tabName) !== -1 ? tabName : 'assessment';
  diagnosticsActiveTab = next;
  if (next !== 'assessment' && diagnosticsAssessmentReviewRefresh) {
    window.clearTimeout(diagnosticsAssessmentReviewRefresh);
    diagnosticsAssessmentReviewRefresh = 0;
  }
  diagnosticsEl('diagnostics-modal').classList.toggle('diagnostics-assessment-wide', next === 'assessment');
  var selectedButton = null;

  Array.prototype.forEach.call(document.querySelectorAll('[data-diagnostics-tab]'), function (button) {
    var active = button.getAttribute('data-diagnostics-tab') === next;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
    if (active) selectedButton = button;
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-diagnostics-panel]'), function (panel) {
    var active = panel.getAttribute('data-diagnostics-panel') === next;
    panel.classList.toggle('hidden', !active);
    panel.hidden = !active;
  });

  if (next === 'assessment') refreshUnifiedModelAssessment();
  if (next === 'h3') refreshH3CalibrationSettings();
  if (focusTab && selectedButton) selectedButton.focus();
}

function selectUnifiedAssessmentModels(select) {
  document.querySelectorAll('#diagnostics-assessment-results tbody[data-assessment-model]:not([hidden]) input[data-assessment-select]').forEach(function (input) {
    if (input.checked !== select) {
      input.checked = select;
      input.dispatchEvent(new Event('change'));
    }
  });
  diagnosticsAssessmentSyncHeaderSelection();
}

function diagnosticsAssessmentSyncHeaderSelection() {
  var header = diagnosticsEl('diagnostics-assessment-select-all');
  if (!header) return;
  var inputs = Array.from(document.querySelectorAll('#diagnostics-assessment-results tbody[data-assessment-model]:not([hidden]) input[data-assessment-select]'));
  var checked = inputs.filter(function (input) { return input.checked; }).length;
  header.checked = inputs.length > 0 && checked === inputs.length;
  header.indeterminate = checked > 0 && checked < inputs.length;
  header.disabled = inputs.length === 0;
}

function refreshUnifiedModelAssessment() {
  var summary = diagnosticsEl('diagnostics-assessment-summary');
  var results = diagnosticsEl('diagnostics-assessment-results');
  if (!summary || !results) throw new Error('Unified assessment markup is missing.');
  summary.textContent = 'Loading model findings…';
  return Promise.all([
    fetch('/fs/storyboard/director').then(function (r) { return r.json().then(function (p) { if (!r.ok || p.ok === false) throw new Error(p.error || 'Director discovery failed.'); return p; }); }),
    fetch('/app/model-lab?summary=1').then(function (r) { return r.json().then(function (p) { if (!r.ok || p.ok === false) throw new Error(p.error || 'Model Lab findings failed.'); return p; }); })
  ]).then(function (values) {
    var directors = values[0].models || [];
    var reports = [];
    var labRuns = values[1].runs || [];
    var capabilityRuns = values[1].capabilityRuns || [];
    var labModels = values[1].models || {};
    var vision = labModels.visions || [];
    var judgeSelect = diagnosticsEl('diagnostics-assessment-judge-model');
    var previouslySelectedJudge = judgeSelect.value;
    judgeSelect.replaceChildren();
    var blankJudge = document.createElement('option');
    blankJudge.value = '';
    blankJudge.textContent = 'Choose judge model…';
    judgeSelect.appendChild(blankJudge);
    (labModels.directors || []).forEach(function (model) {
      var option = document.createElement('option');
      option.value = String(model.modelRef || '');
      option.textContent = String(model.label || model.modelId || model.modelRef || '');
      judgeSelect.appendChild(option);
    });
    judgeSelect.value = previouslySelectedJudge;
    diagnosticsAssessmentCatalog = { directors: directors, visions: vision };
    var activeRun = labRuns.find(function (run) { return run.active || run.status === 'running'; });
    summary.textContent = directors.length + ' Director models · ' + vision.length +
      ' Vision models · ' + labRuns.length + ' Model Lab runs' +
      (activeRun ? ' · Running: ' + activeRun.id + ' (' + activeRun.attemptCount + ' probes recorded)' : '');

    var table = document.createElement('table');
    table.className = 'model-assessment-table';
    var head = document.createElement('thead');
    var header = document.createElement('tr');
    [{key: '', name: 'Select'}, {key: 'model', name: 'Model'},
      {key: 'output', name: 'Valid output'}, {key: 'speed', name: 'tok/s'},
      {key: 'result', name: 'Assessment'}].forEach(function (column) {
      var th = document.createElement('th');
      th.scope = 'col';
      if (column.key) {
        th.dataset.assessmentSort = column.key;
        var button = document.createElement('button');
        button.type = 'button';
        button.textContent = column.name;
        button.title = 'Sort by ' + column.name;
        button.addEventListener('click', function () {
          if (diagnosticsAssessmentSort.key === column.key) diagnosticsAssessmentSort.descending = !diagnosticsAssessmentSort.descending;
          else diagnosticsAssessmentSort = { key: column.key, descending: ['thinking','speed','output','tested','result','size','quality'].indexOf(column.key) !== -1 };
          diagnosticsAssessmentSortAndFilter();
        });
        th.appendChild(button);
      } else {
        var selectAll = document.createElement('input');
        selectAll.type = 'checkbox';
        selectAll.id = 'diagnostics-assessment-select-all';
        selectAll.setAttribute('aria-label', 'Select all models');
        selectAll.title = 'Select or deselect all models';
        selectAll.addEventListener('change', function () { selectUnifiedAssessmentModels(selectAll.checked); });
        th.appendChild(selectAll);
      }
      header.appendChild(th);
    });
    head.appendChild(header);
    table.appendChild(head);

    var present = { director: new Set(), vision: new Set() };
    var seenModels = new Set();
    function refreshSelectionSummary() {
      var selectedModels = new Set([...diagnosticsAssessmentSelected.director, ...diagnosticsAssessmentSelected.vision]);
      diagnosticsEl('diagnostics-assessment-selection').textContent =
        selectedModels.size + ' model(s) selected · Completed compatible tests will be reused.';
      diagnosticsAssessmentSyncHeaderSelection();
    }
    function addRow(title, kind, ref, report) {
      if (seenModels.has(ref)) return;
      seenModels.add(ref);
      var supportsVision = vision.some(function (entry) { return String(entry.modelRef || '') === ref; });
      var supportsDirector = directors.some(function (entry) { return String(entry.id || '') === ref; });
      if (supportsVision) present.vision.add(ref);
      if (supportsDirector) present.director.add(ref);
      var key = ref;
      var row = document.createElement('tbody');
      row.dataset.assessmentModel = key;
      row.dataset.assessmentRole = supportsDirector && supportsVision ? 'both' : supportsDirector ? 'director' : 'vision';
      var runtimeModel = (kind === 'director' ? directors : vision).find(function (model) { return String(model.id || model.modelRef || '') === ref; }) || {};
      row.dataset.assessmentRuntime = String(runtimeModel.runtimeId || '').toLowerCase() === 'local' || ref.startsWith('local::') ? 'local' : 'remote';
      row.dataset.assessmentSearch = (title + ' ' + ref + ' ' + (supportsDirector ? 'director ' : '') + (supportsVision ? 'vision ' : '')).toLowerCase();
      row.assessmentSort = { model: title.toLowerCase(), role: kind, size: null, thinking: null, speed: null, output: null, quality: null, result: 1, tested: null };
      row.assessmentReport = report;
      var line = document.createElement('tr');
      var selection = document.createElement('td');
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.assessmentSelect = '';
      checkbox.checked = diagnosticsAssessmentSelected.director.has(ref) || diagnosticsAssessmentSelected.vision.has(ref);
      checkbox.setAttribute('aria-label', 'Select model ' + ref);
      checkbox.addEventListener('change', function () {
        ['director', 'vision'].forEach(function (role) {
          if (!((role === 'director' && supportsDirector) || (role === 'vision' && supportsVision))) return;
          if (checkbox.checked) diagnosticsAssessmentSelected[role].add(ref);
          else diagnosticsAssessmentSelected[role].delete(ref);
        });
        refreshSelectionSummary();
      });
      selection.appendChild(checkbox);
      line.appendChild(selection);

      function cell(label, text, attribute) {
        var td = document.createElement('td');
        td.dataset.assessmentColumn = label;
        if (attribute) td.setAttribute('data-assessment-' + attribute, '');
        td.textContent = text;
        line.appendChild(td);
        return td;
      }
      var name = document.createElement('td');
      name.className = 'model-assessment-name';
      var expand = document.createElement('button');
      expand.type = 'button';
      expand.className = 'model-assessment-expand';
      expand.textContent = title;
      expand.title = title + ' · show probe evidence';
      expand.setAttribute('aria-expanded', String(diagnosticsAssessmentExpanded.has(key)));
      name.appendChild(expand);
      line.appendChild(name);
      var roleLabel = supportsDirector && supportsVision ? 'Director · Vision' : supportsVision ? 'Vision' : 'Director';
      var model = (kind === 'director' ? directors : vision).find(function (entry) {
        return String(kind === 'director' ? entry.id || '' : entry.modelRef || '') === ref;
      }) || {};
      var size = Number(model.sizeBytes || 0);
      var sizeLabel = diagnosticsAssessmentSize(size);
      row.assessmentSort.size = size > 0 ? size : null;
      var qualification = cell('Qualified for', '', 'qualification');
      qualification.className = 'model-assessment-qualifications';
      var thinkingLabel = supportsDirector ? 'Not verified' : 'N/A';
      var speedCell = cell('Speed', '—', 'speed');
      speedCell.title = 'Runtime-reported generation throughput when available; different probes and runtimes may not be directly comparable.';
      var outputCell = cell('Output', '—', 'output');
      outputCell.title = 'Largest observed completion, potentially including reasoning tokens; not a verified limit.';
      // Put headline metrics before assessment; secondary fields are details-only.
      line.insertBefore(outputCell, qualification);
      line.insertBefore(speedCell, qualification);
      var qualityLabel = 'Not judged';
      var qualityReason = '';
      var evidence = capabilityRuns.filter(function (run) {
        return run.models && run.models[ref] && Object.keys(run.models[ref]).some(function (probe) {
          var isVision = ['vision_open', 'vision_group_aware', 'vision_model_error'].indexOf(probe) !== -1;
          return supportsVision && isVision || supportsDirector && !isVision;
        });
      })[0];
      row.assessmentNeedsGroupAware = !!(evidence && evidence.groupsConfigured);
      var tests = {};
      capabilityRuns.slice().reverse().forEach(function (saved) {
        var byKind = saved.models && saved.models[ref] || {};
        Object.keys(byKind).forEach(function (kind) {
          var probe = byKind[kind];
          if (!tests[kind] || Number((probe.counts || {}).completed || 0) > 0) tests[kind] = probe;
        });
      });
      var thinking = tests.director_thinking;
      if (supportsDirector) {
        var supported = thinking ? thinking.supported === true : !!(report && report.thinking);
        thinkingLabel = supported ? 'Yes' : 'Not verified';
        row.assessmentSort.thinking = supported ? 1 : 0;
      }
      var testedAt = evidence && evidence.startedAt || (report && report.finishedAt) || '';
      var date = testedAt ? new Date(testedAt) : null;
      var validDate = date && !isNaN(date.getTime());
      var testedLabel = validDate ? date.toLocaleDateString() : '—';
      row.assessmentSort.tested = validDate ? date.getTime() : null;
      row.appendChild(line);
      diagnosticsAssessmentCounts(row, tests);
      var qualityRun = capabilityRuns.find(function (run) {
        return ((run.qualityReviews || {})[ref] || {}).status === 'completed';
      });
      var qualityReview = qualityRun && qualityRun.qualityReviews[ref];
      qualityLabel = diagnosticsAssessmentReviewLabel(qualityReview);
      if (qualityReview && qualityReview.status === 'completed') {
        qualityReason = (qualityReview.tasks || []).map(function (task) { return task.task + ': ' + task.reason; }).join(' · ');
        row.assessmentSort.quality = (qualityReview.tasks || []).reduce(function (total, item) { return total + item.score; }, 0) / Math.max(1, (qualityReview.tasks || []).length);
        var qualityBadge = document.createElement('span');
        qualityBadge.className = 'model-assessment-qualification model-assessment-' + (row.assessmentSort.quality >= 3 ? 'passed' : 'issues');
        qualityBadge.textContent = 'Quality ' + row.assessmentSort.quality.toFixed(1) + '/5';
        qualityBadge.title = 'Advisory LLM review, separate from technical qualification: ' + qualityReason;
        qualification.appendChild(qualityBadge);
      }

      var allTests = Object.keys(tests).map(function (probe) { return tests[probe]; });
      var structuredTests = Object.keys(tests).filter(function (kind) { return kind.indexOf('director_scene_plan_') === 0 && Number((tests[kind].counts || {}).completed || 0) > 0; }).map(function (kind) { return tests[kind]; });
      var speedTests = supportsDirector ? structuredTests : allTests;
      var nativeRates = speedTests.flatMap(function (entry) { return entry.generationSpeedSamples || []; }).filter(function (v) { return Number(v) > 0; });
      var rates = nativeRates.length ? nativeRates : speedTests.flatMap(function (entry) { return entry.throughputSamples || []; })
        .filter(function (value) { return Number(value) > 0; });
      var outputs = structuredTests.map(function (entry) { return Number(entry.verifiedOutputTokens || 0); }).filter(function (v) { return v > 0; });
      // Historical prose benchmark speeds are not mixed into current structured results.
      if (rates.length) {
        var rate = rates.reduce(function (a, b) { return a + Number(b); }, 0) / rates.length;
        speedCell.textContent = rate.toFixed(1);
        speedCell.title = nativeRates.length ? 'Runtime-reported generation tokens/s; compare on the same runtime/hardware.'
          : 'Effective throughput includes processing/loading overhead; not directly comparable to generation tokens/s.';
        row.assessmentSort.speed = rate;
      }
      var maxOutput = outputs.length ? Math.max.apply(null, outputs.map(Number)) : 0;
      if (maxOutput > 0) {
        outputCell.textContent = maxOutput.toLocaleString();
        outputCell.title = 'Observed completion tokens in a complete, validated Storyboard JSON response; not a proven hardware or model ceiling.';
        row.assessmentSort.output = maxOutput;
      }

      var expanded = document.createElement('tr');
      expanded.className = 'model-assessment-evidence';
      expanded.hidden = !diagnosticsAssessmentExpanded.has(key);
      var panel = document.createElement('td');
      panel.colSpan = 5;
      var metadata = document.createElement('div');
      metadata.textContent = 'Role: ' + roleLabel + ' · Size: ' + sizeLabel +
        ' · Thinking: ' + thinkingLabel + ' · Last tested: ' + testedLabel +
        ' · Quality review: ' + qualityLabel;
      panel.appendChild(metadata);
      var provenance = document.createElement('div');
      provenance.dataset.assessmentProvenance = '';
      provenance.textContent = evidence ? 'Model Lab run: ' + evidence.id + ' · ' + (evidence.status || 'unknown') +
        ' · ' + (evidence.startedAt || 'date unavailable') +
        (evidence.importedFrom ? ' · Imported from ' + evidence.importedFrom.host + ' (source measurements)' : '')
        : 'No saved Model Lab evidence for this model.';
      if (report && report.importedFrom) provenance.textContent +=
        ' · Legacy calibration imported from ' + report.importedFrom.host;
      panel.appendChild(provenance);
      var summaryLine = document.createElement('div');
      summaryLine.dataset.assessmentCapabilities = '';
      summaryLine.textContent = 'Probe completion is not a semantic quality grade. Context limit: not established by this assessment.';
      panel.appendChild(summaryLine);
      Object.keys(tests).forEach(function (probe) {
        var item = tests[probe];
        var detail = document.createElement('div');
        detail.dataset.assessmentInitialEvidence = '';
        var counts = Object.keys(item.counts || {}).map(function (status) {
          return item.counts[status] + ' ' + status;
        }).join(', ');
        detail.textContent = modelLabAttemptLabel(probe) + ': ' + (counts || item.status) +
          (item.error ? ' · ' + item.error : '');
        panel.appendChild(detail);
      });
      if (qualityReview && Array.isArray(qualityReview.tasks)) {
        qualityReview.tasks.forEach(function (task) {
          var detail = document.createElement('div');
          detail.textContent = 'LLM judge · ' + task.task + ' ' + task.score + '/5: ' + task.reason;
          panel.appendChild(detail);
        });
      }
      var judgeSource = capabilityRuns.find(function (saved) {
        return saved.status === 'completed' && Object.keys((saved.models || {})[ref] || {}).some(function (kind) {
          var item = saved.models[ref][kind];
          return kind.indexOf('director_scene_plan_') === 0 &&
            Number((item.counts || {}).completed || 0) > 0;
        });
      });
      if (supportsDirector && judgeSource) {
        var judgeButton = document.createElement('button');
        judgeButton.type = 'button';
        judgeButton.className = 'review-captions-btn';
        judgeButton.textContent = qualityReview && qualityReview.status === 'completed' ? 'Reassess with LLM' : 'Assess with LLM';
        judgeButton.disabled = !!(qualityReview && qualityReview.status === 'running');
        judgeButton.addEventListener('click', function () { diagnosticsAssessmentJudge(judgeSource.id, ref); });
        panel.appendChild(judgeButton);
      }
      expanded.appendChild(panel);
      row.appendChild(expanded);
      expand.addEventListener('click', function () {
        expanded.hidden = !expanded.hidden;
        expand.setAttribute('aria-expanded', String(!expanded.hidden));
        if (expanded.hidden) diagnosticsAssessmentExpanded.delete(key);
        else diagnosticsAssessmentExpanded.add(key);
      });
      table.appendChild(row);
    }
    directors.forEach(function (model) {
      var ref = String(model.id || '');
      var report = reports.find(function (entry) { return String(entry.modelRef || '') === ref; });
      addRow(String(model.label || model.modelId || ref), 'director', ref, report);
    });
    vision.forEach(function (model) {
      var ref = String(model.modelRef || '');
      addRow(String(model.label || model.modelId || ref), 'vision', ref, null);
    });
    ['director', 'vision'].forEach(function (kind) {
      diagnosticsAssessmentSelected[kind].forEach(function (ref) {
        if (!present[kind].has(ref)) diagnosticsAssessmentSelected[kind].delete(ref);
      });
    });
    results.replaceChildren(table);
    // Override obsolete CSS nth-child rules until their stylesheet is retired.
    table.querySelectorAll('thead th:nth-child(3), thead th:nth-child(4), tbody tr:first-child td:nth-child(3), tbody tr:first-child td:nth-child(4)')
      .forEach(function (node) { node.style.setProperty('display', 'table-cell', 'important'); });
    diagnosticsAssessmentSortAndFilter();
    diagnosticsAssessmentSyncHeaderSelection();
    if (diagnosticsAssessmentReviewRefresh) window.clearTimeout(diagnosticsAssessmentReviewRefresh);
    diagnosticsAssessmentReviewRefresh = 0;
    var reviewsRunning = capabilityRuns.some(function (run) {
      return Object.keys(run.qualityReviews || {}).some(function (ref) {
        return run.qualityReviews[ref].status === 'running';
      });
    });
    if (reviewsRunning && diagnosticsActiveTab === 'assessment') {
      diagnosticsAssessmentReviewRefresh = window.setTimeout(function () {
        diagnosticsAssessmentReviewRefresh = 0;
        refreshUnifiedModelAssessment().catch(function () {});
      }, 3000);
    }
    refreshSelectionSummary();
    var followed = activeRun || labRuns[0];
    if (followed) {
      if (diagnosticsAssessmentRunId !== String(followed.id)) diagnosticsAssessmentRunStatus = '';
      diagnosticsAssessmentRunId = String(followed.id);
      modelLabPublishProgress(followed);
      modelLabSchedulePoll();
    } else {
      diagnosticsAssessmentRunId = ''; diagnosticsAssessmentRunStatus = '';
      diagnosticsEl('diagnostics-assessment-activity').classList.add('hidden');
      diagnosticsEl('diagnostics-assessment-run').disabled = false;
      diagnosticsEl('diagnostics-assessment-stop').disabled = true;
      diagnosticsEl('diagnostics-assessment-stop').hidden = true;
      diagnosticsEl('diagnostics-assessment-stop').classList.add('hidden');
    }
  }).catch(function (error) {
    summary.textContent = 'Could not load assessment findings: ' + String(error.message || error);
    reportConsoleError('Model Assessment', error);
    throw error;
  });
}

function runUnifiedModelAssessment() {
  var selectedDirectors = diagnosticsAssessmentCatalog.directors.filter(function (model) {
    return diagnosticsAssessmentSelected.director.has(String(model.id || ''));
  }).map(function (model) {
    return {
      modelRef: String(model.id || ''),
      runtimeId: String(model.runtimeId || ''),
      runtimeName: String(model.runtimeName || ''),
      modelId: String(model.modelId || ''),
      label: String(model.label || model.modelId || ''),
      sizeBytes: Number(model.sizeBytes || 0)
    };
  });
  var directorRefs = diagnosticsAssessmentSelected.director;
  var visionRefs = diagnosticsAssessmentSelected.vision;
  if (!directorRefs.size && !visionRefs.size) throw new Error('Choose at least one model.');
  var deep = diagnosticsEl('diagnostics-assessment-deep').checked;

  var catalog = diagnosticsAssessmentCatalog;
  var visions = (catalog.visions || []).filter(function (model) { return visionRefs.has(String(model.modelRef || '')); });
  var directors = selectedDirectors;
  if (selectedDirectors.length !== directorRefs.size || visions.length !== visionRefs.size || directors.length !== directorRefs.size) {
    throw new Error('Model selections are stale; refresh assessment findings and retry.');
  }
  var sourceFolder = String(state && state.folder || '').trim();
  var files = modelLabCurrentFiles();
  var canLab = !!sourceFolder && files.length >= 2;
  var status = diagnosticsEl('diagnostics-assessment-selection');
  if (visions.length && !canLab) throw new Error('Open a Set with at least two media items to assess Vision models. Director assessment needs no Set.');
  status.textContent = 'Checking saved results and scheduling outstanding ' + (deep ? 'deep' : 'quick') + ' tests…';
  var runButton = diagnosticsEl('diagnostics-assessment-run');
  runButton.disabled = true;
  return Promise.resolve().then(function () {

    // The server owns active-run admission; a cached historical preview must
    // not block a new assessment after its worker has already failed.
    return modelLabPost({
      action: 'start',
      config: {
        folder: sourceFolder, files: files, groups: modelLabGroups(), depth: deep ? 'deep' : 'quick', sampleCount: deep ? 16 : 8,
        visionModels: visions, directorModels: directors,
        referenceVisionRef: '',
        referenceDirectorRef: '',
        referenceVision: null,
        referenceDirector: null
      }
    }).then(function (payload) {
      if (payload.noWork) {
        status.textContent = 'Already assessed · 0 tests needed. Existing results are preserved.';
        diagnosticsAssessmentRunId = '';
        diagnosticsAssessmentRunStatus = 'completed';
        refreshUnifiedModelAssessment().catch(function (error) { reportConsoleError('Model Assessment', error); });
        return payload.run;
      }
      diagnosticsAssessmentRunId = String(payload.run.id);
      diagnosticsAssessmentRunStatus = '';
      modelLabState.run = payload.run;
      modelLabState.runs = payload.runs || modelLabState.runs;
      modelLabPublishProgress(payload.run);
      modelLabSchedulePoll();
      if (payload.run.status === 'error' || payload.run.status === 'interrupted') {
        throw new Error(payload.run.error || 'Assessment failed before probes could complete.');
      }
      diagnosticsEl('diagnostics-assessment-summary').textContent = 'Existing successful tests are reused · only missing or failed probes run.';
      reportConsoleInfo('Model Assessment', 'Started persistent ' + (deep ? 'deep' : 'quick') + ' Model Lab run ' + payload.run.id + '.');
      return payload.run;
    });
  }).then(function (labRun) {
    if (labRun.noWork) return;
    status.textContent = labRun.status === 'running'
      ? 'Assessment running. You may close Diagnostics.'
      : 'Assessment ' + String(labRun.status) + '.';
  }).catch(function (error) {
    status.textContent = 'Assessment could not complete: ' + String(error.message || error);
    reportConsoleError('Model Assessment', error);
    throw error;
  }).finally(function () {
    runButton.disabled = diagnosticsAssessmentRunStatus === 'running';
  });
}

async function stopUnifiedModelAssessment() {
  var runId = diagnosticsAssessmentRunId;
  if (!runId || diagnosticsAssessmentRunStatus !== 'running' || diagnosticsAssessmentStoppingId === runId) return;
  var button = diagnosticsEl('diagnostics-assessment-stop');
  diagnosticsAssessmentStoppingId = runId;
  button.disabled = true; button.textContent = 'Stopping…';
  try {
    var payload = await modelLabPost({action: 'stop', runId: runId});
    modelLabState.runs = payload.runs || modelLabState.runs;
    modelLabPublishProgress(payload.run);
    modelLabSchedulePoll();
    diagnosticsEl('diagnostics-assessment-selection').textContent = payload.run.status === 'running'
      ? 'Stop requested. Cancelling the current probe; completed results are preserved.'
      : 'Assessment stopped. Completed results are preserved.';
  } catch (error) {
    diagnosticsAssessmentStoppingId = '';
    button.disabled = diagnosticsAssessmentRunStatus !== 'running'; button.textContent = 'Stop Assessment';
    diagnosticsEl('diagnostics-assessment-selection').textContent = 'Could not stop assessment: ' + String(error.message || error);
    reportConsoleError('Model Assessment', error);
  }
}

var diagnosticsAssessmentImportBundle = null;

function diagnosticsAssessmentTransferError(error) {
  diagnosticsEl('diagnostics-assessment-transfer-status').textContent = String(error.message || error);
  reportConsoleError('Assessment transfer', error);
}

async function exportAssessmentResults() {
  try {
    var bundle = await modelLabRequest('/app/model-lab?export=1');
    var url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], {type: 'application/json'}));
    var link = document.createElement('a');
    link.href = url; link.download = 'webcap-assessments-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    diagnosticsEl('diagnostics-assessment-transfer-status').textContent =
      'Exported ' + bundle.runs.length + ' runs and ' + bundle.reports.length + ' reports.' +
      (bundle.activeRunsExcluded ? ' Running assessments are excluded; export again when they finish.' : '');
  } catch (error) { diagnosticsAssessmentTransferError(error); }
}

async function previewAssessmentImport(file) {
  diagnosticsAssessmentImportBundle = null;
  diagnosticsEl('diagnostics-assessment-transfer').classList.add('hidden');
  if (!file) return;
  try {
    var bundle = JSON.parse(await file.text());
    if (bundle.format !== 'webcap-assessments' || bundle.version !== 1 || !Array.isArray(bundle.runs) || !Array.isArray(bundle.reports)) {
      throw new Error('Choose a WebCap assessment export (version 1).');
    }
    var catalog = (await modelLabRequest('/app/model-lab')).models;
    var targets = new Map();
    (catalog.directors || []).concat(catalog.visions || []).forEach(function (model) {
      targets.set(model.runtimeId, model.runtimeName || model.runtimeId);
    });
    var sources = new Set();
    bundle.runs.forEach(function (run) {
      (run.attempts || []).forEach(function (attempt) { sources.add(String(attempt.modelRef).split('::')[0]); });
      ['visionModels', 'directorModels', 'allVisionModels', 'allDirectorModels'].forEach(function (field) {
        (run[field] || []).forEach(function (model) { sources.add(String(model.modelRef).split('::')[0]); });
      });
    });
    bundle.reports.forEach(function (report) { sources.add(String(report.modelRef).split('::')[0]); });
    var host = diagnosticsEl('diagnostics-assessment-runtime-map');
    host.replaceChildren();
    sources.forEach(function (source) {
      var label = document.createElement('label');
      label.textContent = source + ' → ';
      var select = document.createElement('select');
      select.dataset.sourceRuntime = source;
      select.setAttribute('aria-label', 'Destination runtime for ' + source);
      var placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose runtime…'; select.appendChild(placeholder);
      targets.forEach(function (name, id) {
        var option = document.createElement('option'); option.value = id; option.textContent = name + ' (' + id + ')'; select.appendChild(option);
      });
      label.appendChild(select); host.appendChild(label);
    });
    diagnosticsAssessmentImportBundle = bundle;
    diagnosticsEl('diagnostics-assessment-transfer-copy').textContent = bundle.runs.length + ' runs · ' + bundle.reports.length +
      ' reports · Exported from ' + bundle.sourceHost + ' · ' + bundle.exportedAt;
    diagnosticsEl('diagnostics-assessment-transfer').classList.remove('hidden');
    diagnosticsEl('diagnostics-assessment-transfer-status').textContent = '';
  } catch (error) { diagnosticsAssessmentTransferError(error); }
}

async function importAssessmentResults() {
  var runtimeMap = {};
  var choices = diagnosticsEl('diagnostics-assessment-runtime-map').querySelectorAll('select');
  for (var select of choices) {
    if (!select.value) {
      diagnosticsEl('diagnostics-assessment-transfer-status').textContent = 'Choose a destination for each source runtime.';
      select.focus(); return;
    }
    runtimeMap[select.dataset.sourceRuntime] = select.value;
  }
  var button = diagnosticsEl('diagnostics-assessment-import-apply'); button.disabled = true;
  try {
    var result = await modelLabPost({action: 'import', bundle: diagnosticsAssessmentImportBundle, runtimeMap: runtimeMap});
    diagnosticsEl('diagnostics-assessment-transfer-status').textContent = 'Imported ' + result.runsImported + ' runs and ' + result.reportsImported +
      ' reports · ' + result.runsAlreadyPresent + ' runs already present.';
    diagnosticsAssessmentImportBundle = null;
    diagnosticsEl('diagnostics-assessment-transfer').classList.add('hidden');
    await refreshUnifiedModelAssessment();
  } catch (error) { diagnosticsAssessmentTransferError(error); }
  finally { button.disabled = false; }
}

function loadDiagnosticsConfig() {
  return fetch('/app/config')
    .then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok) throw new Error(payload && payload.error ? payload.error : 'Could not load WebCap configuration.');
        return payload;
      });
    })
    .then(function (cfg) {
      diagnosticsLoadedConfig = normalizeAppConfigShape(cfg);
      return diagnosticsLoadedConfig;
    });
}

function openDiagnosticsModal(tabName) {
  var modal = diagnosticsEl('diagnostics-modal');
  if (!modal) throw new Error('Diagnostics modal markup is missing.');
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');

  return loadDiagnosticsConfig()
    .then(function () {
      setDiagnosticsTab(tabName || diagnosticsActiveTab, false);
    })
    .catch(function (error) {
      reportConsoleError('Diagnostics', error);
      closeDiagnosticsModal();
      throw error;
    });
}

function closeDiagnosticsModal() {
  var modal = diagnosticsEl('diagnostics-modal');
  if (!modal) throw new Error('Diagnostics modal markup is missing.');
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');

  // Diagnostics can contain very large model/evidence trees. Once the modal
  // closes they provide no value to the active workspace, so release them.
  // The unified Assessment retains its own evidence and progress state.
}

function refreshH3CalibrationSettings() {
  var summary = diagnosticsEl('h3-calibration-summary');
  var source = diagnosticsEl('h3-calibration-source');
  var run = diagnosticsEl('h3-calibration-run-btn');
  var stop = diagnosticsEl('h3-calibration-stop-btn');
  var reset = diagnosticsEl('h3-calibration-reset-btn');
  if (!summary || !source || !run || !stop || !reset) throw new Error('H3 calibration Diagnostics markup is incomplete.');

  var calibration = diagnosticsLoadedConfig && diagnosticsLoadedConfig.training && diagnosticsLoadedConfig.training.h3_calibration;
  renderH3CalibrationResults(calibration);
  var results = calibration && calibration.results ? calibration.results : {};
  var hardware = calibration && calibration.hardware;
  summary.textContent = hardware
    ? ('Saved hardware: ' + hardware.gpu_model + ' · ' + hardware.total_vram_mib + ' MiB VRAM · ' + Object.keys(results).length + ' tested candidates.')
    : 'No saved calibration results.';
  reset.classList.toggle('hidden', !calibration);

  fetch('/fs/media_metadata?folder=' + encodeURIComponent(state.folder || ''))
    .then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok) throw new Error(payload && payload.error ? payload.error : 'Could not load calibration source metadata.');
        return payload;
      });
    })
    .then(function (metadataRows) {
      var metadata = {};
      (Array.isArray(metadataRows) ? metadataRows : []).forEach(function (row) {
        metadata[row.file] = { duration: Number(String(row.duration || '').replace('s', '')) };
      });
      source.innerHTML = '';
      var choices = (state.items || []).filter(function (item) {
        var ext = String(item.fileName || '').split('.').pop().toLowerCase();
        var data = metadata[item.fileName];
        return item.hasCaption &&
          ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi', 'm4v'].indexOf(ext) !== -1 &&
          data && Number(data.duration) >= 102 / 24;
      }).sort(function (a, b) {
        var ad = Number(metadata[a.fileName].duration || 0);
        var bd = Number(metadata[b.fileName].duration || 0);
        return bd - ad || String(a.fileName).localeCompare(String(b.fileName));
      });
      choices.forEach(function (item) {
        var option = document.createElement('option');
        option.value = item.fileName;
        option.textContent = item.fileName + ' · ' + Number(metadata[item.fileName].duration).toFixed(1) + 's';
        source.appendChild(option);
      });
      run.disabled = !choices.length;
      if (!choices.length) summary.textContent += ' Choose or prepare a captioned video at least 4.25 seconds long.';
    })
    .catch(function (error) {
      reportConsoleError('H3 Calibration', error);
      summary.textContent = 'Could not load calibration source metadata. See Console.';
      run.disabled = true;
    });

  fetch('/fs/h3_probe/status')
    .then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok) throw new Error(payload && payload.error ? payload.error : 'Could not read H3 calibration status.');
        return payload;
      });
    })
    .then(function (status) {
      var active = !!(status && status.active);
      stop.classList.toggle('hidden', !active);
      run.classList.toggle('hidden', active);
      if (active) summary.textContent += ' Calibration is running.';
    })
    .catch(function (error) {
      reportConsoleError('H3 Calibration', error);
    });
}

function runH3Calibration(options) {
  options = options || {};
  var fileName = String(options.fileName || '').trim();
  if (!fileName) {
    diagnosticsEl('h3-calibration-summary').textContent = 'Choose a calibration source video.';
    return;
  }
  var run = diagnosticsEl('h3-calibration-run-btn');
  run.disabled = true;
  fetch('/fs/h3_probe/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: state.folder || '', fileName: fileName })
  }).then(function (response) {
    return response.json().then(function (payload) {
      if (!response.ok) throw new Error(payload && payload.error ? payload.error : 'Could not start H3 calibration.');
      return payload;
    });
  }).then(function () {
    reportConsoleInfo('H3 Calibration', 'Calibration started.');
    return loadDiagnosticsConfig();
  }).then(refreshH3CalibrationSettings).catch(function (error) {
    reportConsoleError('H3 Calibration', error);
    diagnosticsEl('h3-calibration-summary').textContent = 'Could not start calibration. See Console.';
    run.disabled = false;
  });
}

function stopH3Calibration() {
  var stop = diagnosticsEl('h3-calibration-stop-btn');
  stop.disabled = true;
  fetch('/fs/h3_probe/stop', { method: 'POST' })
    .then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok) throw new Error(payload && payload.error ? payload.error : 'Could not stop H3 calibration.');
        return payload;
      });
    })
    .then(function () {
      reportConsoleInfo('H3 Calibration', 'Calibration stop requested.');
      return loadDiagnosticsConfig();
    })
    .then(refreshH3CalibrationSettings)
    .catch(function (error) {
      reportConsoleError('H3 Calibration', error);
      diagnosticsEl('h3-calibration-summary').textContent = 'Could not stop calibration. See Console.';
    })
    .finally(function () {
      stop.disabled = false;
    });
}

function resetH3CalibrationSettings() {
  if (!confirm('Reset saved H3 calibration results? Existing probe logs and dataset TOMLs are unchanged.')) return;
  var payload = normalizeAppConfigShape(diagnosticsLoadedConfig || {});
  delete payload.training.h3_calibration;
  HttpModule.postJson('/app/config', payload, function (status, responseText) {
    if (status !== 200) {
      reportConsoleError('H3 Calibration', new Error(getErrorMessage(responseText, 'Could not reset H3 calibration.')));
      return;
    }
    var saved = JSON.parse(responseText);
    diagnosticsLoadedConfig = normalizeAppConfigShape(saved.config || payload);
    refreshH3CalibrationSettings();
  });
}

function renderEnvironmentCheck(payload) {
  var summaryEl = diagnosticsEl('app-settings-environment-summary');
  var resultsEl = diagnosticsEl('app-settings-environment-results');
  if (!payload || !Array.isArray(payload.checks)) {
    summaryEl.textContent = 'Environment check did not return a valid report.';
    resultsEl.innerHTML = '';
    resultsEl.classList.add('hidden');
    return;
  }

  var summary = payload.summary || {};
  var groupOrder = ['core', 'training', 'inference', 'director', 'optional_analysis'];
  var groupLabels = {
    core: 'Core',
    training: 'Training',
    inference: 'Inference',
    director: 'Director',
    optional_analysis: 'Optional Analysis'
  };
  var core = summary.core || {};
  summaryEl.textContent = core.ready
    ? ('WebCap ready · ' + Number(summary.passed || 0) + '/' + Number(summary.total || 0) + ' checks passed')
    : (Number(core.requiredFailures || 0) + ' core issue(s) · ' + Number(summary.passed || 0) + '/' + Number(summary.total || 0) + ' checks passed');

  resultsEl.innerHTML = groupOrder.map(function (groupName) {
    var checks = payload.checks.filter(function (check) { return check.group === groupName; });
    if (!checks.length) return '';
    var groupSummary = summary[groupName] || {};
    var requiredFailures = Number(groupSummary.requiredFailures || 0);
    var optionalFailures = Number(groupSummary.optionalFailures || 0);
    var groupState = requiredFailures
      ? (requiredFailures + ' issue(s)')
      : (optionalFailures ? ('Ready · ' + optionalFailures + ' optional unavailable') : 'Ready');
    var rows = checks.map(function (check) {
      var stateClass = check.ok ? 'ok' : (check.required ? 'failed' : 'optional');
      var detail = check.details ? '<div class="app-settings-environment-detail">' + escapeHtml(check.details) + '</div>' : '';
      var guidance = check.guidance ? '<div class="app-settings-environment-guidance">' + escapeHtml(check.guidance) + '</div>' : '';
      return '<div class="app-settings-environment-check ' + stateClass + '">' +
        '<span class="app-settings-environment-mark">' + (check.ok ? '&#10003;' : '!') + '</span>' +
        '<span><strong>' + escapeHtml(check.message || check.id) + '</strong>' + detail + guidance + '</span>' +
        '</div>';
    }).join('');
    return '<section class="app-settings-environment-group">' +
      '<div class="app-settings-environment-group-header"><strong>' + escapeHtml(groupLabels[groupName] || groupName) + '</strong><span>' + escapeHtml(groupState) + '</span></div>' +
      rows +
      '</section>';
  }).join('');

  resultsEl.classList.remove('hidden');
  diagnosticsEl('app-settings-environment-details').open = !core.ready;
}

function appendRequirementsOutputToConsole(payload) {
  payload = payload && typeof payload === 'object' ? payload : {};
  var command = Array.isArray(payload.command) ? payload.command.join(' ') : '';
  if (command) reportConsoleInfo('Python Requirements', '$ ' + command);
  String(payload.stdout || '').split(/\r?\n/).forEach(function (line) {
    if (line) reportConsoleInfo('Python Requirements', line);
  });
  String(payload.stderr || '').split(/\r?\n/).forEach(function (line) {
    if (line) reportConsoleWarning('Python Requirements', line);
  });
}

function installPythonRequirements() {
  var button = diagnosticsEl('app-settings-environment-install-btn');
  button.disabled = true;
  button.textContent = 'Installing...';
  reportConsoleInfo('Python Requirements', 'Installing / repairing requirements.txt in the current WebCap Python environment...');
  fetch('/app/environment/install-requirements', { method: 'POST' })
    .then(function (response) {
      return response.json().then(function (payload) {
        appendRequirementsOutputToConsole(payload);
        if (!response.ok || !payload.ok) throw new Error(payload && payload.error ? payload.error : 'Python requirements install failed.');
        return payload;
      });
    })
    .then(function () {
      reportConsoleInfo('Python Requirements', 'Install / repair completed successfully.');
      return runEnvironmentCheck();
    })
    .catch(function (error) {
      reportConsoleError('Python Requirements', error);
      diagnosticsEl('app-settings-environment-summary').textContent = 'Requirements install failed. See Console.';
    })
    .finally(function () {
      button.disabled = false;
      button.textContent = 'Install / Repair Python Requirements';
    });
}

function runEnvironmentCheck() {
  var button = diagnosticsEl('app-settings-environment-run-btn');
  var summary = diagnosticsEl('app-settings-environment-summary');
  var results = diagnosticsEl('app-settings-environment-results');
  button.disabled = true;
  summary.textContent = 'Checking...';
  return fetch('/app/environment')
    .then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok) throw new Error(payload && payload.error ? payload.error : 'Environment check failed.');
        return payload;
      });
    })
    .then(renderEnvironmentCheck)
    .catch(function (error) {
      reportConsoleError('Environment Check', error);
      summary.textContent = 'Environment check failed.';
      results.innerHTML = '<div class="app-settings-environment-check failed"><span class="app-settings-environment-mark">!</span><span><strong>' + escapeHtml(error.message || String(error)) + '</strong></span></div>';
      results.classList.remove('hidden');
    })
    .finally(function () {
      button.disabled = false;
    });
}

function refreshDiagnosticsGpuConsumers() {
  var button = diagnosticsEl('diagnostics-gpu-refresh');
  var status = diagnosticsEl('diagnostics-gpu-status');
  var host = diagnosticsEl('diagnostics-gpu-consumers');
  button.disabled = true;
  status.textContent = 'Checking GPU processes…';
  host.replaceChildren();
  return fetch('/app/diagnostics/gpu-consumers')
    .then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok) throw new Error(payload.error || 'GPU consumer query failed.');
        return payload;
      });
    })
    .then(function (payload) {
      var consumers = payload.consumers || [];
      status.textContent = consumers.length ? consumers.length + ' CUDA process(es) detected.' : 'No CUDA processes reported.';
      consumers.forEach(function (consumer) {
        var row = document.createElement('div');
        row.className = 'app-settings-environment-result';
        row.textContent = consumer.name + ' · PID ' + consumer.pid + ' · ' +
          (consumer.memoryMiB === null ? 'VRAM unavailable' : consumer.memoryMiB + ' MiB VRAM');
        host.appendChild(row);
      });
    })
    .catch(function (error) {
      status.textContent = 'Unavailable: ' + error.message;
      reportConsoleError('GPU Consumers', error);
    })
    .finally(function () { button.disabled = false; });
}

function wireDiagnosticsUi() {
  diagnosticsEl('shell-diagnostics-btn').onclick = function () { openDiagnosticsModal(); };
  diagnosticsEl('diagnostics-gpu-refresh').onclick = refreshDiagnosticsGpuConsumers;
  diagnosticsEl('diagnostics-close-btn').onclick = closeDiagnosticsModal;
  diagnosticsEl('app-settings-environment-run-btn').onclick = runEnvironmentCheck;
  diagnosticsEl('app-settings-environment-install-btn').onclick = installPythonRequirements;
  diagnosticsEl('h3-calibration-run-btn').onclick = function () {
    runH3Calibration({ fileName: diagnosticsEl('h3-calibration-source').value });
  };
  diagnosticsEl('h3-calibration-stop-btn').onclick = stopH3Calibration;
  diagnosticsEl('h3-calibration-reset-btn').onclick = resetH3CalibrationSettings;
  diagnosticsEl('h3-calibration-console-btn').onclick = showConsolePanel;
  diagnosticsEl('diagnostics-assessment-filter').oninput = diagnosticsAssessmentSortAndFilter;
  diagnosticsEl('diagnostics-assessment-run').onclick = function () {
    try {
      Promise.resolve(runUnifiedModelAssessment()).catch(function (error) {
        diagnosticsEl('diagnostics-assessment-selection').textContent =
          'Assessment failed: ' + String(error.message || error);
        reportConsoleError('Model Assessment', error);
      });
    } catch (error) {
      diagnosticsEl('diagnostics-assessment-selection').textContent =
        'Cannot start assessment: ' + String(error.message || error);
      reportConsoleError('Model Assessment', error);
    }
  };
  diagnosticsEl('diagnostics-assessment-runtime').onchange = function () {
    diagnosticsAssessmentRuntime = this.value;
    diagnosticsAssessmentSortAndFilter();
    diagnosticsAssessmentSyncHeaderSelection();
  };
  diagnosticsEl('diagnostics-assessment-refresh').onclick = function () { refreshUnifiedModelAssessment().catch(function () {}); };
  diagnosticsEl('diagnostics-assessment-stop').onclick = stopUnifiedModelAssessment;
  diagnosticsEl('diagnostics-assessment-export').onclick = exportAssessmentResults;
  diagnosticsEl('diagnostics-assessment-import').onclick = function () { diagnosticsEl('diagnostics-assessment-file').click(); };
  diagnosticsEl('diagnostics-assessment-file').onchange = function () { previewAssessmentImport(this.files[0]); this.value = ''; };
  diagnosticsEl('diagnostics-assessment-import-apply').onclick = importAssessmentResults;
  diagnosticsEl('diagnostics-assessment-import-cancel').onclick = function () {
    diagnosticsAssessmentImportBundle = null; diagnosticsEl('diagnostics-assessment-transfer').classList.add('hidden');
  };

  Array.prototype.forEach.call(document.querySelectorAll('[data-diagnostics-tab]'), function (button) {
    button.onclick = function () {
      setDiagnosticsTab(button.getAttribute('data-diagnostics-tab'), false);
    };
    button.onkeydown = function (event) {
      var tabs = ['health', 'assessment', 'h3'];
      var current = tabs.indexOf(button.getAttribute('data-diagnostics-tab'));
      var next = current;
      if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
      else return;
      event.preventDefault();
      setDiagnosticsTab(tabs[next], true);
    };
  });

  diagnosticsEl('diagnostics-modal').addEventListener('mousedown', function (event) {
    if (event.target === diagnosticsEl('diagnostics-modal')) closeDiagnosticsModal();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    var modal = diagnosticsEl('diagnostics-modal');
    if (!modal.classList.contains('hidden')) closeDiagnosticsModal();
  });
}

wireDiagnosticsUi();
