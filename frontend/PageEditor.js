// PageEditor.js - Page editor with columns and drag-drop
// =============================================================================

class PageEditor {
    constructor(app) {
        this.app = app;
        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('btnNewPage').addEventListener('click', () => {
            this.createNew();
        });

        document.getElementById('btnSavePage').addEventListener('click', () => {
            this.save();
        });

        document.getElementById('btnPreviewPage').addEventListener('click', () => {
            this.preview();
        });
        
        document.getElementById('btnExportHTML').addEventListener('click', () => {
            this.exportHTML();
        });

        document.getElementById('btnClosePageEditor').addEventListener('click', () => {
            this.closeEditor();
        });

        document.getElementById('btnBackToPages').addEventListener('click', () => {
            this.closeEditor();
        });

        // Event delegation for pages list
        const pagesList = document.getElementById('pagesList');
        if (pagesList) {
            pagesList.addEventListener('click', (e) => {
                const deleteBtn = e.target.closest('.media-card-delete-btn');
                if (deleteBtn) {
                    e.stopPropagation();
                    const card = e.target.closest('.page-card');
                    const pageId = card.dataset.pageId;
                    const page = this.app.pages.find(p => p.id === pageId);
                    if (page && confirm(`Delete page "${page.title}"?`)) {
                        const idx = this.app.pages.findIndex(p => p.id === page.id);
                        if (idx >= 0) {
                            this.app.pages.splice(idx, 1);
                            if (this.app.api) {
                                this.app.api.deletePage(page).catch(err => {
                                    this.app.console.log('error', `Failed to delete page: ${err.message || err}`);
                                });
                            }
                            this.renderPagesList();
                        }
                    }
                    return;
                }

                const viewBtn = e.target.closest('.media-card-view-btn');
                if (viewBtn) {
                    e.stopPropagation();
                    const card = e.target.closest('.page-card');
                    const pageId = card.dataset.pageId;
                    const page = this.app.pages.find(p => p.id === pageId);
                    if (page) this.viewFullScreen(page);
                    return;
                }

                const card = e.target.closest('.page-card');
                if (card) {
                    const pageId = card.dataset.pageId;
                    const page = this.app.pages.find(p => p.id === pageId);
                    if (page) this.open(page);
                }
            });
        }

        // Event delegation for page canvas (column toolbar buttons and text editing)
        const pageCanvas = document.getElementById('pageCanvas');
        if (pageCanvas) {
            pageCanvas.addEventListener('click', (e) => {
                // Column toolbar buttons
                const moveupBtn = e.target.closest('[data-action="moveup"]');
                if (moveupBtn) {
                    const columnDiv = moveupBtn.closest('.column-element');
                    const columnId = columnDiv.dataset.columnId;
                    const page = this.app.currentEditor.page;
                    const colIdx = page.columns.findIndex(c => c.id === columnId);
                    if (colIdx > 0) {
                        [page.columns[colIdx - 1], page.columns[colIdx]] = [page.columns[colIdx], page.columns[colIdx - 1]];
                        this.renderColumns();
                    }
                    return;
                }

                const movedownBtn = e.target.closest('[data-action="movedown"]');
                if (movedownBtn) {
                    const columnDiv = movedownBtn.closest('.column-element');
                    const columnId = columnDiv.dataset.columnId;
                    const page = this.app.currentEditor.page;
                    const colIdx = page.columns.findIndex(c => c.id === columnId);
                    if (colIdx < page.columns.length - 1) {
                        [page.columns[colIdx + 1], page.columns[colIdx]] = [page.columns[colIdx], page.columns[colIdx + 1]];
                        this.renderColumns();
                    }
                    return;
                }

                const widthBtn = e.target.closest('[data-action="width"]');
                if (widthBtn) {
                    const columnDiv = widthBtn.closest('.column-element');
                    const columnId = columnDiv.dataset.columnId;
                    const column = this.app.currentEditor.page.columns.find(c => c.id === columnId);
                    const widths = [3, 4, 6, 8, 12];
                    const currentIdx = widths.indexOf(column.width);
                    const nextIdx = (currentIdx + 1) % widths.length;
                    column.width = widths[nextIdx];
                    this.renderColumns();
                    return;
                }

                const deleteBtn = e.target.closest('[data-action="delete"]');
                if (deleteBtn) {
                    const columnDiv = deleteBtn.closest('.column-element');
                    const columnId = columnDiv.dataset.columnId;
                    const page = this.app.currentEditor.page;
                    const colIdx = page.columns.findIndex(c => c.id === columnId);
                    if (colIdx >= 0) {
                        page.columns.splice(colIdx, 1);
                        this.renderColumns();
                    }
                    return;
                }

                // Text content click to edit
                const textContent = e.target.closest('[data-text-content]');
                if (textContent && !e.target.closest('.column-toolbar')) {
                    const columnDiv = textContent.closest('.column-element');
                    const columnId = columnDiv.dataset.columnId;
                    const column = this.app.currentEditor.page.columns.find(c => c.id === columnId);
                    if (column) this.editTextInline(columnDiv, column);
                    return;
                }

                // Media edit button
                const mediaEditBtn = e.target.closest('.media-edit-btn');
                if (mediaEditBtn) {
                    const mediaId = mediaEditBtn.dataset.mediaId;
                    const media = this.app.media.find(m => m.id === mediaId);
                    if (media) this.app.mediaManager.openEditor(media);
                    return;
                }
            });
        }

        // Event delegation for media library
        const editorMediaLibrary = document.getElementById('editorMediaLibrary');
        if (editorMediaLibrary) {
            editorMediaLibrary.addEventListener('dblclick', (e) => {
                const mediaItem = e.target.closest('.media-item');
                if (mediaItem) {
                    const mediaId = mediaItem.dataset.mediaId;
                    const media = this.app.media.find(m => m.id === mediaId);
                    if (media && this.app.currentEditor && this.app.currentEditor.page) {
                        const page = this.app.currentEditor.page;
                        const column = {
                            id: this.app.generateId(),
                            width: 12,
                            type: media.media_type,
                            data: { media_id: mediaId, caption: '' }
                        };
                        page.columns.push(column);
                        const metadata = this.app.getMediaMetadata(mediaId);
                        this.app.console.log('info', `Added ${media.media_type} "${metadata.title || media.filename}" to page`);
                        this.renderColumns();
                    }
                }
            });
        }
    }

