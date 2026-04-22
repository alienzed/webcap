
async function renderFileList() {
    debugLog('[renderFileList] called. state.items:', state.items, 'state.childFolders:', state.childFolders, 'filterText:', ui.filterEl.value);
    var q = (ui.filterEl.value || '').toLowerCase();
    var renderSeq = ++state.listRenderSeq;
    ui.mediaListEl.innerHTML = '';
    var mediaItems = state.items;
    // No longer recompute hasCaption; rely on backend-provided property only.
    if (state.focusSet && state.focusSet.keys && state.focusSet.keys.length) {
        var allow = {};
        state.focusSet.keys.forEach(function (key) {
            allow[key] = true;
        });
        mediaItems = state.items.filter(function (item) {
            return !!allow[item.key];
        });
    }
    // Show count of matching media items using static global reference (fail loudly if missing)
    ui.captionFilterCount.textContent = mediaItems.length + (mediaItems.length === 1 ? ' item matches the filter' : ' items match the filter');


    var matchCount = 0;

    // Modern color palette for flags
    var FLAG_COLOR_MAP = {
        green: '#43aa8b',   // teal green
        yellow: '#ffd166',  // soft gold
        orange: '#f8961e',  // warm orange
        red: '#f94144'      // soft red
    };
    for (var i = 0; i < state.childFolders.length; ++i) {
        var folderItem = state.childFolders[i];
        var flagColor = state.flags && state.flags[folderItem.name];
        var colorDot = '';
        if (flagColor) {
            var mappedColor = FLAG_COLOR_MAP[flagColor] || flagColor;
            var dotStyle = 'display:inline-block;width:12px;height:12px;border-radius:50%;background:' + mappedColor + ';margin-left:8px;';
            colorDot = '<span style="' + dotStyle + '"></span>';
        }
        var label = '🗀 ' + folderItem.name;
        var row = document.createElement('div');
        row.className = 'media-item folder-item';
        row.setAttribute('data-type', 'folder');
        row.setAttribute('data-key', folderItem.name);
        row.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;width:100%"><span>' + label + '</span>' + colorDot + '</div>';
        ui.mediaListEl.appendChild(row);
        matchCount++;
    }

    // Render media items
    mediaItems.forEach(function (mediaItem) {
        var isActive = state.currentItem && state.currentItem.key === mediaItem.key;
        var reviewed = state.reviewedSet.has(mediaItem.key);
        var className = 'media-item';
        if (isActive) className += ' active';
        if (reviewed) className += ' reviewed';
        if (!mediaItem.hasCaption) className += ' empty-caption';
        var icon = '';
        var ext = '';
        if (mediaItem.fileName) {
            var dot = mediaItem.fileName.lastIndexOf('.');
            if (dot !== -1) ext = mediaItem.fileName.slice(dot).toLowerCase();
        }
        if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].indexOf(ext) !== -1) {
            icon = '🖼️';
        } else if ([".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"].indexOf(ext) !== -1) {
            icon = '🎬';
        } else if ([".ogg"].indexOf(ext) !== -1) {
            icon = '🎵';
        } else {
            icon = '📄';
        }
        var flagColor = state.flags && state.flags[mediaItem.key];
        var colorDot = '';
        if (flagColor) {
            var mappedColor = FLAG_COLOR_MAP[flagColor] || flagColor;
            var dotStyle = 'display:inline-block;width:12px;height:12px;border-radius:50%;background:' + mappedColor + ';margin-left:8px;';
            colorDot = '<span style="' + dotStyle + '"></span>';
        }
        var displayText = mediaItem.label;
        var row = document.createElement('div');
        row.className = className;
        row.setAttribute('data-type', 'media');
        row.setAttribute('data-key', mediaItem.key);
        row.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;width:100%">' + icon + '&nbsp;' + escapeHtml(displayText) + colorDot + '</div>';
        ui.mediaListEl.appendChild(row);
        matchCount++;
    });
}