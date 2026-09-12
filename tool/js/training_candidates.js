// Read-only TensorBoard loss-curve modal for one recorded training run.
function trainingCandidatesElements() {
  return {
    modal: document.getElementById('training-candidates-modal'),
    dialog: document.querySelector('#training-candidates-modal .training-candidates-dialog'),
    summary: document.getElementById('training-candidates-modal-summary'),
    content: document.getElementById('training-candidates-modal-content'),
    algorithm: document.getElementById('training-candidates-algorithm'),
    smoothing: document.getElementById('training-candidates-smoothing'),
    smoothingNumber: document.getElementById('training-candidates-smoothing-number'),
    yMin: document.getElementById('training-candidates-y-min'),
    yMax: document.getElementById('training-candidates-y-max'),
    yAuto: document.getElementById('training-candidates-y-auto'),
    refresh: document.getElementById('training-candidates-refresh'),
    fullscreen: document.getElementById('training-candidates-fullscreen'),
    openRun: document.getElementById('training-candidates-open-run'),
    close: document.getElementById('training-candidates-modal-close')
  };
}

function trainingCandidatesNumber(value, fallback) {
  var number = Number(value);
  return isFinite(number) ? number : fallback;
}

function trainingCandidatesDisplayState() {
  if (!trainingWorkspaceState.candidateDisplay) trainingWorkspaceState.candidateDisplay = { smoothing: .99, yMin: .10, yMax: .30 };
  return trainingWorkspaceState.candidateDisplay;
}

function trainingCandidatesEma(points, smoothing) {
  var retained = Math.max(0, Math.min(.999, trainingCandidatesNumber(smoothing, .99)));
  var previous = null;
  return points.map(function (point) {
    var loss = trainingCandidatesNumber(point.loss, 0);
    previous = previous === null ? loss : retained * previous + (1 - retained) * loss;
    return { step: point.step, epoch: point.epoch, loss: previous };
  });
}

