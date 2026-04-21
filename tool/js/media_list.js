var mediaListEl = document.getElementById('media-list');
addEventListener('DOMContentLoaded', function () {
    var upRow = document.getElementById('up-one-directory-row');
    if (upRow) {
        upRow.onclick = function () {
            navigateUp();
        };
    }
    var currentRow = document.getElementById('current-folder-row');
    if (currentRow) {
        currentRow.oncontextmenu = function (e) {
            e.preventDefault();
            var actions = [{
                label: 'Run Autoset',
                run: function () {
                    setStatus('Running autoset...');
                    streamPreviewFromFetch(
                        '/fs/autoset_run',
                        { folder: state.folder },
                        ui,
                        function () {
                            setStatus('Autoset finished.');
                        },
                        function (err) {
                            setStatus('Autoset failed: ' + err);
                        }
                    );
                }
            }];
            showContextMenu(e.clientX, e.clientY, actions);
        };
    }
    // Delegated event handlers
    mediaListEl.onclick = function (e) {
        var row = e.target.closest('.media-item');
        if (!row) return;
        var type = row.getAttribute('data-type');
        var key = row.getAttribute('data-key');
        if (type === 'up') {
            navigateUp(state);
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
    mediaListEl.ondblclick = function (e) {
        var row = e.target.closest('.media-item');
        if (!row) return;
        var type = row.getAttribute('data-type');
        var key = row.getAttribute('data-key');
        if (type === 'media') {
            var mediaItem = state.items.find(function (item) { return item.key === key; });
            if (!mediaItem) return;
            if (state.reviewedSet.has(mediaItem.key)) {
                state.reviewedSet.delete(mediaItem.key);
                row.classList.remove('reviewed');
            } else {
                state.reviewedSet.add(mediaItem.key);
                row.classList.add('reviewed');
            }
            onReviewedSetChanged();
        }
    };
    mediaListEl.oncontextmenu = function (e) {
        var row = e.target.closest('.media-item');
        if (!row) return;
        var type = row.getAttribute('data-type');
        var key = row.getAttribute('data-key');
        e.preventDefault();
        if (type === 'folder') {
            var actions = [
                {
                    label: 'Deface',
                    run: function () {
                        setStatus('Defacing all videos...');
                        var folderPath = (state.folder ? state.folder + '/' : '') + key;
                        var previewFrame = ui.previewEl;
                        if (previewFrame && previewFrame.contentDocument) {
                            var doc = previewFrame.contentDocument;
                            doc.open();
                            doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;"></body></html>');
                            doc.close();
                        }
                        streamPreviewFromFetch(
                            '/fs/deface',
                            { folder: folderPath },
                            ui,
                            function () {
                                setStatus('Defacing finished.');
                                refreshCurrentDirectory();
                            },
                            function (err) {
                                setStatus('Defacing failed: ' + err);
                            }
                        );
                    }
                },
                {
                    label: 'Flag',
                    render: function(container) {
                        // Render a single row of small colored circles for flags
                        var flagColors = [
                            {name: 'Red', color: 'red'},
                            {name: 'Green', color: 'green'},
                            {name: 'Yellow', color: 'yellow'},
                            {name: 'Orange', color: 'orange'}
                        ];
                        var row = document.createElement('div');
                        row.className = 'flag-row';
                        flagColors.forEach(function(flag) {
                            var btn = document.createElement('button');
                            btn.title = flag.name;
                            btn.style.background = flag.color;
                            btn.style.border = '1px solid #bbb';
                            btn.style.width = '14px';
                            btn.style.height = '14px';
                            btn.style.borderRadius = '50%';
                            btn.style.cursor = 'pointer';
                            btn.style.outline = 'none';
                            btn.style.padding = '0';
                            btn.style.margin = '0';
                            btn.onclick = function(e) {
                                e.stopPropagation();
                                markFlag(key, flag.color);
                                hideContextMenu();
                            };
                            row.appendChild(btn);
                        });
                        // Clear button (small gray circle with ×)
                        var clearBtn = document.createElement('button');
                        clearBtn.title = 'Clear Flag';
                        clearBtn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#eee;border:1px solid #bbb;line-height:12px;text-align:center;font-size:12px;color:#666;">×</span>';
                        clearBtn.style.background = 'none';
                        clearBtn.style.border = 'none';
                        clearBtn.style.padding = '0';
                        clearBtn.style.margin = '0';
                        clearBtn.style.cursor = 'pointer';
                        clearBtn.style.outline = 'none';
                        clearBtn.onclick = function(e) {
                            e.stopPropagation();
                            markFlag(key, null);
                            hideContextMenu();
                        };
                        row.appendChild(clearBtn);
                        container.appendChild(row);
                    }
                },
                {
                    label: 'Rename Folder',
                    run: function () {
                        var oldName = key;
                        var newName = prompt('Rename folder', oldName);
                        if (newName === null) return;
                        newName = String(newName || '').trim();
                        if (!newName || newName === oldName || newName === '.' || newName === '..' || /[\\/]/.test(newName)) {
                            setStatus('Invalid folder name');
                            return;
                        }
                        // Compute parent path (without trailing slash, never including the folder itself)
                        var parentPath = state.folder ? state.folder.replace(/\/+$/, '') : '';
                        // If in root, parentPath is ''
                        fetch('/fs/rename', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                folder: parentPath,
                                old_name: oldName,
                                new_name: newName
                            })
                        })
                        .then(function (resp) { return resp.json().then(function (data) { return { status: resp.status, data: data }; }); })
                        .then(function (res) {
                            if (res.status === 200 && res.data && !res.data.error) {
                                setStatus('Renamed folder: ' + oldName + ' -> ' + newName);
                                refreshCurrentDirectory();
                            } else {
                                setStatus((res.data && res.data.error) ? res.data.error : 'Rename failed');
                            }
                        })
                        .catch(function (err) {
                            setStatus('Rename failed: ' + err);
                        });
                    }
                },
                {
                    label: 'Duplicate Folder',
                    run: function () {
                        setStatus('Duplicating folder...');
                        var folderPath = (state.folder ? state.folder + '/' : '') + key;
                        fetch('/fs/duplicate_folder', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ src: folderPath })
                        })
                            .then(function (resp) { return resp.json().then(function (data) { return { status: resp.status, data: data }; }); })
                            .then(function (res) {
                                if (res.status === 200 && res.data && res.data.success) {
                                    setStatus('Duplicated folder: ' + key);
                                    refreshCurrentDirectory();
                                } else {
                                    setStatus((res.data && res.data.error) ? res.data.error : 'Duplicate failed');
                                }
                            })
                            .catch(function (err) {
                                setStatus('Duplicate failed: ' + err);
                            });
                    }
                }
            ];
            showContextMenu(e.clientX, e.clientY, actions);
        } else if (type === 'media') {
            var mediaItem = state.items.find(function (item) { return item.key === key; });
            if (!mediaItem) return;
            var actions = [];
            var isInOriginals = (state.folder && state.folder.split(/[\/]/).pop() === 'originals');
            var fileName = mediaItem.fileName;
            // Add flagging for files
            actions.push({
                label: 'Flag',
                render: function(container) {
                    var flagColors = [
                        {name: 'Red', color: 'red'},
                        {name: 'Green', color: 'green'},
                        {name: 'Yellow', color: 'yellow'},
                        {name: 'Orange', color: 'orange'}
                    ];
                    var row = document.createElement('div');
                    row.className = 'flag-row';
                    flagColors.forEach(function(flag) {
                        var btn = document.createElement('button');
                        btn.title = flag.name;
                        btn.style.background = flag.color;
                        btn.style.border = '1px solid #bbb';
                        btn.style.width = '14px';
                        btn.style.height = '14px';
                        btn.style.borderRadius = '50%';
                        btn.style.cursor = 'pointer';
                        btn.style.outline = 'none';
                        btn.style.padding = '0';
                        btn.style.margin = '0';
                        btn.onclick = function(e) {
                            e.stopPropagation();
                            markFlag(key, flag.color);
                            hideContextMenu();
                        };
                        row.appendChild(btn);
                    });
                    // Clear button (small gray circle with ×)
                    var clearBtn = document.createElement('button');
                    clearBtn.title = 'Clear Flag';
                    clearBtn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#eee;border:1px solid #bbb;line-height:12px;text-align:center;font-size:12px;color:#666;">×</span>';
                    clearBtn.style.background = 'none';
                    clearBtn.style.border = 'none';
                    clearBtn.style.padding = '0';
                    clearBtn.style.margin = '0';
                    clearBtn.style.cursor = 'pointer';
                    clearBtn.style.outline = 'none';
                    clearBtn.onclick = function(e) {
                        e.stopPropagation();
                        markFlag(key, null);
                        hideContextMenu();
                    };
                    row.appendChild(clearBtn);
                    container.appendChild(row);
                }
            });
            if (isInOriginals) {
                actions.push({
                    label: 'Restore',
                    run: function () {
                        restoreMedia(mediaItem).catch(function (err) {
                            setStatus(String(err && err.message ? err.message : err));
                        });
                    }
                });
            } else {
                actions.push({
                    label: 'Rename',
                    run: function () {
                        promptRenameMedia(mediaItem, ui, state);
                    }
                });
                actions.push({
                    label: 'Prune',
                    run: function () {
                        pruneMedia(mediaItem).catch(function (err) {
                            setStatus(String(err && err.message ? err.message : err));
                        });
                    }
                });
                actions.push({
                    label: 'Reset',
                    run: function () {
                        if (!confirm('Reset this file to the original version? This will overwrite the current file but leave the caption unchanged.')) return;
                        setStatus('Resetting file...');
                        var filePath = (state.folder ? state.folder : '') || '';
                        fetch('/media/reset', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ folder: filePath, fileName: mediaItem.fileName })
                        })
                        .then(function (resp) { return resp.json().then(function (data) { return { status: resp.status, data: data }; }); })
                        .then(function (res) {
                            if (res.status === 200 && res.data && res.data.ok) {
                                setStatus('File reset to original.');
                                refreshCurrentDirectory();
                            } else {
                                setStatus((res.data && res.data.error) ? res.data.error : 'Reset failed');
                            }
                        })
                        .catch(function (err) {
                            setStatus('Reset failed: ' + err);
                        });
                    }
                });
                var ext = (fileName || '').split('.').pop().toLowerCase();
                if (["mp4", "webm", "mov", "mkv", "avi", "m4v"].indexOf(ext) !== -1) {
                    actions.push({
                        label: 'Deface...',
                        run: function () {
                            var defaultThresh = '0.4';
                            var t = prompt('Deface: Enter threshold (-t, 0.0-1.0)', defaultThresh);
                            if (t === null) return;
                            t = String(t).trim();
                            if (!/^0(\.\d+)?|1(\.0+)?$/.test(t)) {
                                setStatus('Invalid threshold');
                                return;
                            }
                            setStatus('Defacing file...');
                            var filePath = (state.folder ? state.folder + '/' : '') + mediaItem.fileName;
                            streamPreviewFromFetch(
                                '/fs/deface',
                                { file: filePath, thresh: t },
                                ui,
                                function () {
                                    setStatus('Defacing finished.');
                                }
                            );
                        }
                    });
                }
            }
            showContextMenu(e.clientX, e.clientY, actions);
        }
    };
});

