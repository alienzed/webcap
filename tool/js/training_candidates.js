// Read-only TensorBoard loss-curve modal for one recorded training run.
function trainingCandidatesElements() {
  return {
    modal: document.getElementById('training-candidates-modal'),
    summary: document.getElementById('training-candidates-modal-summary'),
    content: document.getElementById('training-candidates-modal-content'),
    algorithm: document.getElementById('training-candidates-algorithm'),
    refresh: document.getElementById('training-candidates-refresh'),
    openRun: document.getElementById('training-candidates-open-run'),
    close: document.getElementById('training-candidates-modal-close')
  };
}

function trainingCandidatesNumber(value, fallback) {
  var number = Number(value);
  return isFinite(number) ? number : fallback;
}

function trainingCandidatesPointForEpoch(epoch, analysis, points) {
  var checkpoint = points.filter(function (item) { return Number(item.epoch) === Number(epoch); })[0];
  if (!checkpoint) return null;
  var analytical = trainingCandidatesPointForStep(checkpoint.step, analysis);
  return { step: checkpoint.step, epoch: epoch, loss: analytical ? analytical.loss : checkpoint.loss };
}

function trainingCandidatesPointForStep(step, points) {
  return points.reduce(function (nearest, item) {
    return !nearest || Math.abs(Number(item.step) - Number(step)) < Math.abs(Number(nearest.step) - Number(step)) ? item : nearest;
  }, null);
}

