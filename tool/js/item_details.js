// Per-item tags and resolution cache
var captionItemTagsByMedia = {};
var mediaResolutionByFile = {};
var mediaMetadataByFile = {};
var debouncedItemTagsSave = debounceCreate(300);
var debouncedItemRatingSave = debounceCreate(250);

function normalizeItemTag(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

function getTagsForMediaKey(mediaKey) {
  var tags = captionItemTagsByMedia[mediaKey];
  return Array.isArray(tags) ? tags.slice() : [];
}

function getResolutionForMedia(fileName) {
  return mediaResolutionByFile[fileName] || '';
}

function normalizeRatingValue(value) {
  var n = Number(value);
  if (!isFinite(n)) return 0;
  var rating = Math.round(n);
  if (rating < 0) rating = 0;
  if (rating > 5) rating = 5;
  return rating;
}

function getRatingForMediaKey(mediaKey) {
  if (!mediaKey || !state || typeof state.ratings !== 'object' || !state.ratings) return 0;
  return normalizeRatingValue(state.ratings[mediaKey]);
}

function saveItemRatingsToFolderState() {
  var snapshot = snapshotFolderStateFromDom();
  writeFolderStateFile(state.folder, snapshot);
}

function setRatingForMediaKey(mediaKey, rating) {
  if (!mediaKey) return;
  if (!state.ratings || typeof state.ratings !== 'object') {
    state.ratings = {};
  }
  var next = normalizeRatingValue(rating);
  if (next <= 0) {
    delete state.ratings[mediaKey];
  } else {
    state.ratings[mediaKey] = next;
  }
  debouncedItemRatingSave(saveItemRatingsToFolderState);
  renderItemMetadataPanel();
  renderFileList();
}

function renderItemMetadataPanel() {
  var listEl = document.getElementById('item-metadata-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!state.currentItem || !state.currentItem.fileName) {
    listEl.textContent = 'Select a media item.';
    return;
  }

  var currentMediaKey = state.currentItem.key || state.currentItem.fileName;
  var currentRating = getRatingForMediaKey(currentMediaKey);
  var starsRow = document.createElement('div');
  starsRow.className = 'item-metadata-stars-row';
  for (var s = 1; s <= 5; s++) {
    (function (value) {
      var starBtn = document.createElement('button');
      starBtn.type = 'button';
      starBtn.className = 'item-metadata-star-btn' + (value <= currentRating ? ' active' : '');
      starBtn.setAttribute('aria-label', 'Set rating to ' + value + ' stars');
      starBtn.title = 'Set rating to ' + value + ' stars';
      starBtn.textContent = value <= currentRating ? '\u2605' : '\u2606';
      starBtn.onclick = function () {
        setRatingForMediaKey(currentMediaKey, value);
      };
      starsRow.appendChild(starBtn);
    })(s);
  }
  listEl.appendChild(starsRow);

  var row = mediaMetadataByFile[state.currentItem.fileName];
  if (!row) {
    var unavailable = document.createElement('div');
    unavailable.textContent = 'Metadata unavailable.';
    listEl.appendChild(unavailable);
    return;
  }
  var fieldOrder = [
    ['resolution', 'Resolution'],
    ['size', 'Size'],
    ['aspect', 'Aspect'],
    ['fps', 'FPS'],
    ['duration', 'Duration'],
    ['frames', 'Frames'],
    ['codec', 'Codec'],
    // ['bitrate', 'Bitrate'],
    // ['color', 'Color'],
  ];
  var hasAny = false;
  for (var i = 0; i < fieldOrder.length; i++) {
    var key = fieldOrder[i][0];
    var label = fieldOrder[i][1];
    var value = row[key];
    if (value === undefined || value === null) continue;
    var text = String(value).trim();
    if (!text || text === '-') continue;
    hasAny = true;
    var itemRow = document.createElement('div');
    itemRow.className = 'item-metadata-row';
    var labelEl = document.createElement('strong');
    labelEl.textContent = label;
    var valueEl = document.createElement('span');
    valueEl.textContent = text;
    if (key === 'aspect' && typeof hasSupportedAspectBucket === 'function' && !hasSupportedAspectBucket(text)) {
      valueEl.classList.add('item-metadata-value-error');
      valueEl.title = 'Aspect ratio is outside supported buckets (square, 4:3, 16:9, 9:16).';
    }
    itemRow.appendChild(labelEl);
    itemRow.appendChild(valueEl);
    listEl.appendChild(itemRow);
  }
  if (!hasAny) {
    var unavailable2 = document.createElement('div');
    unavailable2.textContent = 'Metadata unavailable.';
    listEl.appendChild(unavailable2);
  }
}

function saveItemTagsToFolderState() {
  var snapshot = snapshotFolderStateFromDom();
  snapshot.caption_tags_by_media = JSON.parse(JSON.stringify(captionItemTagsByMedia || {}));
  writeFolderStateFile(state.folder, snapshot);
}

function loadItemTagsFromFolderState(folderState) {
  var source = (folderState && typeof folderState.caption_tags_by_media === 'object' && folderState.caption_tags_by_media) || {};
  var next = {};
  Object.keys(source).forEach(function (mediaKey) {
    var list = Array.isArray(source[mediaKey]) ? source[mediaKey] : [];
    var seen = {};
    var clean = [];
    list.forEach(function (raw) {
      var tag = normalizeItemTag(raw);
      if (!tag) return;
      var low = tag.toLowerCase();
      if (seen[low]) return;
      seen[low] = true;
      clean.push(tag);
    });
    if (clean.length) {
      next[mediaKey] = clean;
    }
  });
  captionItemTagsByMedia = next;
  renderItemTagsPanel();
}

function renderItemTagsPanel() {
  var listEl = document.getElementById('item-tags-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!state.currentItem || !state.currentItem.key) {
    listEl.textContent = 'Select a media item.';
    return;
  }
  var key = state.currentItem.key;
  var tags = getTagsForMediaKey(key);
  if (!tags.length) {
    listEl.textContent = 'No tags.';
    return;
  }
  tags.forEach(function (tag, idx) {
    var row = document.createElement('div');
    row.className = 'row-inline';

    var tagBtn = document.createElement('button');
    tagBtn.type = 'button';
    tagBtn.className = 'phrase-copy-item-btn';
    tagBtn.textContent = tag;
    tagBtn.onclick = function () {
      ui.filterEl.value = tag;
      ui.filterEl.dispatchEvent(new Event('input', { bubbles: true }));
      setStatus('Filter applied from tag: ' + tag);
    };

    var rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.textContent = 'x';
    rmBtn.onclick = function () {
      var current = getTagsForMediaKey(key);
      current.splice(idx, 1);
      if (current.length) captionItemTagsByMedia[key] = current;
      else delete captionItemTagsByMedia[key];
      saveItemTagsToFolderState();
      renderItemTagsPanel();
      renderFileList();
    };

    row.appendChild(tagBtn);
    row.appendChild(rmBtn);
    listEl.appendChild(row);
  });
}

function refreshMediaResolutionCache() {
  if (!state.folder || !Array.isArray(state.items) || !state.items.length) {
    mediaResolutionByFile = {};
    mediaMetadataByFile = {};
    return;
  }
  var requestFolder = state.folder;
  setStatus('Generating metadata...');
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/fs/media_metadata?folder=' + encodeURIComponent(requestFolder));
  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) return;
    if (state.folder !== requestFolder) return;
    if (xhr.status !== 200) {
      mediaResolutionByFile = {};
      mediaMetadataByFile = {};
      setStatus('Metadata failed (' + xhr.status + ').');
      return;
    }
    try {
      var rows = JSON.parse(xhr.responseText);
      var next = {};
      var nextMeta = {};
      (rows || []).forEach(function (row) {
        if (!row || !row.file) return;
        nextMeta[row.file] = row;
        if (row && row.file && row.resolution && row.resolution !== '-') {
          next[row.file] = String(row.resolution);
        }
      });
      mediaResolutionByFile = next;
      mediaMetadataByFile = nextMeta;
      if (state.currentItem && typeof buildSelectedMediaStatus === 'function') {
        setStatus(buildSelectedMediaStatus(state.currentItem));
        renderItemMetadataPanel();
        return;
      }
    } catch (e) {
      mediaResolutionByFile = {};
      mediaMetadataByFile = {};
      setStatus('Metadata parse failed.');
    }
  };
  xhr.send();
}

function wireItemDetailsUi() {
  var addInput = document.getElementById('item-tag-add-input');
  var addBtn = document.getElementById('item-tag-add-btn');
  if (!addInput || !addBtn || addBtn.__itemTagsBound) return;
  addBtn.__itemTagsBound = true;

  function addTag() {
    if (!state.currentItem || !state.currentItem.key) {
      setStatus('Select a media item to add tags.');
      return;
    }
    var tag = normalizeItemTag(addInput.value);
    if (!tag) return;
    var key = state.currentItem.key;
    var current = getTagsForMediaKey(key);
    var low = tag.toLowerCase();
    var exists = current.some(function (t) { return String(t).toLowerCase() === low; });
    if (exists) {
      addInput.value = '';
      return;
    }
    current.push(tag);
    captionItemTagsByMedia[key] = current;
    addInput.value = '';
    debouncedItemTagsSave(saveItemTagsToFolderState);
    renderItemTagsPanel();
    renderFileList();
  }

  addBtn.onclick = addTag;
  addInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    }
  });
}
