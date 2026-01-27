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
    }

    renderPagesList() {
        const list = document.getElementById('pagesList');
        list.innerHTML = '';

        if (this.app.pages.length === 0) {
            list.innerHTML = `
                <div class="empty-state" style="grid-column: 1/-1;">
                    <div class="empty-state-icon">📄</div>
                    <div class="empty-state-text">No pages yet. Create one to get started.</div>
                </div>
            `;
            return;
        }

        this.app.pages.forEach(page => {
            const card = document.createElement('div');
            card.className = 'page-card';
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-icon';
            deleteBtn.textContent = '🗑️';
            deleteBtn.style.position = 'absolute';
            deleteBtn.style.top = '10px';
            deleteBtn.style.right = '10px';
            deleteBtn.style.width = '32px';
            deleteBtn.style.height = '32px';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Delete page "${page.title}"?`)) {
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
            });

            card.style.position = 'relative';
            card.innerHTML = `
                <div class="page-card-title">${this.app.escapeHtml(page.title)}</div>
                <div class="page-card-slug">/${page.slug}</div>
                <div class="page-card-meta">
                    <span>${page.columns ? page.columns.length : (page.sections ? page.sections.length : 0)} items</span>
                    <span>${this.app.formatDate(page.modified)}</span>
                </div>
            `;
            card.appendChild(deleteBtn);
            card.addEventListener('click', () => this.open(page));
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
        
        this.setupCanvasDropZone(canvas);
        this.renderColumns();
        this.renderMediaLibrary();

        const filterInput = document.getElementById('editorMediaFilter');
        filterInput.value = '';
        filterInput.addEventListener('input', () => {
            this.renderMediaLibrary(filterInput.value);
        });

        document.getElementById('pageEditorModal').classList.add('active');
    }

    setupCanvasDropZone(canvas) {
        canvas.style.display = 'flex';
        canvas.style.flexWrap = 'wrap';
        canvas.style.minHeight = '400px';
        canvas.style.padding = '20px';
        canvas.style.background = 'white';
        
        canvas.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
            canvas.style.background = '#fafafa';
        });

        canvas.addEventListener('dragleave', (e) => {
            if (e.target === canvas) {
                canvas.style.background = 'white';
            }
        });

        canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            canvas.style.background = 'white';
            
            const mediaId = e.dataTransfer.getData('mediaId');
            const mediaType = e.dataTransfer.getData('mediaType');
            
            this.app.console.log('info', `Drop event: mediaId=${mediaId}, mediaType=${mediaType}`);
            
            if (mediaId && mediaType) {
                const page = this.app.currentEditor.page;
                const column = {
                    id: this.app.generateId(),
                    width: 12,
                    type: mediaType,
                    data: { media_id: mediaId, caption: '' }
                };
                
                page.columns.push(column);
                
                const media = this.app.media.find(m => m.id === mediaId);
                const metadata = this.app.getMediaMetadata(mediaId);
                this.app.console.log('info', `Added ${mediaType} "${metadata.title || media.filename}" to page`);
                
                this.renderColumns();
            }
        });
    }

    renderColumns() {
        const canvas = document.getElementById('pageCanvas');
        const page = this.app.currentEditor.page;
        
        canvas.innerHTML = '';
        
        page.columns.forEach((column, idx) => {
            const colDiv = this.createColumnElement(column, idx);
            canvas.appendChild(colDiv);
        });
        
        this.addPlaceholder(canvas);
    }
    
    addPlaceholder(canvas) {
        const placeholder = document.createElement('div');
        placeholder.className = 'column-placeholder';
        placeholder.style.cssText = 'width: 100%; padding: 10px; box-sizing: border-box;';
        
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Add text or drag media here...';
        input.className = 'placeholder-input';
        input.style.cssText = `
            width: 100%;
            padding: 20px;
            border: 1px solid transparent;
            border-radius: 8px;
            background: transparent;
            font-size: 14px;
            color: #999;
            outline: none;
            transition: all 0.2s;
        `;
        
        input.addEventListener('focus', () => {
            input.style.borderColor = '#FF8C42';
            input.style.background = 'white';
            input.style.color = '#333';
            input.style.boxShadow = '0 2px 8px rgba(255,140,66,0.15)';
        });
        
        input.addEventListener('blur', () => {
            if (input.value.trim()) {
                const page = this.app.currentEditor.page;
                const column = {
                    id: this.app.generateId(),
                    width: 12,
                    type: 'text',
                    data: { content: input.value.trim() }
                };
                page.columns.push(column);
                this.app.console.log('info', 'Added text column');
                this.renderColumns();
            } else {
                input.style.borderColor = 'transparent';
                input.style.background = 'transparent';
                input.style.color = '#999';
                input.style.boxShadow = 'none';
            }
        });
        
        input.addEventListener('mouseenter', () => {
            if (document.activeElement !== input) {
                input.style.background = '#fafafa';
                input.style.borderColor = '#eee';
            }
        });
        
        input.addEventListener('mouseleave', () => {
            if (document.activeElement !== input) {
                input.style.background = 'transparent';
                input.style.borderColor = 'transparent';
            }
        });
        
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                input.blur();
            }
        });
        
        placeholder.appendChild(input);
        canvas.appendChild(placeholder);
    }

    createColumnElement(column, idx) {
        const div = document.createElement('div');
        div.className = 'page-column';
        div.style.width = `${(column.width / 12) * 100}%`;
        div.style.padding = '10px';
        div.style.boxSizing = 'border-box';
        
        let content = '';
        if (column.type === 'text') {
            content = `<div data-text-content style="padding: 15px; background: #f9f9f9; border-radius: 4px; min-height: 60px; cursor: text; white-space: pre-wrap; word-wrap: break-word; transition: background 0.2s;" onmouseover="this.style.background='#f0f0f0'" onmouseout="this.style.background='#f9f9f9'">${this.app.escapeHtml(column.data.content || 'Empty text')}</div>`;
        } else if (column.type === 'image') {
            if (column.data.media_id) {
                const media = this.app.media.find(m => m.id === column.data.media_id);
                if (media) {
                    const fileUrl = this.app.getMediaFileUrl(media);
                    content = `
                        <div style="border: 2px solid #ddd; border-radius: 4px; overflow: hidden;">
                            <img src="${fileUrl}" style="width: 100%; height: auto; display: block;">
                            ${column.data.caption ? `<div style="padding: 8px; background: #f9f9f9; font-size: 0.9em;">${this.app.escapeHtml(column.data.caption)}</div>` : ''}
                        </div>
                    `;
                }
            }
        } else if (column.type === 'video') {
            if (column.data.media_id) {
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
        }

        div.innerHTML = `
            ${content}
            <div class="column-toolbar" style="margin-top: 8px; display: flex; gap: 5px; justify-content: flex-end; opacity: 0; transition: opacity 0.2s;">
                <button type="button" data-action="width" title="Width: ${column.width}/12" style="padding: 4px 8px; font-size: 11px; border: 1px solid #ddd; background: white; border-radius: 3px; cursor: pointer;">📏 ${column.width}/12</button>
                <button type="button" data-action="edit" style="padding: 4px 8px; font-size: 11px; border: 1px solid #ddd; background: white; border-radius: 3px; cursor: pointer;">✏️</button>
                <button type="button" data-action="delete" style="padding: 4px 8px; font-size: 11px; border: 1px solid #ddd; background: white; border-radius: 3px; cursor: pointer;">🗑️</button>
            </div>
        `;

        const widthBtn = div.querySelector('[data-action="width"]');
        const editBtn = div.querySelector('[data-action="edit"]');
        const deleteBtn = div.querySelector('[data-action="delete"]');
        const toolbar = div.querySelector('.column-toolbar');
        
        div.addEventListener('mouseenter', () => {
            toolbar.style.opacity = '1';
            div.style.background = '#fafafa';
        });
        div.addEventListener('mouseleave', () => {
            toolbar.style.opacity = '0';
            div.style.background = '';
        });
        
        if (column.type === 'text') {
            const textContent = div.querySelector('[data-text-content]');
            if (textContent) {
                textContent.addEventListener('click', () => {
                    this.editTextInline(div, column);
                });
            }
        }

        widthBtn.addEventListener('click', () => {
            const widths = [3, 4, 6, 8, 12];
            const currentIdx = widths.indexOf(column.width);
            const nextIdx = (currentIdx + 1) % widths.length;
            column.width = widths[nextIdx];
            this.renderColumns();
        });

        editBtn.addEventListener('click', () => {
            if (column.type === 'text') {
                this.editTextInline(div, column);
            } else {
                const caption = prompt('Edit caption:', column.data.caption || '');
                if (caption !== null) {
                    column.data.caption = caption;
                    this.renderColumns();
                }
            }
        });

        deleteBtn.addEventListener('click', () => {
            const page = this.app.currentEditor.page;
            const colIdx = page.columns.findIndex(c => c.id === column.id);
            if (colIdx >= 0) {
                page.columns.splice(colIdx, 1);
                this.renderColumns();
            }
        });

        return div;
    }

    editTextInline(columnDiv, column) {
        const contentDiv = columnDiv.querySelector('[data-text-content]');
        if (!contentDiv) return;
        
        const textarea = document.createElement('textarea');
        textarea.value = column.data.content || '';
        textarea.style.cssText = `
            width: 100%;
            min-height: 100px;
            padding: 15px;
            border: 2px solid #FF8C42;
            border-radius: 4px;
            font-family: inherit;
            font-size: 14px;
            resize: vertical;
            outline: none;
        `;
        
        const originalContent = contentDiv.innerHTML;
        contentDiv.innerHTML = '';
        contentDiv.appendChild(textarea);
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        
        const saveEdit = () => {
            const newValue = textarea.value.trim();
            if (newValue) {
                column.data.content = newValue;
                this.renderColumns();
            } else {
                contentDiv.innerHTML = originalContent;
            }
        };
        
        textarea.addEventListener('blur', saveEdit);
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                contentDiv.innerHTML = originalContent;
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                saveEdit();
            }
        });
    }

    renderMediaLibrary(filterText = '') {
        const library = document.getElementById('editorMediaLibrary');
        library.innerHTML = '';
        library.style.display = 'grid';
        library.style.gridTemplateColumns = '1fr 1fr';
        library.style.gap = '8px';

        if (this.app.media.length === 0) {
            library.innerHTML = '<div style="grid-column: 1/-1; padding: 20px; text-align: center; color: #999; font-size: 12px;">No media yet</div>';
            return;
        }
        
        // Add instruction header
        const header = document.createElement('div');
        header.style.cssText = 'grid-column: 1/-1; padding: 8px; background: #FFF4E6; border-radius: 4px; font-size: 11px; color: #F59E0B; text-align: center; margin-bottom: 4px;';
        header.textContent = '🖱️ Double-click or drag to add';
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
            library.innerHTML = '<div style="grid-column: 1/-1; padding: 20px; text-align: center; color: #999; font-size: 12px;">No matching media</div>';
            return;
        }

        filtered.forEach(media => {
            const item = document.createElement('div');
            item.className = 'editor-media-item';
            item.setAttribute('draggable', 'true');
            item.dataset.mediaId = media.id;
            item.dataset.mediaType = media.media_type;
            
            const fileUrl = this.app.getMediaFileUrl(media);
            const metadata = this.app.getMediaMetadata(media.id);
            
            let thumbnail = '';
            if (media.media_type === 'image') {
                thumbnail = `<img src="${fileUrl}" draggable="false" style="width: 100%; height: 80px; object-fit: cover; border-radius: 4px; display: block; pointer-events: none;">`;
            } else {
                thumbnail = `<div style="width: 100%; height: 80px; background: #333; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 24px; pointer-events: none;">🎬</div>`;
            }
            
            item.innerHTML = `
                ${thumbnail}
                <div style="font-size: 10px; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; pointer-events: none;" title="${metadata.title || media.filename}">
                    ${this.app.truncate(metadata.title || media.filename, 15)}
                </div>
            `;

            item.style.cssText = 'cursor: grab; padding: 4px; border: 1px solid #ddd; border-radius: 4px; background: white; user-select: none; transition: all 0.2s;';
            
            item.addEventListener('mouseenter', () => {
                item.style.borderColor = '#FF8C42';
                item.style.boxShadow = '0 2px 4px rgba(255,140,66,0.2)';
            });
            
            item.addEventListener('mouseleave', () => {
                item.style.borderColor = '#ddd';
                item.style.boxShadow = 'none';
            });
            
            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', media.id);
                e.dataTransfer.setData('mediaId', media.id);
                e.dataTransfer.setData('mediaType', media.media_type);
                e.dataTransfer.effectAllowed = 'copy';
                item.style.opacity = '0.5';
                item.style.cursor = 'grabbing';
            });

            item.addEventListener('dragend', () => {
                item.style.opacity = '1';
                item.style.cursor = 'grab';
            });
            
            // Alternative: Double-click to add media
            item.addEventListener('dblclick', () => {
                this.app.console.log('info', `Double-clicked media: ${media.filename}`);
                const page = this.app.currentEditor.page;
                const column = {
                    id: this.app.generateId(),
                    width: 12,
                    type: media.media_type,
                    data: { media_id: media.id, caption: '' }
                };
                page.columns.push(column);
                const metadata = this.app.getMediaMetadata(media.id);
                this.app.console.log('info', `Added ${media.media_type} "${metadata.title || media.filename}" to page`);
                this.renderColumns();
            });

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
        modal.className = 'modal active';
        modal.style.zIndex = '2000';
        modal.innerHTML = `
            <div class="modal-content modal-large" style="max-width: 1000px;">
                <div class="modal-header">
                    <h2>${this.app.escapeHtml(title)}</h2>
                    <button class="btn-close">&times;</button>
                </div>
                <div class="modal-body" style="max-height: 80vh; overflow-y: auto;">
                    <div id="pagePreviewContent" style="padding: 20px;"></div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const content = document.getElementById('pagePreviewContent');
        content.style.display = 'flex';
        content.style.flexWrap = 'wrap';
        
        page.columns.forEach(column => {
            const colDiv = document.createElement('div');
            colDiv.style.width = `${(column.width / 12) * 100}%`;
            colDiv.style.padding = '10px';
            colDiv.style.boxSizing = 'border-box';
            
            if (column.type === 'text') {
                colDiv.innerHTML = `<div style="padding: 15px; background: #f9f9f9; border-radius: 4px; white-space: pre-wrap; word-wrap: break-word;">${this.app.escapeHtml(column.data.content)}</div>`;
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
            
            content.appendChild(colDiv);
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
}
