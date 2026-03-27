window.addEventListener('DOMContentLoaded', function() {
  var editorEl = document.getElementById('editor');
  var previewEl = document.getElementById('preview');
  var pageListEl = document.getElementById('page-list');
  var filterEl = document.getElementById('page-filter');
  var statusEl = document.getElementById('status');
  var dropZone = document.getElementById('drop-zone');
  var createBtn = document.getElementById('create-page-btn');
  var newPageNameEl = document.getElementById('new-page-name');

  EditorModule.init({
    editor: editorEl,
    preview: previewEl,
    onDebouncedSave: function() {
      PagesModule.saveCurrentPage();
    }
  });

  PagesModule.init({
    pageListEl: pageListEl,
    filterEl: filterEl,
    statusEl: statusEl,
    editorApi: EditorModule
  });

  MediaModule.init({
    dropZone: dropZone,
    pagesApi: PagesModule,
    editorApi: EditorModule
  });

  createBtn.addEventListener('click', function() {
    PagesModule.createPage(newPageNameEl.value, function(ok) {
      if (ok) {
        newPageNameEl.value = '';
      }
    });
  });

  newPageNameEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      createBtn.click();
    }
  });

  PagesModule.refreshPages(function() {
    PagesModule.setStatus('Ready');
  });
});
document.getElementById("open-page-btn").onclick = function() {
  openCurrentPage();
};