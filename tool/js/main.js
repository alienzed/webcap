window.addEventListener('DOMContentLoaded', function() {
  var modeSwitchBtn = document.getElementById('mode-switch-btn');
  var ui = {
    editorEl: document.getElementById('editor'),
    previewEl: document.getElementById('preview'),
    pageListEl: document.getElementById('page-list'),
    filterEl: document.getElementById('page-filter'),
    statusEl: document.getElementById('status'),
    dropZone: document.getElementById('drop-zone'),
    createBtn: document.getElementById('create-page-btn'),
    newPageNameEl: document.getElementById('new-page-name'),
    openPageBtn: document.getElementById('open-page-btn'),
    captionUpBtn: document.getElementById('caption-up-btn'),
    reviewBtn: document.getElementById('review-captions-btn'),
    topInputRow: document.getElementById('new-page-name').parentElement
  };

  var params = new URLSearchParams(window.location.search);
  var requestedMode = params.get('mode') || 'page';
  var mode = ModeRouterModule.hasMode(requestedMode) ? requestedMode : 'page';
  var modeOrder = ['page', 'caption', 'stats'];
  var modeLabels = {
    page: 'Page Mode',
    caption: 'Caption Mode',
    stats: 'Stats Mode'
  };
  var modeIdx = modeOrder.indexOf(mode);
  var nextMode = modeOrder[(modeIdx + 1) % modeOrder.length];

  modeSwitchBtn.textContent = modeLabels[nextMode] || 'Page Mode';
  modeSwitchBtn.onclick = function() {
    var nextParams = new URLSearchParams(window.location.search);
    nextParams.set('mode', nextMode);
    window.location.search = nextParams.toString();
  };

  ModeRouterModule.startMode(mode, {
    ui: ui
  });
});