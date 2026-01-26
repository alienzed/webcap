/**
 * Frontend API wrapper for the generic file I/O backend command.
 * All business logic lives here; Rust is just a thin file bridge.
 */

class FileIOAPI {
    constructor(basePath) {
        this.basePath = basePath;
    }

    async invoke(op, relPath, payload = null) {
        try {
            const result = await window.__TAURI__.invoke('file_io', {
                op,
                data_path: this.basePath,
                rel_path: relPath,
                payload
            });
            return result;
        } catch (err) {
            console.error(`file_io(${op}, ${relPath}) failed:`, err);
            throw err;
        }
    }

    // === Directory Operations ===
    
    async initializeDataDir() {
        const dirs = ['media', 'meta', 'pages'];
        for (const dir of dirs) {
            try {
                await this.invoke('mkdir', dir);
            } catch {
                // directory may already exist
            }
        }
        // Ensure tags.json exists
        try {
            await this.invoke('read', 'tags.json');
        } catch {
            await this.invoke('write', 'tags.json', []);
        }
    }

    // === File Operations ===

    async readJSON(relPath) {
        return await this.invoke('read', relPath);
    }

    async writeJSON(relPath, data) {
        return await this.invoke('write', relPath, data);
    }

    async listDir(relPath) {
        return await this.invoke('list', relPath);
    }

    // === Media Operations ===

    async getMediaList() {
        try {
            const entries = await this.listDir('media');
            const mediaList = [];
            for (const entry of entries) {
                if (!entry.is_dir) {
                    const media = {
                        id: this._idFromFilename(entry.name),
                        filename: entry.name,
                        media_type: this._detectMediaType(entry.name),
                        size: 0, // not available from list
                        created: new Date().toISOString(),
                        modified: new Date().toISOString()
                    };
                    mediaList.push(media);
                }
            }
            return mediaList;
        } catch {
            return [];
        }
    }

    async getMediaMetadata(mediaId) {
        try {
            return await this.readJSON(`meta/${mediaId}.json`);
        } catch {
            return {
                tags: [],
                title: '',
                caption: '',
                created: new Date().toISOString(),
                modified: new Date().toISOString()
            };
        }
    }

    async updateMediaMetadata(mediaId, metadata) {
        const updated = {
            ...metadata,
            modified: new Date().toISOString()
        };
        await this.writeJSON(`meta/${mediaId}.json`, updated);
        return updated;
    }

    async queryMedia(tags, matchAll = false) {
        const mediaList = await this.getMediaList();
        if (!tags || tags.length === 0) return mediaList;

        const results = [];
        for (const media of mediaList) {
            const meta = await this.getMediaMetadata(media.id);
            const mediaTags = meta.tags || [];

            const matches = matchAll
                ? tags.every(t => mediaTags.includes(t))
                : tags.some(t => mediaTags.includes(t));

            if (matches) {
                results.push(media);
            }
        }
        return results;
    }

    // === Tags Operations ===

    async getTags() {
        try {
            return await this.readJSON('tags.json');
        } catch {
            return [];
        }
    }

    async addTag(tag) {
        const tags = await this.getTags();
        if (!tags.includes(tag)) {
            tags.push(tag);
            tags.sort();
            await this.writeJSON('tags.json', tags);
        }
    }

    async removeUnusedTags() {
        const tags = await this.getTags();
        const mediaList = await this.getMediaList();
        const usedTags = new Set();

        for (const media of mediaList) {
            const meta = await this.getMediaMetadata(media.id);
            (meta.tags || []).forEach(t => usedTags.add(t));
        }

        const filtered = tags.filter(t => usedTags.has(t));
        await this.writeJSON('tags.json', filtered);
        return filtered;
    }

    // === Pages Operations ===

    async getPages() {
        try {
            const entries = await this.listDir('pages');
            const pages = [];
            for (const entry of entries) {
                if (!entry.is_dir && entry.name.endsWith('.json')) {
                    const pageId = entry.name.replace('.json', '');
                    const page = await this.getPage(pageId);
                    pages.push(page);
                }
            }
            return pages;
        } catch {
            return [];
        }
    }

    async getPage(pageId) {
        return await this.readJSON(`pages/${pageId}.json`);
    }

    async savePage(page) {
        const updated = {
            ...page,
            modified: new Date().toISOString()
        };
        await this.writeJSON(`pages/${page.id}.json`, updated);
        return updated;
    }

    async deletePage(pageId) {
        await this.invoke('remove', `pages/${pageId}.json`);
    }

    // === Helpers ===

    _idFromFilename(filename) {
        // Simple hash-like ID
        let hash = 5381;
        for (let i = 0; i < filename.length; i++) {
            hash = ((hash << 5) + hash) ^ filename.charCodeAt(i);
        }
        return Math.abs(hash).toString(16);
    }

    _detectMediaType(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
        const videoExts = ['mp4', 'webm', 'mov', 'avi', 'mkv'];
        if (imageExts.includes(ext)) return 'image';
        if (videoExts.includes(ext)) return 'video';
        return 'unknown';
    }
}

// Export for use in app.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FileIOAPI;
}
