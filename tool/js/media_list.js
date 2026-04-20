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
                    PreviewPane.streamPreviewFromFetch(
                        '/fs/autoset_run',
                        { folder: state.folder },
                        ui,
                        function () {
                            setStatus('Autoset finished.');
                            refreshCurrentDirectory();
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
                    label: 'Autoset',
                    run: function () {
                        setStatus('Running autoset...');
                        var folderPath = (state.folder ? state.folder + '/' : '') + key;
                        var previewFrame = ui.previewEl;
                        if (previewFrame && previewFrame.contentDocument) {
                            var doc = previewFrame.contentDocument;
                            doc.open();
                            doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:13px;background:#222;color:#eee;padding:8px;white-space:pre-wrap;"></body></html>');
                            doc.close();
                        }
                        PreviewPane.streamPreviewFromFetch(
                            '/fs/autoset_run',
                            { folder: folderPath },
                            ui,
                            function () {
                                setStatus('Autoset finished.');
                                refreshCurrentDirectory();
                            },
                            function (err) {
                                setStatus('Autoset failed: ' + err);
                            }
                        );
                    }
                },
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
                            PreviewPane.streamPreviewFromFetch(
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
                        var parent = state.folder || '';
                        fetch('/fs/rename_folder', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ parent: parent, oldName: oldName, newName: newName })
                        })
                            .then(function (resp) { return resp.json().then(function (data) { return { status: resp.status, data: data }; }); })
                            .then(function (res) {
                                if (res.status === 200 && res.data && res.data.ok) {
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
            var isInOriginals = (state.folder && state.folder.split(/[\\/]/).pop() === 'originals');
            var fileName = mediaItem.fileName;
            if (isInOriginals) {
                actions.push({
                    label: 'Restore',
                    run: function () {
                        restoreMedia( mediaItem).catch(function (err) {
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
                        pruneMedia( mediaItem).catch(function (err) {
                            setStatus(String(err && err.message ? err.message : err));
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
                            PreviewPane.streamPreviewFromFetch(
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

// Delegated event handlers
mediaListEl.onclick = function (e) {
    var row = e.target.closest('.media-item');
    if (!row) return;
    var type = row.getAttribute('data-type');
    var key = row.getAttribute('data-key');
    if (type === 'up') {
        navigateUp();
    } else if (type === 'folder') {
        state.folder = (state.folder ? state.folder + '/' : '') + key;
        if (state.dirStack && state.dirStack.length) {
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
        } else {
            state.reviewedSet.add(mediaItem.key);
        }
        onReviewedSetChanged(state);
        saveFolderStateForCurrentRoot();
        renderFileList();
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
                    PreviewPane.streamPreviewFromFetch(
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
                    var parent = state.folder || '';
                    fetch('/fs/rename_folder', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ parent: parent, oldName: oldName, newName: newName })
                    })
                        .then(function (resp) { return resp.json().then(function (data) { return { status: resp.status, data: data }; }); })
                        .then(function (res) {
                            if (res.status === 200 && res.data && res.data.ok) {
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
        var isInOriginals = (state.folder && state.folder.split(/[\\/]/).pop() === 'originals');
        var fileName = mediaItem.fileName;
        if (isInOriginals) {
            actions.push({
                label: 'Restore',
                run: function () {
                    restoreMedia( mediaItem).catch(function (err) {
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
                    pruneMedia( mediaItem).catch(function (err) {
                        setStatus(String(err && err.message ? err.message : err));
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
                        PreviewPane.streamPreviewFromFetch(
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

    // Always show current folder row and set label
    // var currentRow = document.getElementById('current-folder-row');
    // var currentLabel = document.getElementById('current-folder-label');
    // if (currentRow && currentLabel) {
    //     currentRow.style.display = '';
    //     var folder = state.folder || '';
    //    currentLabel.textContent = folder ? folder : '/';
    // }

    // Always wire up the static Exit Set button after rendering
    ensureFocusSetExitButton();

    var matchCount = 0;

    for (var i = 0; i < state.childFolders.length; ++i) {
        var folderItem = state.childFolders[i];
        var label = ' 🗀 ' + folderItem.name;
        var row = document.createElement('div');
        row.className = 'media-item folder-item';
        row.setAttribute('data-type', 'folder');
        row.setAttribute('data-key', folderItem.name);
        row.innerHTML = '<div>' + escapeHtml(label) + '</div>';
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
        var displayText = mediaItem.label;
        var row = document.createElement('div');
        row.className = className;
        row.setAttribute('data-type', 'media');
        row.setAttribute('data-key', mediaItem.key);
        row.innerHTML = '<div>' + icon + '&nbsp;' + escapeHtml(displayText) + '</div>';
        mediaListEl.appendChild(row);
        matchCount++;
    });
}