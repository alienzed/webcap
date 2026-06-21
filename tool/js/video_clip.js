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

function normalizeVideoClipOutputName(name) {
  var value = String(name || '').trim();
  if (!value) return '';
  var stem = value.replace(/\.[^.]*$/, '');
  if (!stem) return '';
  var ext = getFileExtension(value);
  if (ext !== '.mp4') return stem + '.mp4';
  return value;
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
  btn.disabled = videoClipCropBusy || videoClipCropEditActive;
  btn.textContent = videoClipCropBusy ? 'Exporting...' : 'Export';
}

function setVideoClipBusy(isBusy) {
  videoClipCropBusy = !!isBusy;
  updateVideoClipExportAvailability();
  var outputEl = getVideoClipEl('video-clip-output-input');
  if (outputEl) outputEl.disabled = videoClipCropBusy || videoClipOverwriteSourceMode;
  var startEl = getVideoClipEl('video-clip-start-input');
  if (startEl) startEl.disabled = videoClipCropBusy;
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
    return;
  }
  if (crop) {
    summaryEl.textContent = 'Applied ' + label + ' crop at ' + Math.round(crop.width) + ' x ' + Math.round(crop.height) + ' px.';
    return;
  }
  summaryEl.textContent = 'Ratio: ' + label + '. No crop placed; export uses the full frame.';
}

