function mediaGridCreateViewerModal() {
  if (!document.getElementById('media-grid-viewer-modal')) {
    throw new Error('Media Grid viewer shell is missing from tool.html.');
  }
  var els = mediaGridGetViewerEls();
  if (!els.viewerModal || !els.viewerCloseBtn) throw new Error('Media Grid viewer is missing.');
  if (els.viewerModal.__wired) return;
  els.viewerModal.__wired = true;
  els.viewerCloseBtn.onclick = closeMediaGridViewer;
  els.viewerModal.addEventListener('click', function (e) {
    if (e.target === els.viewerModal) closeMediaGridViewer();
  });
}


function mediaGridBuildViewerTitleParts(mediaItem) {
  var fileName = String((mediaItem && mediaItem.fileName) || (mediaItem && mediaItem.label) || '').trim();
  var caption = String((mediaItem && mediaItem.caption) || '')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    fileName: fileName,
    caption: caption
  };
}

function openMediaGridViewer(mediaKey) {
  var item = mediaGridFindItemByKey(mediaKey);
  if (!item) {
    mediaGridSetStatus('Item is no longer visible in Grid.');
    return;
  }
  var els = mediaGridGetViewerEls();
  if (!els.viewerModal || !els.viewerStage || !els.viewerTitle || !els.viewerTitleName || !els.viewerTitleCaption) throw new Error('Media Grid viewer is missing.');
  mediaGridState.viewerKey = item.key;
  var titleParts = mediaGridBuildViewerTitleParts(item);
  els.viewerTitleName.textContent = titleParts.fileName;
  els.viewerTitleCaption.textContent = titleParts.caption ? '| ' + titleParts.caption : '';
  els.viewerTitleCaption.classList.toggle('hidden', !titleParts.caption);
  els.viewerTitle.title = String((item && item.fileName) || '');
  els.viewerStage.innerHTML = '';
  els.viewerStage.ondblclick = function (e) {
    e.preventDefault();
    e.stopPropagation();
    closeMediaGridViewer();
  };

  var url = mediaGridMediaUrl(item);
  if (mediaGridIsVideoFile(item.fileName)) {
    var video = document.createElement('video');
    video.className = 'media-grid-viewer-media';
    video.controls = true;
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = url;
    els.viewerStage.appendChild(video);
    var playPromise = video.play();
    if (playPromise && playPromise.catch) playPromise.catch(function () {});
  } else {
    var img = document.createElement('img');
    img.className = 'media-grid-viewer-media';
    img.loading = 'eager';
    img.src = url;
    img.alt = item.label || item.fileName;
    els.viewerStage.appendChild(img);
  }

  els.viewerModal.classList.remove('hidden');
  els.viewerModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('media-grid-viewer-open');
}

function closeMediaGridViewer() {
  var els = mediaGridGetViewerEls();
  if (!els.viewerModal || !els.viewerStage) return;
  els.viewerModal.classList.add('hidden');
  els.viewerModal.setAttribute('aria-hidden', 'true');
  els.viewerStage.innerHTML = '';
  document.body.classList.remove('media-grid-viewer-open');
  mediaGridState.viewerKey = '';
}
