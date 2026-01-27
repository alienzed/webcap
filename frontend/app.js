// MediaWeb - Main Application
// =============================================================================

class MediaWeb {
    constructor() {
        this.dataPath = '';
        this.api = null;
        this.media = [];
        this.pages = [];
        this.tags = [];
        this.currentEditor = null;
        this.consoleVisible = false;
        this.consoleEntries = [];
        this.configPath = null; // Will be set after getting user's config dir
        
        // Store original console methods BEFORE interception
        this.originalConsole = {
            log: console.log.bind(console),
            warn: console.warn.bind(console),
            error: console.error.bind(console)
        };
        
        // Intercept console methods before init
        this.setupConsoleInterception();
        this.init();
    }

    setupConsoleInterception() {
        // Override console.log to send to in-app console
        console.log = (...args) => {
            this.originalConsole.log.apply(console, args);
            const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
            this.log('info', message);
        };

        // Override console.warn
        console.warn = (...args) => {
            this.originalConsole.warn.apply(console, args);
            const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
            this.log('warn', message);
        };

        // Override console.error
        console.error = (...args) => {
            this.originalConsole.error.apply(console, args);
            const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
            this.log('error', message);
        };

        // Also capture uncaught errors
        window.addEventListener('error', (event) => {
            this.log('error', `Uncaught error: ${event.message} at ${event.filename}:${event.lineno}`);
        });

        // Capture unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            this.log('error', `Unhandled promise rejection: ${event.reason}`);
        });
    }

    async init() {
        this.setupEventListeners();
        await this.ensureDataPath();
        this.loadDataPath();
        if (this.dataPath) {
            await this.loadData();
        }
    }

    async loadConfig() {
        const tauriInvoke = window.__TAURI__?.core?.invoke;
        if (!tauriInvoke) {
            this.log('warn', 'Tauri API not available, cannot load config');
            return null;
        }

        try {
            // Get user's config directory
            this.log('info', 'Loading config: getting config directory...');
            const configDir = await tauriInvoke('get_default_data_path');
            this.configPath = `${configDir}/../mediaweb-config.json`;
            this.log('info', `Config path: ${this.configPath}`);
            
            // Try to read config file
            this.log('info', `Reading config from: ${configDir}/.. → mediaweb-config.json`);
            const configContent = await tauriInvoke('file_io', {
                op: 'read',
                dataPath: configDir + '/..',
                relPath: 'mediaweb-config.json',
                payload: null
            });
            
            const config = JSON.parse(configContent);
            this.log('info', `✓ Loaded saved config: ${config.dataPath}`);
            return config;
        } catch (err) {
            // Config file doesn't exist yet, that's okay
            this.log('info', `No existing config file (${err.message || err})`);
            return null;
        }
    }

    async saveConfig() {
        const tauriInvoke = window.__TAURI__?.core?.invoke;
        if (!tauriInvoke) {
            this.log('warn', 'Cannot save config: Tauri API not available');
            return;
        }
        if (!this.configPath) {
            this.log('warn', 'Cannot save config: configPath not set');
            return;
        }
        if (!this.dataPath) {
            this.log('warn', 'Cannot save config: dataPath not set');
            return;
        }

        try {
            const config = {
                dataPath: this.dataPath,
                lastUsed: new Date().toISOString()
            };
            
            this.log('info', `Saving config to: ${this.configPath}`);
            this.log('info', `Config content: ${JSON.stringify(config)}`);
            
            const lastSlash = Math.max(this.configPath.lastIndexOf('/'), this.configPath.lastIndexOf('\\'));
            const configDir = lastSlash >= 0 ? this.configPath.substring(0, lastSlash) : this.configPath;
            this.log('info', `Config dir: ${configDir}, relPath: mediaweb-config.json`);
            
            await tauriInvoke('file_io', {
                op: 'write',
                dataPath: configDir,
                relPath: 'mediaweb-config.json',
                payload: JSON.stringify(config, null, 2)
            });
            
            this.log('info', '✓ Configuration saved successfully');
        } catch (err) {
            this.log('error', `Failed to save config: ${err.message || err}`);
        }
    }

    async ensureDataPath() {
        console.log('ensureDataPath: starting, current dataPath:', this.dataPath);

        // Prefer Tauri global API (v2: core.invoke)
        const tauriInvoke = window.__TAURI__?.core?.invoke;

        // First, try to load saved config
        const config = await this.loadConfig();
        if (config && config.dataPath) {
            this.dataPath = config.dataPath;
            this.log('info', `Restored saved path: ${this.dataPath}`);
        }

        if (!this.dataPath) {
            try {
                if (tauriInvoke) {
                    console.log('ensureDataPath: invoking get_default_data_path...');
                    // Get the platform-specific default path from Tauri
                    this.dataPath = await tauriInvoke('get_default_data_path');
                    console.log('ensureDataPath: got path:', this.dataPath);
                    this.log('info', `Path set to ${this.dataPath}`);
                    await this.saveConfig();
                } else {
                    console.warn('ensureDataPath: Tauri API not available, using local fallback path');
                    // Fallback to a relative data directory next to the app (works in browser too)
                    this.dataPath = './mediaweb-data';
                    this.log('info', `Path set to ${this.dataPath} (fallback)`);
                }
            } catch (err) {
                console.error('ensureDataPath: Failed to get default data path:', err);
                // Last resort: prompt the user
                const manual = prompt('Enter a data directory path to use:', this.dataPath || './mediaweb-data');
                if (manual) {
                    this.dataPath = manual;
                    this.log('info', `Path set to ${this.dataPath} (manual)`);
                    await this.saveConfig();
                } else {
                    this.log('error', 'No data directory selected');
                    this.log('error', 'No data directory selected. Please click "Choose" to select one.');
                    return;
                }
            }
        }

        console.log('ensureDataPath: creating FileIOAPI with path:', this.dataPath);

        if (this.dataPath) {
            this.api = new FileIOAPI(this.dataPath);
            console.log('ensureDataPath: FileIOAPI created, api:', this.api);
            this.log('info', `Initializing data directory: ${this.dataPath}`);
            try {
                await this.initializeDataDirectory();
                this.log('info', 'Data directory initialized successfully');
                console.log('ensureDataPath: data directory initialized');
            } catch (err) {
                this.log('error', `Failed to initialize data directory: ${err}`);
                console.error('ensureDataPath: Failed to initialize data directory:', err);
            }
        } else {
            console.error('ensureDataPath: dataPath is still null/empty after trying to set it');
        }
    }

    setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const section = e.currentTarget.getAttribute('data-section');
                this.log('info', `Navigated to ${section || 'section'}`);
                this.switchSection(e);
            });
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboardShortcuts(e));

        // Media Section
        document.getElementById('btnUpload').addEventListener('click', async () => {
            if (!this.api) {
                // Try to set or select a data path first
                await this.selectDataPath();
                if (!this.api) {
                    this.log('error', 'Please choose a data directory first.');
                    return;
                }
            }
            document.getElementById('fileInput').click();
        });

        document.getElementById('fileInput').addEventListener('change', (e) => {
            this.handleFileUpload(e);
        });

        document.getElementById('btnSelectDataPath').addEventListener('click', async () => {
            this.log('info', 'Selecting data directory...');
            await this.selectDataPath();
        });

        // Search and filter
        document.getElementById('searchMedia').addEventListener('input', () => {
            this.filterMedia();
        });

        // Modal controls
        document.querySelectorAll('.modal .btn-close').forEach(btn => {
            btn.addEventListener('click', () => this.closeModal());
        });

        document.getElementById('btnClearConsole').addEventListener('click', () => {
            this.clearConsole();
        });

        document.getElementById('btnToggleConsole').addEventListener('click', () => {
            this.toggleConsole();
        });

        document.getElementById('btnSaveMedia').addEventListener('click', () => {
            this.saveMediaMetadata();
        });

        document.getElementById('btnNewPage').addEventListener('click', () => {
            this.log('info', 'Creating new page...');
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

        document.getElementById('btnCancelPicker').addEventListener('click', () => {
            document.getElementById('mediaPickerModal').classList.remove('active');
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
            const dialogOpen = window.__TAURI__?.dialog?.open;
            let selected = null;

            if (dialogOpen) {
                selected = await dialogOpen({
                    directory: true,
                    multiple: false,
                    defaultPath: this.dataPath || undefined
                });
            } else {
                // Fallback: simple prompt if dialog API is not available
                selected = prompt('Enter a data directory path to use:', this.dataPath || './mediaweb-data');
            }

            if (selected) {
                this.dataPath = selected;
                this.log('info', `Path set to ${this.dataPath}`);
                await this.saveConfig();
                this.api = new FileIOAPI(this.dataPath);
                await this.initializeDataDirectory();
                await this.loadData();
                this.loadDataPath();
            }
        } catch (err) {
            console.error('Failed to select data path:', err);
            this.log('error', `Failed to select path: ${err}`);
            this.log('error', `Could not open directory picker: ${err.message}`);
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
            this.log('info', 'Creating directory structure...');
            await this.api.initializeDataDir();
            this.log('info', `✓ Data directory ready at: ${this.dataPath}`);
        } catch (err) {
            this.log('error', `Failed to initialize data directory: ${err.message || err}`);
        }
    }

    async loadData() {
        if (!this.api) return;
        
        try {
            this.log('info', 'Loading media, pages, and tags...');
            this.media = await this.api.getMediaList();
            this.pages = await this.api.getPages();
            this.tags = await this.api.getTags();
            this.log('info', `Loaded: ${this.media.length} media items, ${this.pages.length} pages, ${this.tags.length} tags`);
        } catch (err) {
            this.log('error', `Failed to load data: ${err.message || err}`);
            this.media = [];
            this.pages = [];
            this.tags = [];
        }

        this.renderMediaGrid();
        this.renderTagFilter();
    }

    async handleFileUpload(e) {
        if (!this.api) {
            this.log('error', 'Please set a data path first.');
            return;
        }

        const files = Array.from(e.target.files);
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
        
        this.log('info', `Starting upload of ${files.length} file(s)...`);
        
        let successCount = 0;
        let failCount = 0;

        for (const file of files) {
            const mediaId = this.generateIdFromFilename(file.name);
            this.log('info', `Uploading: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
            
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

                this.log('info', `  → Encoded to base64, writing to disk...`);

                // Write actual file to disk in date-based directory
                await this.api.writeBinary(`media/${today}/${file.name}`, base64Data);

                this.log('info', `  → File saved to media/${today}/${file.name}`);

                // Create metadata entry
                await this.api.updateMediaMetadata(mediaId, {
                    tags: [],
                    title: '',
                    caption: '',
                    date: today,
                    created: new Date().toISOString(),
                    modified: new Date().toISOString()
                });

                this.log('info', `  ✓ ${file.name} uploaded successfully`);
                this.media.push(media);
                successCount++;
            } catch (err) {
                failCount++;
                this.log('error', `✗ Upload failed for ${file.name}: ${err.message || err}`);
            }
        }

        await this.loadData();
        this.renderMediaGrid();
        
        // Summary
        this.log('info', `Upload complete: ${successCount} succeeded, ${failCount} failed`);
        
        // Reset input
        e.target.value = '';
    }

    getMediaFilePath(media) {
        if (!this.api) return '';
        return media.date
            ? `${this.api.basePath}/media/${media.date}/${media.filename}`
            : `${this.api.basePath}/media/${media.filename}`;
    }

    getMediaFileUrl(media) {
        const filePath = this.getMediaFilePath(media);
        if (!filePath) return '';

        // Tauri 2 exposes convertFileSrc on both global and core namespaces
        const tauriConvert = window.__TAURI__?.convertFileSrc || window.__TAURI__?.core?.convertFileSrc;
        return tauriConvert
            ? tauriConvert(filePath)
            : `file:///${filePath.replace(/\\/g, '/')}`;
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
            
            const fileUrl = this.getMediaFileUrl(media);
            console.log(`[Media Thumbnail] ${media.filename}: ${fileUrl}`);
            let thumbnail = '';
            
            if (media.media_type === 'image') {
                thumbnail = `<img loading="lazy" src="${fileUrl}" alt="${media.filename}" onerror="console.error('Failed to load image:', '${fileUrl}')">`;
            } else if (media.media_type === 'video') {
                thumbnail = `<video muted preload="none"><source src="${fileUrl}" onerror="console.error('Failed to load video:', '${fileUrl}')"></video>`;
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

        const tagStr = activeTags.length > 0 ? ` (tags: ${activeTags.join(', ')})` : '';
        const searchStr = search ? ` (search: "${search}")` : '';
        if (search || activeTags.length > 0) {
            this.log('info', `Filtered to ${filtered.length} of ${this.media.length} items${searchStr}${tagStr}`);
        }

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
            
            const fileUrl = this.getMediaFileUrl(media);
            let thumbnail = '';
            
            if (media.media_type === 'image') {
                thumbnail = `<img loading="lazy" src="${fileUrl}" alt="${media.filename}">`;
            } else if (media.media_type === 'video') {
                thumbnail = `<video muted preload="none"><source src="${fileUrl}"></video>`;
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
        this.log('info', `Opened editor for "${media.filename}"`);
        this.currentEditor = { type: 'media', media };
        const metadata = this.getMediaMetadata(media.id);

        const preview = document.getElementById('mediaPreview');
        const fileUrl = this.getMediaFileUrl(media);
        
        // Render preview directly from disk using Tauri-safe URLs
        if (fileUrl && media.media_type === 'image') {
            preview.innerHTML = `<img src="${fileUrl}" alt="${media.filename}">`;
        } else if (fileUrl && media.media_type === 'video') {
            preview.innerHTML = `<video controls><source src="${fileUrl}"></video>`;
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

        this.log('info', `Saving metadata for "${metadata.title || media.filename}"`);
        this.setMediaMetadata(media.id, metadata);

        // Add new tags to global registry
        metadata.tags.forEach(tag => {
            if (!this.tags.includes(tag)) {
                this.tags.push(tag);
            }
        });
        this.tags.sort();

        this.saveToDisk();
        this.log('info', `Saved: ${metadata.tags.length} tags, title, and caption`);
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
        this.log('info', `Opened page editor for "${page.title || 'New Page'}"`);
        
        // Migrate old format if needed
        if (page.sections && !page.columns) {
            page.columns = [];
            // Convert old sections/blocks to columns
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
        
        // Ensure columns array exists
        if (!page.columns) {
            page.columns = [];
        }
        
        this.currentEditor = { type: 'page', page: JSON.parse(JSON.stringify(page)) };

        document.getElementById('pageTitle').value = page.title;
        document.getElementById('pageSlug').value = page.slug;

        const canvas = document.getElementById('pageCanvas');
        canvas.innerHTML = '';
        
        // Setup drop zone on canvas
        this.setupCanvasDropZone(canvas);
        
        // Render existing columns
        this.renderPageColumns();

        // Populate media library sidebar
        this.renderEditorMediaLibrary();

        // Wire up filter input
        const filterInput = document.getElementById('editorMediaFilter');
        filterInput.value = '';
        filterInput.addEventListener('input', () => {
            this.renderEditorMediaLibrary(filterInput.value);
        });

        document.getElementById('pageEditorModal').classList.add('active');
    }

    setupCanvasDropZone(canvas) {
        canvas.style.display = 'flex';
        canvas.style.flexWrap = 'wrap';
        canvas.style.minHeight = '400px';
        canvas.style.padding = '20px';
        canvas.style.border = '2px dashed #ddd';
        canvas.style.borderRadius = '8px';
        canvas.style.background = 'white';
        
        canvas.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            canvas.style.borderColor = '#FF8C42';
            canvas.style.background = '#fff9f5';
        });

        canvas.addEventListener('dragleave', (e) => {
            if (e.target === canvas) {
                canvas.style.borderColor = '#ddd';
                canvas.style.background = 'white';
            }
        });

        canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            canvas.style.borderColor = '#ddd';
            canvas.style.background = 'white';
            
            const mediaId = e.dataTransfer.getData('mediaId');
            const mediaType = e.dataTransfer.getData('mediaType');
            
            if (mediaId && mediaType) {
                const page = this.currentEditor.page;
                const column = {
                    id: this.generateId(),
                    width: 12,
                    type: mediaType,
                    data: { media_id: mediaId, caption: '' }
                };
                
                page.columns.push(column);
                
                const media = this.media.find(m => m.id === mediaId);
                const metadata = this.getMediaMetadata(mediaId);
                this.log('info', `Added ${mediaType} "${metadata.title || media.filename}" to page`);
                
                this.renderPageColumns();
            }
        });
    }

    renderPageColumns() {
        const canvas = document.getElementById('pageCanvas');
        const page = this.currentEditor.page;
        
        // Clear except for the drop hint
        const existingColumns = canvas.querySelectorAll('.page-column');
        existingColumns.forEach(col => col.remove());
        
        if (page.columns.length === 0) {
            const hint = document.createElement('div');
            hint.style.cssText = 'width: 100%; text-align: center; color: #999; padding: 40px;';
            hint.innerHTML = 'Drag media from the left or click "+ Add Text" below';
            canvas.appendChild(hint);
            return;
        }
        
        page.columns.forEach((column, idx) => {
            const colDiv = this.createColumnElement(column, idx);
            canvas.appendChild(colDiv);
        });
    }

    createColumnElement(column, idx) {
        const div = document.createElement('div');
        div.className = 'page-column';
        div.style.width = `${(column.width / 12) * 100}%`;
        div.style.padding = '10px';
        div.style.boxSizing = 'border-box';
        
        let content = '';
        if (column.type === 'text') {
            content = `<div style="padding: 15px; background: #f9f9f9; border-radius: 4px; min-height: 60px;">${this.escapeHtml(column.data.content || 'Empty text')}</div>`;
        } else if (column.type === 'image') {
            if (column.data.media_id) {
                const media = this.media.find(m => m.id === column.data.media_id);
                if (media) {
                    const fileUrl = this.getMediaFileUrl(media);
                    content = `
                        <div style="border: 2px solid #ddd; border-radius: 4px; overflow: hidden;">
                            <img src="${fileUrl}" style="width: 100%; height: auto; display: block;">
                            ${column.data.caption ? `<div style="padding: 8px; background: #f9f9f9; font-size: 0.9em;">${this.escapeHtml(column.data.caption)}</div>` : ''}
                        </div>
                    `;
                }
            }
        } else if (column.type === 'video') {
            if (column.data.media_id) {
                const media = this.media.find(m => m.id === column.data.media_id);
                if (media) {
                    const fileUrl = this.getMediaFileUrl(media);
                    content = `
                        <div style="border: 2px solid #ddd; border-radius: 4px; overflow: hidden;">
                            <video controls style="width: 100%; height: auto; display: block;">
                                <source src="${fileUrl}">
                            </video>
                            ${column.data.caption ? `<div style="padding: 8px; background: #f9f9f9; font-size: 0.9em;">${this.escapeHtml(column.data.caption)}</div>` : ''}
                        </div>
                    `;
                }
            }
        }

        div.innerHTML = `
            ${content}
            <div style="margin-top: 8px; display: flex; gap: 5px; justify-content: flex-end;">
                <button type="button" data-action="width" title="Width: ${column.width}/12" style="padding: 4px 8px; font-size: 11px; border: 1px solid #ddd; background: white; border-radius: 3px; cursor: pointer;">📏 ${column.width}/12</button>
                <button type="button" data-action="edit" style="padding: 4px 8px; font-size: 11px; border: 1px solid #ddd; background: white; border-radius: 3px; cursor: pointer;">✏️</button>
                <button type="button" data-action="delete" style="padding: 4px 8px; font-size: 11px; border: 1px solid #ddd; background: white; border-radius: 3px; cursor: pointer;">🗑️</button>
            </div>
        `;

        const widthBtn = div.querySelector('[data-action="width"]');
        const editBtn = div.querySelector('[data-action="edit"]');
        const deleteBtn = div.querySelector('[data-action="delete"]');

        widthBtn.addEventListener('click', () => {
            const widths = [3, 4, 6, 8, 12];
            const currentIdx = widths.indexOf(column.width);
            const nextIdx = (currentIdx + 1) % widths.length;
            column.width = widths[nextIdx];
            this.renderPageColumns();
        });

        editBtn.addEventListener('click', () => {
            if (column.type === 'text') {
                const newText = prompt('Edit text content:', column.data.content || '');
                if (newText !== null) {
                    column.data.content = newText;
                    this.renderPageColumns();
                }
            } else {
                const caption = prompt('Edit caption:', column.data.caption || '');
                if (caption !== null) {
                    column.data.caption = caption;
                    this.renderPageColumns();
                }
            }
        });

        deleteBtn.addEventListener('click', () => {
            const page = this.currentEditor.page;
            const colIdx = page.columns.findIndex(c => c.id === column.id);
            if (colIdx >= 0) {
                page.columns.splice(colIdx, 1);
                this.renderPageColumns();
            }
        });

        return div;
    }

    renderEditorMediaLibrary(filterText = '') {
        const library = document.getElementById('editorMediaLibrary');
        library.innerHTML = '';
        library.style.display = 'grid';
        library.style.gridTemplateColumns = '1fr 1fr';
        library.style.gap = '8px';

        if (this.media.length === 0) {
            library.innerHTML = '<div style="grid-column: 1/-1; padding: 20px; text-align: center; color: #999; font-size: 12px;">No media yet</div>';
            return;
        }

        // Filter media by search text
        const filter = filterText.toLowerCase();
        const filtered = this.media.filter(media => {
            if (!filter) return true;
            const metadata = this.getMediaMetadata(media.id);
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
            item.draggable = true;
            item.dataset.mediaId = media.id;
            item.dataset.mediaType = media.media_type;
            
            const fileUrl = this.getMediaFileUrl(media);
            const metadata = this.getMediaMetadata(media.id);
            
            let thumbnail = '';
            if (media.media_type === 'image') {
                thumbnail = `<img src="${fileUrl}" style="width: 100%; height: 80px; object-fit: cover; border-radius: 4px; display: block;">`;
            } else {
                thumbnail = `<div style="width: 100%; height: 80px; background: #333; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 24px;">🎬</div>`;
            }
            
            item.innerHTML = `
                ${thumbnail}
                <div style="font-size: 10px; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${metadata.title || media.filename}">
                    ${this.truncate(metadata.title || media.filename, 15)}
                </div>
            `;

            item.style.cssText = 'cursor: grab; padding: 4px; border: 1px solid #ddd; border-radius: 4px; background: white;';
            
            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('mediaId', media.id);
                e.dataTransfer.setData('mediaType', media.media_type);
                e.dataTransfer.effectAllowed = 'copy';
                item.style.opacity = '0.5';
            });

            item.addEventListener('dragend', () => {
                item.style.opacity = '1';
            });

            library.appendChild(item);
        });
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
        blocksContainer.style.display = 'flex';
        blocksContainer.style.flexWrap = 'wrap';
        blocksContainer.style.alignItems = 'flex-start';
        blocksContainer.style.minHeight = '100px';
        blocksContainer.style.border = '2px dashed transparent';
        blocksContainer.style.borderRadius = '4px';
        blocksContainer.style.transition = 'all 0.2s';
        
        // Add drop zone handlers
        blocksContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            blocksContainer.style.borderColor = '#FF8C42';
            blocksContainer.style.background = '#fff9f5';
        });

        blocksContainer.addEventListener('dragleave', () => {
            blocksContainer.style.borderColor = 'transparent';
            blocksContainer.style.background = '';
        });

        blocksContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            blocksContainer.style.borderColor = 'transparent';
            blocksContainer.style.background = '';
            
            const mediaId = e.dataTransfer.getData('mediaId');
            const mediaType = e.dataTransfer.getData('mediaType');
            
            if (mediaId && mediaType) {
                const block = this.addBlockToSection(section, mediaType, 12);
                block.data.media_id = mediaId;
                
                const media = this.media.find(m => m.id === mediaId);
                const metadata = this.getMediaMetadata(mediaId);
                this.log('info', `Added ${mediaType} "${metadata.title || media.filename}" to section`);
                
                this.renderSection(section, idx, canvas.parentElement);
            }
        });
        
        if (section.blocks.length === 0) {
            blocksContainer.innerHTML = '<div style="padding: 40px; text-align: center; color: #999; width: 100%;">Drag media here or click "+ Add Block"</div>';
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

        const addBlockBtn = secDiv.querySelector('button:last-child');
        addBlockBtn.innerHTML = '+ Add Block';
        addBlockBtn.addEventListener('click', () => {
            this.showBlockTypeMenu(section, idx, canvas);
        });

        canvas.appendChild(secDiv);
    }

    createBlockElement(block, idx, section) {
        const div = document.createElement('div');
        div.className = 'block';
        div.setAttribute('data-block-id', block.id);
        div.style.width = block.columns ? `${(block.columns / 12) * 100}%` : '100%';
        div.style.display = 'inline-block';
        div.style.verticalAlign = 'top';
        div.style.padding = '5px';
        div.style.boxSizing = 'border-box';

        let content = '';
        if (block.type === 'text') {
            content = `<div class="block-content" style="padding: 10px; background: #f9f9f9; border-radius: 4px;"><strong>Text:</strong> ${this.truncate(block.data.content || 'Empty', 80)}</div>`;
        } else if (block.type === 'image') {
            if (block.data.media_id) {
                const media = this.media.find(m => m.id === block.data.media_id);
                if (media) {
                    const fileUrl = this.getMediaFileUrl(media);
                    const metadata = this.getMediaMetadata(block.data.media_id);
                    content = `
                        <div class="block-content" style="border: 2px solid #ddd; border-radius: 4px; overflow: hidden;">
                            <img src="${fileUrl}" style="width: 100%; height: auto; display: block;">
                            ${block.data.caption ? `<div style="padding: 8px; background: #f9f9f9; font-size: 0.9em;">${block.data.caption}</div>` : ''}
                        </div>
                    `;
                } else {
                    content = `<div class="block-content" style="padding: 20px; text-align: center; background: #f9f9f9; border-radius: 4px;">Image not found</div>`;
                }
            } else {
                content = `<div class="block-content" style="padding: 20px; text-align: center; background: #f9f9f9; border-radius: 4px;">No image selected</div>`;
            }
        } else if (block.type === 'video') {
            if (block.data.media_id) {
                const media = this.media.find(m => m.id === block.data.media_id);
                if (media) {
                    const fileUrl = this.getMediaFileUrl(media);
                    const metadata = this.getMediaMetadata(block.data.media_id);
                    content = `
                        <div class="block-content" style="border: 2px solid #ddd; border-radius: 4px; overflow: hidden;">
                            <video controls style="width: 100%; height: auto; display: block;">
                                <source src="${fileUrl}">
                            </video>
                            ${block.data.caption ? `<div style="padding: 8px; background: #f9f9f9; font-size: 0.9em;">${block.data.caption}</div>` : ''}
                        </div>
                    `;
                } else {
                    content = `<div class="block-content" style="padding: 20px; text-align: center; background: #f9f9f9; border-radius: 4px;">Video not found</div>`;
                }
            } else {
                content = `<div class="block-content" style="padding: 20px; text-align: center; background: #f9f9f9; border-radius: 4px;">No video selected</div>`;
            }
        } else if (block.type === 'gallery') {
            content = `<div class="block-content" style="padding: 10px; background: #f9f9f9; border-radius: 4px;"><strong>Gallery:</strong> ${block.data.query_id || 'Not configured'} (${block.data.layout})</div>`;
        }

        div.innerHTML = `
            ${content}
            <div class="block-toolbar">
                <button data-action="width" title="Width: ${block.columns}/12">📏 ${block.columns}/12</button>
                <button data-action="edit">✏️ Edit</button>
                <button data-action="delete">🗑️</button>
            </div>
        `;

        const widthBtn = div.querySelector('[data-action="width"]');
        const editBtn = div.querySelector('[data-action="edit"]');
        const deleteBtn = div.querySelector('[data-action="delete"]');

        widthBtn.addEventListener('click', () => {
            const widths = [3, 4, 6, 8, 12];
            const currentIdx = widths.indexOf(block.columns || 12);
            const nextIdx = (currentIdx + 1) % widths.length;
            block.columns = widths[nextIdx];
            div.style.width = `${(block.columns / 12) * 100}%`;
            widthBtn.textContent = `📏 ${block.columns}/12`;
            widthBtn.title = `Width: ${block.columns}/12`;
        });

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
        if (block.type === 'text') {
            const newText = prompt('Edit text content:', block.data.content || '');
            if (newText !== null) {
                block.data.content = newText;
            }
        } else if (block.type === 'image' || block.type === 'video') {
            const caption = prompt('Edit caption (leave empty for none):', block.data.caption || '');
            if (caption !== null) {
                block.data.caption = caption;
            }
            const changeMedia = confirm('Do you want to change the media file?');
            if (changeMedia) {
                this.openMediaPicker(block, section, 0, document.getElementById('pageCanvas'));
            }
        } else {
            let content = prompt(`Edit block content:\n(JSON format)\n\n${JSON.stringify(block.data, null, 2)}`);
            if (content) {
                try {
                    block.data = JSON.parse(content);
                } catch (e) {
                    alert('Invalid JSON format');
                }
            }
        }
    }

    getMediaTitle(mediaId) {
        const media = this.media.find(m => m.id === mediaId);
        if (!media) return null;
        const metadata = this.getMediaMetadata(mediaId);
        return metadata.title || media.filename;
    }

    showBlockTypeMenu(section, sectionIdx, canvas) {
        const types = [
            { type: 'image', label: '🖼️ Image', columns: [6, 12] },
            { type: 'video', label: '🎬 Video', columns: [6, 12] },
            { type: 'text', label: '📝 Text', columns: [12] },
            { type: 'gallery', label: '🎞️ Gallery', columns: [12] }
        ];

        let menu = '<div style="display: flex; flex-direction: column; gap: 10px;">';
        types.forEach(t => {
            menu += `<button type="button" class="btn btn-secondary" data-type="${t.type}">${t.label}</button>`;
        });
        menu += '</div>';

        const overlay = document.createElement('div');
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;';
        overlay.innerHTML = `<div style="background: white; padding: 30px; border-radius: 8px; min-width: 250px;">${menu}</div>`;
        
        overlay.addEventListener('click', (e) => {
            // Find button if clicked on button or its content
            const button = e.target.closest('[data-type]');
            if (button) {
                const blockType = button.dataset.type;
                const block = this.addBlockToSection(section, blockType);
                
                if (blockType === 'image' || blockType === 'video') {
                    overlay.remove();
                    this.openMediaPicker(block, section, sectionIdx, canvas);
                } else if (blockType === 'text') {
                    const text = prompt('Enter text content:');
                    if (text) {
                        block.data.content = text;
                    }
                    this.renderSection(section, sectionIdx, canvas);
                    overlay.remove();
                } else {
                    this.renderSection(section, sectionIdx, canvas);
                    overlay.remove();
                }
            } else if (e.target === overlay) {
                overlay.remove();
            }
        });
        
        document.body.appendChild(overlay);
    }

    openMediaPicker(block, section, sectionIdx, canvas) {
        this.currentMediaPickerTarget = { block, section, sectionIdx, canvas };
        
        const grid = document.getElementById('mediaPickerGrid');
        grid.innerHTML = '';

        const mediaType = block.type === 'image' ? 'image' : 'video';
        const filtered = this.media.filter(m => m.media_type === mediaType);

        filtered.forEach(media => {
            const item = document.createElement('div');
            item.className = 'media-item';
            item.style.cursor = 'pointer';
            
            const fileUrl = this.getMediaFileUrl(media);
            let thumbnail = '';
            
            if (media.media_type === 'image') {
                thumbnail = `<img loading="lazy" src="${fileUrl}" alt="${media.filename}">`;
            } else if (media.media_type === 'video') {
                thumbnail = `<video muted preload="none"><source src="${fileUrl}"></video>`;
            }

            const metadata = this.getMediaMetadata(media.id);
            
            item.innerHTML = `
                <div class="media-thumbnail">
                    ${thumbnail}
                    <span class="media-type-badge">${media.media_type.toUpperCase()}</span>
                </div>
                <div class="media-info">
                    <div class="media-title">${metadata.title || this.truncate(media.filename, 20)}</div>
                </div>
            `;

            item.addEventListener('click', () => {
                block.data.media_id = media.id;
                document.getElementById('mediaPickerModal').classList.remove('active');
                this.renderSection(section, sectionIdx, canvas);
                this.log('info', `Added ${mediaType} "${metadata.title || media.filename}" to block`);
            });

            grid.appendChild(item);
        });

        document.getElementById('mediaPickerModal').classList.add('active');
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

    addBlockToSection(section, blockType, columns = 12) {
        const block = {
            id: this.generateId(),
            order: section.blocks.length,
            type: blockType,
            columns: columns,
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
        return block;
    }

    async savePage() {
        if (!this.currentEditor || this.currentEditor.type !== 'page') return;

        const page = this.currentEditor.page;
        page.title = document.getElementById('pageTitle').value;
        page.slug = document.getElementById('pageSlug').value;
        page.modified = new Date().toISOString();

        this.log('info', `Saving page "${page.title}" (${page.sections.length} sections)`);

        // Check if this is a new page or update
        const existingIdx = this.pages.findIndex(p => p.id === page.id);
        if (existingIdx >= 0) {
            this.pages[existingIdx] = page;
            this.log('info', 'Page updated');
        } else {
            this.pages.push(page);
            this.log('info', 'New page created');
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

    toggleConsole(force) {
        const panel = document.getElementById('consolePanel');
        this.consoleVisible = force !== undefined ? force : !this.consoleVisible;
        if (this.consoleVisible) {
            panel.classList.add('open');
        } else {
            panel.classList.remove('open');
        }
        this.renderConsole();
    }

    clearConsole() {
        this.consoleEntries = [];
        this.renderConsole();
    }

    log(level, message) {
        const ts = new Date().toLocaleTimeString();
        this.consoleEntries.push({ level, message, ts });
        // keep last 200 lines
        if (this.consoleEntries.length > 200) {
            this.consoleEntries.shift();
        }
        this.renderConsole();
        // Also mirror to browser console using original methods
        if (level === 'error') this.originalConsole.error(message);
        else if (level === 'warn') this.originalConsole.warn(message);
        else this.originalConsole.log(message);
    }

    renderConsole() {
        const body = document.getElementById('consoleBody');
        if (!body) return;
        body.innerHTML = '';
        this.consoleEntries.forEach(entry => {
            const line = document.createElement('div');
            line.className = `console-line ${entry.level}`;
            line.textContent = `[${entry.ts}] ${entry.level.toUpperCase()}: ${entry.message}`;
            body.appendChild(line);
        });
        body.scrollTop = body.scrollHeight;
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new MediaWeb();
});
