var videoClipTargetItem = null;
var videoClipCropBusy = false;
var videoClipCropRatio = 1;
var videoClipSourceResolution = null;
var videoClipPendingCrop = null;
var videoClipOverwriteSourceMode = false;
var videoClipStatusPollTimer = null;
var videoClipStatusJobId = '';
var videoClipLastExportSignature = '';
var videoClipInlineCropper = null;
var videoClipCropEditActive = false;
var videoClipLoopPreviewActive = false;
var videoClipPlaybackRate = 1;
var videoClipRangeDrag = null;

function clearVideoClipStatusPoll() {
  if (videoClipStatusPollTimer) {
    clearInterval(videoClipStatusPollTimer);
    videoClipStatusPollTimer = null;
  }
  videoClipStatusJobId = '';
}

function getVideoClipEl(id) {
  return document.getElementById(id);
}

function formatVideoClipSeconds(value) {
  var n = Number(value || 0);
  if (!isFinite(n) || n < 0) n = 0;
  return n.toFixed(3);
}

function getVideoClipSourceDuration() {
  var videoEl = getVideoClipEl('video-clip-video');
  if (!videoEl) return 0;
  var sourceDuration = Number(videoEl.duration || 0);
  return isFinite(sourceDuration) && sourceDuration > 0 ? sourceDuration : 0;
}

function clampVideoClipRange(start, end, sourceDuration) {
  var currentTime = 0;
  var videoEl = getVideoClipEl('video-clip-video');
  if (videoEl) {
    currentTime = Number(videoEl.currentTime || 0);
    if (!isFinite(currentTime) || currentTime < 0) currentTime = 0;
  }

  var nextStart = Number(start);
  var nextEnd = Number(end);
  if (!isFinite(nextStart) || nextStart < 0) nextStart = 0;
  if (!isFinite(nextEnd) || nextEnd < nextStart) nextEnd = nextStart;
  if (isFinite(sourceDuration) && sourceDuration > 0) {
    if (nextStart > sourceDuration) nextStart = sourceDuration;
    if (nextEnd > sourceDuration) nextEnd = sourceDuration;
    if (nextEnd < nextStart) nextEnd = nextStart;
  }

  return {
    start: nextStart,
    end: nextEnd,
    duration: Math.max(0, nextEnd - nextStart),
    sourceDuration: isFinite(sourceDuration) && sourceDuration > 0
      ? sourceDuration
      : Math.max(nextEnd, currentTime, 1)
  };
}

function readVideoClipTrimState() {
  var startEl = getVideoClipEl('video-clip-start-input');
  var endEl = getVideoClipEl('video-clip-end-input');
  var durationEl = getVideoClipEl('video-clip-duration-input');
  if (!startEl || !durationEl) return null;

  var sourceDuration = getVideoClipSourceDuration();
  var start = Number(startEl.value || 0);
  var end = endEl ? Number(endEl.value) : NaN;
  var duration = Number(durationEl.value || 0);
  if (!isFinite(end)) {
    end = start + ((isFinite(duration) && duration >= 0) ? duration : 0);
  }
  return clampVideoClipRange(start, end, sourceDuration);
}

function writeVideoClipTrimInputs(range) {
  var startEl = getVideoClipEl('video-clip-start-input');
  var endEl = getVideoClipEl('video-clip-end-input');
  var durationEl = getVideoClipEl('video-clip-duration-input');
  if (!startEl || !endEl || !durationEl || !range) return;
  startEl.value = formatVideoClipSeconds(range.start);
  endEl.value = formatVideoClipSeconds(range.end);
  durationEl.value = formatVideoClipSeconds(range.duration);
}

function syncVideoClipTrimInputs(authority) {
  var startEl = getVideoClipEl('video-clip-start-input');
  var endEl = getVideoClipEl('video-clip-end-input');
  var durationEl = getVideoClipEl('video-clip-duration-input');
  if (!startEl || !endEl || !durationEl) return null;

  var sourceDuration = getVideoClipSourceDuration();
  var start = Number(startEl.value || 0);
  var end = Number(endEl.value);
  var duration = Number(durationEl.value || 0);

  if (!isFinite(start) || start < 0) start = 0;
  if (authority === 'duration') {
    if (!isFinite(duration) || duration < 0) duration = 0;
    end = start + duration;
  } else if (authority === 'end') {
    if (!isFinite(end)) end = start;
  } else {
    if (!isFinite(end)) {
      end = start + ((isFinite(duration) && duration >= 0) ? duration : 0);
    }
  }

  var range = clampVideoClipRange(start, end, sourceDuration);
  writeVideoClipTrimInputs(range);
  updateVideoClipTimelineUi();
  return range;
}

function seekVideoClipPlayhead(time) {
  var videoEl = getVideoClipEl('video-clip-video');
  if (!videoEl) return;
  var sourceDuration = getVideoClipSourceDuration();
  var nextTime = Number(time || 0);
  if (!isFinite(nextTime) || nextTime < 0) nextTime = 0;
  if (sourceDuration > 0 && nextTime > sourceDuration) nextTime = sourceDuration;
  try { videoEl.currentTime = nextTime; } catch (e) {}
  updateVideoClipTimelineUi();
}

function stepVideoClipPlayhead(delta) {
  var videoEl = getVideoClipEl('video-clip-video');
  if (!videoEl) return;
  var currentTime = Number(videoEl.currentTime || 0);
  if (!isFinite(currentTime) || currentTime < 0) currentTime = 0;
  seekVideoClipPlayhead(currentTime + Number(delta || 0));
}

function setVideoClipPlaybackRate(rate) {
  var nextRate = Number(rate || 1);
  if (!isFinite(nextRate) || nextRate <= 0) nextRate = 1;
  videoClipPlaybackRate = nextRate;
  var videoEl = getVideoClipEl('video-clip-video');
  if (videoEl) videoEl.playbackRate = nextRate;
  Array.prototype.forEach.call(document.querySelectorAll('.video-clip-rate-btn'), function (btn) {
    btn.classList.toggle('active', Math.abs((Number(btn.getAttribute('data-rate')) || 0) - videoClipPlaybackRate) < 0.0001);
  });
}

function updateVideoClipLoopPreviewButton() {
  var btn = getVideoClipEl('video-clip-loop-preview-btn');
  if (!btn) return;
  btn.textContent = videoClipLoopPreviewActive ? 'Stop Loop' : 'Loop Preview';
  btn.classList.toggle('active', videoClipLoopPreviewActive);
}

