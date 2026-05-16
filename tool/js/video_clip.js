// Store crop modal crop data for export
var videoClipPendingCrop = null;
// --- Wire up crop modal Apply button ---
function wireCropModalApplyButton() {
  var applyBtn = document.getElementById('crop-apply-btn');
  var cropModal = document.getElementById('crop-modal');
  if (!applyBtn || !cropModal) return;
  applyBtn.onclick = function() {
    // Only handle image crop here; video crop uses its own handler
    if (!window.cropperInstance) return;
    var data = window.cropperInstance.getData(true);
    // Store for export (image crop only)
    videoClipPendingCrop = null;
    var msg = 'Crop: x=' + Math.round(data.x) + ', y=' + Math.round(data.y) + ', w=' + Math.round(data.width) + ', h=' + Math.round(data.height);
    setStatus(msg);
    // Hide crop modal
    cropModal.classList.add('hidden');
    cropModal.setAttribute('aria-hidden', 'true');
    window.cropperInstance.destroy();
    window.cropperInstance = null;
  };
}

// --- Wire up video crop overlay Apply button ---
function wireVideoClipCropApplyButton() {
  var applyBtn = document.getElementById('video-clip-crop-apply-btn');
  if (!applyBtn) return;
  applyBtn.onclick = function() {
    if (!videoClipCropper) return;
    var data = videoClipCropper.getData(true);
    videoClipPendingCrop = {
      x: data.x,
      y: data.y,
      width: data.width,
      height: data.height
    };
    setStatus('Crop: x=' + Math.round(data.x) + ', y=' + Math.round(data.y) + ', w=' + Math.round(data.width) + ', h=' + Math.round(data.height));
    destroyVideoClipCropper();
    setVideoClipSizeReadout(0, 0);
  };
}

// Ensure openVideoClipModal is globally accessible
window.openVideoClipModal = openVideoClipModal;
// --- Extract frame and open crop modal ---
function extractFrameAndOpenCropModal() {
  var canvasEl = getVideoClipEl('video-clip-canvas');
  if (!canvasEl) throw new Error('Missing required element: video-clip-canvas');
  var w = canvasEl.width;
  var h = canvasEl.height;
  var tempCanvas = document.createElement('canvas');
  tempCanvas.width = w;
  tempCanvas.height = h;
  var ctx = tempCanvas.getContext('2d');
  ctx.drawImage(canvasEl, 0, 0, w, h);
  var dataUrl = tempCanvas.toDataURL('image/png');
  // Open crop modal and set image
  var cropModal = document.getElementById('crop-modal');
  var cropImg = document.getElementById('crop-image');
  if (!cropModal) throw new Error('Missing required element: crop-modal');
  if (!cropImg) throw new Error('Missing required element: crop-image');
  cropImg.src = dataUrl;
  cropImg.onload = function() {
    if (window.cropperInstance) {
      window.cropperInstance.destroy();
    }
    window.cropperInstance = new Cropper(cropImg, {
      aspectRatio: 1, // Always 1 for image crop
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
        var readoutEl = document.getElementById('crop-size-readout');
        if (readoutEl) {
          var w = Number(detail.width);
          var h = Number(detail.height);
          var x = Number(detail.x);
          var y = Number(detail.y);
          if (!isFinite(w) || !isFinite(h) || w < 0 || h < 0) {
            readoutEl.textContent = '0 x 0 px';
          } else {
            readoutEl.textContent = Math.round(w) + ' x ' + Math.round(h) + ' px  [' + Math.round(x) + ', ' + Math.round(y) + ']';
          }
        }
      },
      ready: function () {
        var data = window.cropperInstance.getData(true);
        var readoutEl = document.getElementById('crop-size-readout');
        if (readoutEl) {
          readoutEl.textContent = Math.round(data.width) + ' x ' + Math.round(data.height) + ' px';
        }
      }
    });
  };
  cropModal.classList.remove('hidden');
  cropModal.setAttribute('aria-hidden', 'false');
}

