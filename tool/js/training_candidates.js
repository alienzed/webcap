// Read-only TensorBoard loss-curve modal for one recorded training run.
function trainingCandidatesElements() {
  return {
    modal: document.getElementById('training-candidates-modal'),
    summary: document.getElementById('training-candidates-modal-summary'),
    content: document.getElementById('training-candidates-modal-content'),
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
  return analysis.filter(function (item) { return Number(item.epoch) === Number(epoch); })[0] || points.filter(function (item) { return Number(item.epoch) === Number(epoch); })[0];
}

function trainingCandidatesSvg(data) {
  var points = data && Array.isArray(data.epochLossPoints) ? data.epochLossPoints : [];
  var analysis = data && Array.isArray(data.analysisPoints) ? data.analysisPoints : [];
  if (!points.length) return '<div class="training-candidates-empty">No epoch-loss points are available.</div>';
  var allLosses = points.concat(analysis).map(function (point) { return trainingCandidatesNumber(point.loss, 0); });
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
  function polyline(series) { return series.map(function (point) { return x(point.epoch).toFixed(2) + ',' + y(point.loss).toFixed(2); }).join(' '); }
  var regions = Array.isArray(data.regions) ? data.regions : [];
  var candidates = Array.isArray(data.candidates) ? data.candidates : [];
  var savedArtifacts = Array.isArray(data.savedArtifacts) ? data.savedArtifacts : [];
  var candidateEpochs = {};
  candidates.forEach(function (candidate) { candidateEpochs[Number(candidate.epoch)] = true; });
  var regionRects = regions.map(function (region) {
    var left = x(region.startEpoch);
    var right = x(region.endEpoch);
    return '<rect class="training-candidates-basin" x="' + left.toFixed(2) + '" y="20" width="' + Math.max(4, right - left).toFixed(2) + '" height="250"></rect>';
  }).join('');
  var savedMarkers = savedArtifacts.filter(function (artifact) { return !candidateEpochs[Number(artifact.epoch)]; }).map(function (artifact) {
    var point = trainingCandidatesPointForEpoch(artifact.epoch, analysis, points);
    return point ? '<circle class="training-candidates-saved-marker ' + escapeHtml(String(artifact.status || '')) + '" cx="' + x(artifact.epoch).toFixed(2) + '" cy="' + y(point.loss).toFixed(2) + '" r="3"></circle>' : '';
  }).join('');
  var candidateMarkers = candidates.map(function (candidate) {
    var point = trainingCandidatesPointForEpoch(candidate.epoch, analysis, points);
    if (!point) return '';
    return '<g class="training-candidates-marker"><line x1="' + x(candidate.epoch).toFixed(2) + '" y1="20" x2="' + x(candidate.epoch).toFixed(2) + '" y2="270"></line><circle cx="' + x(candidate.epoch).toFixed(2) + '" cy="' + y(point.loss).toFixed(2) + '" r="5"></circle><text x="' + x(candidate.epoch).toFixed(2) + '" y="14">' + escapeHtml(String(candidate.epoch)) + '</text></g>';
  }).join('');
  var chartData = escapeHtml(JSON.stringify({ points: points, analysis: analysis, regions: regions, candidates: candidates, savedArtifacts: savedArtifacts, minEpoch: minEpoch, maxEpoch: maxEpoch, minLoss: minLoss, maxLoss: maxLoss }));
  return '<div class="training-candidates-chart-wrap">' +
    '<svg class="training-candidates-chart" viewBox="0 0 1000 300" role="img" aria-label="Epoch loss curve" data-training-candidates-chart="' + chartData + '">' +
      '<line class="training-candidates-axis" x1="46" y1="270" x2="960" y2="270"></line><line class="training-candidates-axis" x1="46" y1="20" x2="46" y2="270"></line>' +
      regionRects + '<polyline class="training-candidates-raw" points="' + polyline(points) + '"></polyline>' +
      (analysis.length ? '<polyline class="training-candidates-analysis" points="' + polyline(analysis) + '"></polyline>' : '') + savedMarkers + candidateMarkers +
      '<line class="training-candidates-hover-guide hidden" x1="0" y1="20" x2="0" y2="270"></line><circle class="training-candidates-hover-point hidden" cx="0" cy="0" r="4"></circle><rect class="training-candidates-hover-layer" x="46" y="20" width="914" height="250"></rect>' +
      '<text class="training-candidates-axis-label" x="46" y="289">epoch ' + escapeHtml(String(minEpoch)) + '</text><text class="training-candidates-axis-label" x="960" y="289" text-anchor="end">epoch ' + escapeHtml(String(maxEpoch)) + '</text>' +
      '<text class="training-candidates-axis-label" x="40" y="25" text-anchor="end">' + escapeHtml(maxLoss.toFixed(4)) + '</text><text class="training-candidates-axis-label" x="40" y="270" text-anchor="end">' + escapeHtml(minLoss.toFixed(4)) + '</text>' +
    '</svg><div class="training-candidates-tooltip hidden"></div><div class="training-candidates-legend"><span><i class="raw"></i>Epoch loss</span><span><i class="analysis"></i>Robust trend</span><span><i class="saved"></i>Saved LoRA</span><span><i class="basin"></i>Candidate region</span></div></div>';
}

function trainingCandidatesTooltipHtml(epoch, data) {
  var raw = data.points.filter(function (point) { return Number(point.epoch) === epoch; })[0];
  var robust = data.analysis.filter(function (point) { return Number(point.epoch) === epoch; })[0];
  var saved = data.savedArtifacts.filter(function (artifact) { return Number(artifact.epoch) === epoch; })[0];
  var region = data.regions.filter(function (item) { return epoch >= Number(item.startEpoch) && epoch <= Number(item.endEpoch); })[0];
  var representative = region && Number(region.representativeEpoch) === epoch;
  var lines = ['<strong>Epoch ' + escapeHtml(String(epoch)) + '</strong>'];
  if (raw) lines.push('Epoch loss: ' + escapeHtml(Number(raw.loss).toFixed(4)));
  if (robust) lines.push('Robust loss: ' + escapeHtml(Number(robust.loss).toFixed(4)));
  lines.push('Saved: ' + escapeHtml(saved ? (saved.status === 'available' ? saved.fileName : 'ambiguous exports') : 'no'));
  if (region) lines.push('Candidate region: ' + escapeHtml(String(region.startEpoch) + '–' + String(region.endEpoch)) + (representative ? ' · representative' : ''));
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
  function hide() { tooltip.classList.add('hidden'); guide.classList.add('hidden'); pointMarker.classList.add('hidden'); }
  chart.addEventListener('mouseleave', hide);
  chart.addEventListener('mousemove', function (event) {
    var rect = chart.getBoundingClientRect();
    var chartX = (event.clientX - rect.left) / rect.width * 1000;
    var wanted = data.minEpoch + (chartX - 46) / 914 * (data.maxEpoch - data.minEpoch);
    var raw = (data.points || []).reduce(function (nearest, item) { return !nearest || Math.abs(Number(item.epoch) - wanted) < Math.abs(Number(nearest.epoch) - wanted) ? item : nearest; }, null);
    if (!raw) return hide();
    var epoch = Number(raw.epoch);
    var robust = (data.analysis || []).filter(function (item) { return Number(item.epoch) === epoch; })[0] || raw;
    var x = 46 + (epoch - data.minEpoch) / (data.maxEpoch - data.minEpoch) * 914;
    var y = 20 + (data.maxLoss - Number(robust.loss)) / (data.maxLoss - data.minLoss) * 250;
    guide.setAttribute('x1', x.toFixed(2)); guide.setAttribute('x2', x.toFixed(2)); guide.classList.remove('hidden');
    pointMarker.setAttribute('cx', x.toFixed(2)); pointMarker.setAttribute('cy', y.toFixed(2)); pointMarker.classList.remove('hidden');
    tooltip.innerHTML = trainingCandidatesTooltipHtml(epoch, data);
    tooltip.style.left = Math.max(4, Math.min(wrap.clientWidth - 210, event.clientX - rect.left + 12)) + 'px';
    tooltip.style.top = Math.max(4, Math.min(rect.height - 98, event.clientY - rect.top + 10)) + 'px';
    tooltip.classList.remove('hidden');
  });
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
  var list = candidates.length ? candidates.map(function (candidate) {
    var openAction = candidate.artifact && candidate.artifact.available ? '<button type="button" class="review-captions-btn training-candidates-open-epoch" data-training-candidate-epoch="' + escapeHtml(String(candidate.epoch)) + '">Open Folder</button>' : '';
    return '<article class="training-candidates-card"><strong>Epoch ' + escapeHtml(String(candidate.epoch)) + '</strong><span>' + escapeHtml(String(candidate.reason || 'Stable region.')) + '</span><em class="' + (candidate.artifact && candidate.artifact.available ? 'available' : 'missing') + '">' + escapeHtml(trainingCandidatesArtifactLabel(candidate.artifact)) + '</em>' + openAction + '</article>';
  }).join('') : '<div class="training-candidates-empty">No candidate regions identified yet. The current trend has not settled enough to suggest a saved epoch.</div>';
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
  trainingWorkspaceState.candidatePending = true;
  renderTrainingCandidates();
  return trainingRunnerRequest('/fs/training_candidates?folder=' + encodeURIComponent(folder) + '&jobId=' + encodeURIComponent(jobId))
    .then(function (payload) {
      if (requestVersion !== trainingWorkspaceState.candidateRequestVersion) return;
      trainingWorkspaceState.candidatePayload = payload;
      var run = payload.run || {};
      var points = Array.isArray((payload.analysis || {}).epochLossPoints) ? payload.analysis.epochLossPoints : [];
      var summary = trainingCandidatesElements().summary;
      if (summary) summary.textContent = [run.runName || run.folder, trainingRunnerStatusLabel(run.status), points.length ? 'epochs ' + points[0].epoch + (points.length > 1 ? '–' + points[points.length - 1].epoch : '') : '', points.length ? points.length + ' epoch-loss points' : 'No epoch-loss points'].filter(Boolean).join(' · ');
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
  if (els.modal) { els.modal.classList.add('hidden'); els.modal.setAttribute('aria-hidden', 'true'); }
}

function openTrainingCandidates(job) {
  if (!job || !job.id || !job.folder || !job.outputRunPath) { setStatus('Candidate analysis is available once this job has a recorded run directory.'); return; }
  var els = trainingCandidatesElements();
  trainingWorkspaceState.candidateJobId = String(job.id);
  trainingWorkspaceState.candidateFolder = String(job.folder);
  trainingWorkspaceState.candidatePayload = null;
  trainingWorkspaceState.candidateModalOpen = true;
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
  els.openRun.onclick = function () { openTrainingCandidatesFolder().catch(function (err) { setStatus('Could not open training run folder: ' + String(err.message || err)); }); };
  els.modal.onclick = function (event) { if (event.target === els.modal) closeTrainingCandidates(); };
}

wireTrainingCandidatesModal();