function stopVideoClipLoopPreview(options) {
  var wasActive = videoClipLoopPreviewActive;
  videoClipLoopPreviewActive = false;
  updateVideoClipLoopPreviewButton();
  if (!wasActive) return;
  if (options && options.pause === false) return;
  var videoEl = getVideoClipEl('video-clip-video');
  if (videoEl) {
    try { videoEl.pause(); } catch (e) {}
  }
}

function startVideoClipLoopPreview() {
  var range = syncVideoClipTrimInputs('start');
  var videoEl = getVideoClipEl('video-clip-video');
  if (!range || !videoEl || range.duration <= 0) return;
  videoClipLoopPreviewActive = true;
  updateVideoClipLoopPreviewButton();
  seekVideoClipPlayhead(range.start);
  setVideoClipPlaybackRate(videoClipPlaybackRate);
  try {
    var playPromise = videoEl.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(function () {});
    }
  } catch (e) {}
}

function toggleVideoClipLoopPreview() {
  if (videoClipLoopPreviewActive) {
    stopVideoClipLoopPreview();
    return;
  }
  startVideoClipLoopPreview();
}

function normalizeVideoClipOutputName(name) {
  var value = String(name || '').trim();
  if (!value) return '';
  var stem = value.replace(/\.[^.]*$/, '');
  if (!stem) return '';
  var ext = getFileExtension(value);
  if (ext !== '.mp4') return stem + '.mp4';
  return value;
}

function shouldVideoClipOverwriteSource(outputName) {
  if (isVideoClipInSrcVideosFolder() || !videoClipTargetItem || !videoClipTargetItem.fileName) {
    return false;
  }
  var rawOutput = String(outputName || '').trim().toLowerCase();
  var sourceName = String(videoClipTargetItem.fileName || '').trim().toLowerCase();
  if (!rawOutput || !sourceName) return false;
  if (rawOutput === sourceName) return true;
  return getFileExtension(sourceName) === '.mp4' &&
    normalizeVideoClipOutputName(rawOutput).toLowerCase() === sourceName;
}

function syncVideoClipOutputMode() {
  var outputEl = getVideoClipEl('video-clip-output-input');
  videoClipOverwriteSourceMode = shouldVideoClipOverwriteSource(outputEl ? outputEl.value : '');
  var titleEl = getVideoClipEl('video-clip-title');
  if (titleEl && videoClipTargetItem && videoClipTargetItem.fileName) {
    titleEl.textContent = videoClipOverwriteSourceMode
      ? ('Clip video (overwrite source): ' + videoClipTargetItem.fileName)
      : ('Clip video: ' + videoClipTargetItem.fileName);
  }
  return videoClipOverwriteSourceMode;
}

function getVideoClipCurrentCrop() {
  if (!videoClipPendingCrop) return null;
  return {
    x: Number(videoClipPendingCrop.x),
    y: Number(videoClipPendingCrop.y),
    width: Number(videoClipPendingCrop.width),
    height: Number(videoClipPendingCrop.height)
  };
}

function matchesVideoClipRatio(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) < 0.0002;
}

function setVideoClipStatus(text, options) {
  var statusEl = getVideoClipEl('video-clip-status');
  var textEl = getVideoClipEl('video-clip-status-text');
  if (!statusEl || !textEl) return;

  var message = String(text || '').trim();
  var kind = options && options.kind ? String(options.kind).toLowerCase() : '';

  textEl.textContent = message;
  statusEl.classList.toggle('hidden', !message);
  statusEl.classList.remove('is-active', 'is-success', 'is-error', 'error');
  statusEl.setAttribute('aria-busy', kind === 'active' ? 'true' : 'false');

  if (!message) return;
  if (kind === 'active') {
    statusEl.classList.add('is-active');
    return;
  }
  if (kind === 'success') {
    statusEl.classList.add('is-success');
    return;
  }
  if (kind === 'error') {
    statusEl.classList.add('is-error', 'error');
  }
}

function updateVideoClipExportAvailability() {
  var btn = getVideoClipEl('video-clip-export-btn');
  if (!btn) return;
  var unchanged = false;
  if (videoClipLastExportSignature) {
    try {
      unchanged = getVideoClipPayloadSignature(getVideoClipPayload(false)) === videoClipLastExportSignature;
    } catch (e) {
      unchanged = false;
    }
  }
  btn.disabled = videoClipCropBusy || videoClipCropEditActive || unchanged;
  btn.textContent = videoClipCropBusy ? 'Exporting...' : 'Export';
}

function setVideoClipBusy(isBusy) {
  videoClipCropBusy = !!isBusy;
  updateVideoClipExportAvailability();
  var outputEl = getVideoClipEl('video-clip-output-input');
  if (outputEl) outputEl.disabled = videoClipCropBusy;
  var startEl = getVideoClipEl('video-clip-start-input');
  if (startEl) startEl.disabled = videoClipCropBusy;
  var endEl = getVideoClipEl('video-clip-end-input');
  if (endEl) endEl.disabled = videoClipCropBusy;
  var durationEl = getVideoClipEl('video-clip-duration-input');
  if (durationEl) durationEl.disabled = videoClipCropBusy;
}

function isVideoClipInSrcVideosFolder() {
  var folder = (typeof state !== 'undefined' && state.folder) ? String(state.folder) : '';
  return /\bsrc_videos(\\|\/|$)/i.test(folder);
}

function setVideoClipSizeReadout(width, height) {
  var readoutEl = getVideoClipEl('video-clip-size-readout');
  if (!readoutEl) return;
  var w = Number(width);
  var h = Number(height);
  if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) {
    readoutEl.textContent = 'Full frame';
    return;
  }
  readoutEl.textContent = Math.round(w) + ' x ' + Math.round(h) + ' px';
}

function getVideoClipRatioLabel(ratio) {
  var value = Number(ratio || 1);
  if (matchesVideoClipRatio(value, 1)) return '1:1';
  if (matchesVideoClipRatio(value, 1.3333333333)) return '4:3';
  if (matchesVideoClipRatio(value, 0.5625)) return '9:16';
  if (matchesVideoClipRatio(value, 1.7777778)) return '16:9';
  return value.toFixed(3);
}