function trainingCandidatesSvg(data) {
  var plotTop = 20, plotHeight = 350, viewHeight = 400;
  var plotBottom = plotTop + plotHeight;
  var points = data && Array.isArray(data.epochLossPoints) ? data.epochLossPoints : [];
  var stepPoints = data && Array.isArray(data.stepLossPoints) ? data.stepLossPoints : [];
  var smoothedStepPoints = data && Array.isArray(data.smoothedStepLossPoints) ? data.smoothedStepLossPoints : [];
  var analysis = data && Array.isArray(data.analysisPoints) ? data.analysisPoints : [];
  if (!points.length || !stepPoints.length) return '<div class="training-candidates-empty">No completed TensorBoard loss points are available.</div>';
  var allLosses = points.concat(smoothedStepPoints).map(function (point) { return trainingCandidatesNumber(point.loss, 0); });
  var minStep = Math.min.apply(Math, stepPoints.map(function (point) { return trainingCandidatesNumber(point.step, 0); }));
  var maxStep = Math.max.apply(Math, stepPoints.map(function (point) { return trainingCandidatesNumber(point.step, 0); }));
  var minStepPoint = stepPoints.reduce(function (earlier, point) { return Number(point.step) < Number(earlier.step) ? point : earlier; });
  var maxStepPoint = stepPoints.reduce(function (later, point) { return Number(point.step) > Number(later.step) ? point : later; });
  var minLoss = Math.min.apply(Math, allLosses);
  var maxLoss = Math.max.apply(Math, allLosses);
  if (minStep === maxStep) maxStep = minStep + 1;
  if (minLoss === maxLoss) {
    minLoss -= Math.max(0.01, Math.abs(minLoss) * 0.02);
    maxLoss += Math.max(0.01, Math.abs(maxLoss) * 0.02);
  }
  var lossPadding = (maxLoss - minLoss) * 0.08;
  minLoss -= lossPadding;
  maxLoss += lossPadding;
  function x(step) { return 46 + (trainingCandidatesNumber(step, minStep) - minStep) / (maxStep - minStep) * 914; }
  function y(loss) { return plotTop + (maxLoss - trainingCandidatesNumber(loss, minLoss)) / (maxLoss - minLoss) * plotHeight; }
  function polyline(series) { return series.map(function (point) { return x(point.step).toFixed(2) + ',' + y(point.loss).toFixed(2); }).join(' '); }
  var regions = Array.isArray(data.regions) ? data.regions : [];
  var candidates = Array.isArray(data.candidates) ? data.candidates : [];
  var savedArtifacts = Array.isArray(data.savedArtifacts) ? data.savedArtifacts : [];
  var candidateEpochs = {};
  candidates.forEach(function (candidate) { candidateEpochs[Number(candidate.epoch)] = true; });
  var regionRects = regions.map(function (region) {
    var left = x(region.startStep);
    var right = x(region.endStep);
    return '<rect class="training-candidates-basin" x="' + left.toFixed(2) + '" y="' + plotTop + '" width="' + Math.max(4, right - left).toFixed(2) + '" height="' + plotHeight + '"></rect>';
  }).join('');
  var savedMarkers = savedArtifacts.filter(function (artifact) { return !candidateEpochs[Number(artifact.epoch)]; }).map(function (artifact) {
    var point = trainingCandidatesPointForEpoch(artifact.epoch, analysis, points);
    return point ? '<circle class="training-candidates-saved-marker ' + escapeHtml(String(artifact.status || '')) + '" cx="' + x(point.step).toFixed(2) + '" cy="' + y(point.loss).toFixed(2) + '" r="3"></circle>' : '';
  }).join('');
  var candidateMarkers = candidates.map(function (candidate) {
    var analytical = trainingCandidatesPointForStep(candidate.step, analysis);
    var checkpoint = trainingCandidatesPointForEpoch(candidate.epoch, [], points);
    var point = { step: candidate.step, loss: analytical ? analytical.loss : checkpoint.loss };
    return '<g class="training-candidates-marker"><line x1="' + x(point.step).toFixed(2) + '" y1="' + plotTop + '" x2="' + x(point.step).toFixed(2) + '" y2="' + plotBottom + '"></line><circle cx="' + x(point.step).toFixed(2) + '" cy="' + y(point.loss).toFixed(2) + '" r="5"></circle><text x="' + x(point.step).toFixed(2) + '" y="14">' + escapeHtml(String(candidate.epoch)) + '</text></g>';
  }).join('');
  var chartData = escapeHtml(JSON.stringify({ points: points, stepPoints: stepPoints, smoothedStepPoints: smoothedStepPoints, analysis: analysis, regions: regions, candidates: candidates, savedArtifacts: savedArtifacts, minStep: minStep, maxStep: maxStep, minLoss: minLoss, maxLoss: maxLoss, plotTop: plotTop, plotBottom: plotBottom, plotHeight: plotHeight }));
  return '<div class="training-candidates-chart-wrap">' +
    '<svg class="training-candidates-chart" viewBox="0 0 1000 ' + viewHeight + '" role="img" aria-label="TensorBoard step loss and epoch loss curve" data-training-candidates-chart="' + chartData + '">' +
      '<defs><clipPath id="training-candidates-plot-clip"><rect x="46" y="' + plotTop + '" width="914" height="' + plotHeight + '"></rect></clipPath></defs>' +
      '<line class="training-candidates-axis" x1="46" y1="' + plotBottom + '" x2="960" y2="' + plotBottom + '"></line><line class="training-candidates-axis" x1="46" y1="' + plotTop + '" x2="46" y2="' + plotBottom + '"></line>' +
      '<polyline class="training-candidates-step-loss" clip-path="url(#training-candidates-plot-clip)" points="' + polyline(stepPoints) + '"></polyline>' +
      (smoothedStepPoints.length ? '<polyline class="training-candidates-step-loss-smoothed" clip-path="url(#training-candidates-plot-clip)" points="' + polyline(smoothedStepPoints) + '"></polyline>' : '') +
      regionRects + '<polyline class="training-candidates-raw" points="' + polyline(points) + '"></polyline>' +
      (analysis.length ? '<polyline class="training-candidates-analysis" points="' + polyline(analysis) + '"></polyline>' : '') + savedMarkers + candidateMarkers +
      '<line class="training-candidates-hover-guide hidden" x1="0" y1="' + plotTop + '" x2="0" y2="' + plotBottom + '"></line><circle class="training-candidates-hover-point hidden" cx="0" cy="0" r="4"></circle><rect class="training-candidates-hover-layer" x="46" y="' + plotTop + '" width="914" height="' + plotHeight + '"></rect>' +
      '<text class="training-candidates-axis-label" x="46" y="' + (plotBottom + 19) + '">step ' + escapeHtml(String(minStep)) + ' · epoch ' + escapeHtml(String(minStepPoint.epoch)) + '</text><text class="training-candidates-axis-label" x="960" y="' + (plotBottom + 19) + '" text-anchor="end">step ' + escapeHtml(String(maxStep)) + ' · epoch ' + escapeHtml(String(maxStepPoint.epoch)) + '</text>' +
      '<text class="training-candidates-axis-label" x="40" y="' + (plotTop + 5) + '" text-anchor="end">' + escapeHtml(maxLoss.toFixed(4)) + '</text><text class="training-candidates-axis-label" x="40" y="' + plotBottom + '" text-anchor="end">' + escapeHtml(minLoss.toFixed(4)) + '</text>' +
    '</svg><div class="training-candidates-tooltip hidden"></div><div class="training-candidates-legend"><span><i class="step"></i>Raw step loss</span><span><i class="step-smoothed"></i>Smoothed step loss</span><span><i class="raw"></i>Epoch loss</span><span><i class="analysis"></i>Robust trend</span><span><i class="saved"></i>Saved LoRA</span><span><i class="basin"></i>Candidate region</span></div></div>';
}

