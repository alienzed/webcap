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
            card.className = 'page-card';
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-icon';
            deleteBtn.textContent = '🗑️';
            deleteBtn.title = 'Delete this page';
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
            
            const viewBtn = document.createElement('button');
            viewBtn.className = 'btn btn-icon';
            viewBtn.textContent = '👁️';
            viewBtn.title = 'View Full Screen';
            viewBtn.style.position = 'absolute';
            viewBtn.style.top = '10px';
            viewBtn.style.right = '50px';
            viewBtn.style.width = '32px';
            viewBtn.style.height = '32px';
            viewBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.viewFullScreen(page);
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
            card.appendChild(viewBtn);
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
        canvas.style.display = 'flex';
        canvas.style.flexWrap = 'wrap';
        canvas.style.gap = '10px';
        canvas.style.minHeight = '400px';
        canvas.style.padding = '20px';
        canvas.style.background = 'white';
        canvas.style.boxSizing = 'border-box';
        
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
        document.getElementById('pageEditor').style.display = 'block';
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
        placeholder.style.cssText = 'flex: 0 0 100%; padding: 15px 10px; box-sizing: border-box; background: #fafafa; border-radius: 8px; margin: 0 10px;';
        
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.textContent = 'Add text block';
        addBtn.className = 'btn btn-primary';
        addBtn.style.width = '100%';
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
        div.className = 'page-column';
        div.dataset.columnId = column.id;
        
        // Calculate width with proper gap handling for flexbox
        // With gap: 10px, for n items filling the row, total gaps = (n-1) * 10px
        const widthPercent = (column.width / 12) * 100;
        const itemsPerRow = 12 / column.width;
        const totalGaps = (itemsPerRow - 1) * 10;
        const gapPerItem = totalGaps / itemsPerRow;
        
        // Add extra buffer to ensure no wrapping (browsers can be inconsistent with calc)
        const adjustedGap = gapPerItem + 1;
        
        div.style.flex = `0 0 calc(${widthPercent}% - ${adjustedGap}px)`;
        div.style.maxWidth = `calc(${widthPercent}% - ${adjustedGap}px)`;
        div.style.minWidth = '0';
        div.style.padding = '10px';
        div.style.boxSizing = 'border-box';
        div.style.position = 'relative';
        
        // Create toolbar at TOP
        const toolbar = document.createElement('div');
        toolbar.className = 'column-toolbar';
        toolbar.style.cssText = 'display: flex; gap: 5px; margin-bottom: 8px; padding: 8px; background: #f5f5f5; border-radius: 4px; opacity: 0; transition: opacity 0.2s;';
        
        const moveupBtn = document.createElement('button');
        moveupBtn.type = 'button';
        moveupBtn.textContent = '▲';
        moveupBtn.title = 'Move Up';
        moveupBtn.style.cssText = 'padding: 6px 10px; font-size: 14px; border: 1px solid #ddd; background: white; border-radius: 3px; cursor: pointer; font-weight: bold;';
        
        const movedownBtn = document.createElement('button');
        movedownBtn.type = 'button';
        movedownBtn.textContent = '▼';
        movedownBtn.title = 'Move Down';
        movedownBtn.style.cssText = 'padding: 6px 10px; font-size: 14px; border: 1px solid #ddd; background: white; border-radius: 3px; cursor: pointer; font-weight: bold;';
        
        const widthBtn = document.createElement('button');
        widthBtn.type = 'button';
        widthBtn.textContent = `${column.width}/12`;
        widthBtn.title = `Width: ${column.width}/12`;
        widthBtn.style.cssText = 'padding: 6px 10px; font-size: 12px; border: 1px solid #ddd; background: white; border-radius: 3px; cursor: pointer; font-weight: 500;';
        
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.textContent = '🗑️';
        deleteBtn.title = 'Delete';
        deleteBtn.style.cssText = 'padding: 6px 10px; font-size: 14px; border: 1px solid #ddd; background: white; border-radius: 3px; cursor: pointer; margin-left: auto;';
        
        toolbar.appendChild(moveupBtn);
        toolbar.appendChild(movedownBtn);
        toolbar.appendChild(widthBtn);
        toolbar.appendChild(deleteBtn);
        
        // Create content container
        const contentContainer = document.createElement('div');
        contentContainer.style.position = 'relative';
        
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
            
            // Make text clickable to edit
            const textContent = contentContainer.querySelector('[data-text-content]');
            if (textContent) {
                textContent.style.cursor = 'text';
                textContent.addEventListener('click', () => {
                    this.editTextInline(div, column);
                });
            }
        } else if (column.type === 'image' || column.type === 'video') {
            if (column.data.media_id) {
                const media = this.app.media.find(m => m.id === column.data.media_id);
                if (media) {
                    const fileUrl = this.app.getMediaFileUrl(media);
                    const mediaWrapper = document.createElement('div');
                    mediaWrapper.style.cssText = 'border: 2px solid #ddd; border-radius: 4px; overflow: hidden; position: relative;';
                    
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
                    
                    // Add floating edit button
                    const editBtn = document.createElement('button');
                    editBtn.type = 'button';
                    editBtn.textContent = '✏️ Edit';
                    editBtn.style.cssText = 'position: absolute; top: 10px; right: 10px; padding: 6px 12px; background: rgba(255, 255, 255, 0.95); border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-size: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); opacity: 0; transition: opacity 0.2s;';
                    editBtn.addEventListener('click', () => {
                        const media = this.app.media.find(m => m.id === column.data.media_id);
                        if (media) {
                            this.app.mediaManager.openEditor(media);
                        }
                    });
                    
                    mediaWrapper.appendChild(editBtn);
                    mediaWrapper.addEventListener('mouseenter', () => {
                        editBtn.style.opacity = '1';
                    });
                    mediaWrapper.addEventListener('mouseleave', () => {
                        editBtn.style.opacity = '0';
                    });
                    
                    contentContainer.appendChild(mediaWrapper);
                }
            }
        }
        
        div.appendChild(toolbar);
        div.appendChild(contentContainer);
        
        // Hover effects for toolbar
        div.addEventListener('mouseenter', () => {
            toolbar.style.opacity = '1';
            div.style.background = '#fafafa';
        });
        div.addEventListener('mouseleave', () => {
            toolbar.style.opacity = '0';
            div.style.background = '';
        });

        moveupBtn.addEventListener('click', () => {
            const page = this.app.currentEditor.page;
            const colIdx = page.columns.findIndex(c => c.id === column.id);
            if (colIdx > 0) {
                [page.columns[colIdx - 1], page.columns[colIdx]] = [page.columns[colIdx], page.columns[colIdx - 1]];
                this.renderColumns();
            }
        });

        movedownBtn.addEventListener('click', () => {
            const page = this.app.currentEditor.page;
            const colIdx = page.columns.findIndex(c => c.id === column.id);
            if (colIdx < page.columns.length - 1) {
                [page.columns[colIdx + 1], page.columns[colIdx]] = [page.columns[colIdx], page.columns[colIdx + 1]];
                this.renderColumns();
            }
        });

        widthBtn.addEventListener('click', () => {
            const widths = [3, 4, 6, 8, 12];
            const currentIdx = widths.indexOf(column.width);
            const nextIdx = (currentIdx + 1) % widths.length;
            column.width = widths[nextIdx];
            this.renderColumns();
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
        
        // Initialize formatting data if not present
        if (!column.data.textType) column.data.textType = 'p';
        if (!column.data.textAlign) column.data.textAlign = 'left';
        
        const originalContent = contentDiv.innerHTML;
        contentDiv.innerHTML = '';
        
        // Create toolbar
        const toolbar = document.createElement('div');
        toolbar.className = 'text-toolbar';
        toolbar.style.cssText = 'display: flex; gap: 8px; margin-bottom: 10px; align-items: center; flex-wrap: wrap; padding: 12px; background: #f5f5f5; border-radius: 4px;';
        
        // Type selector buttons (instead of dropdown)
        const typeGroup = document.createElement('div');
        typeGroup.style.cssText = 'display: flex; gap: 4px; padding-right: 8px; border-right: 1px solid #ddd;';
        
        const types = [
            { value: 'p', label: 'P' },
            { value: 'h1', label: 'H1' },
            { value: 'h2', label: 'H2' },
            { value: 'h3', label: 'H3' }
        ];
        
        types.forEach(type => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = type.label;
            btn.style.cssText = 'padding: 6px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px; background: white; cursor: pointer; font-weight: 500;';
            if (column.data.textType === type.value) {
                btn.style.background = '#FF8C42';
                btn.style.color = 'white';
                btn.style.borderColor = '#FF8C42';
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
                btn.style.background = isActive ? '#FF8C42' : 'white';
                btn.style.color = isActive ? 'white' : 'black';
                btn.style.borderColor = isActive ? '#FF8C42' : '#ddd';
            });
        };
        
        // Alignment buttons
        const alignGroup = document.createElement('div');
        alignGroup.style.cssText = 'display: flex; gap: 4px;';
        
        const alignLeft = document.createElement('button');
        alignLeft.type = 'button';
        alignLeft.textContent = '≡';
        alignLeft.title = 'Align Left';
        alignLeft.style.cssText = 'padding: 6px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 16px; background: white; cursor: pointer; font-family: monospace;';
        if (column.data.textAlign === 'left') {
            alignLeft.style.background = '#FF8C42';
        }
        alignLeft.addEventListener('click', () => {
            column.data.textAlign = 'left';
            updateAlignButtons();
        });
        
        const alignCenter = document.createElement('button');
        alignCenter.type = 'button';
        alignCenter.textContent = '≣';
        alignCenter.title = 'Align Center';
        alignCenter.style.cssText = 'padding: 6px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 16px; background: white; cursor: pointer; font-family: monospace;';
        if (column.data.textAlign === 'center') {
            alignCenter.style.background = '#FF8C42';
        }
        alignCenter.addEventListener('click', () => {
            column.data.textAlign = 'center';
            updateAlignButtons();
        });
        
        const alignRight = document.createElement('button');
        alignRight.type = 'button';
        alignRight.textContent = '≡';
        alignRight.title = 'Align Right';
        alignRight.style.cssText = 'padding: 6px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 16px; background: white; cursor: pointer; font-family: monospace;';
        if (column.data.textAlign === 'right') {
            alignRight.style.background = '#FF8C42';
        }
        alignRight.addEventListener('click', () => {
            column.data.textAlign = 'right';
            updateAlignButtons();
        });
        
        const updateAlignButtons = () => {
            alignLeft.style.background = column.data.textAlign === 'left' ? '#FF8C42' : 'white';
            alignCenter.style.background = column.data.textAlign === 'center' ? '#FF8C42' : 'white';
            alignRight.style.background = column.data.textAlign === 'right' ? '#FF8C42' : 'white';
        };
        
        alignGroup.appendChild(alignLeft);
        alignGroup.appendChild(alignCenter);
        alignGroup.appendChild(alignRight);
        
        // Help text
        const helpText = document.createElement('span');
        helpText.style.cssText = 'font-size: 11px; color: #666; margin-left: auto;';
        helpText.textContent = 'Ctrl+Enter to save, Esc to cancel';
        
        toolbar.appendChild(typeGroup);
        toolbar.appendChild(alignGroup);
        toolbar.appendChild(helpText);
        
        // Create textarea
        const textarea = document.createElement('textarea');
        textarea.value = column.data.content || '';
        textarea.className = 'text-editor-textarea';
        textarea.style.cssText = 'width: 100%; min-height: 100px; padding: 12px; border: 1px solid #ddd; border-radius: 4px; font-family: inherit; font-size: 14px; resize: vertical; box-sizing: border-box;';
        
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
        header.textContent = '� Double-click to add media to page';
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

            item.style.cssText = 'cursor: pointer; padding: 4px; border: 1px solid #ddd; border-radius: 4px; background: white; user-select: none; transition: all 0.2s;';
            
            item.addEventListener('mouseenter', () => {
                item.style.borderColor = '#FF8C42';
                item.style.boxShadow = '0 2px 4px rgba(255,140,66,0.2)';
            });
            
            item.addEventListener('mouseleave', () => {
                item.style.borderColor = '#ddd';
                item.style.boxShadow = 'none';
            });
            
            // Double-click to add media
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
    
    viewFullScreen(page) {
        this.app.console.log('info', `Viewing "${page.title}" full screen`);
        
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.style.zIndex = '3000';
        
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
        document.getElementById('pages').style.display = 'block';
        document.getElementById('pageEditor').style.display = 'none';
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
            
            columnsHTML += `
                <div style="width: ${widthPercent}%; padding: 10px; box-sizing: border-box; float: left;">
                    ${content}
                </div>
            `;
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