// --- Wire up Crop This Frame button ---
function wireCropThisFrameButton() {
  var videoModal = getVideoClipEl('video-clip-modal');
  if (!videoModal) throw new Error('Missing required element: video-clip-modal');
  var panel = videoModal.querySelector('.video-clip-player-panel');
  if (!panel) throw new Error('Missing required element: video-clip-player-panel');
  var btn = document.getElementById('video-clip-extract-frame-btn');
  btn.onclick = extractFrameAndShowOverlayCropper;
  // btn.id = 'video-clip-extract-frame-btn';
  // btn.type = 'button';
  // btn.textContent = 'Crop';
  // btn.style.margin = '8px 0';
  // btn.disabled = true;
  // btn.onclick = extractFrameAndOpenCropModal;
  // panel.appendChild(btn);
  // // Enable button when video is ready
  // var videoEl = getVideoClipEl('video-clip-video');
  // if (!videoEl) throw new Error('Missing required element: video-clip-video');
  // videoEl.addEventListener('loadedmetadata', function() {
  //   btn.disabled = false;
  // });
  // // Defensive: if video is already loaded
  // if (videoEl.readyState >= 1) {
  //   btn.disabled = false;
  // }
}

// video_clip.js
// Video clip modal: playback + start time + duration + aspect-ratio crop export.

var videoClipTargetItem = null;
var videoClipCropper = null;
var videoClipCropBusy = false;
var videoClipCropRatio = 1;
var videoClipCropEnabled = false;
var videoClipSourceResolution = null;
var videoClipFramePlayer = null;

function getVideoClipEl(id) {
  return document.getElementById(id);
}


function setVideoClipBusy(isBusy) {
  videoClipCropBusy = !!isBusy;
  var btn = getVideoClipEl('video-clip-export-btn');
  if (btn) btn.disabled = videoClipCropBusy;
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

  var canvasEl = getVideoClipEl('video-clip-canvas');
  if (canvasEl && videoClipFramePlayer) {
    videoClipFramePlayer.pause();
    videoClipFramePlayer.frames = [];
    videoClipFramePlayer.ready = false;
    videoClipFramePlayer.currentFrame = 0;
  }

  var cropWrap = getVideoClipEl('video-clip-crop-wrap');
  if (cropWrap) cropWrap.classList.add('hidden');
  var toggleBtn = getVideoClipEl('video-clip-crop-toggle-btn');
  if (toggleBtn) toggleBtn.textContent = 'Set Crop';
}


function initializeVideoClipCropSurface(mediaItem) {
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
// (removed stray code block delimiters and comments)
// Video cropping uses only the overlay cropper, not the image crop modal
function extractFrameAndShowOverlayCropper() {
  var canvasEl = getVideoClipEl('video-clip-canvas');
  var img = getVideoClipEl('video-clip-crop-image');
  if (!canvasEl || !img) throw new Error('Missing required element for video cropping');
  destroyVideoClipCropper();
  setVideoClipSizeReadout(0, 0);
  // Use canvas size for overlay
  var cw = canvasEl.width;
  var ch = canvasEl.height;
  if (!cw || !ch) return;
  img.src = buildBlankSvgDataUrl(cw, ch);
  img.classList.remove('hidden');
  img.onload = function() {
    // Align overlay to canvas
    var rect = canvasEl.getBoundingClientRect();
    var parentRect = canvasEl.parentElement.getBoundingClientRect();
    img.width = Math.round(rect.width);
    img.height = Math.round(rect.height);
    img.style.position = 'absolute';
    img.style.left = (rect.left - parentRect.left) + 'px';
    img.style.top = (rect.top - parentRect.top) + 'px';
    img.style.width = rect.width + 'px';
    img.style.height = rect.height + 'px';
    img.style.pointerEvents = 'auto';
    img.style.zIndex = 10;
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
  };
}

// Patch: wire up the video crop overlay apply button and crop this frame button
addEventListener('DOMContentLoaded', function() {
  wireVideoClipModal();
  var btn = document.getElementById('video-clip-extract-frame-btn');
  if (btn) btn.onclick = extractFrameAndShowOverlayCropper;
  wireVideoClipCropApplyButton();
});


