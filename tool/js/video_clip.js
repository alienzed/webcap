var videoClipTargetItem = null;
var videoClipCropper = null;
var videoClipCropBusy = false;
var videoClipCropRatio = 1;
var videoClipCropEnabled = false;
var videoClipSourceResolution = null;
var videoClipPendingCrop = null;

// --- Extract frame and open crop modal ---
function extractFrameAndOpenCropModal() {
  var videoEl = getVideoClipEl('video-clip-video');
  if (!videoEl) throw new Error('Missing required element: video-clip-video');
  if (!videoEl.videoWidth || !videoEl.videoHeight) throw new Error('Video element has no video loaded');
  var w = videoEl.videoWidth;
  var h = videoEl.videoHeight;
  var canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  var ctx = canvas.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, w, h);
  var dataUrl = canvas.toDataURL('image/png');
  openVideoCropModal(dataUrl, videoClipCropRatio, function(crop) {
    window.videoClipPendingCrop = crop;
    setStatus('Crop: x=' + crop.x + ', y=' + crop.y + ', w=' + crop.width + ', h=' + crop.height);
  });
}
// --- Wire up Crop This Frame button ---
function wireCropThisFrameButton() {
  var btn = getVideoClipEl('video-clip-crop-frame-btn');
  if (!btn) throw new Error('Missing required element: video-clip-crop-frame-btn');
  btn.disabled = true;
  btn.onclick = extractFrameAndOpenCropModal;
  // Enable button when video is ready
  var videoEl = getVideoClipEl('video-clip-video');
  if (!videoEl) throw new Error('Missing required element: video-clip-video');
  videoEl.addEventListener('loadedmetadata', function() {
    btn.disabled = false;
  });
  // Defensive: if video is already loaded
  if (videoEl.readyState >= 1) {
    btn.disabled = false;
  }
}
// video_clip.js
// Video clip modal: playback + start time + duration + aspect-ratio crop export.



function getVideoClipEl(id) {
  return document.getElementById(id);
}


function setVideoClipBusy(isBusy) {
  videoClipCropBusy = !!isBusy;
  var btn = getVideoClipEl('video-clip-export-btn');
  if (btn) btn.disabled = videoClipCropBusy;
  var outputEl = getVideoClipEl('video-clip-output-input');
  if (outputEl) outputEl.disabled = videoClipCropBusy;
  var startEl = getVideoClipEl('video-clip-start-input');
  if (startEl) startEl.disabled = videoClipCropBusy;
  var durationEl = getVideoClipEl('video-clip-duration-input');
  if (durationEl) durationEl.disabled = videoClipCropBusy;
}

function setVideoClipSizeReadout(width, height) {
  var readoutEl = getVideoClipEl('video-clip-size-readout');
  if (!readoutEl) return;
  var w = Number(width);
  var h = Number(height);
  if (!isFinite(w) || !isFinite(h) || w < 0 || h < 0) {
    readoutEl.textContent = '0 x 0 px';
    return;
  }
  readoutEl.textContent = Math.round(w) + ' x ' + Math.round(h) + ' px';
}