function updateVideoClipExportSummary() {
  var summaryEl = getVideoClipEl('video-clip-export-summary');
  if (!summaryEl) return;

  var startEl = getVideoClipEl('video-clip-start-input');
  var durationEl = getVideoClipEl('video-clip-duration-input');
  var outputEl = getVideoClipEl('video-clip-output-input');
  if (!startEl || !durationEl || !outputEl) {
    summaryEl.textContent = '';
    return;
  }

  var start = Number(startEl.value || 0);
  var duration = Number(durationEl.value || 0);
  var outputName = videoClipOverwriteSourceMode
    ? String(videoClipTargetItem && videoClipTargetItem.fileName || '')
    : normalizeVideoClipOutputName(outputEl.value || '');
  var crop = getVideoClipCurrentCrop();
  var cropText = crop
    ? ('Crop ' + Math.round(crop.width) + ' x ' + Math.round(crop.height) + ' px')
    : 'Full frame';

  summaryEl.textContent = (outputName || 'Set output name') + ' | ' +
    formatVideoClipSeconds(start) + 's -> ' + formatVideoClipSeconds(start + duration) + 's | ' +
    cropText;
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
  var startEl = getVideoClipEl('video-clip-start-input');
  var durationEl = getVideoClipEl('video-clip-duration-input');
  var endEl = getVideoClipEl('video-clip-end-time');
  var playheadEl = getVideoClipEl('video-clip-playhead');
  var selectionEl = getVideoClipEl('video-clip-selection-range');
  if (!videoEl || !startEl || !durationEl) return;

  var sourceDuration = Number(videoEl.duration || 0);
  var start = Number(startEl.value || 0);
  var clipDuration = Number(durationEl.value || 0);
  var current = Number(videoEl.currentTime || 0);
  if (!isFinite(sourceDuration) || sourceDuration <= 0) sourceDuration = Math.max(start + clipDuration, current, 1);
  if (!isFinite(start) || start < 0) start = 0;
  if (!isFinite(clipDuration) || clipDuration < 0) clipDuration = 0;
  if (!isFinite(current) || current < 0) current = 0;

  var end = Math.min(sourceDuration, start + clipDuration);
  if (endEl) endEl.textContent = end.toFixed(3);

  var startPct = Math.max(0, Math.min(100, (start / sourceDuration) * 100));
  var endPct = Math.max(startPct, Math.min(100, (end / sourceDuration) * 100));
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

function syncVideoClipStartToPlayhead(decimals) {
  var startEl = getVideoClipEl('video-clip-start-input');
  var videoEl = getVideoClipEl('video-clip-video');
  if (!startEl || !videoEl) return;
  if (videoEl.paused) return;
  var precision = isFinite(Number(decimals)) ? Number(decimals) : 3;
  var current = Number(videoEl.currentTime || 0);
  if (!isFinite(current) || current < 0) current = 0;
  startEl.value = current.toFixed(precision);
  updateVideoClipTimelineUi();
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
  clearVideoClipStatusPoll();
  videoClipCropEditActive = false;
  videoClipTargetItem = null;
  videoClipSourceResolution = null;
  videoClipOverwriteSourceMode = false;
  videoClipLastExportSignature = '';
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
  var durationEl = getVideoClipEl('video-clip-duration-input');
  var currentTimeEl = getVideoClipEl('video-clip-current-time');
  var endTimeEl = getVideoClipEl('video-clip-end-time');
  var cropFrameBtn = getVideoClipEl('video-clip-crop-frame-btn');

  if (!modal || !titleEl || !videoEl || !outputEl || !startEl || !durationEl || !currentTimeEl) {
    throw new Error('Video clip modal is missing required elements');
  }

  videoClipTargetItem = mediaItem;
  videoClipOverwriteSourceMode = !isVideoClipInSrcVideosFolder();
  videoClipSourceResolution = null;
  videoClipLastExportSignature = '';
  setVideoClipBusy(false);
  setVideoClipStatus('');
  setStatus('');
  setVideoClipRatio(1, { preserveCrop: true });
  setVideoClipPendingCrop(null);
  updateVideoClipCropButtons();

  var stem = mediaItem.fileName.replace(/\.[^.]+$/, '');
  outputEl.value = videoClipOverwriteSourceMode ? mediaItem.fileName : (stem + '_clip');
  outputEl.disabled = videoClipOverwriteSourceMode;
  startEl.value = '0';
  durationEl.value = '2.0';
  currentTimeEl.textContent = '0.000';
  if (endTimeEl) endTimeEl.textContent = '2.000';
  if (cropFrameBtn) cropFrameBtn.disabled = true;
  updateVideoClipTimelineUi();

  titleEl.textContent = videoClipOverwriteSourceMode
    ? ('Clip video (overwrite source): ' + mediaItem.fileName)
    : ('Clip video: ' + mediaItem.fileName);
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');

  var src = '/caption/media?folder=' + encodeURIComponent(state.folder || '') + '&media=' + encodeURIComponent(mediaItem.fileName) + '&t=' + Date.now();
  videoEl.src = src;
  videoEl.onloadedmetadata = function () {
    var d = Number(videoEl.duration);
    if (isFinite(d) && d > 0) {
      durationEl.value = String(Math.max(0.2, Math.min(2.0, d)).toFixed(3));
    }
    var vw = Number(videoEl.videoWidth || 0);
    var vh = Number(videoEl.videoHeight || 0);
    if (isFinite(vw) && isFinite(vh) && vw > 0 && vh > 0) {
      videoClipSourceResolution = { width: Math.round(vw), height: Math.round(vh) };
    }
    updateVideoClipStageLayout();
    if (cropFrameBtn) cropFrameBtn.disabled = false;
    syncVideoClipStartToPlayhead(3);
    updateVideoClipTimelineUi();
    updateVideoClipCropOverlay();
  };
  videoEl.ontimeupdate = function () {
    currentTimeEl.textContent = Number(videoEl.currentTime || 0).toFixed(3);
    syncVideoClipStartToPlayhead(3);
    updateVideoClipTimelineUi();
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
  var durationEl = getVideoClipEl('video-clip-duration-input');
  if (!outputEl || !startEl || !durationEl) {
    throw new Error('Video clip form elements are missing');
  }

  var outputName = String(outputEl.value || '').trim();
  if (!videoClipOverwriteSourceMode && !outputName) {
    throw new Error('Output name is required');
  }
  if (videoClipOverwriteSourceMode) {
    outputName = String(videoClipTargetItem.fileName || '').trim();
  } else {
    outputName = normalizeVideoClipOutputName(outputName);
  }

  var startSec = Number(startEl.value);
  if (!isFinite(startSec) || startSec < 0) {
    throw new Error('Start time must be >= 0');
  }

  var durationSec = Number(durationEl.value);
  if (!isFinite(durationSec) || durationSec <= 0) {
    throw new Error('Duration must be > 0');
  }

  return {
    folder: state.folder || '',
    fileName: videoClipTargetItem.fileName,
    outputName: outputName,
    startSec: startSec,
    durationSec: durationSec,
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

  var payload;
  try {
    payload = getVideoClipPayload(overwrite);
  } catch (e) {
    setVideoClipStatus(String(e && e.message ? e.message : e), { kind: 'error' });
    setStatus(String(e && e.message ? e.message : e));
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
      rememberVideoClipExportPayload(payload);
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
  var useCurrentBtn = getVideoClipEl('video-clip-use-current-btn');
  var startEl = getVideoClipEl('video-clip-start-input');
  var durationEl = getVideoClipEl('video-clip-duration-input');
  var outputEl = getVideoClipEl('video-clip-output-input');
  var videoEl = getVideoClipEl('video-clip-video');

  if (exportBtn) exportBtn.onclick = function () { applyVideoClip(false, false); };
  if (cancelBtn) cancelBtn.onclick = closeVideoClipModal;
  if (cancelX) cancelX.onclick = closeVideoClipModal;
  if (cropApplyBtn) cropApplyBtn.onclick = applyVideoClipCropEdit;
  if (cropCancelBtn) cropCancelBtn.onclick = function () { cancelVideoClipCropEdit(true); };
  if (cropClearBtn) cropClearBtn.onclick = clearVideoClipCrop;

  if (useCurrentBtn && startEl && videoEl) {
    useCurrentBtn.onclick = function () {
      startEl.value = Number(videoEl.currentTime || 0).toFixed(3);
      updateVideoClipTimelineUi();
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

  if (startEl && videoEl) {
    startEl.addEventListener('change', function () {
      var v = Number(startEl.value);
      if (!isFinite(v) || v < 0) return;
      try { videoEl.currentTime = v; } catch (e) {}
      updateVideoClipTimelineUi();
    });
    startEl.addEventListener('input', updateVideoClipTimelineUi);
  }

  if (durationEl) {
    durationEl.addEventListener('input', updateVideoClipTimelineUi);
    durationEl.addEventListener('change', updateVideoClipTimelineUi);
  }

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
      if (!startEl) return;

      e.preventDefault();
      var currentVal = (videoEl && isFinite(Number(videoEl.currentTime))) ? Number(videoEl.currentTime) : (Number(startEl.value) || 0);
      var step = 0.05;
      var newVal = e.key === 'ArrowRight' ? currentVal + step : currentVal - step;
      if (newVal < 0) newVal = 0;
      startEl.value = Number(newVal.toFixed(2));
      startEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

addEventListener('DOMContentLoaded', function() {
  wireVideoClipModal();
  wireCropThisFrameButton();
  updateVideoClipCropButtons();
  updateVideoClipExportSummary();
});