function trainingCandidatesTooltipHtml(stepPoint, data) {
  var epoch = Number(stepPoint.epoch);
  var smoothed = data.smoothedStepPoints.filter(function (point) { return Number(point.step) === Number(stepPoint.step); })[0];
  var raw = data.points.filter(function (point) { return Number(point.epoch) === epoch; })[0];
  var robust = trainingCandidatesPointForStep(stepPoint.step, data.analysis);
  var saved = data.savedArtifacts.filter(function (artifact) { return Number(artifact.epoch) === epoch; })[0];
  var region = data.regions.filter(function (item) { return Number(stepPoint.step) >= Number(item.startStep) && Number(stepPoint.step) <= Number(item.endStep); })[0];
  var representative = data.candidates.some(function (candidate) { return Number(candidate.step) === Number(stepPoint.step); });
  var lines = ['<strong>Step ' + escapeHtml(String(stepPoint.step)) + ' · Epoch ' + escapeHtml(String(epoch)) + '</strong>'];
  lines.push('Step loss: ' + escapeHtml(Number(stepPoint.loss).toFixed(4)));
  if (smoothed) lines.push('Smoothed step loss: ' + escapeHtml(Number(smoothed.loss).toFixed(4)));
  if (raw) lines.push('Epoch loss: ' + escapeHtml(Number(raw.loss).toFixed(4)));
  if (robust) lines.push('Robust loss: ' + escapeHtml(Number(robust.loss).toFixed(4)));
  lines.push('Saved: ' + escapeHtml(saved ? (saved.status === 'available' ? saved.fileName : 'ambiguous exports') : 'no'));
  if (region) {
    lines.push('Candidate region: ' + escapeHtml(String(region.startEpoch) + '–' + String(region.endEpoch)) + (representative ? ' · representative' : ''));
    lines.push(escapeHtml(String(region.label || 'Stable region')));
    lines.push(escapeHtml(trainingCandidatesRegionCoverage(region, data.savedArtifacts)));
  }
  return lines.map(function (line) { return '<div>' + line + '</div>'; }).join('');
}