function trainingCandidatesRangeValue(value) {
  return value === '' || value === null || value === undefined || !isFinite(Number(value)) ? null : Number(value);
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

function trainingCandidatesStepPointForEpoch(epoch, data) {
  var points = (data.stepPoints || []).filter(function (point) { return Number(point.epoch) === Number(epoch); });
  if (points.length) return points.reduce(function (latest, point) { return Number(point.step) > Number(latest.step) ? point : latest; });
  return (data.points || []).filter(function (point) { return Number(point.epoch) === Number(epoch); })[0] || null;
}

function trainingCandidatesChartGeometry() {
  var geometry = trainingWorkspaceState.candidateChartGeometry;
  return geometry && geometry.width >= 480 && geometry.height >= 320 ? geometry : { width: 1000, height: 560 };
}

function trainingCandidatesYAxisTicks(minLoss, maxLoss) {
  var rough = (maxLoss - minLoss) / 6;
  var scale = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
  var step = [1, 2, 5, 10].map(function (value) { return value * scale; }).reduce(function (best, value) {
    return Math.abs((maxLoss - minLoss) / value - 6) < Math.abs((maxLoss - minLoss) / best - 6) ? value : best;
  });
  var first = Math.ceil((minLoss - step * 1e-8) / step) * step;
  var ticks = [];
  for (var value = first; value < maxLoss + step * 1e-8 && ticks.length < 10; value += step) ticks.push(Number(value.toFixed(12)));
  return ticks.length > 1 ? ticks : [minLoss, maxLoss];
}

function trainingCandidatesClearPinnedDetails() {
  trainingWorkspaceState.candidatePinnedEpoch = null;
}

function trainingCandidatesClearChartWiring() {
  if (typeof trainingWorkspaceState.candidateChartCleanup === 'function') trainingWorkspaceState.candidateChartCleanup();
  trainingWorkspaceState.candidateChartCleanup = null;
}

function trainingCandidatesSvg(data) {
  var geometry = trainingCandidatesChartGeometry();
  var viewWidth = geometry.width, viewHeight = geometry.height;
  var plotLeft = Math.max(50, Math.round(viewWidth * .052)), plotRight = viewWidth - 22;
  var plotTop = 28, plotBottom = viewHeight - 42, plotHeight = plotBottom - plotTop;
  var points = data && Array.isArray(data.epochLossPoints) ? data.epochLossPoints : [];
  var stepPoints = data && Array.isArray(data.stepLossPoints) ? data.stepLossPoints : [];
  var display = trainingCandidatesDisplayState();
  var smoothedStepPoints = trainingCandidatesEma(stepPoints, display.smoothing);
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
  var requestedMin = trainingCandidatesRangeValue(display.yMin);
  var requestedMax = trainingCandidatesRangeValue(display.yMax);
  if (requestedMin !== null && requestedMax !== null && requestedMin < requestedMax) {
    minLoss = requestedMin;
    maxLoss = requestedMax;
  } else if (requestedMin !== null && requestedMin < maxLoss) {
    minLoss = requestedMin;
  } else if (requestedMax !== null && requestedMax > minLoss) {
    maxLoss = requestedMax;
  }
  function x(step) { return plotLeft + (trainingCandidatesNumber(step, minStep) - minStep) / (maxStep - minStep) * (plotRight - plotLeft); }
  function y(loss) { return plotTop + (maxLoss - trainingCandidatesNumber(loss, minLoss)) / (maxLoss - minLoss) * plotHeight; }
  function polyline(series) { return series.map(function (point) { return x(point.step).toFixed(2) + ',' + y(point.loss).toFixed(2); }).join(' '); }
  var regions = Array.isArray(data.regions) ? data.regions : [];
  var candidates = Array.isArray(data.candidates) ? data.candidates : [];
  var savedArtifacts = Array.isArray(data.savedArtifacts) ? data.savedArtifacts : [];
  var candidateEpochs = {};
  candidates.forEach(function (candidate) { candidateEpochs[Number(candidate.epoch)] = true; });
  function markerData(epoch) { return 'data-training-candidate-epoch="' + escapeHtml(String(epoch)) + '"'; }
  var regionRects = regions.map(function (region) {
    var left = x(region.startStep);
    var right = x(region.endStep);
    return '<rect class="training-candidates-basin" x="' + left.toFixed(2) + '" y="' + plotTop + '" width="' + Math.max(4, right - left).toFixed(2) + '" height="' + plotHeight + '"></rect>';
  }).join('');
  var savedMarkers = savedArtifacts.filter(function (artifact) { return !candidateEpochs[Number(artifact.epoch)]; }).map(function (artifact) {
    var point = trainingCandidatesPointForEpoch(artifact.epoch, analysis, points);
    if (!point) return '';
    var pointX = x(point.step).toFixed(2), pointY = y(point.loss).toFixed(2);
    return '<g class="training-candidates-epoch-marker training-candidates-saved-marker ' + escapeHtml(String(artifact.status || '')) + '" ' + markerData(artifact.epoch) + ' role="button" tabindex="0" aria-label="Saved LoRA at epoch ' + escapeHtml(String(artifact.epoch)) + '"><circle cx="' + pointX + '" cy="' + pointY + '" r="3"></circle><circle class="training-candidates-epoch-hit" cx="' + pointX + '" cy="' + pointY + '" r="10"></circle></g>';
  }).join('');
  var candidateMarkers = candidates.map(function (candidate) {
    var analytical = trainingCandidatesPointForStep(candidate.step, analysis);
    var checkpoint = trainingCandidatesPointForEpoch(candidate.epoch, [], points);
    var point = { step: candidate.step, loss: analytical ? analytical.loss : checkpoint.loss };
    var pointX = x(point.step).toFixed(2), pointY = y(point.loss).toFixed(2);
    return '<g class="training-candidates-marker training-candidates-epoch-marker" ' + markerData(candidate.epoch) + ' role="button" tabindex="0" aria-label="Suggested epoch ' + escapeHtml(String(candidate.epoch)) + '"><line x1="' + pointX + '" y1="' + plotTop + '" x2="' + pointX + '" y2="' + plotBottom + '"></line><circle cx="' + pointX + '" cy="' + pointY + '" r="5"></circle><text x="' + pointX + '" y="' + (plotTop - 8) + '">' + escapeHtml(String(candidate.epoch)) + '</text><circle class="training-candidates-epoch-hit" cx="' + pointX + '" cy="' + pointY + '" r="12"></circle></g>';
  }).join('');
  var yTicks = trainingCandidatesYAxisTicks(minLoss, maxLoss).map(function (value) {
    var tickY = y(value);
    return '<line class="training-candidates-gridline" x1="' + plotLeft + '" y1="' + tickY.toFixed(2) + '" x2="' + plotRight + '" y2="' + tickY.toFixed(2) + '"></line><text class="training-candidates-axis-label" x="' + (plotLeft - 8) + '" y="' + (tickY + 4).toFixed(2) + '" text-anchor="end">' + escapeHtml(value.toFixed(4)) + '</text>';
  }).join('');
  var chartData = escapeHtml(JSON.stringify({ points: points, stepPoints: stepPoints, smoothedStepPoints: smoothedStepPoints, analysis: analysis, regions: regions, candidates: candidates, savedArtifacts: savedArtifacts, minStep: minStep, maxStep: maxStep, minLoss: minLoss, maxLoss: maxLoss, plotLeft: plotLeft, plotRight: plotRight, plotTop: plotTop, plotBottom: plotBottom, plotHeight: plotHeight, viewWidth: viewWidth, viewHeight: viewHeight }));
  return '<div class="training-candidates-chart-wrap">' +
    '<svg class="training-candidates-chart" viewBox="0 0 ' + viewWidth + ' ' + viewHeight + '" role="img" aria-label="TensorBoard step loss and epoch loss curve" data-training-candidates-chart="' + chartData + '">' +
      '<defs><clipPath id="training-candidates-plot-clip"><rect x="' + plotLeft + '" y="' + plotTop + '" width="' + (plotRight - plotLeft) + '" height="' + plotHeight + '"></rect></clipPath></defs>' +
      yTicks + '<line class="training-candidates-axis" x1="' + plotLeft + '" y1="' + plotBottom + '" x2="' + plotRight + '" y2="' + plotBottom + '"></line><line class="training-candidates-axis" x1="' + plotLeft + '" y1="' + plotTop + '" x2="' + plotLeft + '" y2="' + plotBottom + '"></line>' +
      '<polyline class="training-candidates-step-loss" clip-path="url(#training-candidates-plot-clip)" points="' + polyline(stepPoints) + '"></polyline>' +
      (smoothedStepPoints.length ? '<polyline class="training-candidates-step-loss-smoothed" clip-path="url(#training-candidates-plot-clip)" points="' + polyline(smoothedStepPoints) + '"></polyline>' : '') +
      regionRects + '<polyline class="training-candidates-raw" points="' + polyline(points) + '"></polyline>' +
      (analysis.length ? '<polyline class="training-candidates-analysis" points="' + polyline(analysis) + '"></polyline>' : '') +
      '<rect class="training-candidates-hover-layer" x="' + plotLeft + '" y="' + plotTop + '" width="' + (plotRight - plotLeft) + '" height="' + plotHeight + '"></rect><line class="training-candidates-hover-guide hidden" x1="0" y1="' + plotTop + '" x2="0" y2="' + plotBottom + '"></line><circle class="training-candidates-hover-point hidden" cx="0" cy="0" r="4"></circle>' + savedMarkers + candidateMarkers +
      '<text class="training-candidates-axis-label" x="' + plotLeft + '" y="' + (plotBottom + 24) + '">step ' + escapeHtml(String(minStep)) + ' · epoch ' + escapeHtml(String(minStepPoint.epoch)) + '</text><text class="training-candidates-axis-label" x="' + plotRight + '" y="' + (plotBottom + 24) + '" text-anchor="end">step ' + escapeHtml(String(maxStep)) + ' · epoch ' + escapeHtml(String(maxStepPoint.epoch)) + '</text>' +
    '</svg><div class="training-candidates-tooltip hidden"></div><div class="training-candidates-pinned-popover hidden"></div><div class="training-candidates-legend"><span><i class="step"></i>Raw step loss</span><span><i class="step-smoothed"></i>Smoothed step loss</span><span><i class="raw"></i>Epoch loss</span><span><i class="analysis"></i>Robust trend</span><span><i class="saved"></i>Saved LoRA</span><span><i class="basin"></i>Candidate region</span></div>' + (candidates.length ? '' : '<div class="training-candidates-no-candidates">No candidate regions identified by this algorithm.</div>') + '</div>';
}

function trainingCandidatesTooltipHtml(stepPoint, data) {
  var epoch = Number(stepPoint.epoch);
  var smoothed = data.smoothedStepPoints.filter(function (point) { return Number(point.step) === Number(stepPoint.step); })[0];
  var raw = data.points.filter(function (point) { return Number(point.epoch) === epoch; })[0];
  var robust = trainingCandidatesPointForStep(stepPoint.step, data.analysis);
  var saved = data.savedArtifacts.filter(function (artifact) { return Number(artifact.epoch) === epoch; })[0];
  var region = data.regions.filter(function (item) { return Number(stepPoint.step) >= Number(item.startStep) && Number(stepPoint.step) <= Number(item.endStep); })[0];
  var representative = data.candidates.some(function (candidate) { return Number(candidate.epoch) === epoch; });
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
  var popover = wrap.querySelector('.training-candidates-pinned-popover');
  var guide = wrap.querySelector('.training-candidates-hover-guide');
  var pointMarker = wrap.querySelector('.training-candidates-hover-point');
  if (!chart || !tooltip || !popover || !guide || !pointMarker) return;
  wrap.__trainingCandidatesChartWired = true;
  var data = JSON.parse(chart.getAttribute('data-training-candidates-chart') || '{}');
  data.smoothedStepPoints = data.smoothedStepPoints || [];
  function hide() { tooltip.classList.add('hidden'); guide.classList.add('hidden'); pointMarker.classList.add('hidden'); }
  function chartPoint(point) {
    return {
      x: data.plotLeft + (Number(point.step) - data.minStep) / (data.maxStep - data.minStep) * (data.plotRight - data.plotLeft),
      y: Math.max(data.plotTop, Math.min(data.plotBottom, data.plotTop + (data.maxLoss - Number(point.loss)) / (data.maxLoss - data.minLoss) * data.plotHeight))
    };
  }
  function clearPinned() {
    trainingCandidatesClearPinnedDetails();
    popover.classList.add('hidden');
  }
  function showPinned(epoch) {
    var point = trainingCandidatesStepPointForEpoch(epoch, data);
    if (!point) return;
    trainingWorkspaceState.candidatePinnedEpoch = Number(epoch);
    hide();
    popover.innerHTML = trainingCandidatesTooltipHtml(point, data) + ((data.savedArtifacts || []).some(function (artifact) { return Number(artifact.epoch) === Number(epoch) && artifact.available; }) ? '<button type="button" class="review-captions-btn training-candidates-open-epoch" data-training-candidate-epoch="' + escapeHtml(String(epoch)) + '">Open Folder</button>' : '');
    popover.classList.remove('hidden');
    var position = chartPoint(point);
    var left = position.x / data.viewWidth * chart.clientWidth + 12;
    var top = position.y / data.viewHeight * chart.clientHeight + 10;
    popover.style.left = Math.max(6, Math.min(chart.clientWidth - popover.offsetWidth - 6, left)) + 'px';
    popover.style.top = Math.max(6, Math.min(chart.clientHeight - popover.offsetHeight - 6, top)) + 'px';
  }
  chart.addEventListener('mouseleave', function () { if (trainingWorkspaceState.candidatePinnedEpoch === null) hide(); });
  chart.addEventListener('mousemove', function (event) {
    if (trainingWorkspaceState.candidatePinnedEpoch !== null) return;
    var rect = chart.getBoundingClientRect();
    var cursor = chart.createSVGPoint();
    cursor.x = event.clientX; cursor.y = event.clientY;
    var position = cursor.matrixTransform(chart.getScreenCTM().inverse());
    var chartX = position.x;
    if (chartX < data.plotLeft || chartX > data.plotRight || position.y < data.plotTop || position.y > data.plotBottom) return hide();
    var wanted = data.minStep + (chartX - data.plotLeft) / (data.plotRight - data.plotLeft) * (data.maxStep - data.minStep);
    var raw = (data.stepPoints || []).reduce(function (nearest, item) { return !nearest || Math.abs(Number(item.step) - wanted) < Math.abs(Number(nearest.step) - wanted) ? item : nearest; }, null);
    if (!raw) return hide();
    var point = chartPoint(raw), x = point.x, y = point.y;
    guide.setAttribute('x1', x.toFixed(2)); guide.setAttribute('x2', x.toFixed(2)); guide.classList.remove('hidden');
    pointMarker.setAttribute('cx', x.toFixed(2)); pointMarker.setAttribute('cy', y.toFixed(2)); pointMarker.classList.remove('hidden');
    tooltip.innerHTML = trainingCandidatesTooltipHtml(raw, data);
    tooltip.classList.remove('hidden');
    tooltip.style.left = Math.max(4, Math.min(wrap.clientWidth - tooltip.offsetWidth - 4, event.clientX - rect.left + 12)) + 'px';
    tooltip.style.top = Math.max(4, Math.min(chart.clientHeight - tooltip.offsetHeight - 4, event.clientY - rect.top + 10)) + 'px';
  });
  wrap.addEventListener('click', function (event) {
    var openButton = event.target.closest ? event.target.closest('.training-candidates-open-epoch') : null;
    if (openButton) {
      event.stopPropagation();
      openTrainingCandidatesFolder(openButton.getAttribute('data-training-candidate-epoch')).catch(function (err) { setStatus('Could not open saved LoRA folder: ' + String(err.message || err)); });
      return;
    }
    var marker = event.target.closest ? event.target.closest('[data-training-candidate-epoch]') : null;
    if (marker) {
      event.stopPropagation();
      showPinned(marker.getAttribute('data-training-candidate-epoch'));
    } else if (!popover.contains(event.target)) {
      clearPinned();
    }
  });
  wrap.addEventListener('keydown', function (event) {
    var marker = event.target.closest ? event.target.closest('[data-training-candidate-epoch]') : null;
    if (marker && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      showPinned(marker.getAttribute('data-training-candidate-epoch'));
    }
  });
  var onDocumentClick = function (event) { if (!wrap.contains(event.target)) clearPinned(); };
  var onDocumentKeydown = function (event) {
    if (event.key === 'Escape' && trainingWorkspaceState.candidatePinnedEpoch !== null) {
      event.preventDefault();
      clearPinned();
    }
  };
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onDocumentKeydown);
  var observer = null;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(function () {
      var width = Math.round(chart.clientWidth), height = Math.round(chart.clientHeight);
      var geometry = trainingCandidatesChartGeometry();
      if (width >= 480 && height >= 320 && (Math.abs(width - geometry.width) > 1 || Math.abs(height - geometry.height) > 1)) {
        trainingWorkspaceState.candidateChartGeometry = { width: width, height: height };
        renderTrainingCandidates();
      }
    });
    observer.observe(chart);
  }
  trainingWorkspaceState.candidateChartCleanup = function () {
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onDocumentKeydown);
    if (observer) observer.disconnect();
  };
  if (trainingWorkspaceState.candidatePinnedEpoch !== null && trainingWorkspaceState.candidatePinnedEpoch !== undefined) showPinned(trainingWorkspaceState.candidatePinnedEpoch);
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
  return 'Region ' + String(region.startEpoch) + '–' + String(region.endEpoch);
}

