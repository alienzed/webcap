# 📚 MediaWeb Documentation Index

Welcome to **MediaWeb** - A portable, offline-first Media CMS + Page Builder.

This index helps you navigate the documentation and get started quickly.

## 🎯 Where to Start?

### **I want to...**

**...get started quickly**
→ Read [INSTALL.md](INSTALL.md) (5 min setup guide)

**...understand what MediaWeb does**
→ Read [README.md](README.md) (features & overview)

**...use the application**
→ See keyboard shortcuts in [SHORTCUTS.md](SHORTCUTS.md)

**...contribute or develop**
→ Read [DEVELOPMENT.md](DEVELOPMENT.md) (architecture & workflow)

**...understand the technical details**
→ Read [SPEC.md](SPEC.md) (complete technical specification)

**...see what's new**
→ Check [CHANGELOG.md](CHANGELOG.md) (version history & roadmap)

**...view example data**
→ See [data/EXAMPLE.md](data/EXAMPLE.md) (sample data structure)

**...get a complete overview**
→ Read [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md) (full project summary)

## 📖 Documentation Files

| File | Purpose | Time |
|------|---------|------|
| **[README.md](README.md)** | Features, structure, quick start | 10 min |
| **[INSTALL.md](INSTALL.md)** | Installation for all platforms | 15 min |
| **[SHORTCUTS.md](SHORTCUTS.md)** | Keyboard shortcuts reference | 2 min |
| **[DEVELOPMENT.md](DEVELOPMENT.md)** | Development setup & workflow | 20 min |
| **[SPEC.md](SPEC.md)** | Technical specification & API | 30 min |
| **[CHANGELOG.md](CHANGELOG.md)** | Version history & roadmap | 5 min |
| **[PROJECT_SUMMARY.md](PROJECT_SUMMARY.md)** | Complete project overview | 15 min |
| **[QUICKSTART.sh](QUICKSTART.sh)** | Quick reference card | 2 min |
| **[data/EXAMPLE.md](data/EXAMPLE.md)** | Example data structure | 5 min |

## 🚀 Quick Start (3 steps)

### 1. Install Rust
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### 2. Run the App
```bash
cd mediaweb
cargo tauri dev
```

### 3. Choose Data Directory
- On first launch, click "Choose" in Settings
- Select or create folder for your media

**That's it!** Start uploading media and creating pages.

## 🏗️ Project Structure

```
mediaweb/
├── 📄 README.md                 ← Start here
├── 📄 INSTALL.md                ← Installation guide
├── 📄 DEVELOPMENT.md            ← Dev guide
├── 📄 SPEC.md                   ← Technical details
├── 📄 SHORTCUTS.md              ← Keyboard shortcuts
├── 📄 CHANGELOG.md              ← What's new
├── 📄 PROJECT_SUMMARY.md        ← Full overview
├── 📄 QUICKSTART.sh             ← Quick ref
├── 📁 src/                      ← Rust backend
│   ├── main.rs                  ← App entry point
│   ├── models.rs                ← Data structures
│   └── commands/                ← Command handlers
├── 📁 frontend/                 ← Web UI
│   ├── index.html               ← Layout
│   ├── styles.css               ← Styling
│   └── app.js                   ← Logic
├── 📁 data/                     ← User data
│   ├── media/                   ← Original files
│   ├── meta/                    ← Metadata
│   ├── pages/                   ← Page files
│   ├── tags.json                ← Tags list
│   └── EXAMPLE.md               ← Example format
├── 📁 .github/
│   └── copilot-instructions.md  ← Dev guidelines
├── Cargo.toml                   ← Rust config
└── tauri.conf.json              ← App config
```

## 🎨 What You Can Do

### Media Management
- Upload images & videos
- Edit metadata (title, caption, tags)
- Filter by tags
- Real-time search
- All stored as JSON

### Page Building
- Create multi-section pages
- Add text, image, gallery, video blocks
- Inline editing
- Auto-save to disk

### Offline-First
- Works without internet
- No database required
- Data stays local
- Portable (USB, cloud drive, etc.)

## 💡 Key Concepts

### Metadata Sidecars
Every media file has a companion JSON:
```
photo.jpg  →  photo.json  (metadata)
```

### Tag-Based Organization
- Flat string tags (no hierarchy)
- AND/OR filtering
- Auto-indexed

### Page Hierarchy
```
Page
  └─ Section
      ├─ Text Block
      ├─ Image Block
      ├─ Gallery Block
      └─ Video Block
```