function wireTrainingCandidatesChart() {
  var wrap = document.querySelector('.training-candidates-chart-wrap');
  if (!wrap || wrap.__trainingCandidatesChartWired) return;
  var chart = wrap.querySelector('.training-candidates-chart');
  var tooltip = wrap.querySelector('.training-candidates-tooltip');
  var guide = wrap.querySelector('.training-candidates-hover-guide');
  var pointMarker = wrap.querySelector('.training-candidates-hover-point');
  if (!chart || !tooltip || !guide || !pointMarker) return;
  wrap.__trainingCandidatesChartWired = true;
  var data = JSON.parse(chart.getAttribute('data-training-candidates-chart') || '{}');
  data.smoothedStepPoints = data.smoothedStepPoints || [];
  function hide() { tooltip.classList.add('hidden'); guide.classList.add('hidden'); pointMarker.classList.add('hidden'); }
  chart.addEventListener('mouseleave', hide);
  chart.addEventListener('mousemove', function (event) {
    var rect = chart.getBoundingClientRect();
    var cursor = chart.createSVGPoint();
    cursor.x = event.clientX; cursor.y = event.clientY;
    var position = cursor.matrixTransform(chart.getScreenCTM().inverse());
    var chartX = position.x;
    if (chartX < 46 || chartX > 960 || position.y < data.plotTop || position.y > data.plotBottom) return hide();
    var wanted = data.minStep + (chartX - 46) / 914 * (data.maxStep - data.minStep);
    var raw = (data.stepPoints || []).reduce(function (nearest, item) { return !nearest || Math.abs(Number(item.step) - wanted) < Math.abs(Number(nearest.step) - wanted) ? item : nearest; }, null);
    if (!raw) return hide();
    var x = 46 + (Number(raw.step) - data.minStep) / (data.maxStep - data.minStep) * 914;
    var y = Math.max(data.plotTop, Math.min(data.plotBottom, data.plotTop + (data.maxLoss - Number(raw.loss)) / (data.maxLoss - data.minLoss) * data.plotHeight));
    guide.setAttribute('x1', x.toFixed(2)); guide.setAttribute('x2', x.toFixed(2)); guide.classList.remove('hidden');
    pointMarker.setAttribute('cx', x.toFixed(2)); pointMarker.setAttribute('cy', y.toFixed(2)); pointMarker.classList.remove('hidden');
    tooltip.innerHTML = trainingCandidatesTooltipHtml(raw, data);
    tooltip.classList.remove('hidden');
    tooltip.style.left = Math.max(4, Math.min(wrap.clientWidth - tooltip.offsetWidth - 4, event.clientX - rect.left + 12)) + 'px';
    tooltip.style.top = Math.max(4, Math.min(rect.height - tooltip.offsetHeight - 4, event.clientY - rect.top + 10)) + 'px';
  });
}

function trainingCandidatesArtifactLabel(artifact) {
  if (artifact && artifact.available) return 'Saved · ' + String(artifact.fileName || '.safetensors');
  if (artifact && artifact.status === 'ambiguous') return 'Multiple exports found';
  return 'No matching saved LoRA';
}

function trainingCandidatesEpochList(epochs) {
  var values = (Array.isArray(epochs) ? epochs : []).map(Number).filter(isFinite).sort(function (a, b) { return a - b; });
  if (values.length <= 8) return values.join(', ');
  var stride = values[1] - values[0];
  var regular = stride > 0 && values.every(function (epoch, index) { return !index || epoch - values[index - 1] === stride; });
  if (regular) return values[0] + '–' + values[values.length - 1] + ' every ' + stride + ' epochs';
  return values.slice(0, 8).join(', ') + ' +' + (values.length - 8);
}

function trainingCandidatesRegionCoverage(region, savedArtifacts) {
  var saved = Array.isArray(region && region.savedEpochs) ? region.savedEpochs : [];
  var ambiguous = (Array.isArray(savedArtifacts) ? savedArtifacts : []).filter(function (artifact) {
    return artifact.status === 'ambiguous' && Number(artifact.epoch) >= Number(region.startEpoch) && Number(artifact.epoch) <= Number(region.endEpoch);
  }).map(function (artifact) { return artifact.epoch; });
  var text = saved.length ? 'Saved in region: ' + trainingCandidatesEpochList(saved) : (ambiguous.length ? 'No unambiguous saved LoRAs in region' : 'No saved LoRAs in region');
  return text + (ambiguous.length ? ' · Ambiguous exports: ' + trainingCandidatesEpochList(ambiguous) : '');
}

