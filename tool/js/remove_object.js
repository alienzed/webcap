// Single-image Remove Object: paint a mask and apply OpenCV inpainting.
var removeObjectTarget = null;
var removeObjectBusy = false;
var removeObjectPainting = false;
var removeObjectLastPoint = null;

function removeObjectEl(id) { return document.getElementById(id); }

function removeObjectStatus(message, error) {
  var el = removeObjectEl('remove-object-status');
  el.textContent = message || '';
  el.classList.toggle('error', !!error);
}

function closeRemoveObjectModal() {
  if (removeObjectBusy) return;
  removeObjectPainting = false;
  removeObjectTarget = null;
  removeObjectLastPoint = null;
  var modal = removeObjectEl('remove-object-modal');
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  removeObjectEl('remove-object-image').removeAttribute('src');
}

function removeObjectPaint(event) {
  if (!removeObjectPainting || removeObjectBusy) return;
  var canvas = removeObjectEl('remove-object-mask');
  var bounds = canvas.getBoundingClientRect();
  var point = {
    x: (event.clientX - bounds.left) * canvas.width / bounds.width,
    y: (event.clientY - bounds.top) * canvas.height / bounds.height
  };
  var ctx = canvas.getContext('2d');
  var size = Number(removeObjectEl('remove-object-brush').value);
  ctx.strokeStyle = '#ff4b99';
  ctx.fillStyle = '#ff4b99';
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(point.x, point.y, size / 2, 0, Math.PI * 2);
  ctx.fill();
  if (removeObjectLastPoint) {
    ctx.beginPath();
    ctx.moveTo(removeObjectLastPoint.x, removeObjectLastPoint.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }
  removeObjectLastPoint = point;
}

function openRemoveObjectModal(mediaItem) {
  if (!mediaItem || !isCroppableImageFile(mediaItem.fileName)) {
    throw new Error('Remove Object requires a still image');
  }
  removeObjectTarget = { folder: state.folder || '', fileName: mediaItem.fileName, key: mediaItem.key };
  var modal = removeObjectEl('remove-object-modal');
  var img = removeObjectEl('remove-object-image');
  var mask = removeObjectEl('remove-object-mask');
    var brush = removeObjectEl('remove-object-brush');
  var brushLabel = removeObjectEl('remove-object-brush-value');
  removeObjectEl('remove-object-title').textContent = 'Remove Object: ' + mediaItem.fileName;
  brush.value = '16';
  brushLabel.textContent = brush.value + ' px';
  brush.oninput = function () { brushLabel.textContent = brush.value + ' px'; };
  removeObjectStatus('Loading image...');
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  img.onload = function () {
    mask.width = img.naturalWidth;
    mask.height = img.naturalHeight;
    mask.getContext('2d').clearRect(0, 0, mask.width, mask.height);
    removeObjectStatus('Brush over the object, then Apply. Reset restores the original later.');
  };
  img.onerror = function () {
    removeObjectStatus('Image failed to load', true);
    reportConsoleError('Remove Object', new Error('Image failed to load: ' + mediaItem.fileName));
  };
  img.src = '/caption/media?folder=' + encodeURIComponent(state.folder || '') +
    '&media=' + encodeURIComponent(mediaItem.fileName) + '&t=' + Date.now();
  mask.onpointerdown = function (event) {
    if (removeObjectBusy || !mask.width || !mask.height) return;
    removeObjectPainting = true;
    removeObjectLastPoint = null;
    mask.setPointerCapture(event.pointerId);
    removeObjectPaint(event);
  };
  mask.onpointermove = removeObjectPaint;
  mask.onpointerup = mask.onpointercancel = function () {
    removeObjectPainting = false;
    removeObjectLastPoint = null;
  };
  removeObjectEl('remove-object-clear').onclick = function () {
    mask.getContext('2d').clearRect(0, 0, mask.width, mask.height);
  };
  removeObjectEl('remove-object-cancel').onclick = closeRemoveObjectModal;
  removeObjectEl('remove-object-close').onclick = closeRemoveObjectModal;
  removeObjectEl('remove-object-apply').onclick = function () {
    if (removeObjectBusy || !removeObjectTarget || !mask.width) return;
    var ctx = mask.getContext('2d');
    var alpha = ctx.getImageData(0, 0, mask.width, mask.height).data;
    var filled = false;
    for (var i = 3; i < alpha.length; i += 4) {
      if (alpha[i]) { filled = true; break; }
    }
    if (!filled) { removeObjectStatus('Paint a mask first.', true); return; }
    // Any nonzero mask value is selected by OpenCV; the visible pink strokes stay visible over white fabric.
    var binary = document.createElement('canvas');
    binary.width = mask.width;
    binary.height = mask.height;
    var binaryCtx = binary.getContext('2d');
    binaryCtx.fillStyle = '#000';
    binaryCtx.fillRect(0, 0, binary.width, binary.height);
    binaryCtx.drawImage(mask, 0, 0);
    var target = removeObjectTarget;
    removeObjectBusy = true;
    removeObjectEl('remove-object-apply').disabled = true;
    removeObjectStatus('Removing object...');
    fetch('/media/inpaint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: target.folder, fileName: target.fileName,
        maskDataUrl: binary.toDataURL('image/png') })
    }).then(function (resp) {
      return resp.json().then(function (data) {
        if (!resp.ok || !data.ok) throw new Error(data.error || 'Remove Object failed (' + resp.status + ')');
        return data;
      });
    }).then(function () {
      removeObjectBusy = false;
      removeObjectEl('remove-object-apply').disabled = false;
      closeRemoveObjectModal();
      setStatus('Object removed: ' + target.fileName);
      markMediaMutated(target.key, 'best_effort');
      bumpMediaCacheBustToken(target.key);
      saveFolderStateForCurrentRoot();
      refreshMediaResolutionCache();
      if (state.folder === target.folder) {
        var current = state.items.find(function (item) { return item.fileName === target.fileName; });
        if (current) selectPathMedia(current).catch(function (err) { reportConsoleError('Remove Object refresh', err); });
      }
    }).catch(function (err) {
      removeObjectStatus(String(err && err.message ? err.message : err), true);
      reportConsoleError('Remove Object', err);
      setStatus('Remove Object failed: ' + String(err && err.message ? err.message : err));
      removeObjectBusy = false;
      removeObjectEl('remove-object-apply').disabled = false;
    });
  };
}
document.addEventListener('keydown', function (event) {
  var modal = removeObjectEl('remove-object-modal');
  if (event.key === 'Escape' && modal && !modal.classList.contains('hidden') && !removeObjectBusy) {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeRemoveObjectModal();
  }
}, true);
