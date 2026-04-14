window.addEventListener('DOMContentLoaded', function() {
  var ui = {
    editorEl: document.getElementById('editor'),
    previewEl: document.getElementById('preview'),
    pageListEl: document.getElementById('page-list'),
    filterEl: document.getElementById('page-filter'),
    statusEl: document.getElementById('status'),
    dropZone: document.getElementById('drop-zone'),
    createBtn: document.getElementById('create-page-btn'),
    openPageBtn: document.getElementById('open-page-btn'),
    captionUpBtn: document.getElementById('caption-up-btn'),
    reviewBtn: document.getElementById('review-captions-btn'),
    autosetBtn: document.getElementById('run-autoset-btn'),
    folderLabelEl: document.getElementById('folder-label'),
    topInputRow: document.getElementById('folder-label').parentElement
  };

  var params = new URLSearchParams(window.location.search);
  var requestedMode = params.get('mode') || 'caption';
  if (requestedMode === 'stats') {
    requestedMode = 'caption';
  }
  var mode = ModeRouterModule.hasMode(requestedMode) ? requestedMode : 'caption';

  ModeRouterModule.startMode(mode, {
    ui: ui
  });
});