(function() {
  function startPageMode(context) {
    var ui = context.ui;

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
