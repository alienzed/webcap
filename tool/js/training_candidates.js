// Read-only TensorBoard loss-curve modal for one recorded training run.
function trainingCandidatesElements() {
  return {
    modal: document.getElementById('training-candidates-modal'),
    summary: document.getElementById('training-candidates-modal-summary'),
    content: document.getElementById('training-candidates-modal-content'),
    refresh: document.getElementById('training-candidates-refresh'),
    close: document.getElementById('training-candidates-modal-close')
  };
}

function trainingCandidatesNumber(value, fallback) {
  var number = Number(value);
  return isFinite(number) ? number : fallback;
}

function trainingCandidatesSvg(data) {
  var points = data && Array.isArray(data.points) ? data.points : [];
  var smoothed = data && Array.isArray(data.smoothedPoints) ? data.smoothedPoints : [];
  if (!points.length) return '<div class="training-candidates-empty">No epoch-loss points are available.</div>';
  var allLosses = points.concat(smoothed).map(function (point) { return trainingCandidatesNumber(point.loss, 0); });
  var minEpoch = Math.min.apply(Math, points.map(function (point) { return trainingCandidatesNumber(point.epoch, 0); }));
  var maxEpoch = Math.max.apply(Math, points.map(function (point) { return trainingCandidatesNumber(point.epoch, 0); }));
  var minLoss = Math.min.apply(Math, allLosses);
  var maxLoss = Math.max.apply(Math, allLosses);
  if (minEpoch === maxEpoch) maxEpoch = minEpoch + 1;
  if (minLoss === maxLoss) {
    minLoss -= Math.max(0.01, Math.abs(minLoss) * 0.02);
    maxLoss += Math.max(0.01, Math.abs(maxLoss) * 0.02);
  }
  var lossPadding = (maxLoss - minLoss) * 0.08;
  minLoss -= lossPadding;
  maxLoss += lossPadding;
  function x(epoch) { return 46 + (trainingCandidatesNumber(epoch, minEpoch) - minEpoch) / (maxEpoch - minEpoch) * 914; }
  function y(loss) { return 20 + (maxLoss - trainingCandidatesNumber(loss, minLoss)) / (maxLoss - minLoss) * 250; }
  function polyline(series) {
    return series.map(function (point) { return x(point.epoch).toFixed(2) + ',' + y(point.loss).toFixed(2); }).join(' ');
  }
  var basins = Array.isArray(data.basins) ? data.basins : [];
  var basinRects = basins.map(function (basin) {
    var left = x(basin.startEpoch);
    var right = x(basin.endEpoch);
    return '<rect class="training-candidates-basin ' + (basin.confirmed ? 'confirmed' : 'tentative') + '" x="' + left.toFixed(2) + '" y="20" width="' + Math.max(4, right - left).toFixed(2) + '" height="250"></rect>';
  }).join('');
  var candidates = Array.isArray(data.candidates) ? data.candidates : [];
  var markers = candidates.map(function (candidate) {
    var point = smoothed.filter(function (item) { return Number(item.epoch) === Number(candidate.epoch); })[0] || points.filter(function (item) { return Number(item.epoch) === Number(candidate.epoch); })[0];
    if (!point) return '';
    return '<g class="training-candidates-marker"><line x1="' + x(candidate.epoch).toFixed(2) + '" y1="20" x2="' + x(candidate.epoch).toFixed(2) + '" y2="270"></line><circle cx="' + x(candidate.epoch).toFixed(2) + '" cy="' + y(point.loss).toFixed(2) + '" r="5"></circle><text x="' + x(candidate.epoch).toFixed(2) + '" y="14">' + escapeHtml(String(candidate.epoch)) + '</text></g>';
  }).join('');
  return '<div class="training-candidates-chart-wrap"><svg class="training-candidates-chart" viewBox="0 0 1000 300" role="img" aria-label="Epoch loss curve">' +
    '<line class="training-candidates-axis" x1="46" y1="270" x2="960" y2="270"></line><line class="training-candidates-axis" x1="46" y1="20" x2="46" y2="270"></line>' +
    basinRects +
    '<polyline class="training-candidates-raw" points="' + polyline(points) + '"></polyline>' +
    '<polyline class="training-candidates-smoothed" points="' + polyline(smoothed) + '"></polyline>' +
    markers +
    '<text class="training-candidates-axis-label" x="46" y="289">epoch ' + escapeHtml(String(minEpoch)) + '</text><text class="training-candidates-axis-label" x="960" y="289" text-anchor="end">epoch ' + escapeHtml(String(maxEpoch)) + '</text>' +
    '<text class="training-candidates-axis-label" x="40" y="25" text-anchor="end">' + escapeHtml(maxLoss.toFixed(4)) + '</text><text class="training-candidates-axis-label" x="40" y="270" text-anchor="end">' + escapeHtml(minLoss.toFixed(4)) + '</text>' +
    '</svg><div class="training-candidates-legend"><span><i class="raw"></i>Epoch loss</span><span><i class="smooth"></i>Smoothed</span><span><i class="basin"></i>Valley</span></div></div>';
}

function trainingCandidatesArtifactLabel(artifact) {
  if (artifact && artifact.available) return 'Saved · ' + String(artifact.fileName || '.safetensors');
  if (artifact && artifact.status === 'ambiguous') return 'Multiple exports found';
  return 'No matching saved LoRA';
}