function isVideoFileName(fileName) {
  var ext = getFileExtension(fileName || '');
  return !!MEDIA_EXTENSIONS[ext] && ['.mp4', '.webm', '.ogg', '.mov', '.mkv', '.avi', '.m4v'].indexOf(ext) !== -1;
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

function buildBlankSvgDataUrl(width, height) {
  var w = Math.max(1, Number(width) || 1);
  var h = Math.max(1, Number(height) || 1);
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><rect x="0" y="0" width="' + w + '" height="' + h + '" fill="rgba(0,0,0,0)"/></svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}


function destroyVideoClipCropper() {
  if (videoClipCropper) {
    videoClipCropper.destroy();
    videoClipCropper = null;
  }
  var img = getVideoClipEl('video-clip-crop-image');
  if (img) {
    img.classList.add('hidden');
    img.style.width = '';
    img.style.height = '';
    img.style.left = '';
    img.style.top = '';
  }
}

function setVideoClipRatio(ratio) {
  videoClipCropRatio = ratio || 1;
  Array.prototype.forEach.call(document.querySelectorAll('.video-clip-ratio-btn'), function (btn) {
    btn.classList.toggle('active', Number(btn.getAttribute('data-ratio')) === videoClipCropRatio);
  });
  if (videoClipCropper) {
    videoClipCropper.setAspectRatio(videoClipCropRatio);
  }
}

function getVideoClipResolution(fileName) {
  var text = getResolutionForMedia(fileName);
  var parsed = parseResolutionText(text);
  if (parsed) return parsed;
  var row = mediaMetadataByFile[fileName];
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

function closeVideoClipModal() {
  destroyVideoClipCropper();
  videoClipTargetItem = null;
  videoClipCropEnabled = false;
  videoClipSourceResolution = null;
  setVideoClipBusy(false);
  setStatus('');
  setVideoClipSizeReadout(0, 0);

  var modal = getVideoClipEl('video-clip-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }

  var videoEl = getVideoClipEl('video-clip-video');
  if (videoEl) {
    try { videoEl.pause(); } catch (e) {}
    videoEl.removeAttribute('src');
    videoEl.load();
  }
  var cropFrameBtn = getVideoClipEl('video-clip-crop-frame-btn');
  if (cropFrameBtn) cropFrameBtn.disabled = true;

  var cropWrap = getVideoClipEl('video-clip-crop-wrap');
  if (cropWrap) cropWrap.classList.add('hidden');
  var toggleBtn = getVideoClipEl('video-clip-crop-toggle-btn');
  if (toggleBtn) toggleBtn.textContent = 'Set Crop';
}


function initializeVideoClipCropSurface(mediaItem) {
  if (typeof Cropper !== 'function') {
    throw new Error('Cropper.js is not loaded');
  }
  var videoEl = getVideoClipEl('video-clip-video');
  var img = getVideoClipEl('video-clip-crop-image');
  if (!videoEl || !img) throw new Error('Video or overlay element not found');
  destroyVideoClipCropper();
  setVideoClipSizeReadout(0, 0);
  // Defensive: Wait for video metadata
  function onVideoReady() {
    var vw = videoEl.videoWidth;
    var vh = videoEl.videoHeight;
    if (!vw || !vh) return; // Not ready yet
    // Generate SVG overlay matching video pixel size
    img.src = buildBlankSvgDataUrl(vw, vh);
    img.classList.remove('hidden');
    // Wait for overlay image to load
    img.onload = function() {
      alignOverlayToVideo();
      // Wait for layout
      requestAnimationFrame(function() {
        destroyVideoClipCropper();
        videoClipCropper = new Cropper(img, {
          aspectRatio: videoClipCropRatio,
          viewMode: 1,
          dragMode: 'move',
          autoCropArea: 0.9,
          background: false,
          responsive: true,
          movable: true,
          zoomable: true,
          scalable: false,
          rotatable: false,
          cropBoxMovable: true,
          cropBoxResizable: true,
          crop: function (event) {
            var detail = event && event.detail ? event.detail : {};
            setVideoClipSizeReadout(detail.width, detail.height);
          },
          ready: function () {
            var data = videoClipCropper.getData(true);
            setVideoClipSizeReadout(data.width, data.height);
          }
        });
      });
    };
    // Listen for resize events
    window.addEventListener('resize', alignOverlayToVideo);
    // Defensive: Remove listeners on modal close
    var modal = document.getElementById('video-clip-modal');
    if (modal) {
      modal.addEventListener('transitionend', function cleanup() {
        if (modal.classList.contains('hidden')) {
          window.removeEventListener('resize', alignOverlayToVideo);
          modal.removeEventListener('transitionend', cleanup);
        }
      });
    }
  }
  // Defensive: Only run when video is visible and has size
  function alignOverlayToVideo() {
    var rect = videoEl.getBoundingClientRect();
    var parentRect = videoEl.parentElement.getBoundingClientRect();
    // Set both intrinsic and rendered size
    img.width = Math.round(rect.width);
    img.height = Math.round(rect.height);
    img.style.position = 'absolute';
    img.style.left = (rect.left - parentRect.left) + 'px';
    img.style.top = (rect.top - parentRect.top) + 'px';
    img.style.width = rect.width + 'px';
    img.style.height = rect.height + 'px';
    img.style.pointerEvents = 'auto';
    img.style.zIndex = 10;
  }
  if (videoEl.readyState >= 1) {
    onVideoReady();
  } else {
    videoEl.addEventListener('loadedmetadata', onVideoReady, { once: true });
  }
  window.addEventListener('resize', syncVideoClipCropOverlayToVideo);
  var videoEl = getVideoClipEl('video-clip-video');
  if (videoEl) videoEl.addEventListener('loadedmetadata', syncVideoClipCropOverlayToVideo);
  setTimeout(syncVideoClipCropOverlayToVideo, 100);
}

function toggleVideoClipCropMode() {
  var img = getVideoClipEl('video-clip-crop-image');
  var btn = getVideoClipEl('video-clip-crop-toggle-btn');
  if (!img || !btn || !videoClipTargetItem) return;

  videoClipCropEnabled = !videoClipCropEnabled;
  if (videoClipCropEnabled) {
    btn.textContent = 'Hide Crop Tool';
    try {
      initializeVideoClipCropSurface(videoClipTargetItem);
      setStatus('');
    } catch (e) {
      videoClipCropEnabled = false;
      img.classList.add('hidden');
      btn.textContent = 'Set Crop Tool';
      setStatus(String(e && e.message ? e.message : e));
    }
    return;
  }

  btn.textContent = 'Set Crop Tool';
  destroyVideoClipCropper();
  setVideoClipSizeReadout(0, 0);
}

function openVideoClipModal(mediaItem) {
  setStatus('[VideoClip] Opening video clip modal for', mediaItem.fileName);
  if (!mediaItem || !mediaItem.fileName || !isVideoFileName(mediaItem.fileName)) {
    setStatus('Clip is only available for video files.');
    return;
  }
  // Restrict to src_videos folder only
  var folder = (typeof state !== 'undefined' && state.folder) ? String(state.folder) : '';
  if (!/\bsrc_videos(\\|\/|$)/i.test(folder)) {
    setStatus('Clip is only available for videos inside the src_videos folder.');
    return;
  }

  var modal = getVideoClipEl('video-clip-modal');
  var titleEl = getVideoClipEl('video-clip-title');
  var videoEl = getVideoClipEl('video-clip-video');
  var outputEl = getVideoClipEl('video-clip-output-input');
  var startEl = getVideoClipEl('video-clip-start-input');
  var durationEl = getVideoClipEl('video-clip-duration-input');
  var currentTimeEl = getVideoClipEl('video-clip-current-time');
  var cropFrameBtn = getVideoClipEl('video-clip-crop-frame-btn');
  var cropWrap = getVideoClipEl('video-clip-crop-wrap');
  var cropToggleBtn = getVideoClipEl('video-clip-crop-toggle-btn');

  if (!modal || !titleEl || !videoEl || !outputEl || !startEl || !durationEl || !currentTimeEl) {
    throw new Error('Video clip modal is missing required elements');
  }

  destroyVideoClipCropper();
  videoClipTargetItem = mediaItem;
  videoClipCropEnabled = false;
  setVideoClipBusy(false);
  setStatus('');
  setVideoClipSizeReadout(0, 0);
  setVideoClipRatio(1);

  if (cropWrap) cropWrap.classList.add('hidden');
  if (cropToggleBtn) cropToggleBtn.textContent = 'Set Crop Tool';

  var stem = mediaItem.fileName.replace(/\.[^.]+$/, '');
  outputEl.value = stem + '_clip';
  startEl.value = '0';
  durationEl.value = '2.0';
  currentTimeEl.textContent = '0.000';
  if (cropFrameBtn) cropFrameBtn.disabled = true;

  titleEl.textContent = 'Clip video: ' + mediaItem.fileName;
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
    // No autoplay for video clip modal
  };
  videoEl.ontimeupdate = function () {
    currentTimeEl.textContent = Number(videoEl.currentTime || 0).toFixed(3);
  };
  videoEl.onerror = function () {
    setStatus('Video failed to load. The codec may be unsupported in browser playback.');
  };
}

function getVideoClipPayload(overwrite) {
  if (!videoClipTargetItem || !videoClipTargetItem.fileName) {
    throw new Error('No video clip target selected');
  }

  var videoEl = getVideoClipEl('video-clip-video');
  var outputEl = getVideoClipEl('video-clip-output-input');
  var startEl = getVideoClipEl('video-clip-start-input');
  var durationEl = getVideoClipEl('video-clip-duration-input');

  if (!videoEl || !outputEl || !startEl || !durationEl) {
    throw new Error('Video clip form elements are missing');
  }

  var outputName = String(outputEl.value || '').trim();
  if (!outputName) {
    throw new Error('Output name is required');
  }

  var startSec = Number(startEl.value);
  if (!isFinite(startSec) || startSec < 0) {
    throw new Error('Start time must be >= 0');
  }

  var durationSec = Number(durationEl.value);
  if (!isFinite(durationSec) || durationSec <= 0) {
    throw new Error('Duration must be > 0');
  }

  var cropData = null;
  if (videoClipPendingCrop) {
    cropData = videoClipPendingCrop;
  } else if (videoClipCropper) {
    var data = videoClipCropper.getData(true);
    cropData = {
      x: data.x,
      y: data.y,
      width: data.width,
      height: data.height
    };
  } else {
    var res = getVideoClipResolution(videoClipTargetItem.fileName);
    if (!res) {
      throw new Error('Crop is required and video resolution metadata is unavailable');
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
    var cropX = (sourceW - cropW) / 2;
    var cropY = (sourceH - cropH) / 2;
    cropData = {
      x: cropX,
      y: cropY,
      width: cropW,
      height: cropH
    };
  }
  videoClipPendingCrop = null;

  return {
    folder: state.folder || '',
    fileName: videoClipTargetItem.fileName,
    outputName: outputName,
    startSec: startSec,
    durationSec: durationSec,
    crop: cropData,
    overwrite: !!overwrite
  };
}

function applyVideoClip(overwrite) {
  if (videoClipCropBusy) return;

  var payload;
  try {
    payload = getVideoClipPayload(overwrite);
  } catch (e) {
    setStatus(String(e && e.message ? e.message : e));
    return;
  }

  setVideoClipBusy(true);
  setStatus('Exporting clip to: ' + payload.outputName);
  if (window.console && console.log) {
    console.log('[VideoClip] Export payload:', payload);
  }

  HttpModule.postJson('/media/video_clip', payload, function (status, responseText) {
    setVideoClipBusy(false);
    if (window.console && console.log) {
      console.log('[VideoClip] Export response:', status, responseText);
    }
    if (status === 200) {
      // Leave modal open so user can create more clips.
      setStatus('Clip exported: ' + payload.outputName);
      if (window.console && console.log) {
        console.log('[VideoClip] Exported:', payload.outputName);
      }
      refreshCurrentDirectory();
      return;
    }
    var message = getErrorMessage(responseText, 'Clip export failed');
    var data = null;
    try { data = JSON.parse(responseText); } catch (e) {}
    if (status === 409 && data && data.requiresOverwrite) {
      var overwriteConfirmed = confirm('Output file exists. Overwrite?\n\n' + data.outputName);
      if (overwriteConfirmed) {
        applyVideoClip(true);
        return;
      }
      setStatus('Export cancelled.');
      return;
    }
    setStatus(message);
    setStatus('Clip export failed: ' + message);
    if (window.console && console.error) {
      console.error('[VideoClip] Export failed:', message, payload, responseText);
    }
  });
}

function wireVideoClipModal() {
  var exportBtn = getVideoClipEl('video-clip-export-btn');
  var cancelBtn = getVideoClipEl('video-clip-cancel-btn');
  var cancelX = getVideoClipEl('video-clip-cancel-x');
  var useCurrentBtn = getVideoClipEl('video-clip-use-current-btn');
  var startEl = getVideoClipEl('video-clip-start-input');
  var videoEl = getVideoClipEl('video-clip-video');
  var cropToggleBtn = getVideoClipEl('video-clip-crop-toggle-btn');

  if (exportBtn) exportBtn.onclick = function () { applyVideoClip(false); };
  if (cancelBtn) cancelBtn.onclick = closeVideoClipModal;
  if (cancelX) cancelX.onclick = closeVideoClipModal;
  if (cropToggleBtn) cropToggleBtn.onclick = toggleVideoClipCropMode;

  if (useCurrentBtn && startEl && videoEl) {
    useCurrentBtn.onclick = function () {
      startEl.value = Number(videoEl.currentTime || 0).toFixed(3);
    };
  }

  var outputEl = getVideoClipEl('video-clip-output-input');
  if (outputEl) {
    outputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyVideoClip(false);
      }
    });
  }

  if (startEl && videoEl) {
    startEl.addEventListener('change', function () {
      var v = Number(startEl.value);
      if (!isFinite(v) || v < 0) return;
      try { videoEl.currentTime = v; } catch (e) {}
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.video-clip-ratio-btn'), function (btn) {
    btn.onclick = function () {
      setVideoClipRatio(Number(btn.getAttribute('data-ratio')) || 1);
    };
  });

  document.addEventListener('keydown', function (e) {
    var modal = getVideoClipEl('video-clip-modal');
    if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
      closeVideoClipModal();
    }
  });
}

