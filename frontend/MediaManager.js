// MediaManager.js - Media grid, upload, and editor
// =============================================================================

class MediaManager {
    constructor(app) {
        this.app = app;
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Media editor save button
        document.getElementById('btnSaveMedia').addEventListener('click', () => {
            this.saveMetadata();
        });
        
        // Media editor close button
        document.getElementById('btnCloseEditor')?.addEventListener('click', () => {
            this.app.closeModal();
        });
    }

    async handleFileUpload(e) {
        if (!this.app.api) {
            this.app.console.log('error', 'Please set a data path first.');
            return;
        }

        const files = Array.from(e.target.files);
        const today = new Date().toISOString().split('T')[0];
        
        this.app.console.log('info', `Starting upload of ${files.length} file(s)...`);
        
        let successCount = 0;
        let failCount = 0;

        for (const file of files) {
            const mediaId = this.app.generateIdFromFilename(file.name);
            this.app.console.log('info', `Uploading: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
            
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
                const reader = new FileReader();
                const base64Data = await new Promise((resolve, reject) => {
                    reader.onload = (evt) => resolve(evt.target.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });

                this.app.console.log('info', `  → Encoded to base64, writing to disk...`);
                await this.app.api.writeBinary(`media/${today}/${file.name}`, base64Data);
                this.app.console.log('info', `  → File saved to media/${today}/${file.name}`);

                await this.app.api.updateMediaMetadata(mediaId, {
                    tags: [],
                    title: '',
                    caption: '',
                    date: today,
                    created: new Date().toISOString(),
                    modified: new Date().toISOString()
                });

                this.app.console.log('info', `  ✓ ${file.name} uploaded successfully`);
                this.app.media.push(media);
                successCount++;
            } catch (err) {
                failCount++;
                this.app.console.log('error', `✗ Upload failed for ${file.name}: ${err.message || err}`);
            }
        }

        await this.app.loadData();
        this.renderGrid();
        
        this.app.console.log('info', `Upload complete: ${successCount} succeeded, ${failCount} failed`);
        e.target.value = '';
    }

    renderGrid() {
        const grid = document.getElementById('mediaGrid');
        if (!grid) {
            this.app.console.log('error', 'Media grid element not found');
            return;
        }
        
        grid.innerHTML = '';

        if (this.app.media.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1/-1;">
                    <div class="empty-state-icon">🖼️</div>
                    <div class="empty-state-text">No media yet. Upload images or videos to get started.</div>
                    <button class="btn btn-primary" onclick="document.getElementById('btnUpload').click()" style="margin-top: 1rem;">+ Add Your First Media</button>
                </div>
            `;
            return;
        }

        this.app.media.forEach(media => {
            const item = this.createMediaItem(media);
            grid.appendChild(item);
        });
    }

    createMediaItem(media) {
        const item = document.createElement('div');
        item.className = 'media-item';
        
        const fileUrl = this.app.getMediaFileUrl(media);
        let thumbnail = '';
        
        if (media.media_type === 'image') {
            thumbnail = `<img loading="lazy" src="${fileUrl}" alt="${media.filename}" style="pointer-events: none;">`;
        } else if (media.media_type === 'video') {
            thumbnail = `<video muted preload="none" style="pointer-events: none;"><source src="${fileUrl}"></video>`;
        }

        const metadata = this.app.getMediaMetadata(media.id);
        const tagsHtml = metadata.tags.map(tag => 
            `<span class="media-item-tag">${this.app.escapeHtml(tag)}</span>`
        ).join('');

        item.innerHTML = `
            <div class="media-thumbnail">
                ${thumbnail}
                <span class="media-type-badge">${media.media_type.toUpperCase()}</span>
            </div>
            <div class="media-info">
                <div class="media-title">${metadata.title || this.app.truncate(media.filename, 20)}</div>
                <div class="media-filename">${this.app.truncate(media.filename, 25)}</div>
                <div class="media-item-tags">${tagsHtml}</div>
            </div>
        `;

        item.addEventListener('click', () => {
            this.openEditor(media);
        });
        return item;
    }

    renderTagFilter() {
        const container = document.getElementById('tagList');
        container.innerHTML = '';

        this.app.tags.forEach(tag => {
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

        const filtered = this.app.media.filter(media => {
            const metadata = this.app.getMediaMetadata(media.id);
            const matchesSearch = !search || 
                metadata.title.toLowerCase().includes(search) ||
                metadata.caption.toLowerCase().includes(search) ||
                media.filename.toLowerCase().includes(search);

            const matchesTags = activeTags.length === 0 || 
                activeTags.some(tag => metadata.tags.includes(tag));

            return matchesSearch && matchesTags;
        });

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
            const item = this.createMediaItem(media);
            grid.appendChild(item);
        });
    }

    openEditor(media) {
        if (!this.app.api) {
            this.app.console.log('error', 'Please choose a data directory first');
            return;
        }
        
        this.app.console.log('info', `Opened editor for "${media.filename}"`);
        this.app.currentEditor = { type: 'media', media };
        const metadata = this.app.getMediaMetadata(media.id);

        const preview = document.getElementById('mediaPreview');
        const fileUrl = this.app.getMediaFileUrl(media);
        
        if (fileUrl && media.media_type === 'image') {
            preview.innerHTML = `<img src="${fileUrl}" alt="${media.filename}">`;
        } else if (fileUrl && media.media_type === 'video') {
            preview.innerHTML = `<video controls><source src="${fileUrl}"></video>`;
        } else {
            preview.innerHTML = `<div style="text-align: center; padding: 60px; color: #ccc;">Preview not available</div>`;
        }

        document.getElementById('mediaTitle').value = metadata.title;
        document.getElementById('mediaCaption').value = metadata.caption;
        
        this.renderTagsInput(metadata.tags);

        document.getElementById('mediaEditorModal').classList.add('active');
    }

    renderTagsInput(tags) {
        const container = document.getElementById('mediaTagsContainer');
        container.innerHTML = '';

        tags.forEach(tag => {
            const chip = document.createElement('div');
            chip.className = 'tag-chip';
            chip.innerHTML = `
                ${this.app.escapeHtml(tag)}
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
                        ${this.app.escapeHtml(tag)}
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

    async saveMetadata() {
        if (!this.app.currentEditor || this.app.currentEditor.type !== 'media') return;

        const media = this.app.currentEditor.media;
        const metadata = {
            title: document.getElementById('mediaTitle').value,
            caption: document.getElementById('mediaCaption').value,
            tags: Array.from(document.querySelectorAll('#mediaTagsContainer .tag-chip'))
                .map(chip => chip.textContent.trim().replace('×', '').trim()),
            date: media.date,
            created: media.created,
            modified: new Date().toISOString(),
            crop: null,
            rotation: null
        };

        this.app.console.log('info', `Saving metadata for "${metadata.title || media.filename}"`);
        
        if (this.app.api) {
            await this.app.api.updateMediaMetadata(media.id, metadata);
        }
        
        this.app.setMediaMetadata(media.id, metadata);

        // Add new tags to global registry
        metadata.tags.forEach(tag => {
            if (!this.app.tags.includes(tag)) {
                this.app.tags.push(tag);
            }
        });
        this.app.tags.sort();

        if (this.app.api) {
            await this.app.api.writeJSON('tags.json', this.app.tags);
        }

        this.app.console.log('info', `Saved: ${metadata.tags.length} tags, title, and caption`);
        this.app.closeModal();
        this.renderGrid();
        this.renderTagFilter();
    }
}