function trainingCandidatesContentHtml(payload) {
  var analysis = payload && payload.analysis ? payload.analysis : null;
  if (!analysis) return '<div class="training-candidates-empty">Loading loss curve…</div>';
  var candidates = Array.isArray(analysis.candidates) ? analysis.candidates : [];
  var list = candidates.length
    ? candidates.map(function (candidate) {
      return '<article class="training-candidates-card"><strong>Epoch ' + escapeHtml(String(candidate.epoch)) + '</strong><span>' + escapeHtml(String(candidate.reason || 'Stable valley.')) + '</span><em class="' + (candidate.artifact && candidate.artifact.available ? 'available' : 'missing') + '">' + escapeHtml(trainingCandidatesArtifactLabel(candidate.artifact)) + '</em></article>';
    }).join('')
    : '<div class="training-candidates-empty">No confirmed valleys yet. The current tail remains unselected until the curve clearly exits a stable low region.</div>';
  return '<section class="training-candidates-analysis">' + trainingCandidatesSvg(analysis) + '<section class="training-candidates-list"><h3>Suggested epochs</h3>' + list + '</section></section>';
}

function renderTrainingCandidates() {
  var els = trainingCandidatesElements();
  if (!els.content) return;
  if (trainingWorkspaceState.candidatePending) {
    els.content.innerHTML = '<div class="training-candidates-empty">Loading loss curve…</div>';
    return;
  }
  els.content.innerHTML = trainingCandidatesContentHtml(trainingWorkspaceState.candidatePayload);
}

function refreshTrainingCandidates() {
  var folder = String(trainingWorkspaceState.candidateFolder || '');
  var jobId = String(trainingWorkspaceState.candidateJobId || '');
  if (!folder || !jobId) throw new Error('Candidate analysis has no selected training run.');
  var requestVersion = ++trainingWorkspaceState.candidateRequestVersion;
  trainingWorkspaceState.candidatePending = true;
  renderTrainingCandidates();
  return trainingRunnerRequest('/fs/training_candidates?folder=' + encodeURIComponent(folder) + '&jobId=' + encodeURIComponent(jobId))
    .then(function (payload) {
      if (requestVersion !== trainingWorkspaceState.candidateRequestVersion) return;
      trainingWorkspaceState.candidatePayload = payload;
      var run = payload.run || {};
      var analysis = payload.analysis || {};
      var points = Array.isArray(analysis.points) ? analysis.points : [];
      var pointCount = points.length;
      var epochRange = pointCount ? 'epochs ' + points[0].epoch + (pointCount > 1 ? '–' + points[pointCount - 1].epoch : '') : '';
      var summary = trainingCandidatesElements().summary;
      if (summary) summary.textContent = [run.runName || run.folder, trainingRunnerStatusLabel(run.status), epochRange, pointCount ? pointCount + ' epoch-loss points' : 'No epoch-loss points'].filter(Boolean).join(' · ');
    })
    .finally(function () {
      if (requestVersion !== trainingWorkspaceState.candidateRequestVersion) return;
      trainingWorkspaceState.candidatePending = false;
      renderTrainingCandidates();
    });
}

function closeTrainingCandidates() {
  var els = trainingCandidatesElements();
  trainingWorkspaceState.candidateRequestVersion++;
  trainingWorkspaceState.candidateModalOpen = false;
  trainingWorkspaceState.candidatePending = false;
  trainingWorkspaceState.candidatePayload = null;
  if (els.modal) {
    els.modal.classList.add('hidden');
    els.modal.setAttribute('aria-hidden', 'true');
  }
}

function openTrainingCandidates(job) {
  if (!job || !job.id || !job.folder || !job.outputRunPath) {
    setStatus('Candidate analysis is available once this job has a recorded run directory.');
    return;
  }
  var els = trainingCandidatesElements();
  trainingWorkspaceState.candidateJobId = String(job.id);
  trainingWorkspaceState.candidateFolder = String(job.folder);
  trainingWorkspaceState.candidatePayload = null;
  trainingWorkspaceState.candidateModalOpen = true;
  if (els.modal) {
    els.modal.classList.remove('hidden');
    els.modal.setAttribute('aria-hidden', 'false');
  }
  refreshTrainingCandidates().catch(function (err) {
    if (!trainingWorkspaceState.candidateModalOpen) return;
    trainingWorkspaceState.candidatePayload = null;
    trainingWorkspaceState.candidatePending = false;
    var content = trainingCandidatesElements().content;
    if (content) content.innerHTML = '<div class="training-candidates-empty is-error">' + escapeHtml(String(err && err.message ? err.message : err)) + '</div>';
  });
}

function wireTrainingCandidatesModal() {
  var els = trainingCandidatesElements();
  if (!els.modal || els.modal.__trainingCandidatesWired) return;
  els.modal.__trainingCandidatesWired = true;
  els.close.onclick = closeTrainingCandidates;
  els.refresh.onclick = function () {
    refreshTrainingCandidates().catch(function (err) { setStatus('Could not refresh LoRA candidates: ' + String(err && err.message ? err.message : err)); });
  };
  els.modal.onclick = function (event) { if (event.target === els.modal) closeTrainingCandidates(); };
}

wireTrainingCandidatesModal();
