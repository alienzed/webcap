window.addEventListener('DOMContentLoaded', function() {
  var ui = {
    editorEl: document.getElementById('editor'),
    previewEl: document.getElementById('preview'),
    pageListEl: document.getElementById('media-list'),
    filterEl: document.getElementById('page-filter'),
    statusEl: document.getElementById('status'),
    dropZone: document.getElementById('drop-zone'),
    refreshBtn: document.getElementById('refresh-btn'),
    reviewBtn: document.getElementById('review-captions-btn')
  };

  window.startCaptionMode({ ui: ui });
});