    renderPagesList() {
        const list = document.getElementById('pagesList');
        list.innerHTML = '';

        if (this.app.pages.length === 0) {
            list.innerHTML = `
                <div class="empty-state" style="grid-column: 1/-1;">
                    <div class="empty-state-icon">📄</div>
                    <div class="empty-state-text">No pages yet. Create one to get started.</div>
                    <button class="btn btn-primary" onclick="document.getElementById('btnNewPage').click()" style="margin-top: 1rem;">+ Create Your First Page</button>
                </div>
            `;
            return;
        }

        this.app.pages.forEach(page => {
            const card = document.createElement('div');
            card.className = 'page-card media-card-positioned';
            card.dataset.pageId = page.id;
            card.innerHTML = `
                <div class="page-card-title">${this.app.escapeHtml(page.title)}</div>
                <div class="page-card-slug">/${page.slug}</div>
                <div class="page-card-meta">
                    <span>${page.columns ? page.columns.length : (page.sections ? page.sections.length : 0)} items</span>
                    <span>${this.app.formatDate(page.modified)}</span>
                </div>
                <button class="btn btn-icon media-card-delete-btn" title="Delete this page">🗑️</button>
                <button class="btn btn-icon media-card-view-btn" title="View Full Screen">👁️</button>
            `;
            list.appendChild(card);
        });
    }

    createNew() {
        this.app.console.log('info', 'Creating new page...');
        const today = new Date().toISOString().split('T')[0];
        this.open({
            id: this.app.generateId(),
            title: '',
            slug: '',
            date: today,
            columns: [],
            created: new Date().toISOString(),
            modified: new Date().toISOString()
        });
    }