// Restore onReviewedSetChanged: save reviewed state after toggle
function onReviewedSetChanged() {
    saveFolderStateForCurrentRoot();
}
async function renderFileList() {
    debugLog('[renderFileList] called. state.items:', state.items, 'state.childFolders:', state.childFolders, 'filterText:', ui.filterEl.value);
    var q = (ui.filterEl.value || '').toLowerCase();
    var renderSeq = ++state.listRenderSeq;
    mediaListEl.innerHTML = '';
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

    // Always wire up the static Exit Set button after rendering
    ensureFocusSetExitButton();

    var matchCount = 0;

    for (var i = 0; i < state.childFolders.length; ++i) {
        var folderItem = state.childFolders[i];
        var flagColor = state.flags && state.flags[folderItem.name];
        var colorDot = '';
        if (flagColor) {
            var dotStyle = 'display:inline-block;width:12px;height:12px;border-radius:50%;background:' + flagColor + ';margin-left:8px;';
            colorDot = '<span style="' + dotStyle + '"></span>';
        }
        var label = '🗀 ' + folderItem.name;
        var row = document.createElement('div');
        row.className = 'media-item folder-item';
        row.setAttribute('data-type', 'folder');
        row.setAttribute('data-key', folderItem.name);
        row.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;width:100%"><span>' + label + '</span>' + colorDot + '</div>';
        mediaListEl.appendChild(row);
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
            var dotStyle = 'display:inline-block;width:12px;height:12px;border-radius:50%;background:' + flagColor + ';margin-left:8px;';
            colorDot = '<span style="' + dotStyle + '"></span>';
        }
        var displayText = mediaItem.label;
        var row = document.createElement('div');
        row.className = className;
        row.setAttribute('data-type', 'media');
        row.setAttribute('data-key', mediaItem.key);
        row.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;width:100%">' + icon + '&nbsp;' + escapeHtml(displayText) + colorDot + '</div>';
        mediaListEl.appendChild(row);
        matchCount++;
    });
}