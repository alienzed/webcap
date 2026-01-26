// MediaWeb - Main Application
// =============================================================================

class MediaWeb {
    constructor() {
        this.dataPath = localStorage.getItem('dataPath') || '';
        this.api = null;
        this.media = [];
        this.pages = [];
        this.tags = [];
        this.currentEditor = null;
        this.init();
    }

    async init() {
        this.setupEventListeners();
        await this.ensureDataPath();
        this.loadDataPath();
        if (this.dataPath) {
            await this.loadData();
        }
    }

    async ensureDataPath() {
        if (!this.dataPath) {
            // Get the platform-specific default path from Tauri
            // On Windows: C:\Users\{user}\AppData\Local\mediaweb
            // On macOS: ~/Library/Application Support/mediaweb
            // On Linux: ~/.local/share/mediaweb
            this.dataPath = await window.__TAURI__.invoke('get_default_data_path');
            console.log('Using default data path:', this.dataPath);
            localStorage.setItem('dataPath', this.dataPath);
        }
        if (this.dataPath) {
            this.api = new FileIOAPI(this.dataPath);
            try {
                await this.initializeDataDirectory();
            } catch (err) {
                console.error('Failed to initialize data directory:', err);
            }
        }
    }

    setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => this.switchSection(e));
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboardShortcuts(e));

        // Media Section
        document.getElementById('btnUpload').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });

        document.getElementById('fileInput').addEventListener('change', (e) => {
            this.handleFileUpload(e);
        });

        document.getElementById('btnSelectDataPath').addEventListener('click', async () => {
            await this.selectDataPath();
        });

        // Search and filter
        document.getElementById('searchMedia').addEventListener('input', () => {
            this.filterMedia();
        });

        // Modal controls
        document.querySelectorAll('.modal .btn-close, .modal .btn-secondary').forEach(btn => {
            btn.addEventListener('click', () => this.closeModal());
        });

        document.getElementById('btnSaveMedia').addEventListener('click', () => {
            this.saveMediaMetadata();
        });

        document.getElementById('btnNewPage').addEventListener('click', () => {
            this.openPageEditor({
                id: this.generateId(),
                title: 'Untitled Page',
                slug: 'untitled-page',
                sections: [],
                created: new Date().toISOString(),
                modified: new Date().toISOString()
            });
        });

        document.getElementById('btnSavePage').addEventListener('click', () => {
            this.savePage();
        });

        document.getElementById('btnClosePageEditor').addEventListener('click', () => {
            this.closeModal();
        });

        document.getElementById('btnCloseEditor').addEventListener('click', () => {
            this.closeModal();
        });

        document.getElementById('btnAddSection').addEventListener('click', () => {
            this.addSection();
        });

        document.getElementById('btnAbout').addEventListener('click', () => {
            this.showAbout();
        });
    }

    handleKeyboardShortcuts(e) {
        // Prevent shortcuts when typing in input
        if (e.target.matches('input[type="text"], textarea, input[type="search"]')) {
            if (e.key === 'Escape') {
                e.target.blur();
            }
            return;
        }

        // Navigation shortcuts
        if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey) {
            this.switchToSection('media');
        } else if (e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey) {
            this.switchToSection('pages');
        } else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) {
            this.switchToSection('settings');
        } else if (e.key === '/') {
            e.preventDefault();
            document.getElementById('searchMedia').focus();
        } else if (e.key === 'Escape') {
            this.closeModal();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') {
            e.preventDefault();
            document.getElementById('btnUpload').click();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            const modal = document.querySelector('.modal.active');
            if (modal && document.getElementById('mediaEditorModal').classList.contains('active')) {
                this.saveMediaMetadata();
            } else if (modal && document.getElementById('pageEditorModal').classList.contains('active')) {
                this.savePage();
            }
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
            e.preventDefault();
            const currentSection = document.querySelector('.section.active').id;
            if (currentSection === 'pages') {
                document.getElementById('btnNewPage').click();
            }
        } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            if (this.currentEditor && this.currentEditor.type === 'page') {
                this.addSection();
            }
        }
    }

    switchToSection(sectionId) {
        const item = document.querySelector(`[data-section="${sectionId}"]`);
        if (item) {
            item.click();
        }
    }

    switchSection(e) {
        e.preventDefault();
        const section = e.currentTarget.getAttribute('data-section');

        // Update nav items
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        e.currentTarget.classList.add('active');

        // Update sections
        document.querySelectorAll('.section').forEach(sec => {
            sec.classList.remove('active');
        });
        document.getElementById(section).classList.add('active');

        // Load section data
        if (section === 'media') {
            this.renderMediaGrid();
        } else if (section === 'pages') {
            this.renderPagesList();
        } else if (section === 'settings') {
            this.updateSettingsDisplay();
        }
    }

    async selectDataPath() {
        try {
            const selected = await window.__TAURI__.dialog.open({
                directory: true,
                multiple: false,
                defaultPath: this.dataPath || undefined
            });
            if (selected) {
                this.dataPath = selected;
                localStorage.setItem('dataPath', this.dataPath);
                this.api = new FileIOAPI(this.dataPath);
                await this.initializeDataDirectory();
                await this.loadData();
                this.loadDataPath();
            }
        } catch (err) {
            console.error('Failed to select data path:', err);
        }
    }

    loadDataPath() {
        const display = document.getElementById('dataPathDisplay');
        if (this.dataPath) {
            display.textContent = this.dataPath;
        } else {
            display.textContent = 'Not set - Click "Choose" to set up';
        }
    }

    async initializeDataDirectory() {
        if (!this.api) return;
        try {
            await this.api.initializeDataDir();
            console.log('Initialized data directory:', this.dataPath);
        } catch (err) {
            console.error('Failed to initialize data directory:', err);
        }
    }

    async loadData() {
        if (!this.api) return;
        
        try {
            this.media = await this.api.getMediaList();
            this.pages = await this.api.getPages();
            this.tags = await this.api.getTags();
        } catch (err) {
            console.error('Failed to load data:', err);
            this.media = [];
            this.pages = [];
            this.tags = [];
        }

        this.renderMediaGrid();
        this.renderTagFilter();
    }

    async handleFileUpload(e) {
        if (!this.api) {
            alert('Please set a data path first.');
            return;
        }

        const files = Array.from(e.target.files);
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
        
        for (const file of files) {
            const mediaId = this.generateIdFromFilename(file.name);
            const media = {
                id: mediaId,
                filename: file.name,
                media_type: file.type.startsWith('image') ? 'image' : 'video',
                date: today,
                size: file.size,
                created: new Date().toISOString(),
                modified: new Date().toISOString()
            };

            try {
                // Read file as base64
                const reader = new FileReader();
                const base64Data = await new Promise((resolve, reject) => {
                    reader.onload = (evt) => resolve(evt.target.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });

                // Write actual file to disk in date-based directory
                await this.api.writeBinary(`media/${today}/${file.name}`, base64Data);

                // Create metadata entry
                await this.api.updateMediaMetadata(mediaId, {
                    tags: [],
                    title: '',
                    caption: '',
                    date: today,
                    created: new Date().toISOString(),
                    modified: new Date().toISOString()
                });

                this.media.push(media);
            } catch (err) {
                console.error(`Failed to upload ${file.name}:`, err);
                alert(`Failed to upload ${file.name}: ${err}`);
            }
        }

        await this.loadData();
        this.renderMediaGrid();
        
        // Reset input
        e.target.value = '';
    }

    renderMediaGrid() {
        const grid = document.getElementById('mediaGrid');
        grid.innerHTML = '';

        if (this.media.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1/-1;">
                    <div class="empty-state-icon">🖼️</div>
                    <div class="empty-state-text">No media yet. Upload images or videos to get started.</div>
                </div>
            `;
            return;
        }

        this.media.forEach(media => {
            const item = document.createElement('div');
            item.className = 'media-item';
            
            // Construct file path based on date
            const filePath = media.date 
                ? `${this.api.basePath}/media/${media.date}/${media.filename}`
                : `${this.api.basePath}/media/${media.filename}`;
            
            let thumbnail = '📹';
            
            if (media.media_type === 'image') {
                // Use file:// protocol to load from disk
                thumbnail = `<img src="file:///${filePath.replace(/\\/g, '/')}" alt="${media.filename}">`;
            } else if (media.media_type === 'video') {
                thumbnail = '🎬';
            }

            const metadata = this.getMediaMetadata(media.id);
            const tagsHtml = metadata.tags.map(tag => 
                `<span class="media-item-tag">${this.escapeHtml(tag)}</span>`
            ).join('');

            item.innerHTML = `
                <div class="media-thumbnail">
                    ${thumbnail}
                    <span class="media-type-badge">${media.media_type.toUpperCase()}</span>
                </div>
                <div class="media-info">
                    <div class="media-title">${metadata.title || this.truncate(media.filename, 20)}</div>
                    <div class="media-filename">${this.truncate(media.filename, 25)}</div>
                    <div class="media-item-tags">${tagsHtml}</div>
                </div>
            `;

            item.addEventListener('click', () => this.openMediaEditor(media));
            grid.appendChild(item);
        });
    }

    renderTagFilter() {
        const container = document.getElementById('tagList');
        container.innerHTML = '';

        this.tags.forEach(tag => {
            const span = document.createElement('span');
            span.className = 'tag';
            span.textContent = tag;
            span.addEventListener('click', () => this.toggleTagFilter(tag, span));
            container.appendChild(span);
        });
    }

    toggleTagFilter(tag, element) {
        element.classList.toggle('active');
        this.filterMedia();
    }

    filterMedia() {
        const search = document.getElementById('searchMedia').value.toLowerCase();
        const activeTags = Array.from(document.querySelectorAll('.tag.active')).map(t => t.textContent);

        const filtered = this.media.filter(media => {
            const metadata = this.getMediaMetadata(media.id);
            const matchesSearch = !search || 
                metadata.title.toLowerCase().includes(search) ||
                metadata.caption.toLowerCase().includes(search) ||
                media.filename.toLowerCase().includes(search);

            const matchesTags = activeTags.length === 0 || 
                activeTags.some(tag => metadata.tags.includes(tag));

            return matchesSearch && matchesTags;
        });

        // Re-render with filtered results
        const grid = document.getElementById('mediaGrid');
        grid.innerHTML = '';

        if (filtered.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1/-1;">
                    <div class="empty-state-icon">🔍</div>
                    <div class="empty-state-text">No media matches your filter.</div>
                </div>
            `;
            return;
        }

        filtered.forEach(media => {
            const item = document.createElement('div');
            item.className = 'media-item';
            
            const fileData = localStorage.getItem(`mediaweb_file_${media.id}`);
            let thumbnail = media.media_type === 'image' ? '🖼️' : '📹';
            
            if (media.media_type === 'image' && fileData) {
                thumbnail = `<img src="${fileData}" alt="${media.filename}">`;
            }

            const metadata = this.getMediaMetadata(media.id);
            const tagsHtml = metadata.tags.map(tag => 
                `<span class="media-item-tag">${this.escapeHtml(tag)}</span>`
            ).join('');

            item.innerHTML = `
                <div class="media-thumbnail">
                    ${thumbnail}
                    <span class="media-type-badge">${media.media_type.toUpperCase()}</span>
                </div>
                <div class="media-info">
                    <div class="media-title">${metadata.title || this.truncate(media.filename, 20)}</div>
                    <div class="media-filename">${this.truncate(media.filename, 25)}</div>
                    <div class="media-item-tags">${tagsHtml}</div>
                </div>
            `;

            item.addEventListener('click', () => this.openMediaEditor(media));
            grid.appendChild(item);
        });
    }

    openMediaEditor(media) {
        this.currentEditor = { type: 'media', media };
        const metadata = this.getMediaMetadata(media.id);

        const preview = document.getElementById('mediaPreview');
        const fileData = localStorage.getItem(`mediaweb_file_${media.id}`);
        
        if (fileData && media.media_type === 'image') {
            preview.innerHTML = `<img src="${fileData}" alt="${media.filename}">`;
        } else if (fileData && media.media_type === 'video') {
            preview.innerHTML = `<video controls><source src="${fileData}"></video>`;
        } else {
            preview.innerHTML = `<div style="text-align: center; padding: 60px; color: #ccc;">Preview not available</div>`;
        }

        document.getElementById('mediaTitle').value = metadata.title;
        document.getElementById('mediaCaption').value = metadata.caption;
        
        // Render tags
        this.renderMediaTagsInput(metadata.tags);

        document.getElementById('mediaEditorModal').classList.add('active');
    }

    renderMediaTagsInput(tags) {
        const container = document.getElementById('mediaTagsContainer');
        container.innerHTML = '';

        tags.forEach(tag => {
            const chip = document.createElement('div');
            chip.className = 'tag-chip';
            chip.innerHTML = `
                ${this.escapeHtml(tag)}
                <button class="tag-chip-remove" type="button">&times;</button>
            `;
            chip.querySelector('.tag-chip-remove').addEventListener('click', () => {
                chip.remove();
            });
            container.appendChild(chip);
        });

        const input = document.getElementById('mediaTagInput');
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const tag = input.value.trim();
                if (tag && !tags.includes(tag)) {
                    const chip = document.createElement('div');
                    chip.className = 'tag-chip';
                    chip.innerHTML = `
                        ${this.escapeHtml(tag)}
                        <button class="tag-chip-remove" type="button">&times;</button>
                    `;
                    chip.querySelector('.tag-chip-remove').addEventListener('click', () => {
                        chip.remove();
                    });
                    container.appendChild(chip);
                    input.value = '';
                }
            }
        });
    }

    async saveMediaMetadata() {
        if (!this.currentEditor || this.currentEditor.type !== 'media') return;

        const media = this.currentEditor.media;
        const metadata = {
            title: document.getElementById('mediaTitle').value,
            caption: document.getElementById('mediaCaption').value,
            tags: Array.from(document.querySelectorAll('#mediaTagsContainer .tag-chip'))
                .map(chip => chip.textContent.trim().replace('×', '').trim()),
            created: new Date(media.created).toISOString(),
            modified: new Date().toISOString(),
            crop: null,
            rotation: null
        };

        this.setMediaMetadata(media.id, metadata);

        // Add new tags to global registry
        metadata.tags.forEach(tag => {
            if (!this.tags.includes(tag)) {
                this.tags.push(tag);
            }
        });
        this.tags.sort();

        this.saveToDisk();
        this.closeModal();
        this.renderMediaGrid();
        this.renderTagFilter();
    }

    renderPagesList() {
        const list = document.getElementById('pagesList');
        list.innerHTML = '';

        if (this.pages.length === 0) {
            list.innerHTML = `
                <div class="empty-state" style="grid-column: 1/-1;">
                    <div class="empty-state-icon">📄</div>
                    <div class="empty-state-text">No pages yet. Create one to get started.</div>
                </div>
            `;
            return;
        }

        this.pages.forEach(page => {
            const card = document.createElement('div');
            card.className = 'page-card';
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-icon' ;
            deleteBtn.textContent = '🗑️';
            deleteBtn.style.position = 'absolute';
            deleteBtn.style.top = '10px';
            deleteBtn.style.right = '10px';
            deleteBtn.style.width = '32px';
            deleteBtn.style.height = '32px';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Delete page "${page.title}"?`)) {
                    const idx = this.pages.findIndex(p => p.id === page.id);
                    if (idx >= 0) {
                        this.pages.splice(idx, 1);
                        this.saveToDisk();
                        this.renderPagesList();
                    }
                }
            });

            card.style.position = 'relative';
            card.innerHTML = `
                <div class="page-card-title">${this.escapeHtml(page.title)}</div>
                <div class="page-card-slug">/${page.slug}</div>
                <div class="page-card-meta">
                    <span>${page.sections.length} sections</span>
                    <span>${this.formatDate(page.modified)}</span>
                </div>
            `;
            card.appendChild(deleteBtn);
            card.addEventListener('click', () => this.openPageEditor(page));
            list.appendChild(card);
        });
    }

    openPageEditor(page) {
        this.currentEditor = { type: 'page', page: JSON.parse(JSON.stringify(page)) };

        document.getElementById('pageTitle').value = page.title;
        document.getElementById('pageSlug').value = page.slug;

        const canvas = document.getElementById('pageCanvas');
        canvas.innerHTML = '';

        if (page.sections.length === 0) {
            canvas.innerHTML = '<div class="empty-state"><div class="empty-state-text">No sections yet. Click "+ Add Section" to start building your page.</div></div>';
        } else {
            page.sections.forEach((section, idx) => {
                this.renderSection(section, idx, canvas);
            });
        }

        document.getElementById('pageEditorModal').classList.add('active');
    }

    renderSection(section, idx, canvas) {
        const secDiv = document.createElement('div');
        secDiv.className = 'section-block';
        secDiv.setAttribute('data-section-id', section.id);
        secDiv.innerHTML = `
            <div class="section-header-bar">
                <h3>Section ${idx + 1}</h3>
                <div>
                    <button class="section-btn" data-action="delete" title="Delete section">🗑️</button>
                </div>
            </div>
            <div class="blocks-container"></div>
            <button class="btn btn-secondary" style="margin-top: 10px; width: 100%;">+ Add Block to Section</button>
        `;

        const blocksContainer = secDiv.querySelector('.blocks-container');
        if (section.blocks.length === 0) {
            blocksContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #ccc;">No blocks in this section</div>';
        } else {
            section.blocks.forEach((block, bIdx) => {
                const blockDiv = this.createBlockElement(block, bIdx, section);
                blocksContainer.appendChild(blockDiv);
            });
        }

        const deleteBtn = secDiv.querySelector('[data-action="delete"]');
        deleteBtn.addEventListener('click', () => {
            const page = this.currentEditor.page;
            const sectionIdx = page.sections.findIndex(s => s.id === section.id);
            if (sectionIdx >= 0) {
                page.sections.splice(sectionIdx, 1);
                secDiv.remove();
            }
        });

        secDiv.querySelector('button:last-child').addEventListener('click', () => {
            const blockType = prompt('Block type (text, image, gallery, video):');
            if (blockType) {
                this.addBlockToSection(section, blockType);
                secDiv.querySelector('button:last-child').remove();
                this.renderSection(section, idx, canvas.parentElement);
            }
        });

        canvas.appendChild(secDiv);
    }

    createBlockElement(block, idx, section) {
        const div = document.createElement('div');
        div.className = 'block';
        div.setAttribute('data-block-id', block.id);

        let content = '';
        if (block.type === 'Text') {
            content = `<div class="block-content"><strong>Text:</strong> ${this.truncate(block.data.content, 50)}</div>`;
        } else if (block.type === 'Image') {
            const mediaTitle = this.getMediaTitle(block.data.media_id);
            content = `<div class="block-content"><strong>Image:</strong> ${mediaTitle || block.data.media_id}</div>`;
        } else if (block.type === 'Gallery') {
            content = `<div class="block-content"><strong>Gallery:</strong> ${block.data.query_id} (${block.data.layout})</div>`;
        } else if (block.type === 'Video') {
            const mediaTitle = this.getMediaTitle(block.data.media_id);
            content = `<div class="block-content"><strong>Video:</strong> ${mediaTitle || block.data.media_id}</div>`;
        }

        div.innerHTML = `
            ${content}
            <div class="block-toolbar">
                <button data-action="edit">Edit</button>
                <button data-action="delete">Delete</button>
            </div>
        `;

        const editBtn = div.querySelector('[data-action="edit"]');
        const deleteBtn = div.querySelector('[data-action="delete"]');

        editBtn.addEventListener('click', () => this.editBlock(block, section));
        deleteBtn.addEventListener('click', () => {
            const blockIdx = section.blocks.findIndex(b => b.id === block.id);
            if (blockIdx >= 0) {
                section.blocks.splice(blockIdx, 1);
                div.remove();
            }
        });

        return div;
    }

    editBlock(block, section) {
        const title = block.type === 'Text' ? 'Edit Text Block' : `Edit ${block.type} Block`;
        let content = prompt(`Edit block content:\n(JSON format)\n\n${JSON.stringify(block.data, null, 2)}`);
        
        if (content) {
            try {
                block.data = JSON.parse(content);
            } catch (e) {
                alert('Invalid JSON format');
            }
        }
    }

    getMediaTitle(mediaId) {
        const media = this.media.find(m => m.id === mediaId);
        if (!media) return null;
        const metadata = this.getMediaMetadata(mediaId);
        return metadata.title || media.filename;
    }

    addSection() {
        if (!this.currentEditor || this.currentEditor.type !== 'page') return;

        const page = this.currentEditor.page;
        const section = {
            id: this.generateId(),
            order: page.sections.length,
            blocks: []
        };

        page.sections.push(section);

        const canvas = document.getElementById('pageCanvas');
        this.renderSection(section, page.sections.length - 1, canvas);
    }

    addBlockToSection(section, blockType) {
        const block = {
            id: this.generateId(),
            order: section.blocks.length,
            type: blockType,
            data: {}
        };

        if (blockType === 'text') {
            block.data = { content: '' };
        } else if (blockType === 'image' || blockType === 'video') {
            block.data = { media_id: '', caption: '' };
        } else if (blockType === 'gallery') {
            block.data = { query_id: '', layout: 'grid' };
        }

        section.blocks.push(block);
    }

    async savePage() {
        if (!this.currentEditor || this.currentEditor.type !== 'page') return;

        const page = this.currentEditor.page;
        page.title = document.getElementById('pageTitle').value;
        page.slug = document.getElementById('pageSlug').value;
        page.modified = new Date().toISOString();

        // Check if this is a new page or update
        const existingIdx = this.pages.findIndex(p => p.id === page.id);
        if (existingIdx >= 0) {
            this.pages[existingIdx] = page;
        } else {
            this.pages.push(page);
        }

        this.saveToDisk();
        this.closeModal();
        this.renderPagesList();
    }

    closeModal() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.remove('active');
        });
        document.getElementById('mediaTagInput').value = '';
        this.currentEditor = null;
    }

    updateSettingsDisplay() {
        document.getElementById('infoMediaCount').textContent = this.media.length;
        document.getElementById('infoPagesCount').textContent = this.pages.length;
        document.getElementById('infoTagsCount').textContent = this.tags.length;
    }

    saveToDisk() {
        localStorage.setItem('mediaweb_media', JSON.stringify(this.media));
        localStorage.setItem('mediaweb_pages', JSON.stringify(this.pages));
        localStorage.setItem('mediaweb_tags', JSON.stringify(this.tags));
    }

    getMediaMetadata(mediaId) {
        const stored = localStorage.getItem(`mediaweb_meta_${mediaId}`);
        return stored ? JSON.parse(stored) : {
            title: '',
            caption: '',
            tags: [],
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
            crop: null,
            rotation: null
        };
    }

    setMediaMetadata(mediaId, metadata) {
        localStorage.setItem(`mediaweb_meta_${mediaId}`, JSON.stringify(metadata));
    }

    generateId() {
        return 'id_' + Math.random().toString(36).substr(2, 9);
    }

    generateIdFromFilename(filename) {
        const ext = filename.split('.').pop();
        const name = filename.replace('.' + ext, '');
        return name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Math.random().toString(36).substr(2, 5);
    }

    truncate(str, len) {
        return str.length > len ? str.substr(0, len) + '...' : str;
    }

    escapeHtml(text) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    formatDate(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    showAbout() {
        const aboutHtml = `
            <div style="text-align: center;">
                <svg class="logo-icon" style="width: 80px; height: 80px; margin-bottom: 20px;" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                        <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" style="stop-color:#FF8C42;stop-opacity:1" />
                            <stop offset="100%" style="stop-color:#6B7280;stop-opacity:1" />
                        </linearGradient>
                    </defs>
                    <circle cx="50" cy="50" r="48" fill="url(#logoGradient)" opacity="0.2"/>
                    <rect x="20" y="20" width="60" height="60" fill="none" stroke="url(#logoGradient)" stroke-width="2"/>
                    <circle cx="35" cy="35" r="4" fill="url(#logoGradient)"/>
                    <path d="M20 80 L35 50 L55 65 L80 30" fill="none" stroke="url(#logoGradient)" stroke-width="2"/>
                </svg>
                <h2 style="margin-bottom: 10px;">MediaWeb v0.1.0</h2>
                <p style="margin: 10px 0; color: #6B7280;">A portable, offline-first Media CMS + Page Builder</p>
                <hr style="margin: 20px 0; border: none; border-top: 1px solid #E5E7EB;">
                <p style="font-size: 0.9rem; color: #6B7280; margin-bottom: 15px;">Built with Tauri, Rust, and vanilla JavaScript</p>
                <p style="font-size: 0.9rem; color: #6B7280; margin-bottom: 15px;">All data stored locally in human-readable JSON</p>
                <p style="font-size: 0.9rem; color: #9CA3AF;">
                    <strong>Keyboard:</strong> M=Media, P=Pages, S=Settings, /=Search, Esc=Close
                </p>
                <p style="font-size: 0.85rem; color: #9CA3AF; margin-top: 20px;">
                    © 2025 · Made for creative professionals · MIT License
                </p>
            </div>
        `;

        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 400px;">
                <div class="modal-header">
                    <h2>About</h2>
                    <button class="btn-close">&times;</button>
                </div>
                <div class="modal-body">
                    ${aboutHtml}
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
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new MediaWeb();
});
