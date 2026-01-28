// MediaWeb - Main Application (Refactored with Modules)
// =============================================================================

class MediaWeb {
    constructor() {
        this.dataPath = '';
        this.api = null;
        this.media = [];
        this.pages = [];
        this.tags = [];
        this.currentEditor = null;
        this.configPath = null;
        
        // Initialize modules
        this.console = new Console(this);
        this.mediaManager = new MediaManager(this);
        this.pageEditor = new PageEditor(this);
        
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

    async loadConfig() {
        const tauriInvoke = window.__TAURI__?.core?.invoke;
        if (!tauriInvoke) {
            this.console.log('warn', 'Tauri API not available, cannot load config');
            return null;
        }

        try {
            this.console.log('info', 'Loading config: getting config directory...');
            const configDir = await tauriInvoke('get_default_data_path');
            this.configPath = `${configDir}/../mediaweb-config.json`;
            this.console.log('info', `Config path: ${this.configPath}`);
            
            this.console.log('info', `Reading config from: ${configDir}/.. → mediaweb-config.json`);
            const configContent = await tauriInvoke('file_io', {
                op: 'read',
                dataPath: configDir + '/..',
                relPath: 'mediaweb-config.json',
                payload: null
            });
            
            const config = JSON.parse(configContent);
            this.console.log('info', `✓ Loaded saved config: ${config.dataPath}`);
            return config;
        } catch (err) {
            this.console.log('info', `No existing config file (${err.message || err})`);
            return null;
        }
    }

    async saveConfig() {
        const tauriInvoke = window.__TAURI__?.core?.invoke;
        if (!tauriInvoke) {
            this.console.log('warn', 'Tauri API not available, cannot save config');
            return;
        }

        if (!this.configPath) {
            this.console.log('error', 'Config path not set');
            return;
        }

        if (!this.dataPath) {
            this.console.log('warn', 'No data path to save');
            return;
        }

        try {
            const config = { dataPath: this.dataPath };
            this.console.log('info', `Saving config to ${this.configPath}...`);

            const pathParts = this.configPath.split(/[\\/]/);
            const fileName = pathParts.pop();
            const dirPath = pathParts.join('/');

            await tauriInvoke('file_io', {
                op: 'write',
                dataPath: dirPath,
                relPath: fileName,
                payload: JSON.stringify(config, null, 2)
            });

            this.console.log('info', '✓ Config saved successfully');
        } catch (err) {
            this.console.log('error', `Failed to save config: ${err.message || err}`);
        }
    }

    async ensureDataPath() {
        const tauriInvoke = window.__TAURI__?.core?.invoke;
        this.console.log('info', 'Checking for saved configuration...');

        const config = await this.loadConfig();

        if (config && config.dataPath) {
            this.dataPath = config.dataPath;
            this.console.log('info', `Using saved data path: ${this.dataPath}`);
            return;
        }

        if (!this.dataPath) {
            const modal = document.createElement('div');
                if (tauriInvoke) {
                    try {
                        const defaultPath = await tauriInvoke('get_default_data_path');
                        this.console.log('info', `Suggested default path: ${defaultPath}`);
                        modal.innerHTML = `
                            <div class="modal-content" style="max-width: 500px;">
                                <div class="modal-header">
                                    <h2>Welcome to MediaWeb</h2>
                                </div>
                                <div class="modal-body">
                                    <p style="margin-bottom: 15px;">Please choose a directory to store your media and pages:</p>
                                    <p style="margin-bottom: 15px; padding: 12px; background: #FFF4E6; border-radius: 4px; color: #F59E0B;">
                                        <strong>Suggestion:</strong> <code style="background: white; padding: 2px 6px; border-radius: 3px;">${defaultPath}</code>
                                    </p>
                                    <button class="btn btn-primary" id="btnChooseDataPath">Choose Directory</button>
                                </div>
                            </div>
                        `;
                    } catch (err) {
                        this.console.log('error', `Could not get default path: ${err.message || err}`);
                    }
                }

                const manual = prompt('Enter a directory path for your MediaWeb data:');
                if (manual) {
                    this.dataPath = manual;
                    await this.saveConfig();
                    this.loadDataPath();
                    await this.loadData();
                } else {
                    this.console.log('warn', 'No data path selected');
                }
            document.body.appendChild(modal);
            modal.classList.add('modal', 'active');

            document.getElementById('btnChooseDataPath')?.addEventListener('click', async () => {
                await this.selectDataPath();
                modal.remove();
            });
        }

        if (this.dataPath) {
            await this.saveConfig();
        }
    }

    setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => this.switchSection(e));
        });

        // Data path picker
        document.getElementById('btnSelectDataPath').addEventListener('click', () => {
            this.selectDataPath();
        });

        // Upload
        document.getElementById('fileInput').addEventListener('change', (e) => {
            this.mediaManager.handleFileUpload(e);
        });
        document.getElementById('btnUpload').addEventListener('click', () => {
            if (!this.api) {
                this.console.log('error', 'Please choose a data directory first');
                alert('Please set up a data directory first!\n\nGo to Settings → Choose Directory');
                this.switchToSection('settings');
                return;
            }
            document.getElementById('fileInput').click();
        });

        // Search
        document.getElementById('searchMedia').addEventListener('input', (e) => {
            this.mediaManager.filterMedia(e.target.value);
        });

        // About via logo
        document.querySelector('.logo').addEventListener('click', () => {
            this.showAbout();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboardShortcuts(e));

        // Close modal on overlay click or close button
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.closeModal();
            }
            const closeBtn = e.target.closest('.btn-close');
            if (closeBtn) {
                this.closeModal();
            }
        });

        // Escape key closes modals
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const activeModal = document.querySelector('.modal.active');
                if (activeModal) {
                    this.closeModal();
                }
            }
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
                this.mediaManager.saveMetadata();
            } else if (modal && document.getElementById('pageEditorModal').classList.contains('active')) {
                this.pageEditor.save();
            }
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
            e.preventDefault();
            const currentSection = document.querySelector('.section.active').id;
            if (currentSection === 'pages') {
                document.getElementById('btnNewPage').click();
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
            this.mediaManager.renderGrid();
        } else if (section === 'pages') {
            this.pageEditor.renderPagesList();
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
                selected = prompt('Enter a data directory path to use:', this.dataPath || './mediaweb-data');
            }

            if (selected) {
                this.dataPath = selected;
                this.console.log('info', `Data path set to: ${this.dataPath}`);
                await this.saveConfig();
                this.loadDataPath();
                await this.loadData();
            }
        } catch (err) {
            this.console.log('error', `Failed to select directory: ${err.message || err}`);
        }
    }

    loadDataPath() {
        const display = document.getElementById('dataPathDisplay');
        if (this.dataPath) {
            display.textContent = this.dataPath;
            this.api = new FileIOAPI(this.dataPath);
            this.console.log('info', `API initialized with base path: ${this.dataPath}`);
            this.initializeDataDirectory();
        } else {
            display.textContent = 'Not set - Click "Choose" to set up';
        }
    }

    async initializeDataDirectory() {
        if (!this.api) return;
        try {
            this.console.log('info', 'Creating directory structure...');
            await this.api.initializeDataDir();
            this.console.log('info', `✓ Data directory ready at: ${this.dataPath}`);
        } catch (err) {
            this.console.log('error', `Failed to initialize data directory: ${err.message || err}`);
        }
    }

    async loadData() {
        if (!this.api) return;
        
        try {
            this.console.log('info', 'Loading media, pages, and tags...');
            this.media = await this.api.getMediaList();
            this.pages = await this.api.getPages();
            this.tags = await this.api.getTags();
            this.console.log('info', `Loaded: ${this.media.length} media items, ${this.pages.length} pages, ${this.tags.length} tags`);
        } catch (err) {
            this.console.log('error', `Failed to load data: ${err.message || err}`);
            this.media = [];
            this.pages = [];
            this.tags = [];
        }

        this.mediaManager.renderGrid();
        this.mediaManager.renderTagFilter();
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

        const convertFileSrc = window.__TAURI__?.core?.convertFileSrc || window.__TAURI__?.tauri?.convertFileSrc;
        if (convertFileSrc) {
            return convertFileSrc(filePath);
        }

        return filePath;
    }

    closeModal() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.remove('active');
        });
        const tagInput = document.getElementById('mediaTagInput');
        if (tagInput) tagInput.value = '';
        this.currentEditor = null;
        this.console.log('info', 'Modal closed');
    }

    updateSettingsDisplay() {
        document.getElementById('infoMediaCount').textContent = this.media.length;
        document.getElementById('infoPagesCount').textContent = this.pages.length;
        document.getElementById('infoTagsCount').textContent = this.tags.length;
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
                <div style="text-align: left; max-width: 500px; margin: 0 auto;">
                    <h3 style="font-size: 1rem; margin-bottom: 10px; color: #374151;">⌨️ Keyboard Shortcuts</h3>
                    <table style="width: 100%; font-size: 0.85rem; color: #6B7280; border-collapse: collapse;">
                        <tr><td style="padding: 4px 0;"><code>M</code></td><td>Go to Media</td></tr>
                        <tr><td style="padding: 4px 0;"><code>P</code></td><td>Go to Pages</td></tr>
                        <tr><td style="padding: 4px 0;"><code>S</code></td><td>Go to Settings</td></tr>
                        <tr><td style="padding: 4px 0;"><code>/</code></td><td>Focus Search</td></tr>
                        <tr><td style="padding: 4px 0;"><code>Ctrl+U</code></td><td>Upload Media</td></tr>
                        <tr><td style="padding: 4px 0;"><code>Ctrl+N</code></td><td>New Page</td></tr>
                        <tr><td style="padding: 4px 0;"><code>Ctrl+S</code></td><td>Save (in editor)</td></tr>
                        <tr><td style="padding: 4px 0;"><code>Esc</code></td><td>Close Dialog/Modal</td></tr>
                        <tr><td style="padding: 4px 0;"><code>Ctrl+\`</code></td><td>Toggle Console</td></tr>
                        <tr><td style="padding: 4px 0;"><code>Ctrl+Shift+K</code></td><td>Clear Console</td></tr>
                    </table>
                </div>
                <hr style="margin: 20px 0; border: none; border-top: 1px solid #E5E7EB;">
                <p style="font-size: 0.9rem; color: #6B7280; margin-bottom: 10px;">Built with Tauri, Rust, and vanilla JavaScript</p>
                <p style="font-size: 0.9rem; color: #6B7280; margin-bottom: 15px;">All data stored locally in human-readable JSON</p>
                <p style="font-size: 0.85rem; color: #9CA3AF; margin-top: 20px;">
                    © 2025 · Made for creative professionals · MIT License
                </p>
            </div>
        `;

        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 550px;">
                <div class="modal-header">
                    <h2>About & Keyboard Shortcuts</h2>
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
    try {
        window.app = new MediaWeb();
        console.log('MediaWeb initialized successfully');
    } catch (err) {
        console.error('Failed to initialize MediaWeb:', err);
        alert('Failed to start MediaWeb: ' + err.message);
    }
});