addEventListener('DOMContentLoaded', function() {
  wireVideoClipModal();
  wireCropThisFrameButton();
});

// --- Overlay sync helper ---


// --- PATCH: update initializeVideoClipCropSurface to sync overlay ---
var _orig_initializeVideoClipCropSurface = initializeVideoClipCropSurface;
initializeVideoClipCropSurface = function(mediaItem) {
  if (typeof Cropper !== 'function') {
    throw new Error('Cropper.js is not loaded');
  }
  var res = getVideoClipResolution(mediaItem.fileName);
  if (!res) {
    throw new Error('Video resolution metadata is unavailable. Reload folder and try again.');
  }
  var img = getVideoClipEl('video-clip-crop-image');
  if (!img) throw new Error('Video clip crop image element not found');
  destroyVideoClipCropper();
  setVideoClipSizeReadout(0, 0);
  img.classList.remove('hidden');
  img.src = buildBlankSvgDataUrl(res.width, res.height);
  function syncAndInitCropper() {
    // Ensure overlay <img> matches rendered video size
    var videoEl = getVideoClipEl('video-clip-video');
    if (videoEl && img) {
      var rect = videoEl.getBoundingClientRect();
      img.setAttribute('width', Math.round(rect.width));
      img.setAttribute('height', Math.round(rect.height));
    }
    destroyVideoClipCropper();
    videoClipCropper = new Cropper(img, {
      aspectRatio: videoClipCropRatio,
      viewMode: 1,
      dragMode: 'move',
      autoCropArea: 0.9,
      background: false,
      responsive: true,
      movable: true,
      zoomable: true,
      scalable: false,
      rotatable: false,
      cropBoxMovable: true,
      cropBoxResizable: true,
      crop: function (event) {
        var detail = event && event.detail ? event.detail : {};
        setVideoClipSizeReadout(detail.width, detail.height);
      },
      ready: function () {
        var data = videoClipCropper.getData(true);
        setVideoClipSizeReadout(data.width, data.height);
      }
    });
  }
  img.onload = syncAndInitCropper;

};

// --- PATCH: update destroyVideoClipCropper to clean up overlay ---
var _orig_destroyVideoClipCropper = destroyVideoClipCropper;
destroyVideoClipCropper = function() {
  if (videoClipCropper) {
    videoClipCropper.destroy();
    videoClipCropper = null;
  }
  var img = getVideoClipEl('video-clip-crop-image');
  if (img) {
    img.classList.add('hidden');
  }

};
