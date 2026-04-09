(function() {
  function startPageMode(context) {
    var ui = context.ui;

    ui.createBtn.style.display = '';
    ui.createBtn.textContent = 'Create';
    ui.newPageNameEl.readOnly = false;
    ui.newPageNameEl.classList.remove('caption-folder-label');
    ui.newPageNameEl.placeholder = 'new page name';
    ui.topInputRow.classList.remove('single');
    ui.openPageBtn.textContent = 'Open Page';
    ui.captionUpBtn.style.display = 'none';
    ui.dropZone.style.display = '';
    ui.editorEl.spellcheck = false;

    EditorModule.init({
      editor: ui.editorEl,
      preview: ui.previewEl,
      onDebouncedSave: function() {
        PagesModule.saveCurrentPage();
      }
    });

    PagesModule.init({
      pageListEl: ui.pageListEl,
      filterEl: ui.filterEl,
      statusEl: ui.statusEl,
      editorApi: EditorModule
    });

    MediaModule.init({
      dropZone: ui.dropZone,
      pagesApi: PagesModule,
      editorApi: EditorModule
    });

    ui.createBtn.addEventListener('click', function() {
      PagesModule.createPage(ui.newPageNameEl.value, function(ok) {
        if (ok) {
          ui.newPageNameEl.value = '';
        }
      });
    });

    ui.newPageNameEl.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        ui.createBtn.click();
      }
    });

    ui.openPageBtn.onclick = function() {
      openCurrentPage();
    };

    PagesModule.refreshPages(function() {
      PagesModule.setStatus('Ready');
    });
  }

  ModeRouterModule.registerMode('page', startPageMode);
})();
