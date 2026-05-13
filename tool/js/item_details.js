// Per-item tags and resolution cache
var captionItemTagsByMedia = {};
var mediaResolutionByFile = {};
var mediaMetadataByFile = {};
var debouncedItemTagsSave = debounceCreate(300);

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

function renderItemMetadataPanel() {
  var listEl = document.getElementById('item-metadata-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!state.currentItem || !state.currentItem.fileName) {
    listEl.textContent = 'Select a media item.';
    return;
  }
  var row = mediaMetadataByFile[state.currentItem.fileName];
  if (!row) {
    listEl.textContent = 'Metadata unavailable.';
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
    ['bitrate', 'Bitrate'],
    ['color', 'Color'],
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
    itemRow.appendChild(labelEl);
    itemRow.appendChild(valueEl);
    listEl.appendChild(itemRow);
  }
  if (!hasAny) {
    listEl.textContent = 'Metadata unavailable.';
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
  if (!state.folder) {
    mediaResolutionByFile = {};
    mediaMetadataByFile = {};
    return;
  }
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/fs/media_metadata?folder=' + encodeURIComponent(state.folder));
  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) return;
    if (xhr.status !== 200) {
      mediaResolutionByFile = {};
      mediaMetadataByFile = {};
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
      }
    } catch (e) {
      mediaResolutionByFile = {};
      mediaMetadataByFile = {};
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
