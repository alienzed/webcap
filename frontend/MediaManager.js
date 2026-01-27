// MediaManager.js - Media grid, upload, and editor
// =============================================================================

class MediaManager {
    constructor(app) {
        this.app = app;
        this.setupEventListeners();
        this.setupDragAndDrop();
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

    setupDragAndDrop() {
        const mediaGrid = document.getElementById('mediaGrid');
        if (!mediaGrid) return;
        
        // Prevent default drag behaviors on entire document
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            document.body.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });
        
        // Handle drag over media grid
        mediaGrid.addEventListener('dragenter', (e) => {
            e.preventDefault();
            if (this.app.api) {
                mediaGrid.classList.add('drag-over');
            }
        });
        
        mediaGrid.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (this.app.api) {
                mediaGrid.classList.add('drag-over');
            }
        });
        
        mediaGrid.addEventListener('dragleave', (e) => {
            e.preventDefault();
            // Only remove if leaving the grid itself
            if (e.target === mediaGrid) {
                mediaGrid.classList.remove('drag-over');
            }
        });
        
        mediaGrid.addEventListener('drop', async (e) => {
            e.preventDefault();
            mediaGrid.classList.remove('drag-over');
            
            if (!this.app.api) {
                this.app.console.log('error', 'Please set a data directory first');
                alert('Please set up a data directory first!\n\nGo to Settings → Choose Directory');
                this.app.switchToSection('settings');
                return;
            }
            
            const files = Array.from(e.dataTransfer.files).filter(file => 
                file.type.startsWith('image/') || file.type.startsWith('video/')
            );
            
            if (files.length === 0) {
                this.app.console.log('warn', 'No valid media files to upload');
                return;
            }
            
            this.app.console.log('info', `Dropped ${files.length} file(s), starting upload...`);
            await this.uploadFiles(files);
        });
    }

    async uploadFiles(files) {
        const today = new Date().toISOString().split('T')[0];
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const mediaId = this.app.generateIdFromFilename(file.name);
            
            this.app.console.log('info', `[${i+1}/${files.length}] Uploading: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
            
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

                await this.app.api.writeBinary(`media/${today}/${file.name}`, base64Data);

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
        
        this.app.console.log('info', `✓ Upload complete: ${successCount} succeeded, ${failCount} failed`);
    }

    async handleFileUpload(e) {
        if (!this.app.api) {
            this.app.console.log('error', 'Please set a data path first.');
            return;
        }

        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        
        await this.uploadFiles(files);
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

        const mediaIcon = media.media_type === 'image' ? '🖼️' : '🎬';
        
        item.innerHTML = `
            <div class="media-thumbnail">
                ${thumbnail}
                <span class="media-type-badge" title="${media.media_type}">${mediaIcon}</span>
                <button class="media-delete-btn" title="Delete media" data-media-id="${media.id}" style="position: absolute; top: 8px; right: 8px; background: rgba(239, 68, 68, 0.9); color: white; border: none; border-radius: 4px; width: 28px; height: 28px; cursor: pointer; font-size: 16px; display: none;">×</button>
            </div>
            <div class="media-info">
                <div class="media-title">${metadata.title || this.app.truncate(media.filename, 20)}</div>
                <div class="media-filename">${this.app.truncate(media.filename, 25)}</div>
                <div class="media-item-tags">${tagsHtml}</div>
            </div>
        `;

        // Show delete button on hover
        item.addEventListener('mouseenter', () => {
            const deleteBtn = item.querySelector('.media-delete-btn');
            if (deleteBtn) deleteBtn.style.display = 'block';
        });
        
        item.addEventListener('mouseleave', () => {
            const deleteBtn = item.querySelector('.media-delete-btn');
            if (deleteBtn) deleteBtn.style.display = 'none';
        });
        
        // Delete button handler
        const deleteBtn = item.querySelector('.media-delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this.deleteMedia(media);
            });
        }

        item.addEventListener('click', () => {
            this.openEditor(media);
        });
        return item;
    }

    async deleteMedia(media) {
        // Check if media is referenced in any pages
        const referencingPages = this.app.pages.filter(page => {
            // Check all columns/sections for image/video blocks
            const items = page.columns || page.sections || [];
            return items.some(item => {
                const blocks = item.blocks || [];
                return blocks.some(block => {
                    if (block.type === 'Image' || block.type === 'Video') {
                        return block.data.mediaId === media.id;
                    }
                    if (block.type === 'Gallery') {
                        // Could check gallery queries, but that's complex
                        return false;
                    }
                    return false;
                });
            });
        });

        if (referencingPages.length > 0) {
            const pageNames = referencingPages.map(p => p.title).join(', ');
            const confirmMsg = `This media is used in ${referencingPages.length} page(s): ${pageNames}\n\nAre you sure you want to delete it?`;
            if (!confirm(confirmMsg)) {
                return;
            }
        } else {
            if (!confirm(`Delete "${media.filename}"?`)) {
                return;
            }
        }

        try {
            this.app.console.log('info', `Deleting media: ${media.filename}`);
            
            // Delete the media file
            await this.app.api.deleteFile(`media/${media.date}/${media.filename}`);
            
            // Delete metadata
            await this.app.api.deleteFile(`meta/${media.date}/${media.id}.json`);
            
            // Remove from app state
            const idx = this.app.media.findIndex(m => m.id === media.id);
            if (idx >= 0) {
                this.app.media.splice(idx, 1);
            }
            
            this.app.console.log('info', `✓ Deleted ${media.filename}`);
            this.renderGrid();
        } catch (err) {
            this.app.console.log('error', `Failed to delete media: ${err.message || err}`);
            alert(`Failed to delete media: ${err.message || err}`);
        }
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

        // Show selected tags
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
        
        // Add popular/recent tags
        const suggestedContainer = document.createElement('div');
        suggestedContainer.style.cssText = 'margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;';
        
        const suggestedLabel = document.createElement('div');
        suggestedLabel.style.cssText = 'font-size: 11px; color: #9ca3af; margin-bottom: 6px; text-transform: uppercase; font-weight: 600;';
        suggestedLabel.textContent = 'Quick Add:';
        suggestedContainer.appendChild(suggestedLabel);
        
        const suggestedTagsDiv = document.createElement('div');
        suggestedTagsDiv.style.cssText = 'display: flex; flex-wrap: wrap; gap: 4px;';
        
        // Get all tags that haven't been added yet, prioritize by frequency
        const availableTags = this.app.tags.filter(tag => !tags.includes(tag));
        const tagsWithFreq = availableTags.map(tag => ({
            tag,
            freq: this.app.media.reduce((sum, m) => {
                const meta = this.app.getMediaMetadata(m.id);
                return sum + (meta.tags.includes(tag) ? 1 : 0);
            }, 0)
        })).sort((a, b) => b.freq - a.freq);
        
        const topTags = tagsWithFreq.slice(0, 8); // Show top 8
        
        if (topTags.length > 0) {
            topTags.forEach(({tag}) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'tag-suggest';
                btn.textContent = tag;
                btn.style.cssText = 'padding: 4px 12px; font-size: 12px; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 16px; cursor: pointer; transition: all 0.2s;';
                btn.addEventListener('mouseenter', () => {
                    btn.style.background = '#FF8C42';
                    btn.style.color = 'white';
                    btn.style.borderColor = '#FF8C42';
                });
                btn.addEventListener('mouseleave', () => {
                    btn.style.background = '#f3f4f6';
                    btn.style.color = 'inherit';
                    btn.style.borderColor = '#d1d5db';
                });
                btn.addEventListener('click', () => {
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
                    btn.style.opacity = '0.5';
                    btn.disabled = true;
                });
                suggestedTagsDiv.appendChild(btn);
            });
        } else {
            const noTags = document.createElement('div');
            noTags.style.cssText = 'font-size: 11px; color: #d1d5db;';
            noTags.textContent = 'No suggested tags';
            suggestedTagsDiv.appendChild(noTags);
        }
        
        suggestedContainer.appendChild(suggestedTagsDiv);
        container.appendChild(suggestedContainer);

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
