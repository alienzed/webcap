// --- Crop modal globals ---
var cropperInstance = null;
var cropTargetItem = null;
var cropActiveRatio = 1;
var cropActiveAngle = 0;
var cropRotationEnabled = false;
var cropBusy = false;
var cropMagnetApplying = false;
var cropEscapeHandlerBound = false;
var CROP_MAGNET_GRID = 8;
var CROP_MAGNET_THRESHOLD = 6;

var CROPPABLE_IMAGE_EXTENSIONS = { '.jpg': true, '.jpeg': true, '.png': true, '.webp': true, '.bmp': true };
function getFileExtension(fileName) {
  var idx = (fileName || '').lastIndexOf('.');
  return idx !== -1 ? fileName.slice(idx).toLowerCase() : '';
}
function isCroppableImageFile(fileName) {
  return !!CROPPABLE_IMAGE_EXTENSIONS[getFileExtension(fileName || '')];
}
window.isCroppableImageFile = isCroppableImageFile;

function getCropEl(id) {
  return document.getElementById(id);
}

function destroyCropper() {
  if (cropperInstance) {
    cropperInstance.destroy();
    cropperInstance = null;
  }
}

function setCropStatus(text, isError) {
  var statusEl = getCropEl('crop-status');
  if (!statusEl) return;
  statusEl.textContent = text || '';
  statusEl.classList.toggle('error', !!isError);
}

function setCropSizeReadout(width, height) {
  var readoutEl = getCropEl('crop-size-readout');
  if (!readoutEl) return;
  var w = Number(width);
  var h = Number(height);
  if (!isFinite(w) || !isFinite(h) || w < 0 || h < 0) {
    readoutEl.textContent = '0 x 0 px';
    return;
  }
  readoutEl.textContent = Math.round(w) + ' x ' + Math.round(h) + ' px';
}

function setCropBusy(isBusy) {
  cropBusy = !!isBusy;
  var applyBtn = getCropEl('crop-apply-btn');
  if (applyBtn) applyBtn.disabled = cropBusy;
}

function setCropRotationControlsVisible(isVisible) {
  var row = getCropEl('crop-rotate-row');
  if (!row) return;
  row.classList.toggle('hidden', !isVisible);
}

function normalizeCropAngle(value) {
  var angle = Number(value);
  if (!isFinite(angle)) return 0;
  if (angle > 180) return 180;
  if (angle < -180) return -180;
  return angle;
}

function formatCropAngle(value) {
  var angle = normalizeCropAngle(value);
  return String(Math.round(angle * 10) / 10);
}

function syncCropAngleControls(value) {
  var slider = getCropEl('crop-rotate-slider');
  var input = getCropEl('crop-rotate-input');
  var text = formatCropAngle(value);
  if (slider) slider.value = text;
  if (input) input.value = text;
}

function setCropAngle(value) {
  cropActiveAngle = normalizeCropAngle(value);
  syncCropAngleControls(cropActiveAngle);
  if (cropperInstance && cropRotationEnabled) {
    cropperInstance.rotateTo(cropActiveAngle);
  }
}

function setCropAspectRatio(ratio) {
  cropActiveRatio = ratio || 1;
  Array.prototype.forEach.call(document.querySelectorAll('.crop-ratio-btn'), function (btn) {
    btn.classList.toggle('active', Number(btn.getAttribute('data-ratio')) === cropActiveRatio);
  });
  if (cropperInstance) {
    cropperInstance.setAspectRatio(cropActiveRatio);
  }
}

function magnetNearest(value, grid) {
  return Math.round(Number(value) / grid) * grid;
}

function magnetSnapDimension(value, grid, threshold) {
  var nearest = magnetNearest(value, grid);
  if (Math.abs(Number(value) - nearest) <= threshold) return nearest;
  return Number(value);
}

function applyCropSoftMagnet() {
  if (!cropperInstance || cropMagnetApplying) return;
  var data = cropperInstance.getData(true);
  var ratio = cropActiveRatio > 0 ? cropActiveRatio : 1;
  var snappedW = magnetSnapDimension(data.width, CROP_MAGNET_GRID, CROP_MAGNET_THRESHOLD);
  if (snappedW === data.width) {
    setCropSizeReadout(data.width, data.height);
    return;
  }
  var snappedH = Math.max(CROP_MAGNET_GRID, Math.round(snappedW / ratio));
  cropMagnetApplying = true;
  cropperInstance.setData({
    x: data.x,
    y: data.y,
    width: snappedW,
    height: snappedH
  });
  cropMagnetApplying = false;
  setCropSizeReadout(snappedW, snappedH);
}