## ⌨️ Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `M` | Media section |
| `P` | Pages section |
| `S` | Settings section |
| `/` | Focus search |
| `Esc` | Close modal |
| `Ctrl+U` | Upload |
| `Ctrl+S` | Save |

See [SHORTCUTS.md](SHORTCUTS.md) for more.

## 🔧 Tech Stack

- **Tauri 1.5** - Desktop framework
- **Rust** - Backend (async, type-safe)
- **Vanilla JavaScript** - Frontend (no frameworks)
- **JSON** - Data format
- **CSS3** - Styling (grey + orange theme)

## 📊 Stats

- **Backend**: ~500 lines Rust
- **Frontend**: ~800 lines JavaScript
- **Styling**: ~600 lines CSS
- **Documentation**: ~3000 lines
- **Total size**: ~3 KB compiled frontend code
- **App binary**: ~30-50 MB (platform-dependent)

## 🎓 Learning Path

1. **First time?**
   - Read [INSTALL.md](INSTALL.md)
   - Install and launch
   - Explore the UI

2. **Want to use it?**
   - Read [README.md](README.md)
   - Learn [SHORTCUTS.md](SHORTCUTS.md)
   - Check [data/EXAMPLE.md](data/EXAMPLE.md)

3. **Want to develop?**
   - Read [DEVELOPMENT.md](DEVELOPMENT.md)
   - Review [SPEC.md](SPEC.md)
   - Check `.github/copilot-instructions.md`

4. **Want the full picture?**
   - Read [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md)
   - Review [SPEC.md](SPEC.md)
   - Browse the source code

## ❓ Common Questions

**Q: Is it free?**
A: Yes! MIT License - use however you want.

**Q: Does it need internet?**
A: No! Works completely offline.

**Q: How do I backup?**
A: Copy the `data/` folder. That's all your data.

**Q: Can I edit files manually?**
A: Yes! Everything is JSON. Edit in any text editor.

**Q: Can I use from USB?**
A: Yes! Just set data directory to USB on first launch.

**Q: How big can my media library be?**
A: Depends on hardware, but ~500 items recommended for smooth UI.

**Q: Is my data secure?**
A: Yes, completely local. No cloud, no servers, no tracking.

## 🆘 Getting Help

1. **Setup problems?** → Check [INSTALL.md](INSTALL.md)
2. **How do I use it?** → Check [README.md](README.md) & [SHORTCUTS.md](SHORTCUTS.md)
3. **Technical questions?** → Check [SPEC.md](SPEC.md)
4. **Want to contribute?** → Check [DEVELOPMENT.md](DEVELOPMENT.md)
5. **Have ideas?** → Open a GitHub discussion

## 📞 Support

- 📖 Read the documentation
- 🐛 Report bugs on GitHub
- 💬 Ask questions in GitHub Discussions
- 🚀 Share features ideas

## 🎯 Recommended Reading Order

1. This file (you are here!)
2. [README.md](README.md) - Understand the project
3. [INSTALL.md](INSTALL.md) - Set up the app
4. [SHORTCUTS.md](SHORTCUTS.md) - Learn shortcuts
5. [data/EXAMPLE.md](data/EXAMPLE.md) - See example data
6. [DEVELOPMENT.md](DEVELOPMENT.md) - (If developing)
7. [SPEC.md](SPEC.md) - (If deep dive)

## 📦 What's Included

✅ Complete Rust + JavaScript application
✅ Cross-platform Tauri desktop app
✅ Professional UI (grey + orange theme)
✅ Full offline-first architecture
✅ Comprehensive documentation (8 guides)
✅ Example data structure
✅ Development guidelines
✅ API specification
✅ Keyboard shortcut reference
✅ Version history & roadmap

## 🚀 Get Started Now

```bash
# 1. Install Rust (one-time)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 2. Run the app
cd mediaweb
cargo tauri dev

# 3. Enjoy!
```

## 📅 Version

**MediaWeb v0.1.0** - January 2025

See [CHANGELOG.md](CHANGELOG.md) for version history.

## 📄 License

MIT - Free for personal and commercial use.

---

## Quick Links

- [README.md](README.md) - Features overview
- [INSTALL.md](INSTALL.md) - Setup instructions
- [DEVELOPMENT.md](DEVELOPMENT.md) - Dev guide
- [SPEC.md](SPEC.md) - Technical specification
- [SHORTCUTS.md](SHORTCUTS.md) - Keyboard reference
- [CHANGELOG.md](CHANGELOG.md) - What's new
- [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md) - Full overview
- [QUICKSTART.sh](QUICKSTART.sh) - Quick reference

---

**Made with ❤️ for offline-first creative workflows**

Questions? Check the documentation above or open an issue on GitHub!