    open(page) {
        this.app.console.log('info', `Opened page editor for "${page.title || 'New Page'}"`);
        
        // Ensure page has a date field
        if (!page.date) {
            page.date = new Date().toISOString().split('T')[0];
        }
        
        // Migrate old format if needed
        if (page.sections && !page.columns) {
            page.columns = [];
            page.sections.forEach(section => {
                section.blocks.forEach(block => {
                    page.columns.push({
                        id: block.id,
                        width: block.columns || 12,
                        type: block.type,
                        data: block.data
                    });
                });
            });
            delete page.sections;
        }
        
        if (!page.columns) {
            page.columns = [];
        }
        
        this.app.currentEditor = { type: 'page', page: JSON.parse(JSON.stringify(page)) };

        document.getElementById('pageTitle').value = page.title;
        document.getElementById('pageSlug').value = page.slug;

        const canvas = document.getElementById('pageCanvas');
        canvas.innerHTML = '';
        
        this.renderColumns();
        this.renderMediaLibrary();

        const filterInput = document.getElementById('editorMediaFilter');
        filterInput.value = '';
        filterInput.addEventListener('input', () => {
            this.renderMediaLibrary(filterInput.value);
        });

        // Show the page editor section instead of modal
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.getElementById('pageEditor').classList.add('active');
        document.getElementById('pageEditor').classList.remove('hidden');
    }

