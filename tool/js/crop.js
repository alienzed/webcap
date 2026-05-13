// crop.js
// Plain global crop modal helpers. Keep this small and isolated.

var cropperInstance = null;
var cropTargetItem = null;
var cropActiveRatio = 1;
var cropBusy = false;
var CROPPABLE_IMAGE_EXTENSIONS = { '.jpg': true, '.jpeg': true, '.png': true, '.webp': true, '.bmp': true };

function isCroppableImageFile(fileName) {
  return !!CROPPABLE_IMAGE_EXTENSIONS[getFileExtension(fileName || '')];
}

function getCropEl(id) {
  return document.getElementById(id);
}

function setCropStatus(text, isError) {
  var statusEl = getCropEl('crop-status');
  if (!statusEl) return;
  statusEl.textContent = text || '';
  statusEl.classList.toggle('error', !!isError);
}

function setCropBusy(isBusy) {
  cropBusy = !!isBusy;
  var applyBtn = getCropEl('crop-apply-btn');
  if (applyBtn) applyBtn.disabled = cropBusy;
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

function destroyCropper() {
  if (cropperInstance) {
    cropperInstance.destroy();
    cropperInstance = null;
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

function closeCropModal() {
  destroyCropper();
  cropTargetItem = null;
  setCropBusy(false);
  setCropStatus('', false);
  var imageEl = getCropEl('crop-image');
  if (imageEl) imageEl.removeAttribute('src');
  setCropSizeReadout(0, 0);
  var modal = getCropEl('crop-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
}

function openCropModal(mediaItem) {
  if (!mediaItem || !mediaItem.fileName || !isCroppableImageFile(mediaItem.fileName)) {
    setStatus('Crop is only available for still image files.');
    return;
  }
  if (typeof Cropper !== 'function') {
    throw new Error('Cropper.js is not loaded');
  }

  var modal = getCropEl('crop-modal');
  var imageEl = getCropEl('crop-image');
  var titleEl = getCropEl('crop-modal-title');
  if (!modal || !imageEl || !titleEl) {
    throw new Error('Crop modal is missing from the page');
  }

  destroyCropper();
  cropTargetItem = mediaItem;
  setCropBusy(false);
  setCropAspectRatio(1);
  setCropSizeReadout(0, 0);
  setCropStatus('Loading image...', false);
  titleEl.textContent = 'Crop image: ' + mediaItem.fileName;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');

  imageEl.onload = function () {
    if (!cropTargetItem || cropTargetItem.fileName !== mediaItem.fileName) return;
    destroyCropper();
    cropperInstance = new Cropper(imageEl, {
      aspectRatio: cropActiveRatio,
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
        setCropSizeReadout(detail.width, detail.height);
      },
      ready: function () {
        var data = cropperInstance.getData(true);
        setCropSizeReadout(data.width, data.height);
        setCropStatus('', false);
      }
    });
  };
  imageEl.onerror = function () {
    console.error('Crop image failed to load:', mediaItem.fileName);
    setCropStatus('Image failed to load.', true);
  };
  imageEl.src = '/caption/media?folder=' + encodeURIComponent(state.folder || '') +
    '&media=' + encodeURIComponent(mediaItem.fileName) +
    '&t=' + Date.now();
}

function applyCrop() {
  if (cropBusy || !cropTargetItem || !cropperInstance) return;
  var fileName = cropTargetItem.fileName;
  var cropData = cropperInstance.getData(true);

  setCropBusy(true);
  setCropStatus('Applying crop...', false);

  HttpModule.postJson('/media/crop', {
    folder: state.folder || '',
    fileName: fileName,
    crop: {
      x: cropData.x,
      y: cropData.y,
      width: cropData.width,
      height: cropData.height
    }
  }, function (status, responseText) {
    setCropBusy(false);
    if (status === 200) {
      closeCropModal();
      setStatus('Cropped: ' + fileName);
      refreshMediaResolutionCache();
      if (state.currentItem && state.currentItem.fileName === fileName) {
        renderPathPreview(state.folder || '', fileName);
      }
      return;
    }

    var message = getErrorMessage(responseText, 'Crop failed');
    console.error('Crop failed:', message);
    setCropStatus(message, true);
    setStatus('Crop failed: ' + message);
  });
}

function wireCropModal() {
  var applyBtn = getCropEl('crop-apply-btn');
  var cancelBtn = getCropEl('crop-cancel-btn');
  var cancelX = getCropEl('crop-cancel-x');
  if (applyBtn) applyBtn.onclick = applyCrop;
  if (cancelBtn) cancelBtn.onclick = closeCropModal;
  if (cancelX) cancelX.onclick = closeCropModal;
  Array.prototype.forEach.call(document.querySelectorAll('.crop-ratio-btn'), function (btn) {
    btn.onclick = function () {
      setCropAspectRatio(Number(btn.getAttribute('data-ratio')) || 1);
    };
  });
  document.addEventListener('keydown', function (e) {
    var modal = getCropEl('crop-modal');
    if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
      closeCropModal();
    }
  });
}

addEventListener('DOMContentLoaded', wireCropModal);