function parseResolutionText(value) {
  var text = String(value || '').toLowerCase().trim();
  if (!text || text.indexOf('x') === -1) return null;
  var parts = text.split('x', 1);
  var rest = text.slice(parts[0].length + 1);
  var w = Number(parts[0]);
  var h = Number(rest);
  if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return null;
  return { width: Math.round(w), height: Math.round(h) };
}

function getVideoClipResolution(fileName) {
  var text = getResolutionForMedia(fileName);
  var parsed = parseResolutionText(text);
  if (parsed) return parsed;
  var row = (typeof getMetadataForMedia === 'function') ? getMetadataForMedia(fileName) : null;
  if (row && row.resolution) {
    parsed = parseResolutionText(row.resolution);
    if (parsed) return parsed;
  }
  if (videoClipSourceResolution && videoClipSourceResolution.width > 0 && videoClipSourceResolution.height > 0) {
    return {
      width: Number(videoClipSourceResolution.width),
      height: Number(videoClipSourceResolution.height)
    };
  }
  return null;
}

function getVideoClipDefaultRatioCrop() {
  var res = getVideoClipResolution(videoClipTargetItem && videoClipTargetItem.fileName);
  if (!res) {
    throw new Error('Could not determine video resolution for crop edit');
  }
  var ratio = videoClipCropRatio || 1;
  var sourceW = res.width;
  var sourceH = res.height;
  var widthFromHeight = sourceH * ratio;
  var cropW = widthFromHeight <= sourceW ? widthFromHeight : sourceW;
  var cropH = cropW / ratio;
  if (cropH > sourceH) {
    cropH = sourceH;
    cropW = cropH * ratio;
  }
  return {
    x: Math.round((sourceW - cropW) / 2),
    y: Math.round((sourceH - cropH) / 2),
    width: Math.round(cropW),
    height: Math.round(cropH)
  };
}

function getVideoClipStageLayout() {
  var wrapEl = getVideoClipEl('video-clip-player-wrap');
  var videoEl = getVideoClipEl('video-clip-video');
  if (!wrapEl || !videoEl) return null;
  var naturalW = Number(videoEl.videoWidth || 0);
  var naturalH = Number(videoEl.videoHeight || 0);
  if (!isFinite(naturalW) || !isFinite(naturalH) || naturalW <= 0 || naturalH <= 0) return null;
  var maxW = Math.max(160, Number(wrapEl.clientWidth || 0) - 24);
  var maxH = Math.max(120, Number(wrapEl.clientHeight || 0) - 24);
  if (!isFinite(maxW) || !isFinite(maxH) || maxW <= 0 || maxH <= 0) return null;
  var scale = Math.min(1, maxW / naturalW, maxH / naturalH);
  if (!isFinite(scale) || scale <= 0) scale = 1;
  return {
    width: Math.max(1, Math.round(naturalW * scale)),
    height: Math.max(1, Math.round(naturalH * scale)),
    naturalWidth: naturalW,
    naturalHeight: naturalH
  };
}

function updateVideoClipStageLayout() {
  var stageEl = getVideoClipEl('video-clip-preview-stage');
  var videoEl = getVideoClipEl('video-clip-video');
  var layout = getVideoClipStageLayout();
  if (!stageEl || !videoEl || !layout) return;
  stageEl.style.width = layout.width + 'px';
  stageEl.style.height = layout.height + 'px';
}

function destroyVideoClipInlineCropper() {
  if (videoClipInlineCropper) {
    videoClipInlineCropper.destroy();
    videoClipInlineCropper = null;
  }
}

function updateVideoClipCropOverlay() {
  var overlayEl = getVideoClipEl('video-clip-crop-overlay');
  var crop = getVideoClipCurrentCrop();
  var layout = getVideoClipStageLayout();
  if (!overlayEl || !crop || !layout || videoClipCropEditActive) {
    if (overlayEl) overlayEl.classList.add('hidden');
    return;
  }

  overlayEl.classList.remove('hidden');
  overlayEl.style.left = ((crop.x / layout.naturalWidth) * layout.width).toFixed(3) + 'px';
  overlayEl.style.top = ((crop.y / layout.naturalHeight) * layout.height).toFixed(3) + 'px';
  overlayEl.style.width = ((crop.width / layout.naturalWidth) * layout.width).toFixed(3) + 'px';
  overlayEl.style.height = ((crop.height / layout.naturalHeight) * layout.height).toFixed(3) + 'px';
}

function updateVideoClipCropButtons() {
  var editBtn = getVideoClipEl('video-clip-crop-frame-btn');
  var applyBtn = getVideoClipEl('video-clip-crop-apply-btn');
  var cancelBtn = getVideoClipEl('video-clip-crop-cancel-btn');
  var clearBtn = getVideoClipEl('video-clip-crop-clear-btn');
  var hasCrop = !!getVideoClipCurrentCrop();
  if (editBtn) {
    editBtn.textContent = hasCrop ? 'Edit Crop' : 'Place Crop';
    editBtn.classList.toggle('hidden', videoClipCropEditActive);
  }
  if (applyBtn) applyBtn.classList.toggle('hidden', !videoClipCropEditActive);
  if (cancelBtn) cancelBtn.classList.toggle('hidden', !videoClipCropEditActive);
  if (clearBtn) clearBtn.classList.toggle('hidden', videoClipCropEditActive || !hasCrop);
  updateVideoClipExportAvailability();
}

function updateVideoClipCropSummary() {
  var summaryEl = getVideoClipEl('video-clip-crop-summary');
  if (!summaryEl) return;
  var crop = getVideoClipCurrentCrop();
  var label = getVideoClipRatioLabel(videoClipCropRatio);
  if (videoClipCropEditActive) {
    summaryEl.textContent = 'Editing ' + label + ' crop on the preview stage. Apply or cancel when it looks right.';
    summaryEl.classList.remove('hidden');
    return;
  }
  if (crop) {
    summaryEl.textContent = 'Applied ' + label + ' crop at ' + Math.round(crop.width) + ' x ' + Math.round(crop.height) + ' px.';
    summaryEl.classList.remove('hidden');
    return;
  }
  summaryEl.textContent = '';
  summaryEl.classList.add('hidden');
}