function finalizeCropData(data) {
  var ratio = cropActiveRatio > 0 ? cropActiveRatio : 1;
  var width = Math.max(CROP_MAGNET_GRID, magnetNearest(data.width, CROP_MAGNET_GRID));
  var height = Math.max(CROP_MAGNET_GRID, Math.round(width / ratio));
  var x = Math.round(data.x);
  var y = Math.round(data.y);

  if (cropperInstance && typeof cropperInstance.getImageData === 'function') {
    var imageData = cropperInstance.getImageData() || {};
    var naturalWidth = Math.max(0, Math.round(Number(imageData.naturalWidth) || 0));
    var naturalHeight = Math.max(0, Math.round(Number(imageData.naturalHeight) || 0));
    if (naturalWidth > 0 && naturalHeight > 0) {
      x = Math.max(0, Math.min(x, Math.max(0, naturalWidth - CROP_MAGNET_GRID)));
      y = Math.max(0, Math.min(y, Math.max(0, naturalHeight - CROP_MAGNET_GRID)));

      // Keep the snapped box inside bounds by shrinking width to the largest
      // valid grid step that also satisfies the locked aspect ratio.
      var maxWidthByBounds = Math.min(naturalWidth - x, (naturalHeight - y) * ratio);
      var maxWidthGrid = Math.floor(maxWidthByBounds / CROP_MAGNET_GRID) * CROP_MAGNET_GRID;
      if (maxWidthGrid >= CROP_MAGNET_GRID) {
        width = Math.min(width, maxWidthGrid);
        width = Math.max(CROP_MAGNET_GRID, Math.floor(width / CROP_MAGNET_GRID) * CROP_MAGNET_GRID);
      }
      height = Math.max(CROP_MAGNET_GRID, Math.floor(width / ratio));
      while (width > CROP_MAGNET_GRID && (x + width > naturalWidth || y + height > naturalHeight)) {
        width -= CROP_MAGNET_GRID;
        height = Math.max(CROP_MAGNET_GRID, Math.floor(width / ratio));
      }
    }
  }

  return {
    x: x,
    y: y,
    width: width,
    height: height
  };
}

function closeCropModal() {
  destroyCropper();
  cropTargetItem = null;
  cropRotationEnabled = false;
  setCropRotationControlsVisible(false);
  setCropAngle(0);
  setCropBusy(false);
  setCropStatus('', false);
  var imageEl = getCropEl('crop-image');
  if (imageEl) imageEl.removeAttribute('src');
  setCropSizeReadout(0, 0);
  var modal = getCropEl('crop-modal');
  if (modal) {
    if (modal.contains(document.activeElement)) {
      try { document.activeElement.blur(); } catch (e) {}
      if ('inert' in modal) {
        modal.inert = true;
      }
    }
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
}

function buildCroppedImageDataUrl() {
  if (!cropperInstance || typeof cropperInstance.getCroppedCanvas !== 'function') {
    throw new Error('Cropper is not ready');
  }
  var canvas = cropperInstance.getCroppedCanvas({
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
    fillColor: '#000000'
  });
  if (!canvas || typeof canvas.toDataURL !== 'function') {
    throw new Error('Unable to render cropped image');
  }
  var dataUrl = canvas.toDataURL('image/png');
  if (!dataUrl || dataUrl === 'data:,') {
    throw new Error('Unable to encode cropped image');
  }
  return {
    dataUrl: dataUrl,
    width: canvas.width,
    height: canvas.height
  };
}

// --- Shared modal/Cropper setup ---
function setupCropModal(imageSrc, aspectRatio, onReady, onApply, options) {
  options = options || {};
  cropRotationEnabled = !!options.rotationEnabled;
  var initialAngle = normalizeCropAngle(options.initialAngle || 0);
  var modal = getCropEl('crop-modal');
  var imageEl = getCropEl('crop-image');
  var titleEl = getCropEl('crop-modal-title');
  var applyBtn = getCropEl('crop-apply-btn');
  if (!modal || !imageEl || !titleEl || !applyBtn) throw new Error('Crop modal is missing from the page');
  destroyCropper();
  setCropBusy(false);
  setCropAspectRatio(aspectRatio || 1);
  setCropRotationControlsVisible(cropRotationEnabled);
  setCropAngle(initialAngle);
  setCropSizeReadout(0, 0);
  setCropStatus('Loading image...', false);
  modal.classList.remove('hidden');
  if ('inert' in modal) {
    modal.inert = false;
  }
  modal.setAttribute('aria-hidden', 'false');
  imageEl.onload = function () {
    destroyCropper();
    cropperInstance = new Cropper(imageEl, {
      aspectRatio: aspectRatio || 1,
      viewMode: 1,
      dragMode: 'move',
      autoCropArea: 1,
      background: false,
      responsive: true,
      movable: true,
      zoomable: true,
      scalable: false,
      rotatable: cropRotationEnabled,
      cropBoxMovable: true,
      cropBoxResizable: true,
      crop: function (event) {
        var detail = event && event.detail ? event.detail : {};
        setCropSizeReadout(detail.width, detail.height);
      },
      ready: function () {
        setCropAngle(initialAngle);
        var data = cropperInstance.getData(true);
        setCropSizeReadout(data.width, data.height);
        setCropStatus('', false);
        if (onReady) onReady();
      }
    });
  };
  imageEl.onerror = function () {
    setCropStatus('Image failed to load.', true);
  };
  applyBtn.onclick = onApply;
  // Cancel/close wiring
  var cancelBtn = getCropEl('crop-cancel-btn');
  var cancelX = getCropEl('crop-cancel-x');
  if (cancelBtn) cancelBtn.onclick = closeCropModal;
  if (cancelX) cancelX.onclick = closeCropModal;
  var rotateSlider = getCropEl('crop-rotate-slider');
  var rotateInput = getCropEl('crop-rotate-input');
  var rotateResetBtn = getCropEl('crop-rotate-reset-btn');
  if (rotateSlider) {
    rotateSlider.oninput = function () {
      setCropAngle(rotateSlider.value);
    };
  }
  if (rotateInput) {
    rotateInput.onchange = function () {
      setCropAngle(rotateInput.value);
    };
    rotateInput.onkeydown = function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        setCropAngle(rotateInput.value);
      }
    };
  }
  if (rotateResetBtn) {
    rotateResetBtn.onclick = function () {
      setCropAngle(0);
    };
  }
  Array.prototype.forEach.call(document.querySelectorAll('.crop-ratio-btn'), function (btn) {
    btn.onclick = function () {
      setCropAspectRatio(Number(btn.getAttribute('data-ratio')) || 1);
    };
  });
  if (!cropEscapeHandlerBound) {
    document.addEventListener('keydown', function (e) {
      var modal = getCropEl('crop-modal');
      if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
        closeCropModal();
      }
    });
    cropEscapeHandlerBound = true;
  }
  imageEl.src = imageSrc;
}