function trainingCandidatesContentHtml(payload) {
  var analysis = payload && payload.analysis ? payload.analysis : null;
  if (!analysis) return '<div class="training-candidates-empty">Loading loss curve…</div>';
  return '<section class="training-candidates-analysis">' + trainingCandidatesSvg(analysis) + '</section>';
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
  trainingCandidatesClearChartWiring();
  if (trainingWorkspaceState.candidatePending) {
    els.content.innerHTML = '<div class="training-candidates-empty">Loading loss curve…</div>';
    return;
  }
  els.content.innerHTML = trainingCandidatesContentHtml(trainingWorkspaceState.candidatePayload);
  wireTrainingCandidatesChart();
}

function syncTrainingCandidatesDisplayControls() {
  var els = trainingCandidatesElements();
  var display = trainingCandidatesDisplayState();
  if (els.smoothing) els.smoothing.value = String(display.smoothing);
  if (els.smoothingNumber) els.smoothingNumber.value = Number(display.smoothing).toFixed(3);
  if (els.yMin) els.yMin.value = display.yMin === null ? '' : String(display.yMin);
  if (els.yMax) els.yMax.value = display.yMax === null ? '' : String(display.yMax);
}

function refreshTrainingCandidates() {
  var folder = String(trainingWorkspaceState.candidateFolder || '');
  var jobId = String(trainingWorkspaceState.candidateJobId || '');
  if (!folder || !jobId) throw new Error('Candidate analysis has no selected training run.');
  var requestVersion = ++trainingWorkspaceState.candidateRequestVersion;
  var algorithm = String(trainingWorkspaceState.candidateAlgorithm || 'v5');
  trainingCandidatesClearPinnedDetails();
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

function syncTrainingCandidatesFullscreenButton() {
  var els = trainingCandidatesElements();
  if (!els.fullscreen || !els.dialog) return;
  var fullscreen = document.fullscreenElement === els.dialog;
  els.fullscreen.innerHTML = fullscreen ? '&#10530;' : '&#9974;';
  els.fullscreen.setAttribute('title', fullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
  els.fullscreen.setAttribute('aria-label', fullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
}

function toggleTrainingCandidatesFullscreen() {
  var els = trainingCandidatesElements();
  if (!els.dialog) { setStatus('Fullscreen is unavailable because the candidate dialog is missing.'); return; }
  var action = document.fullscreenElement === els.dialog
    ? (document.exitFullscreen ? document.exitFullscreen() : Promise.reject(new Error('Fullscreen exit is not supported.')))
    : (els.dialog.requestFullscreen ? els.dialog.requestFullscreen() : Promise.reject(new Error('Fullscreen is not supported by this browser.')));
  Promise.resolve(action).catch(function (err) { setStatus('Could not change fullscreen mode: ' + String(err.message || err)); });
}

function closeTrainingCandidates() {
  var els = trainingCandidatesElements();
  trainingWorkspaceState.candidateRequestVersion++;
  trainingWorkspaceState.candidateModalOpen = false;
  trainingWorkspaceState.candidatePending = false;
  trainingWorkspaceState.candidatePayload = null;
  trainingWorkspaceState.candidateChartGeometry = null;
  trainingCandidatesClearPinnedDetails();
  trainingCandidatesClearChartWiring();
  if (document.fullscreenElement === els.dialog && document.exitFullscreen) document.exitFullscreen().catch(function (err) { setStatus('Could not exit fullscreen: ' + String(err.message || err)); });
  if (els.modal) { els.modal.classList.add('hidden'); els.modal.setAttribute('aria-hidden', 'true'); }
}

function openTrainingCandidates(job) {
  if (!job || !job.id || !job.folder || !job.outputRunPath) { setStatus('Candidate analysis is available once this job has a recorded run directory.'); return; }
  var els = trainingCandidatesElements();
  trainingWorkspaceState.candidateJobId = String(job.id);
  trainingWorkspaceState.candidateFolder = String(job.folder);
  trainingWorkspaceState.candidateAlgorithm = 'v5';
  trainingWorkspaceState.candidatePayload = null;
  trainingWorkspaceState.candidateChartGeometry = null;
  trainingCandidatesClearPinnedDetails();
  trainingWorkspaceState.candidateDisplay = { smoothing: .99, yMin: .10, yMax: .30 };
  trainingWorkspaceState.candidateModalOpen = true;
  els.algorithm.value = trainingWorkspaceState.candidateAlgorithm;
  syncTrainingCandidatesDisplayControls();
  syncTrainingCandidatesFullscreenButton();
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
  els.fullscreen.onclick = toggleTrainingCandidatesFullscreen;
  document.addEventListener('fullscreenchange', syncTrainingCandidatesFullscreenButton);
  els.algorithm.onchange = function () {
    trainingWorkspaceState.candidateAlgorithm = els.algorithm.value;
    trainingCandidatesClearPinnedDetails();
    refreshTrainingCandidates().catch(function (err) { setStatus('Could not refresh LoRA candidates: ' + String(err.message || err)); });
  };
  els.smoothing.oninput = function () {
    trainingCandidatesDisplayState().smoothing = trainingCandidatesNumber(els.smoothing.value, .99);
    trainingCandidatesClearPinnedDetails();
    syncTrainingCandidatesDisplayControls();
    renderTrainingCandidates();
  };
  function commitSmoothingNumber() {
    var value = trainingCandidatesNumber(els.smoothingNumber.value, NaN);
    if (value >= .900 && value <= .999) {
      trainingCandidatesDisplayState().smoothing = value;
      trainingCandidatesClearPinnedDetails();
      syncTrainingCandidatesDisplayControls();
      renderTrainingCandidates();
    } else {
      syncTrainingCandidatesDisplayControls();
    }
  }
  els.smoothingNumber.onchange = commitSmoothingNumber;
  els.smoothingNumber.onkeydown = function (event) { if (event.key === 'Enter') els.smoothingNumber.blur(); };
  function updateYRange() {
    var display = trainingCandidatesDisplayState();
    var min = trainingCandidatesRangeValue(els.yMin.value);
    var max = trainingCandidatesRangeValue(els.yMax.value);
    if (min !== null && max !== null && min >= max) {
      syncTrainingCandidatesDisplayControls();
      return;
    }
    display.yMin = min;
    display.yMax = max;
    trainingCandidatesClearPinnedDetails();
    syncTrainingCandidatesDisplayControls();
    renderTrainingCandidates();
  }
  els.yMin.onchange = updateYRange;
  els.yMax.onchange = updateYRange;
  els.yMin.onkeydown = function (event) { if (event.key === 'Enter') els.yMin.blur(); };
  els.yMax.onkeydown = function (event) { if (event.key === 'Enter') els.yMax.blur(); };
  els.yAuto.onclick = function () {
    trainingCandidatesDisplayState().yMin = null;
    trainingCandidatesDisplayState().yMax = null;
    trainingCandidatesClearPinnedDetails();
    syncTrainingCandidatesDisplayControls();
    renderTrainingCandidates();
  };
  els.openRun.onclick = function () { openTrainingCandidatesFolder().catch(function (err) { setStatus('Could not open training run folder: ' + String(err.message || err)); }); };
  els.modal.onclick = function (event) { if (event.target === els.modal) closeTrainingCandidates(); };
}

wireTrainingCandidatesModal();