function trainingCandidatesRegionSummary(region) {
  return String(region.label || 'Stable region') + ' · Region ' + String(region.startEpoch) + '–' + String(region.endEpoch);
}

function trainingCandidatesContentHtml(payload) {
  var analysis = payload && payload.analysis ? payload.analysis : null;
  if (!analysis) return '<div class="training-candidates-empty">Loading loss curve…</div>';
  var candidates = Array.isArray(analysis.candidates) ? analysis.candidates : [];
  var list = candidates.length ? candidates.map(function (candidate) {
    var openAction = candidate.artifact && candidate.artifact.available ? '<button type="button" class="review-captions-btn training-candidates-open-epoch" data-training-candidate-epoch="' + escapeHtml(String(candidate.epoch)) + '">Open Folder</button>' : '';
    return '<article class="training-candidates-card"><strong>Epoch ' + escapeHtml(String(candidate.epoch)) + '</strong><span class="training-candidates-region-summary">' + escapeHtml(trainingCandidatesRegionSummary(candidate)) + '</span><span class="training-candidates-region-coverage">' + escapeHtml(trainingCandidatesRegionCoverage(candidate, analysis.savedArtifacts)) + '</span><em class="' + (candidate.artifact && candidate.artifact.available ? 'available' : 'missing') + '">' + escapeHtml(trainingCandidatesArtifactLabel(candidate.artifact)) + '</em>' + openAction + '</article>';
  }).join('') : '<div class="training-candidates-empty">No candidate regions with a completed checkpoint identified by this algorithm.</div>';
  return '<section class="training-candidates-analysis">' + trainingCandidatesSvg(analysis) + '<section class="training-candidates-list"><h3>Suggested epochs</h3>' + list + '</section></section>';
}

function openTrainingCandidatesFolder(epoch) {
  var folder = String(trainingWorkspaceState.candidateFolder || '');
  var jobId = String(trainingWorkspaceState.candidateJobId || '');
  if (!folder || !jobId) throw new Error('Candidate analysis has no selected training run.');
  var path = epoch ? '/fs/training_candidates/open_epoch' : '/fs/training_candidates/open_run';
  var body = { folder: folder, jobId: jobId };
  if (epoch) body.epoch = epoch;
  return trainingRunnerRequest(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function () { setStatus(epoch ? 'Opened saved LoRA folder.' : 'Opened training run folder.'); });
}

function renderTrainingCandidates() {
  var els = trainingCandidatesElements();
  if (!els.content) return;
  if (trainingWorkspaceState.candidatePending) {
    els.content.innerHTML = '<div class="training-candidates-empty">Loading loss curve…</div>';
    return;
  }
  els.content.innerHTML = trainingCandidatesContentHtml(trainingWorkspaceState.candidatePayload);
  wireTrainingCandidatesChart();
  Array.prototype.forEach.call(els.content.querySelectorAll('[data-training-candidate-epoch]'), function (button) {
    button.onclick = function () { openTrainingCandidatesFolder(button.getAttribute('data-training-candidate-epoch')).catch(function (err) { setStatus('Could not open saved LoRA folder: ' + String(err.message || err)); }); };
  });
}