function updateVideoClipExportSummary() {
  var stateNoteEl = getVideoClipEl('video-clip-export-state-note');
  syncVideoClipOutputMode();

  if (stateNoteEl) {
    var unchanged = false;
    if (videoClipLastExportSignature) {
      try {
        unchanged = getVideoClipPayloadSignature(getVideoClipPayload(false)) === videoClipLastExportSignature;
      } catch (e) {
        unchanged = false;
      }
    }
    stateNoteEl.textContent = unchanged ? 'Unchanged since last export in this modal.' : '';
    stateNoteEl.classList.toggle('hidden', !unchanged);
  }
  updateVideoClipExportAvailability();
}

function setVideoClipPendingCrop(crop) {
  if (!crop) {
    videoClipPendingCrop = null;
    setVideoClipSizeReadout(0, 0);
    updateVideoClipCropButtons();
    updateVideoClipCropSummary();
    updateVideoClipExportSummary();
    updateVideoClipCropOverlay();
    return;
  }

  videoClipPendingCrop = {
    x: Math.round(Number(crop.x || 0)),
    y: Math.round(Number(crop.y || 0)),
    width: Math.round(Number(crop.width || 0)),
    height: Math.round(Number(crop.height || 0))
  };
  setVideoClipSizeReadout(videoClipPendingCrop.width, videoClipPendingCrop.height);
  updateVideoClipCropButtons();
  updateVideoClipCropSummary();
  updateVideoClipExportSummary();
  updateVideoClipCropOverlay();
}

function updateVideoClipTimelineUi() {
  var videoEl = getVideoClipEl('video-clip-video');
  var endEl = getVideoClipEl('video-clip-end-time');
  var playheadEl = getVideoClipEl('video-clip-playhead');
  var selectionEl = getVideoClipEl('video-clip-selection-range');
  var range = readVideoClipTrimState();
  if (!videoEl || !range) return;

  var sourceDuration = range.sourceDuration;
  var current = Number(videoEl.currentTime || 0);
  if (!isFinite(current) || current < 0) current = 0;
  if (endEl) endEl.textContent = formatVideoClipSeconds(range.end);

  var startPct = Math.max(0, Math.min(100, (range.start / sourceDuration) * 100));
  var endPct = Math.max(startPct, Math.min(100, (range.end / sourceDuration) * 100));
  var currentPct = Math.max(0, Math.min(100, (current / sourceDuration) * 100));
  if (selectionEl) {
    selectionEl.style.left = startPct.toFixed(3) + '%';
    selectionEl.style.width = Math.max(0.75, endPct - startPct).toFixed(3) + '%';
  }
  if (playheadEl) {
    playheadEl.style.left = currentPct.toFixed(3) + '%';
  }
  updateVideoClipExportSummary();
}

function endVideoClipRangeDrag(event) {
  var drag = videoClipRangeDrag;
  if (!drag) return;
  if (event && event.pointerId !== undefined && event.pointerId !== drag.pointerId) return;
  var selectionEl = getVideoClipEl('video-clip-selection-range');
  if (selectionEl) {
    selectionEl.classList.remove('is-dragging');
    try {
      if (selectionEl.hasPointerCapture && selectionEl.hasPointerCapture(drag.pointerId)) {
        selectionEl.releasePointerCapture(drag.pointerId);
      }
    } catch (e) {}
  }
  videoClipRangeDrag = null;
}

