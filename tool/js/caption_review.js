// caption_review.js
// Review/stats bridge for caption mode.

var CaptionReviewModule = (function() {
  function init(ui, state, deps) {
    //ensureStatsPane(ui);
    //ensureFilterClearButton(ui);
    wireReviewActions(ui, state, deps);
  }
  /*
  function ensureStatsPane(ui) {
    var container = document.getElementById('caption-stats-pane');
    if (!container) {
      container = document.createElement('div');
      container.id = 'caption-stats-pane';
      container.innerHTML = StatsViewModule.buildStatsPanelHtml('Update Review');
      ui.pageListEl.parentNode.insertBefore(container, ui.dropZone);
    }
    var details = document.getElementById('stats-details');
    if (details) {
      details.open = false;
    }
  }
  */

  function wireReviewActions(ui, state, deps) {
    var reviewBtn = document.getElementById('review-captions-btn');
    if (reviewBtn) {
      reviewBtn.onclick = function() {
        runReview(ui, state, deps);
      };
    }

    var runBtn = document.getElementById('stats-run-btn');
    if (runBtn) {
      runBtn.onclick = function() {
        runReview(ui, state, deps);
      };
    }

    window.addEventListener('message', function(event) {
      var data = event.data;
      if (!data) {
        return;
      }
      if (data.type === 'caption-review-select') {
        selectByFileName(ui, state, data.fileName, deps, data.focusFiles, data.focusSource);
        return;
      }
      if (data.type === 'caption-review-token') {
        applyTokenFilter(ui, data.token, deps);
      }
    });
  }

  function runReview(ui, state, deps) {
    if (!state.items.length) {
      deps.setStatus(ui, 'No media files loaded');
      return;
    }

    deps.saveCurrentCaption(ui, state).then(function() {
      if (deps.clearFocusSet) {
        deps.clearFocusSet(ui, state);
      }
      deps.setReviewMode(ui, state, true);
      state.currentItem = null;
      deps.renderFileList(ui, state, ui.filterEl.value);
      var details = document.getElementById('stats-details');
      if (details) {
        details.open = true;
      }

      var runSeq = (state.reviewSeq || 0) + 1;
      state.reviewSeq = runSeq;
      deps.setStatus(ui, 'Building combined captions and stats...');

      var promises = state.items.map(function(item) {
        return CaptionOps.loadCaptionTextForItem(state, item).then(function(text) {
          return {
            fileName: item.fileName,
            caption: text || ''
          };
        });
      });

      return Promise.all(promises).then(function(results) {
        if (state.reviewSeq !== runSeq) {
          return;
        }
        var options = StatsViewModule.getOptionsFromDom();
        var report = StatsEngineModule.compute(results, {
          requiredPhrase: options.requiredPhrase,
          phrases: options.phrases,
          tokenRules: options.tokenRules
        });
        state.suppressInput = true;
        ui.editorEl.value = StatsViewModule.buildCombinedCaptionsText(results);
        state.suppressInput = false;
        StatsViewModule.renderReportPreview(ui, report);
        deps.setStatus(ui, 'Review ready: ' + results.length + ' files');
      });
    }).catch(function(err) {
      deps.setStatus(ui, String(err && err.message ? err.message : err));
    });
  }

  function selectByFileName(ui, state, fileName, deps, focusFiles, focusSource) {
    if (!fileName) {
      return;
    }

    if (deps.activateFocusSet && focusFiles && focusFiles.length) {
      deps.activateFocusSet(ui, state, focusFiles, focusSource || 'Focused Items');
    }

    var target = null;
    for (var i = 0; i < state.items.length; i += 1) {
      if (state.items[i].fileName === fileName) {
        target = state.items[i];
        break;
      }
    }
    if (!target) {
      deps.setStatus(ui, 'File not found in current folder: ' + fileName);
      return;
    }

    if (ui.filterEl.value) {
      ui.filterEl.value = '';
      ui.filterEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    deps.selectMedia(ui, state, target).then(function() {
      scrollToCurrentRow(ui, state);
    }).catch(function(err) {
      deps.setStatus(ui, String(err && err.message ? err.message : err));
    });
  }

  function applyTokenFilter(ui, token, deps) {
    var value = String(token || '').trim();
    ui.filterEl.value = value;
    var ev = new Event('input', { bubbles: true });
    ui.filterEl.dispatchEvent(ev);
    if (value) {
      deps.setStatus(ui, 'Filter applied from token: ' + value);
    }
  }

  function scrollToCurrentRow(ui, state) {
    if (!state.currentItem) {
      return;
    }
    var row = ui.pageListEl.querySelector('.page-item[data-key="' + state.currentItem.key + '"]');
    if (!row || !row.scrollIntoView) {
      return;
    }
    row.scrollIntoView({ block: 'nearest' });
  }

  return {
    init: init
  };
})();