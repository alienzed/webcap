function wireAllUi() {
  // Refresh button
  if (ui.refreshBtn) {
    ui.refreshBtn.onclick = function() {
      refreshCurrentDirectory();
    };
  }

  // Review Captions button
  if (ui.reviewBtn) {
    ui.reviewBtn.onclick = function() {
      runReview();
    };
  }

  // Up One Directory button
  var upRow = document.getElementById('up-one-directory-row');
  if (upRow) {
    upRow.onclick = function () {
      navigateUp();
    };
  }

  // Media List click handler
  var mediaListEl = document.getElementById('media-list');
  if (mediaListEl) {
    mediaListEl.onclick = function(e) {
      var row = e.target.closest('.media-item');
      if (!row) return;
      var type = row.getAttribute('data-type');
      var key = row.getAttribute('data-key');
      if (type === 'up') {
        navigateUp();
      } else if (type === 'folder') {
        state.folder = (state.folder ? state.folder + '/' : '') + key;
        if (state.dirStack.length) {
          state.dirStack.push({ name: key });
        }
        state.currentItem = null;
        clearEditorAndPreview();
        refreshCurrentDirectory();
      } else if (type === 'media') {
        var mediaItem = state.items.find(function (item) { return item.key === key; });
        if (!mediaItem) return;
        if (state.currentItem && state.currentItem.key === mediaItem.key) return;
        if (state.currentItem && state.currentItem.fileName) {
          savePathCaption().then(function () {
            selectPathMedia(mediaItem);
          }).catch(function (err) {
            setStatus(String(err && err.message ? err.message : err));
          });
        } else {
          selectPathMedia(mediaItem);
        }
      }
    };
  }

  // Focus Set Exit button
  var focusSetExitBtn = document.getElementById('focus-set-exit-btn');
  if (focusSetExitBtn) {
    focusSetExitBtn.onclick = function () {
      state.focusSet = null;
      if (ui.editorEl) ui.editorEl.removeAttribute('readonly');
      clearEditorAndPreview();
      refreshCurrentDirectory();
      focusSetExitBtn.style.display = 'none';
    };
  }

  // Stats Run button
  var statsRunBtn = document.getElementById('stats-run-btn');
  if (statsRunBtn) {
    statsRunBtn.onclick = function () {
      if (typeof runReview === 'function') runReview();
    };
  }
}

addEventListener('DOMContentLoaded', function() {
  console.log('[webcap] initializing');
  refreshCurrentDirectory();
  wireAllUi();
});