    renderColumns() {
        const canvas = document.getElementById('pageCanvas');
        const page = this.app.currentEditor.page;
        canvas.innerHTML = '';

        // Chunk columns into rows that sum to 12 or less
        let currentRow = [];
        let currentSum = 0;
        const rows = [];
        page.columns.forEach(col => {
            const width = Number(col.width) || 12;
            if (currentSum + width > 12) {
                if (currentRow.length) rows.push(currentRow);
                currentRow = [];
                currentSum = 0;
            }
            currentRow.push(col);
            currentSum += width;
        });
        if (currentRow.length) rows.push(currentRow);

        // Render each row as a flex row
        rows.forEach(row => {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'canvas-row';
            rowDiv.style.display = 'flex';
            rowDiv.style.gap = '12px';
            row.forEach(column => {
                const colDiv = this.createColumnElement(column);
                // Set flex-basis as a percentage of 12 columns
                const percent = (Number(column.width) || 12) / 12 * 100;
                colDiv.style.flex = `0 0 ${percent}%`;
                colDiv.style.maxWidth = `${percent}%`;
                colDiv.style.boxSizing = 'border-box';
                rowDiv.appendChild(colDiv);
            });
            canvas.appendChild(rowDiv);
        });

        // Add placeholder as a new full-width row
        const placeholderRow = document.createElement('div');
        placeholderRow.className = 'canvas-row';
        placeholderRow.style.display = 'flex';
        const placeholder = document.createElement('div');
        placeholder.style.flex = '0 0 100%';
        placeholder.style.maxWidth = '100%';
        placeholder.style.boxSizing = 'border-box';
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.textContent = 'Add text block';
        addBtn.className = 'btn btn-primary canvas-add-btn';
        addBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const page = this.app.currentEditor.page;
            const columnId = this.app.generateId();
            const column = {
                id: columnId,
                width: 12,
                type: 'text',
                data: {
                    content: '',
                    textType: 'p',
                    textAlign: 'left'
                }
            };
            page.columns.push(column);
            this.app.console.log('info', 'Added text column');
            this.renderColumns();
            setTimeout(() => {
                const newColEl = document.querySelector(`.column-element[data-column-id="${columnId}"]`);
                if (newColEl) {
                    this.editTextInline(newColEl, column);
                }
            }, 0);
        });
        placeholder.appendChild(addBtn);
        placeholderRow.appendChild(placeholder);
        canvas.appendChild(placeholderRow);
    }

    addPlaceholder(canvas) {
        const placeholder = document.createElement('div');
        placeholder.className = 'canvas-placeholder';
        
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.textContent = 'Add text block';
        addBtn.className = 'btn btn-primary canvas-add-btn';
        addBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const page = this.app.currentEditor.page;
            const columnId = this.app.generateId();
            const column = {
                id: columnId,
                width: 12,
                type: 'text',
                data: { 
                    content: '',
                    textType: 'p',
                    textAlign: 'left'
                }
            };
            page.columns.push(column);
            this.app.console.log('info', 'Added text column');
            this.renderColumns();
            setTimeout(() => {
                const newColEl = document.querySelector(`.page-column[data-column-id="${columnId}"]`);
                if (newColEl) {
                    this.editTextInline(newColEl, column);
                }
            }, 0);
        });
        
        placeholder.appendChild(addBtn);
        canvas.appendChild(placeholder);
    }

    createColumnElement(column, idx) {
        const div = document.createElement('div');
        div.className = `column-element col-${column.width}`;
        div.dataset.columnId = column.id;
        
        // Create toolbar with data attributes
        const toolbar = document.createElement('div');
        toolbar.className = 'column-toolbar';
        toolbar.innerHTML = `
            <button type="button" class="column-toolbar-btn" data-action="moveup" title="Move Up">▲</button>
            <button type="button" class="column-toolbar-btn" data-action="movedown" title="Move Down">▼</button>
            <button type="button" class="column-width-btn" data-action="width" title="Width: ${column.width}/12">${column.width}/12</button>
            <button type="button" class="column-delete-btn" data-action="delete" title="Delete">🗑️</button>
        `;
        
        // Create content container
        const contentContainer = document.createElement('div');
        contentContainer.className = 'column-content-container';
        
        let content = '';
        if (column.type === 'text') {
            const textType = column.data.textType || 'p';
            const textAlign = column.data.textAlign || 'left';
            content = this.buildTextHtml({
                textType,
                textAlign,
                content: column.data.content || 'Empty text'
            }, true);
            contentContainer.innerHTML = content;
        } else if (column.type === 'image' || column.type === 'video') {
            if (column.data.media_id) {
                const media = this.app.media.find(m => m.id === column.data.media_id);
                if (media) {
                    const fileUrl = this.app.getMediaFileUrl(media);
                    const mediaWrapper = document.createElement('div');
                    mediaWrapper.className = 'media-wrapper';
                    
                    if (column.type === 'image') {
                        mediaWrapper.innerHTML = `
                            <img src="${fileUrl}" style="width: 100%; height: auto; display: block;">
                            ${column.data.caption ? `<div style="padding: 8px; background: #f9f9f9; font-size: 0.9em;">${this.app.escapeHtml(column.data.caption)}</div>` : ''}
                        `;
                    } else {
                        mediaWrapper.innerHTML = `
                            <video controls style="width: 100%; height: auto; display: block;">
                                <source src="${fileUrl}">
                            </video>
                            ${column.data.caption ? `<div style="padding: 8px; background: #f9f9f9; font-size: 0.9em;">${this.app.escapeHtml(column.data.caption)}</div>` : ''}
                        `;
                    }
                    
                    // Add floating edit button with data attribute
                    const editBtn = document.createElement('button');
                    editBtn.type = 'button';
                    editBtn.className = 'media-edit-btn';
                    editBtn.textContent = '✏️ Edit';
                    editBtn.dataset.mediaId = column.data.media_id;
                    
                    mediaWrapper.appendChild(editBtn);
                    contentContainer.appendChild(mediaWrapper);
                }
            }
        }
        
        div.appendChild(toolbar);
        div.appendChild(contentContainer);
        return div;
    }

    editTextInline(columnDiv, column) {
        const contentDiv = columnDiv.querySelector('[data-text-content]');
        if (!contentDiv) return;
        
        // Initialize formatting data if not present
        if (!column.data.textType) column.data.textType = 'p';
        if (!column.data.textAlign) column.data.textAlign = 'left';
        
        const originalContent = contentDiv.innerHTML;
        contentDiv.innerHTML = '';
        
        // Create toolbar
        const toolbar = document.createElement('div');
        toolbar.className = 'text-editor-inline-toolbar';
        
        // Type selector buttons (instead of dropdown)
        const typeGroup = document.createElement('div');
        typeGroup.className = 'text-type-group';
        
        const types = [
            { value: 'p', label: 'P' },
            { value: 'h1', label: 'H1' },
            { value: 'h2', label: 'H2' },
            { value: 'h3', label: 'H3' }
        ];
        
        types.forEach(type => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'text-type-btn';
            btn.textContent = type.label;
            if (column.data.textType === type.value) {
                btn.classList.add('active');
            }
            btn.addEventListener('click', () => {
                column.data.textType = type.value;
                updateTypeButtons();
            });
            typeGroup.appendChild(btn);
        });
        
        const updateTypeButtons = () => {
            typeGroup.querySelectorAll('button').forEach((btn, idx) => {
                const isActive = types[idx].value === column.data.textType;
                btn.classList.toggle('active', isActive);
            });
        };
        
        // Alignment buttons
        const alignGroup = document.createElement('div');
        alignGroup.className = 'text-align-group-inline';
        
        const alignLeft = document.createElement('button');
        alignLeft.type = 'button';
        alignLeft.className = 'text-align-btn-inline';
        alignLeft.textContent = '≡';
        alignLeft.title = 'Align Left';
        if (column.data.textAlign === 'left') {
            alignLeft.classList.add('active');
        }
        alignLeft.addEventListener('click', () => {
            column.data.textAlign = 'left';
            updateAlignButtons();
        });
        
        const alignCenter = document.createElement('button');
        alignCenter.type = 'button';
        alignCenter.className = 'text-align-btn-inline';
        alignCenter.textContent = '≃';
        alignCenter.title = 'Align Center';
        if (column.data.textAlign === 'center') {
            alignCenter.classList.add('active');
        }
        alignCenter.addEventListener('click', () => {
            column.data.textAlign = 'center';
            updateAlignButtons();
        });
        
        const alignRight = document.createElement('button');
        alignRight.type = 'button';
        alignRight.className = 'text-align-btn-inline';
        alignRight.textContent = '≡';
        alignRight.title = 'Align Right';
        if (column.data.textAlign === 'right') {
            alignRight.classList.add('active');
        }
        alignRight.addEventListener('click', () => {
            column.data.textAlign = 'right';
            updateAlignButtons();
        });
        
        const updateAlignButtons = () => {
            alignLeft.classList.toggle('active', column.data.textAlign === 'left');
            alignCenter.classList.toggle('active', column.data.textAlign === 'center');
            alignRight.classList.toggle('active', column.data.textAlign === 'right');
        };
        
        alignGroup.appendChild(alignLeft);
        alignGroup.appendChild(alignCenter);
        alignGroup.appendChild(alignRight);
        
        // Help text
        const helpText = document.createElement('span');
        helpText.className = 'text-editor-help';
        helpText.textContent = 'Ctrl+Enter to save, Esc to cancel';
        
        toolbar.appendChild(typeGroup);
        toolbar.appendChild(alignGroup);
        toolbar.appendChild(helpText);
        
        // Create textarea
        const textarea = document.createElement('textarea');
        textarea.value = column.data.content || '';
        textarea.className = 'text-editor-textarea-inline';
        
        const saveEdit = () => {
            const newValue = textarea.value.trim();
            if (newValue) {
                column.data.content = newValue;
                this.renderColumns();
            } else {
                contentDiv.innerHTML = originalContent;
            }
        };
        
        textarea.addEventListener('blur', () => {
            // Simple blur - just check if focus moved completely away
            setTimeout(() => {
                if (!contentDiv.contains(document.activeElement)) {
                    saveEdit();
                }
            }, 0);
        });
        
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                contentDiv.innerHTML = originalContent;
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                saveEdit();
            }
        });
        
        contentDiv.appendChild(toolbar);
        contentDiv.appendChild(textarea);
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }

    buildTextHtml(data, includeDataAttr = false) {
        const textType = data.textType || 'p';
        const textAlign = data.textAlign || 'left';
        const content = this.app.escapeHtml(data.content || 'Empty text');

        let tag = 'p';
        const classes = ['text-block', `text-align-${textAlign}`];

        if (textType === 'h1') {
            tag = 'h1';
            classes.push('text-h1');
        } else if (textType === 'h2') {
            tag = 'h2';
            classes.push('text-h2');
        } else if (textType === 'h3') {
            tag = 'h3';
            classes.push('text-h3');
        } else {
            classes.push('text-body');
        }

        const dataAttr = includeDataAttr ? ' data-text-content' : '';
        return `<${tag}${dataAttr} class="${classes.join(' ')}">${content}</${tag}>`;
    }

    renderMediaLibrary(filterText = '') {
        const library = document.getElementById('editorMediaLibrary');
        library.innerHTML = '';
        library.className = 'editor-media-library';

        if (this.app.media.length === 0) {
            library.innerHTML = '<div class="editor-media-header">No media yet</div>';
            return;
        }
        
        // Add instruction header
        const header = document.createElement('div');
        header.className = 'editor-media-header';
        header.textContent = '🎬 Double-click to add media to page';
        library.appendChild(header);

        const filter = filterText.toLowerCase();
        const filtered = this.app.media.filter(media => {
            if (!filter) return true;
            const metadata = this.app.getMediaMetadata(media.id);
            return media.filename.toLowerCase().includes(filter) ||
                   (metadata.title && metadata.title.toLowerCase().includes(filter)) ||
                   metadata.tags.some(tag => tag.toLowerCase().includes(filter));
        });

        if (filtered.length === 0) {
            library.innerHTML = '<div class="editor-media-header">No matching media</div>';
            return;
        }

        filtered.forEach(media => {
            const item = document.createElement('div');
            item.className = 'editor-media-item media-item';
            item.dataset.mediaId = media.id;
            item.dataset.mediaType = media.media_type;
            
            const fileUrl = this.app.getMediaFileUrl(media);
            const metadata = this.app.getMediaMetadata(media.id);
            
            let thumbnail = '';
            if (media.media_type === 'image') {
                thumbnail = `<img src="${fileUrl}" style="width: 100%; height: 80px; object-fit: cover; border-radius: 4px; display: block; pointer-events: none;">`;
            } else {
                thumbnail = `<div style="width: 100%; height: 80px; background: #333; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 24px; pointer-events: none;">🎬</div>`;
            }
            
            item.innerHTML = `
                ${thumbnail}
                <div style="font-size: 10px; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; pointer-events: none;" title="${metadata.title || media.filename}">
                    ${this.app.truncate(metadata.title || media.filename, 15)}
                </div>
            `;

            library.appendChild(item);
        });
    }

    async save() {
        if (!this.app.currentEditor || this.app.currentEditor.type !== 'page') return;

        const page = this.app.currentEditor.page;
        const title = document.getElementById('pageTitle').value.trim();
        const slug = document.getElementById('pageSlug').value.trim();
        
        if (!title) {
            alert('Page title is required');
            document.getElementById('pageTitle').focus();
            return;
        }
        
        page.title = title;
        page.slug = slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        page.modified = new Date().toISOString();

        this.app.console.log('info', `Saving page "${page.title}" (${page.columns.length} columns)`);

        const existingIdx = this.app.pages.findIndex(p => p.id === page.id);
        if (existingIdx >= 0) {
            this.app.pages[existingIdx] = page;
            this.app.console.log('info', 'Page updated');
        } else {
            this.app.pages.push(page);
            this.app.console.log('info', 'New page created');
        }

        if (this.app.api) {
            try {
                await this.app.api.savePage(page);
                this.app.console.log('info', '✓ Page saved to disk');
            } catch (err) {
                this.app.console.log('error', `Failed to save page to disk: ${err.message || err}`);
            }
        }

        this.app.closeModal();
        this.renderPagesList();
    }

    preview() {
        if (!this.app.currentEditor || this.app.currentEditor.type !== 'page') return;
        
        const page = this.app.currentEditor.page;
        const title = document.getElementById('pageTitle').value || 'Untitled Page';
        
        const modal = document.createElement('div');
        modal.className = 'modal active modal-preview';
        modal.innerHTML = `
            <div class="modal-content modal-large">
                <div class="modal-header">
                    <h2>${this.app.escapeHtml(title)}</h2>
                    <button class="btn-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div id="pagePreviewContent" style="padding: 20px;"></div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const content = document.getElementById('pagePreviewContent');
        content.className = 'preview-content';
        
        // Group columns into rows that sum to 12 or less
        function chunkColumns(columns) {
            const rows = [];
            let currentRow = [];
            let currentSum = 0;
            columns.forEach(col => {
                const width = Number(col.width) || 12;
                if (currentSum + width > 12) {
                    if (currentRow.length) rows.push(currentRow);
                    currentRow = [];
                    currentSum = 0;
                }
                currentRow.push(col);
                currentSum += width;
            });
            if (currentRow.length) rows.push(currentRow);
            return rows;
        }

        const rows = chunkColumns(page.columns);
        rows.forEach(row => {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'preview-content'; // 12-col grid
            row.forEach(column => {
                const colDiv = document.createElement('div');
                colDiv.className = `preview-column col-${column.width}`;

                if (column.type === 'text') {
                    colDiv.innerHTML = this.buildTextHtml({
                        textType: column.data.textType,
                        textAlign: column.data.textAlign,
                        content: column.data.content || ''
                    });
                } else if (column.type === 'image') {
                    const media = this.app.media.find(m => m.id === column.data.media_id);
                    if (media) {
                        const fileUrl = this.app.getMediaFileUrl(media);
                        colDiv.innerHTML = `
                            <div style="border: 2px solid #ddd; border-radius: 4px; overflow: hidden;">
                                <img src="${fileUrl}" style="width: 100%; height: auto; display: block;">
                                ${column.data.caption ? `<div style="padding: 8px; background: #f9f9f9; font-size: 0.9em;">${this.app.escapeHtml(column.data.caption)}</div>` : ''}
                            </div>
                        `;
                    }
                } else if (column.type === 'video') {
                    const media = this.app.media.find(m => m.id === column.data.media_id);
                    if (media) {
                        const fileUrl = this.app.getMediaFileUrl(media);
                        colDiv.innerHTML = `
                            <div style="border: 2px solid #ddd; border-radius: 4px; overflow: hidden;">
                                <video controls style="width: 100%; height: auto; display: block;">
                                    <source src="${fileUrl}">
                                </video>
                                ${column.data.caption ? `<div style="padding: 8px; background: #f9f9f9; font-size: 0.9em;">${this.app.escapeHtml(column.data.caption)}</div>` : ''}
                            </div>
                        `;
                    }
                }
                rowDiv.appendChild(colDiv);
            });
            content.appendChild(rowDiv);
        });
        
        modal.querySelector('.btn-close').addEventListener('click', () => {
            modal.remove();
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }
    
    viewFullScreen(page) {
        this.app.console.log('info', `Viewing "${page.title}" full screen`);
        
        const modal = document.createElement('div');
        modal.className = 'modal active';
        
        const html = this.generatePageHTML(page);
        
        // Extract just the body content
        const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
        const bodyContent = bodyMatch ? bodyMatch[1] : html;
        
        modal.innerHTML = `
            <div class="modal-content modal-large" style="max-width: 100%; height: 100%; margin: 0; border-radius: 0; overflow-y: auto;">
                <div class="modal-header" style="position: sticky; top: 0; background: white; z-index: 10; border-bottom: 1px solid #ddd;">
                    <h2>Page Preview</h2>
                    <button class="btn-close">&times;</button>
                </div>
                <div class="modal-body" style="padding: 40px; background: white;">
                    ${bodyContent}
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        modal.querySelector('.btn-close').addEventListener('click', () => {
            modal.remove();
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }
    
    exportHTML() {
        try {
            if (!this.app.currentEditor || this.app.currentEditor.type !== 'page') {
                this.app.console.log('error', 'No page selected for export');
                return;
            }
            
            const page = this.app.currentEditor.page;
            const title = document.getElementById('pageTitle').value || 'Untitled Page';
            page.title = title;
            
            const html = this.generatePageHTML(page);
            const filename = `${page.slug || 'page'}.html`;
            
            // Convert HTML to base64 for binary write
            const base64Html = btoa(unescape(encodeURIComponent(html)));
            
            window.__TAURI__.invoke('file_io', {
                op: 'write_binary',
                data_path: this.app.dataPath,
                rel_path: filename,
                payload: base64Html
            }).then(() => {
                this.app.console.log('info', `Exported "${page.title}" as HTML`);
            }).catch((err) => {
                console.error('Export error:', err);
                this.app.console.log('error', `Export failed: ${err}`);
            });
        } catch (e) {
            console.error('Export error:', e);
            this.app.console.log('error', `Export failed: ${e.message}`);
        }
    }

    closeEditor() {
        // Show pages list again
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.getElementById('pages').classList.add('active');
        document.getElementById('pageEditor').classList.add('hidden');
        this.app.currentEditor = null;
    }
    
    generatePageHTML(page) {
        let columnsHTML = '';
        
        page.columns.forEach(column => {
            const widthPercent = (column.width / 12) * 100;
            let content = '';
            
            if (column.type === 'text') {
                content = this.buildTextHtml({
                    textType: column.data.textType,
                    textAlign: column.data.textAlign,
                    content: column.data.content || ''
                });
            } else if (column.type === 'image') {
                const media = this.app.media.find(m => m.id === column.data.media_id);
                if (media) {
                    const fileUrl = this.app.getMediaFileUrl(media);
                    content = `
                        <div style="border: 2px solid #ddd; border-radius: 4px; overflow: hidden;">
                            <img src="${fileUrl}" style="width: 100%; height: auto; display: block;" alt="">
                            ${column.data.caption ? `<div style="padding: 8px; background: #f9f9f9; font-size: 0.9em;">${this.app.escapeHtml(column.data.caption)}</div>` : ''}
                        </div>
                    `;
                }
            } else if (column.type === 'video') {
                const media = this.app.media.find(m => m.id === column.data.media_id);
                if (media) {
                    const fileUrl = this.app.getMediaFileUrl(media);
                    content = `
                        <div style="border: 2px solid #ddd; border-radius: 4px; overflow: hidden;">
                            <video controls style="width: 100%; height: auto; display: block;">
                                <source src="${fileUrl}">
                            </video>
                            ${column.data.caption ? `<div style="padding: 8px; background: #f9f9f9; font-size: 0.9em;">${this.app.escapeHtml(column.data.caption)}</div>` : ''}
                        </div>
                    `;
                }
            }
            
            columnsHTML += `<div style="width: ${widthPercent}%; padding: 10px; box-sizing: border-box; float: left;">${content}</div>`;
        });
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.app.escapeHtml(page.title)}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            margin: 0;
            padding: 20px;
            background: #f9fafb;
        }
        .page-container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .page-title {
            font-size: 2.5rem;
            font-weight: 700;
            margin-bottom: 30px;
            color: #1f2937;
        }
        .page-content {
            display: flex;
            flex-wrap: wrap;
            margin: -10px;
        }
        .page-content::after {
            content: "";
            display: table;
            clear: both;
        }
        img, video {
            max-width: 100%;
            height: auto;
        }
        .text-block {
            display: block;
            width: 100%;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        .text-body {
            padding: 15px;
            background: #f9f9f9;
            border-radius: 4px;
            min-height: 60px;
        }
        .text-h1,
        .text-h2,
        .text-h3,
        .text-h4 {
            background: transparent;
            padding: 0;
        }
        .text-h1 {
            font-size: 2rem;
            font-weight: 700;
            margin: 20px 0 10px 0;
        }
        .text-h2 {
            font-size: 1.5rem;
            font-weight: 600;
            margin: 15px 0 8px 0;
        }
        .text-h3 {
            font-size: 1.25rem;
            font-weight: 600;
            margin: 12px 0 6px 0;
        }
        .text-h4 {
            font-size: 1.1rem;
            font-weight: 600;
            margin: 10px 0 5px 0;
        }
        .text-blockquote {
            padding: 15px;
            background: #f3f4f6;
            border-left: 4px solid #FF8C42;
            margin: 10px 0;
            font-style: italic;
            color: #6b7280;
        }
        .text-align-left { text-align: left; }
        .text-align-center { text-align: center; }
        .text-align-right { text-align: right; }
        .text-align-justify { text-align: justify; }
    </style>
</head>
<body>
    <div class="page-container">
        <h1 class="page-title">${this.app.escapeHtml(page.title)}</h1>
        <div class="page-content">
            ${columnsHTML}
        </div>
    </div>
</body>
</html>`;
    }
}