function refreshTrainingCandidates() {
  var folder = String(trainingWorkspaceState.candidateFolder || '');
  var jobId = String(trainingWorkspaceState.candidateJobId || '');
  if (!folder || !jobId) throw new Error('Candidate analysis has no selected training run.');
  var requestVersion = ++trainingWorkspaceState.candidateRequestVersion;
  var algorithm = String(trainingWorkspaceState.candidateAlgorithm || 'v1');
  trainingWorkspaceState.candidatePending = true;
  trainingWorkspaceState.candidatePayload = null;
  renderTrainingCandidates();
  return trainingRunnerRequest('/fs/training_candidates?folder=' + encodeURIComponent(folder) + '&jobId=' + encodeURIComponent(jobId) + '&algorithm=' + encodeURIComponent(algorithm))
    .then(function (payload) {
      if (requestVersion !== trainingWorkspaceState.candidateRequestVersion) return;
      trainingWorkspaceState.candidatePayload = payload;
      var run = payload.run || {};
      var points = Array.isArray((payload.analysis || {}).epochLossPoints) ? payload.analysis.epochLossPoints : [];
      var summary = trainingCandidatesElements().summary;
      if (summary) summary.textContent = [run.runName || run.folder, trainingRunnerStatusLabel(run.status), points.length ? 'epochs ' + points[0].epoch + (points.length > 1 ? '–' + points[points.length - 1].epoch : '') : '', points.length ? points.length + ' epoch-loss points' : 'No epoch-loss points'].filter(Boolean).join(' · ');
    })
    .catch(function (err) {
      if (requestVersion !== trainingWorkspaceState.candidateRequestVersion) return;
      trainingWorkspaceState.candidatePending = false;
      trainingCandidatesElements().content.innerHTML = '<div class="training-candidates-empty is-error">' + escapeHtml(String(err.message || err)) + '</div>';
      throw err;
    })
    .finally(function () {
      if (requestVersion !== trainingWorkspaceState.candidateRequestVersion) return;
      trainingWorkspaceState.candidatePending = false;
      if (trainingWorkspaceState.candidatePayload) renderTrainingCandidates();
    });
}

function closeTrainingCandidates() {
  var els = trainingCandidatesElements();
  trainingWorkspaceState.candidateRequestVersion++;
  trainingWorkspaceState.candidateModalOpen = false;
  trainingWorkspaceState.candidatePending = false;
  trainingWorkspaceState.candidatePayload = null;
  if (els.modal) { els.modal.classList.add('hidden'); els.modal.setAttribute('aria-hidden', 'true'); }
}

function openTrainingCandidates(job) {
  if (!job || !job.id || !job.folder || !job.outputRunPath) { setStatus('Candidate analysis is available once this job has a recorded run directory.'); return; }
  var els = trainingCandidatesElements();
  trainingWorkspaceState.candidateJobId = String(job.id);
  trainingWorkspaceState.candidateFolder = String(job.folder);
  trainingWorkspaceState.candidateAlgorithm = 'v1';
  trainingWorkspaceState.candidatePayload = null;
  trainingWorkspaceState.candidateModalOpen = true;
  els.algorithm.value = trainingWorkspaceState.candidateAlgorithm;
  if (els.modal) { els.modal.classList.remove('hidden'); els.modal.setAttribute('aria-hidden', 'false'); }
  refreshTrainingCandidates().catch(function (err) {
    if (!trainingWorkspaceState.candidateModalOpen) return;
    trainingWorkspaceState.candidatePayload = null;
    trainingWorkspaceState.candidatePending = false;
    if (els.content) els.content.innerHTML = '<div class="training-candidates-empty is-error">' + escapeHtml(String(err && err.message ? err.message : err)) + '</div>';
  });
}

function wireTrainingCandidatesModal() {
  var els = trainingCandidatesElements();
  if (!els.modal || els.modal.__trainingCandidatesWired) return;
  els.modal.__trainingCandidatesWired = true;
  els.close.onclick = closeTrainingCandidates;
  els.refresh.onclick = function () { refreshTrainingCandidates().catch(function (err) { setStatus('Could not refresh LoRA candidates: ' + String(err.message || err)); }); };
  els.algorithm.onchange = function () {
    trainingWorkspaceState.candidateAlgorithm = els.algorithm.value;
    refreshTrainingCandidates().catch(function (err) { setStatus('Could not refresh LoRA candidates: ' + String(err.message || err)); });
  };
  els.openRun.onclick = function () { openTrainingCandidatesFolder().catch(function (err) { setStatus('Could not open training run folder: ' + String(err.message || err)); }); };
  els.modal.onclick = function (event) { if (event.target === els.modal) closeTrainingCandidates(); };
}

wireTrainingCandidatesModal();
