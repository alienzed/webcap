// caption_ops.js
// Minimal caption file operations (load/save)

(function(global) {
  function captionCacheKey(state, mediaItem) {
    if (mediaItem.kind === 'picker') {
      var dirNames = state.dirStack.map(function(handle) { return handle.name; }).join('/');
      return 'picker:' + dirNames + ':' + mediaItem.fileName;
    }
    return 'path:' + (state.folder || '') + ':' + mediaItem.fileName;
  }

  async function readPickerCaption(mediaItem) {
    var captionName = mediaItem.fileName.replace(/\.[^.]+$/, '.txt');
    try {
      var captionHandle = await mediaItem.dirHandle.getFileHandle(captionName);
      var file = await captionHandle.getFile();
      return { text: await file.text(), exists: true };
    } catch (err) {
      return { text: '', exists: false };
    }
  }

  function loadCaptionTextForItem(state, mediaItem) {
    var key = captionCacheKey(state, mediaItem);
    if (Object.prototype.hasOwnProperty.call(state.captionCache, key)) {
      return Promise.resolve(state.captionCache[key]);
    }
    if (mediaItem.kind === 'picker') {
      return readPickerCaption(mediaItem).then(function(result) {
        state.captionCache[key] = result.text || '';
        return state.captionCache[key];
      });
    }
    return new Promise(function(resolve) {
      HttpModule.get('/caption/load?folder=' + encodeURIComponent(state.folder) + '&media=' + encodeURIComponent(mediaItem.fileName), function(status, responseText) {
        if (status !== 200) {
          state.captionCache[key] = '';
          resolve('');
          return;
        }
        try {
          var data = JSON.parse(responseText);
          state.captionCache[key] = data.caption || '';
          resolve(state.captionCache[key]);
        } catch (e) {
          state.captionCache[key] = '';
          resolve('');
        }
      });
    });
  }

  function savePathCaption(ui, state, mediaItem, text) {
    return new Promise(function(resolve, reject) {
      HttpModule.postJson('/caption/save', { folder: state.folder, media: mediaItem.fileName, text: text }, function(status, responseText) {
        if (status === 200) {
          if (ui && ui.statusEl) {
            ui.statusEl.textContent = 'Saved: ' + mediaItem.fileName.replace(/\.[^.]+$/, '.txt');
          }
          resolve();
          return;
        }
        reject(new Error(CaptionUtils.getErrorMessage(responseText, 'Could not save caption')));
      });
    });
  }

  global.CaptionOps = {
    captionCacheKey: captionCacheKey,
    readPickerCaption: readPickerCaption,
    loadCaptionTextForItem: loadCaptionTextForItem,
    savePathCaption: savePathCaption
  };
})(window);