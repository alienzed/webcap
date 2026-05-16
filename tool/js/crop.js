function destroyCropper() {
  if (cropperInstance) {
    cropperInstance.destroy();
    cropperInstance = null;
  }
}

// --- Crop modal globals ---
var cropperInstance = null;
var cropTargetItem = null;
var cropActiveRatio = 1;
var cropBusy = false;

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

// --- Shared modal/Cropper setup ---
function setupCropModal(imageSrc, aspectRatio, onReady, onApply) {
  var modal = getCropEl('crop-modal');
  var imageEl = getCropEl('crop-image');
  var titleEl = getCropEl('crop-modal-title');
  var applyBtn = getCropEl('crop-apply-btn');
  if (!modal || !imageEl || !titleEl || !applyBtn) throw new Error('Crop modal is missing from the page');
  destroyCropper();
  setCropBusy(false);
  setCropAspectRatio(aspectRatio || 1);
  setCropSizeReadout(0, 0);
  setCropStatus('Loading image...', false);
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  imageEl.onload = function () {
    destroyCropper();
    cropperInstance = new Cropper(imageEl, {
      aspectRatio: aspectRatio || 1,
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
          selectPathMedia(state.currentItem).catch(function () {});
        }
        return;
      }
      var message = getErrorMessage(responseText, 'Crop failed');
      setCropStatus(message, true);
      setStatus('Crop failed: ' + message);
    });
  });
}

// --- Video crop entry point ---
function openVideoCropModal(dataUrl, aspect, onCrop) {
  setupCropModal(dataUrl, aspect, function() {
    getCropEl('crop-modal-title').textContent = 'Crop video frame';
  }, function() {
    // Apply handler for video
    if (!cropperInstance) return;
    var data = cropperInstance.getData(true);
    if (typeof onCrop === 'function') onCrop({
      x: Math.round(data.x),
      y: Math.round(data.y),
      width: Math.round(data.width),
      height: Math.round(data.height)
    });
    closeCropModal();
  });
}
