// caption_state.js
// Minimal state management for caption mode

(function(global) {
  var state = {
    folder: '',
    suppressInput: false,
    items: [],
    childFolders: [],
    currentItem: null,
    objectUrl: '',
    mode: 'path',
    dirStack: [],
    reviewMode: false,
    captionCache: {},
    listRenderSeq: 0,
    reviewedSet: new Set()
  };
  global.CaptionState = state;
})(window);