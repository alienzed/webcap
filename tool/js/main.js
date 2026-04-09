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
    openPageBtn: document.getElementById('open-page-btn')
  };

  var params = new URLSearchParams(window.location.search);
  var requestedMode = params.get('mode') || 'page';
  var mode = ModeRouterModule.hasMode(requestedMode) ? requestedMode : 'page';
  var nextMode = mode === 'caption' ? 'page' : 'caption';

  modeSwitchBtn.textContent = nextMode === 'caption' ? 'Caption Mode' : 'Page Mode';
  modeSwitchBtn.onclick = function() {
    var nextParams = new URLSearchParams(window.location.search);
    nextParams.set('mode', nextMode);
    window.location.search = nextParams.toString();
  };

  ModeRouterModule.startMode(mode, {
    ui: ui
  });
});