// --- Image crop entry point ---
function openImageCropModal(mediaItem) {
  if (!mediaItem || !mediaItem.fileName || !isCroppableImageFile(mediaItem.fileName)) {
    setStatus('Crop is only available for still image files.');
    return;
  }
  cropTargetItem = mediaItem;
  var folder = state.folder || '';
  var imageSrc = '/caption/media?folder=' + encodeURIComponent(folder) + '&media=' + encodeURIComponent(mediaItem.fileName) + '&t=' + Date.now();
  var aspect = 1;
  setupCropModal(imageSrc, aspect, function() {
    // ready
    getCropEl('crop-modal-title').textContent = 'Crop image: ' + mediaItem.fileName;
  }, function() {
    // Apply handler for image
    if (cropBusy || !cropTargetItem || !cropperInstance) return;
    var fileName = cropTargetItem.fileName;
    var cropData = finalizeCropData(cropperInstance.getData(true));
    var renderedCrop = null;
    try {
      renderedCrop = buildCroppedImageDataUrl();
    } catch (err) {
      var renderError = err && err.message ? err.message : String(err);
      setCropStatus(renderError, true);
      setStatus('Crop failed: ' + renderError);
      return;
    }
    if (renderedCrop && renderedCrop.width > 0 && renderedCrop.height > 0) {
      cropData.width = renderedCrop.width;
      cropData.height = renderedCrop.height;
    }
    setCropBusy(true);
    setCropStatus('Applying crop...', false);
    HttpModule.postJson('/media/crop', {
      folder: state.folder || '',
      fileName: fileName,
      crop: cropData,
      angle: cropActiveAngle,
      imageDataUrl: renderedCrop ? renderedCrop.dataUrl : null
    }, function (status, responseText) {
      setCropBusy(false);
      if (status === 200) {
        closeCropModal();
        setStatus('Cropped: ' + fileName);
        markMediaMutated(fileName, 'best_effort');
        bumpMediaCacheBustToken(fileName);
        saveFolderStateForCurrentRoot();
        refreshMediaResolutionCache();
        if (state.currentItem && state.currentItem.fileName === fileName) {
          selectPathMedia(state.currentItem).catch(function () {});
        }
        return;
      }
      var message = getErrorMessage(responseText, 'Crop failed');
      setCropStatus(message, true);
      setStatus('Crop failed: ' + message);
    });
  }, {
    rotationEnabled: true,
    initialAngle: 0
  });
}

// --- Video crop entry point ---
function openVideoCropModal(dataUrl, aspect, onCrop) {
  setupCropModal(dataUrl, aspect, function() {
    getCropEl('crop-modal-title').textContent = 'Crop video frame';
  }, function() {
    // Apply handler for video
    if (!cropperInstance) return;
    var data = finalizeCropData(cropperInstance.getData(true));
    onCrop(data);
    closeCropModal();
  }, {
    rotationEnabled: false,
    initialAngle: 0
  });
}