function beginVideoClipRangeDrag(event) {
  if (videoClipCropBusy || videoClipCropEditActive || (event.button !== undefined && event.button !== 0)) return;
  var selectionEl = getVideoClipEl('video-clip-selection-range');
  var trackEl = selectionEl && selectionEl.parentElement;
  var range = readVideoClipTrimState();
  if (!selectionEl || !trackEl || !range || range.sourceDuration <= 0 || range.duration <= 0) return;
  var rect = trackEl.getBoundingClientRect();
  if (!rect || rect.width <= 0) return;

  videoClipRangeDrag = {
    pointerId: event.pointerId,
    originClientX: Number(event.clientX || 0),
    originStart: range.start,
    duration: range.duration,
    sourceDuration: range.sourceDuration,
    trackWidth: rect.width
  };
  selectionEl.classList.add('is-dragging');
  selectionEl.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function moveVideoClipRangeDrag(event) {
  var drag = videoClipRangeDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  var deltaSeconds = ((Number(event.clientX || 0) - drag.originClientX) / drag.trackWidth) * drag.sourceDuration;
  var maxStart = Math.max(0, drag.sourceDuration - drag.duration);
  var nextStart = Math.max(0, Math.min(maxStart, drag.originStart + deltaSeconds));
  var range = clampVideoClipRange(nextStart, nextStart + drag.duration, drag.sourceDuration);
  writeVideoClipTrimInputs(range);
  seekVideoClipPlayhead(range.start);
  event.preventDefault();
}

function isVideoFileName(fileName) {
  var ext = getFileExtension(fileName || '');
  return !!MEDIA_EXTENSIONS[ext] && ['.mp4', '.webm', '.ogg', '.mov', '.mkv', '.avi', '.m4v'].indexOf(ext) !== -1;
}

function setVideoClipRatio(ratio, options) {
  options = options || {};
  var nextRatio = Number(ratio || 1);
  var previousRatio = Number(videoClipCropRatio || 1);
  videoClipCropRatio = nextRatio;
  Array.prototype.forEach.call(document.querySelectorAll('.video-clip-ratio-btn'), function (btn) {
    btn.classList.toggle('active', matchesVideoClipRatio(btn.getAttribute('data-ratio'), videoClipCropRatio));
  });
  if (videoClipCropEditActive && videoClipInlineCropper) {
    videoClipInlineCropper.setAspectRatio(videoClipCropRatio);
    var liveData = videoClipInlineCropper.getData(true);
    setVideoClipSizeReadout(liveData.width, liveData.height);
    updateVideoClipCropSummary();
    updateVideoClipExportSummary();
    return;
  }
  if (!options.preserveCrop && getVideoClipCurrentCrop() && !matchesVideoClipRatio(previousRatio, nextRatio)) {
    setVideoClipPendingCrop(null);
    return;
  }
  updateVideoClipCropSummary();
  updateVideoClipExportSummary();
}

function buildVideoClipFullFrameCrop() {
  var res = getVideoClipResolution(videoClipTargetItem && videoClipTargetItem.fileName);
  if (!res) {
    throw new Error('Could not determine video resolution for export');
  }
  return {
    x: 0,
    y: 0,
    width: res.width,
    height: res.height
  };
}

function closeVideoClipModal() {
  endVideoClipRangeDrag();
  clearVideoClipStatusPoll();
  stopVideoClipLoopPreview();
  videoClipCropEditActive = false;
  videoClipTargetItem = null;
  videoClipSourceResolution = null;
  videoClipOverwriteSourceMode = false;
  videoClipLastExportSignature = '';
  videoClipPlaybackRate = 1;
  destroyVideoClipInlineCropper();
  setVideoClipPendingCrop(null);
  setVideoClipBusy(false);
  setVideoClipStatus('');
  setStatus('');

  var modal = getVideoClipEl('video-clip-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }

  var videoEl = getVideoClipEl('video-clip-video');
  if (videoEl) {
    try { videoEl.pause(); } catch (e) {}
    videoEl.controls = true;
    videoEl.style.width = '';
    videoEl.style.height = '';
    videoEl.removeAttribute('src');
    videoEl.load();
  }
  var stageEl = getVideoClipEl('video-clip-preview-stage');
  if (stageEl) {
    stageEl.style.width = '';
    stageEl.style.height = '';
  }
  var editLayerEl = getVideoClipEl('video-clip-crop-edit-layer');
  if (editLayerEl) {
    editLayerEl.classList.add('hidden');
    editLayerEl.setAttribute('aria-hidden', 'true');
  }
  var cropFrameBtn = getVideoClipEl('video-clip-crop-frame-btn');
  if (cropFrameBtn) cropFrameBtn.disabled = true;
  updateVideoClipLoopPreviewButton();
  setVideoClipPlaybackRate(1);
  updateVideoClipCropButtons();
}

function openVideoClipModal(mediaItem) {
  if (!mediaItem || !mediaItem.fileName || !isVideoFileName(mediaItem.fileName)) {
    setVideoClipStatus('Clip is only available for video files.', { kind: 'error' });
    setStatus('Clip is only available for video files.');
    return;
  }

  var modal = getVideoClipEl('video-clip-modal');
  var titleEl = getVideoClipEl('video-clip-title');
  var videoEl = getVideoClipEl('video-clip-video');
  var outputEl = getVideoClipEl('video-clip-output-input');
  var startEl = getVideoClipEl('video-clip-start-input');
  var trimEndEl = getVideoClipEl('video-clip-end-input');
  var durationEl = getVideoClipEl('video-clip-duration-input');
  var currentTimeEl = getVideoClipEl('video-clip-current-time');
  var endTimeEl = getVideoClipEl('video-clip-end-time');
  var cropFrameBtn = getVideoClipEl('video-clip-crop-frame-btn');

  if (!modal || !titleEl || !videoEl || !outputEl || !startEl || !trimEndEl || !durationEl || !currentTimeEl) {
    throw new Error('Video clip modal is missing required elements');
  }

  videoClipTargetItem = mediaItem;
  videoClipOverwriteSourceMode = false;
  videoClipSourceResolution = null;
  videoClipLastExportSignature = '';
  videoClipLoopPreviewActive = false;
  setVideoClipBusy(false);
  setVideoClipStatus('');
  setStatus('');
  setVideoClipRatio(1, { preserveCrop: true });
  setVideoClipPendingCrop(null);
  setVideoClipPlaybackRate(1);
  updateVideoClipLoopPreviewButton();
  updateVideoClipCropButtons();

  var stem = mediaItem.fileName.replace(/\.[^.]+$/, '');
  outputEl.value = isVideoClipInSrcVideosFolder() ? (stem + '_clip') : mediaItem.fileName;
  outputEl.disabled = false;
  startEl.value = '0';
  trimEndEl.value = '2.000';
  durationEl.value = '2.0';
  currentTimeEl.textContent = '0.000';
  if (endTimeEl) endTimeEl.textContent = '2.000';
  if (cropFrameBtn) cropFrameBtn.disabled = true;
  syncVideoClipTrimInputs('duration');

  syncVideoClipOutputMode();
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  focusFirstModalTextField(modal);

  var src = '/caption/media?folder=' + encodeURIComponent(state.folder || '') + '&media=' + encodeURIComponent(mediaItem.fileName) + '&t=' + Date.now();
  videoEl.src = src;
  videoEl.onloadedmetadata = function () {
    var d = Number(videoEl.duration);
    if (isFinite(d) && d > 0) {
      trimEndEl.value = String(Math.max(0.1, Math.min(2.0, d)).toFixed(3));
    }
    var vw = Number(videoEl.videoWidth || 0);
    var vh = Number(videoEl.videoHeight || 0);
    if (isFinite(vw) && isFinite(vh) && vw > 0 && vh > 0) {
      videoClipSourceResolution = { width: Math.round(vw), height: Math.round(vh) };
    }
    updateVideoClipStageLayout();
    if (cropFrameBtn) cropFrameBtn.disabled = false;
    syncVideoClipTrimInputs('end');
    setVideoClipPlaybackRate(1);
    updateVideoClipCropOverlay();
  };
  videoEl.ontimeupdate = function () {
    currentTimeEl.textContent = Number(videoEl.currentTime || 0).toFixed(3);
    if (videoClipLoopPreviewActive) {
      var range = readVideoClipTrimState();
      if (range && range.duration > 0 && Number(videoEl.currentTime || 0) >= (range.end - 0.01)) {
        seekVideoClipPlayhead(range.start);
        if (videoEl.paused) {
          try {
            var playPromise = videoEl.play();
            if (playPromise && typeof playPromise.catch === 'function') {
              playPromise.catch(function () {});
            }
          } catch (e) {}
        }
      }
    }
    updateVideoClipTimelineUi();
  };
  videoEl.onpause = function () {
    if (videoClipLoopPreviewActive) {
      stopVideoClipLoopPreview({ pause: false });
    }
  };
  videoEl.onerror = function () {
    setVideoClipStatus('Video failed to load. The codec may be unsupported in browser playback.', { kind: 'error' });
    setStatus('Video failed to load. The codec may be unsupported in browser playback.');
  };
}

function getVideoClipPayload(overwrite) {
  if (!videoClipTargetItem || !videoClipTargetItem.fileName) {
    throw new Error('No video clip target selected');
  }

  var outputEl = getVideoClipEl('video-clip-output-input');
  var startEl = getVideoClipEl('video-clip-start-input');
  var endEl = getVideoClipEl('video-clip-end-input');
  if (!outputEl || !startEl || !endEl) {
    throw new Error('Video clip form elements are missing');
  }

  var outputName = String(outputEl.value || '').trim();
  syncVideoClipOutputMode();
  if (!outputName) {
    throw new Error('Output name is required');
  }
  if (videoClipOverwriteSourceMode) {
    outputName = String(videoClipTargetItem.fileName || '').trim();
  } else {
    outputName = normalizeVideoClipOutputName(outputName);
  }

  var range = readVideoClipTrimState();
  if (!range) {
    throw new Error('Video clip trim inputs are missing');
  }
  if (!isFinite(range.start) || range.start < 0) {
    throw new Error('Start time must be >= 0');
  }
  if (!isFinite(range.duration) || range.duration <= 0) {
    throw new Error('Duration must be > 0');
  }

  return {
    folder: state.folder || '',
    fileName: videoClipTargetItem.fileName,
    outputName: outputName,
    startSec: range.start,
    durationSec: range.duration,
    crop: getVideoClipCurrentCrop() || buildVideoClipFullFrameCrop(),
    overwrite: !!overwrite,
    overwriteSource: !!videoClipOverwriteSourceMode
  };
}

function getVideoClipPayloadSignature(payload) {
  return [
    String(payload.folder || ''),
    String(payload.fileName || ''),
    String(payload.outputName || ''),
    formatVideoClipSeconds(payload.startSec),
    formatVideoClipSeconds(payload.durationSec),
    String(!!payload.overwriteSource),
    String(Math.round(Number(payload.crop && payload.crop.x || 0))),
    String(Math.round(Number(payload.crop && payload.crop.y || 0))),
    String(Math.round(Number(payload.crop && payload.crop.width || 0))),
    String(Math.round(Number(payload.crop && payload.crop.height || 0)))
  ].join('|');
}

function rememberVideoClipExportPayload(payload) {
  videoClipLastExportSignature = getVideoClipPayloadSignature(payload);
}

function confirmRepeatedVideoClipExport(payload) {
  var signature = getVideoClipPayloadSignature(payload);
  if (!videoClipLastExportSignature || signature !== videoClipLastExportSignature) {
    return true;
  }
  return confirm('This clip was already exported from this modal with the same output name, timing, and crop. Export it again?');
}

function finalizeVideoClipJob(payload, status, message) {
  clearVideoClipStatusPoll();
  setVideoClipBusy(false);
  if (status === 'completed') {
    rememberVideoClipExportPayload(payload);
    updateVideoClipTimelineUi();
    if (payload && payload.overwriteSource && payload.fileName) {
      markMediaMutated(payload.fileName, 'best_effort');
      bumpMediaCacheBustToken(payload.fileName);
      state.pendingSelectFileName = payload.fileName;
    }
    setStatus(payload && payload.overwriteSource ? 'In-place clip exported.' : 'Clip exported.');
    if (payload && payload.overwriteSource && payload.fileName) {
      Promise.resolve(saveFolderStateForCurrentRoot()).catch(function (err) {
        if (window.console && console.warn) {
          console.warn('[VideoClip] Could not persist clip mutation state:', err);
        }
      }).then(function () {
        refreshCurrentDirectory();
      });
    } else {
      refreshCurrentDirectory();
    }
    setVideoClipStatus(payload && payload.overwriteSource ? 'In-place clip exported.' : 'Clip exported.', { kind: 'success' });
    return;
  }
  if (status === 'failed') {
    setVideoClipStatus('Clip export failed: ' + (message || 'Unknown error'), { kind: 'error' });
    setStatus('Clip export failed: ' + (message || 'Unknown error'));
  }
}

function pollVideoClipJob(jobId, payload) {
  clearVideoClipStatusPoll();
  videoClipStatusJobId = String(jobId || '').trim();
  if (!videoClipStatusJobId) return;

  var pollOnce = function () {
    if (!videoClipStatusJobId) return;
    fetch('/media/video_clip_status?jobId=' + encodeURIComponent(videoClipStatusJobId))
      .then(function (resp) {
        return resp.json().then(function (data) {
          return { status: resp.status, data: data };
        });
      })
      .then(function (res) {
        if (String(videoClipStatusJobId || '') !== String(jobId || '').trim()) return;
        if (res.status === 404) {
          finalizeVideoClipJob(payload, 'failed', 'Clip job not found');
          return;
        }
        if (res.status !== 200 || !res.data || !res.data.ok || !res.data.job) return;
        var job = res.data.job;
        var jobStatus = String(job.status || '').toLowerCase();
        if (jobStatus === 'queued') {
          setVideoClipStatus(payload && payload.overwriteSource ? 'In-place clip queued. Waiting for worker...' : 'Clip queued. Waiting for worker...', { kind: 'active' });
          return;
        }
        if (jobStatus === 'running') {
          setVideoClipStatus(payload && payload.overwriteSource ? 'Exporting in place...' : 'Exporting clip...', { kind: 'active' });
          return;
        }
        if (jobStatus === 'completed') {
          finalizeVideoClipJob(payload, 'completed');
          return;
        }
        if (jobStatus === 'failed') {
          finalizeVideoClipJob(payload, 'failed', job.error || 'Clip export failed');
        }
      })
      .catch(function (err) {
        if (window.console && console.warn) {
          console.warn('[VideoClip] Status poll failed:', err);
        }
      });
  };

  pollOnce();
  videoClipStatusPollTimer = setInterval(pollOnce, 1000);
}

function beginVideoClipCropEdit() {
  var videoEl = getVideoClipEl('video-clip-video');
  var editLayerEl = getVideoClipEl('video-clip-crop-edit-layer');
  var editImageEl = getVideoClipEl('video-clip-crop-edit-image');
  if (!videoEl) throw new Error('Missing required element: video-clip-video');
  if (!editLayerEl || !editImageEl) throw new Error('Missing required crop edit layer');
  if (!videoEl.videoWidth || !videoEl.videoHeight) throw new Error('Video element has no video loaded');
  if (typeof Cropper !== 'function') throw new Error('Cropper.js is not loaded');
  stopVideoClipLoopPreview();
  updateVideoClipStageLayout();
  try { videoEl.pause(); } catch (e) {}
  videoEl.controls = false;
  destroyVideoClipInlineCropper();
  videoClipCropEditActive = true;
  updateVideoClipCropButtons();
  updateVideoClipCropSummary();
  updateVideoClipCropOverlay();
  var canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  var ctx = canvas.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, videoEl.videoWidth, videoEl.videoHeight);
  editLayerEl.classList.remove('hidden');
  editLayerEl.setAttribute('aria-hidden', 'false');
  editImageEl.onload = function () {
    destroyVideoClipInlineCropper();
    videoClipInlineCropper = new Cropper(editImageEl, {
      aspectRatio: videoClipCropRatio,
      viewMode: 1,
      dragMode: 'move',
      autoCropArea: 1,
      background: false,
      guides: true,
      center: true,
      highlight: true,
      movable: false,
      zoomable: false,
      scalable: false,
      rotatable: false,
      responsive: true,
      cropBoxMovable: true,
      cropBoxResizable: true,
      toggleDragModeOnDblclick: false,
      ready: function () {
        var initialCrop = getVideoClipCurrentCrop() || getVideoClipDefaultRatioCrop();
        videoClipInlineCropper.setData(initialCrop);
        setVideoClipSizeReadout(initialCrop.width, initialCrop.height);
      },
      crop: function (event) {
        var detail = event && event.detail ? event.detail : {};
        setVideoClipSizeReadout(detail.width, detail.height);
      }
    });
  };
  editImageEl.src = canvas.toDataURL('image/png');
}

function applyVideoClipCropEdit() {
  if (!videoClipCropEditActive || !videoClipInlineCropper) return;
  var crop = videoClipInlineCropper.getData(true);
  setVideoClipPendingCrop({
    x: crop.x,
    y: crop.y,
    width: crop.width,
    height: crop.height
  });
  cancelVideoClipCropEdit(false);
  setStatus('Crop updated.');
}

function cancelVideoClipCropEdit(restoreStatus) {
  var videoEl = getVideoClipEl('video-clip-video');
  var editLayerEl = getVideoClipEl('video-clip-crop-edit-layer');
  var currentCrop = getVideoClipCurrentCrop();
  destroyVideoClipInlineCropper();
  videoClipCropEditActive = false;
  if (videoEl) videoEl.controls = true;
  if (editLayerEl) {
    editLayerEl.classList.add('hidden');
    editLayerEl.setAttribute('aria-hidden', 'true');
  }
  if (currentCrop) {
    setVideoClipSizeReadout(currentCrop.width, currentCrop.height);
  } else {
    setVideoClipSizeReadout(0, 0);
  }
  updateVideoClipCropButtons();
  updateVideoClipCropSummary();
  updateVideoClipExportSummary();
  updateVideoClipCropOverlay();
  if (restoreStatus !== false) {
    setStatus('Crop edit cancelled.');
  }
}

function clearVideoClipCrop() {
  if (videoClipCropEditActive) {
    cancelVideoClipCropEdit(false);
  }
  setVideoClipPendingCrop(null);
  setStatus('Crop cleared. Export will use the full frame.');
}

function applyVideoClip(overwrite, skipRepeatConfirm) {
  if (videoClipCropBusy) return;
  stopVideoClipLoopPreview();

  var payload;
  try {
    payload = getVideoClipPayload(overwrite);
  } catch (e) {
    setVideoClipStatus(String(e && e.message ? e.message : e), { kind: 'error' });
    setStatus(String(e && e.message ? e.message : e));
    return;
  }

  if (videoClipLastExportSignature && getVideoClipPayloadSignature(payload) === videoClipLastExportSignature) {
    updateVideoClipExportSummary();
    setVideoClipStatus('No changes since the last export in this modal.');
    setStatus('No changes since the last export in this modal.');
    return;
  }

  if (!skipRepeatConfirm && !confirmRepeatedVideoClipExport(payload)) {
    setVideoClipStatus('Export cancelled.');
    setStatus('Export cancelled.');
    return;
  }

  setVideoClipBusy(true);
  setVideoClipStatus(payload.overwriteSource ? 'Queueing in-place clip export...' : 'Queueing clip export...', { kind: 'active' });
  setStatus(payload.overwriteSource ? 'Queueing in-place clip export...' : 'Queueing clip export...');

  HttpModule.postJson('/media/video_clip', payload, function (status, responseText) {
    if (status === 200 || status === 202) {
      var parsed = null;
      try { parsed = JSON.parse(responseText); } catch (e) {}
      if (parsed && parsed.jobId) {
        setVideoClipStatus(payload.overwriteSource ? 'In-place clip queued. Waiting for worker...' : 'Clip queued. Waiting for worker...', { kind: 'active' });
        setStatus(payload.overwriteSource ? 'In-place clip queued.' : 'Clip queued.');
        setVideoClipBusy(true);
        pollVideoClipJob(parsed.jobId, payload);
        return;
      }
      setVideoClipBusy(false);
      if (status === 202) {
        setVideoClipStatus(payload.overwriteSource ? 'In-place clip queued.' : 'Clip queued.', { kind: 'active' });
      } else {
        rememberVideoClipExportPayload(payload);
        updateVideoClipTimelineUi();
        setVideoClipStatus(payload.overwriteSource ? 'In-place clip exported.' : 'Clip exported.', { kind: 'success' });
      }
      setStatus(status === 202
        ? (payload.overwriteSource ? 'In-place clip queued.' : 'Clip queued.')
        : (payload.overwriteSource ? 'In-place clip exported.' : 'Clip exported.'));
      refreshCurrentDirectory();
      return;
    }

    setVideoClipBusy(false);
    var message = getErrorMessage(responseText, 'Clip export failed');
    var data = null;
    try { data = JSON.parse(responseText); } catch (e) {}
    if (status === 409 && data && data.requiresOverwrite) {
      var overwriteConfirmed = confirm('Output file exists. Overwrite?\n\n' + data.outputName);
      if (overwriteConfirmed) {
        applyVideoClip(true, true);
        return;
      }
      setVideoClipStatus('Export cancelled.');
      setStatus('Export cancelled.');
      return;
    }
    if (status === 409 && data && data.duplicateRequest) {
      setVideoClipStatus('That same clip is already queued or was just exported.');
      setStatus('That same clip is already queued or was just exported.');
      return;
    }
    setVideoClipStatus('Clip export failed: ' + message, { kind: 'error' });
    setStatus('Clip export failed: ' + message);
  });
}

function wireCropThisFrameButton() {
  var btn = getVideoClipEl('video-clip-crop-frame-btn');
  if (!btn) throw new Error('Missing required element: video-clip-crop-frame-btn');
  btn.disabled = true;
  btn.onclick = beginVideoClipCropEdit;

  var videoEl = getVideoClipEl('video-clip-video');
  if (!videoEl) throw new Error('Missing required element: video-clip-video');
  videoEl.addEventListener('loadedmetadata', function() {
    btn.disabled = false;
    updateVideoClipCropOverlay();
  });
  if (videoEl.readyState >= 1) {
    btn.disabled = false;
  }
}

function wireVideoClipModal() {
  var exportBtn = getVideoClipEl('video-clip-export-btn');
  var cancelBtn = getVideoClipEl('video-clip-cancel-btn');
  var cancelX = getVideoClipEl('video-clip-cancel-x');
  var cropApplyBtn = getVideoClipEl('video-clip-crop-apply-btn');
  var cropCancelBtn = getVideoClipEl('video-clip-crop-cancel-btn');
  var cropClearBtn = getVideoClipEl('video-clip-crop-clear-btn');
  var skipBackBtn = getVideoClipEl('video-clip-skip-back-btn');
  var skipForwardBtn = getVideoClipEl('video-clip-skip-forward-btn');
  var skipForward15Btn = getVideoClipEl('video-clip-skip-forward-15-btn');
  var skipForward30Btn = getVideoClipEl('video-clip-skip-forward-30-btn');
  var loopPreviewBtn = getVideoClipEl('video-clip-loop-preview-btn');
  var markStartBtn = getVideoClipEl('video-clip-mark-start-btn');
  var markEndBtn = getVideoClipEl('video-clip-mark-end-btn');
  var startEl = getVideoClipEl('video-clip-start-input');
  var endEl = getVideoClipEl('video-clip-end-input');
  var durationEl = getVideoClipEl('video-clip-duration-input');
  var outputEl = getVideoClipEl('video-clip-output-input');
  var videoEl = getVideoClipEl('video-clip-video');
  var selectionEl = getVideoClipEl('video-clip-selection-range');

  if (exportBtn) exportBtn.onclick = function () { applyVideoClip(false, false); };
  if (cancelBtn) cancelBtn.onclick = closeVideoClipModal;
  if (cancelX) cancelX.onclick = closeVideoClipModal;
  if (cropApplyBtn) cropApplyBtn.onclick = applyVideoClipCropEdit;
  if (cropCancelBtn) cropCancelBtn.onclick = function () { cancelVideoClipCropEdit(true); };
  if (cropClearBtn) cropClearBtn.onclick = clearVideoClipCrop;
  if (skipBackBtn) skipBackBtn.onclick = function () { stepVideoClipPlayhead(-5); };
  if (skipForwardBtn) skipForwardBtn.onclick = function () { stepVideoClipPlayhead(5); };
  if (skipForward15Btn) skipForward15Btn.onclick = function () { stepVideoClipPlayhead(15); };
  if (skipForward30Btn) skipForward30Btn.onclick = function () { stepVideoClipPlayhead(30); };
  if (loopPreviewBtn) loopPreviewBtn.onclick = toggleVideoClipLoopPreview;
  if (markStartBtn && startEl && videoEl) {
    markStartBtn.onclick = function () {
      startEl.value = formatVideoClipSeconds(videoEl.currentTime || 0);
      syncVideoClipTrimInputs('start');
    };
  }
  if (markEndBtn && endEl && videoEl) {
    markEndBtn.onclick = function () {
      endEl.value = formatVideoClipSeconds(videoEl.currentTime || 0);
      syncVideoClipTrimInputs('end');
    };
  }

  if (outputEl) {
    outputEl.addEventListener('input', updateVideoClipExportSummary);
    outputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyVideoClip(false, false);
      }
    });
  }

  if (selectionEl) {
    selectionEl.addEventListener('pointerdown', beginVideoClipRangeDrag);
    selectionEl.addEventListener('pointermove', moveVideoClipRangeDrag);
    selectionEl.addEventListener('pointerup', endVideoClipRangeDrag);
    selectionEl.addEventListener('pointercancel', endVideoClipRangeDrag);
    selectionEl.addEventListener('lostpointercapture', endVideoClipRangeDrag);
  }

  if (startEl && videoEl) {
    startEl.addEventListener('change', function () {
      var range = syncVideoClipTrimInputs('start');
      if (range) seekVideoClipPlayhead(range.start);
    });
    startEl.addEventListener('input', updateVideoClipTimelineUi);
  }

  if (endEl && videoEl) {
    endEl.addEventListener('change', function () {
      var range = syncVideoClipTrimInputs('end');
      if (range) seekVideoClipPlayhead(range.end);
    });
    endEl.addEventListener('input', updateVideoClipTimelineUi);
  }

  if (durationEl) {
    durationEl.addEventListener('input', updateVideoClipTimelineUi);
    durationEl.addEventListener('change', function () {
      syncVideoClipTrimInputs('duration');
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.video-clip-rate-btn'), function (btn) {
    btn.onclick = function () {
      setVideoClipPlaybackRate(Number(btn.getAttribute('data-rate')) || 1);
    };
  });

  Array.prototype.forEach.call(document.querySelectorAll('.video-clip-ratio-btn'), function (btn) {
    btn.onclick = function () {
      setVideoClipRatio(Number(btn.getAttribute('data-ratio')) || 1);
    };
  });

  window.addEventListener('resize', function () {
    updateVideoClipStageLayout();
    updateVideoClipCropOverlay();
  });

  document.addEventListener('keydown', function (e) {
    var modal = getVideoClipEl('video-clip-modal');
    if (!modal || modal.classList.contains('hidden')) return;

    if (e.key === 'Escape') {
      if (videoClipCropEditActive) {
        cancelVideoClipCropEdit(true);
        return;
      }
      closeVideoClipModal();
      return;
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (videoClipCropEditActive) return;
      var activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;
      if (!videoEl) return;

      e.preventDefault();
      var currentVal = isFinite(Number(videoEl.currentTime)) ? Number(videoEl.currentTime) : 0;
      var step = 0.05;
      var newVal = e.key === 'ArrowRight' ? currentVal + step : currentVal - step;
      seekVideoClipPlayhead(newVal);
    }
  });
}

addEventListener('DOMContentLoaded', function() {
  wireVideoClipModal();
  wireCropThisFrameButton();
  updateVideoClipLoopPreviewButton();
  setVideoClipPlaybackRate(1);
  updateVideoClipCropButtons();
  updateVideoClipExportSummary();
});
