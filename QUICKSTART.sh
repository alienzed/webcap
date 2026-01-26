#!/bin/bash
# MediaWeb Quick Reference

## 🚀 Quick Start

```bash
# 1. Install Rust (one-time)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 2. Clone project
git clone https://github.com/yourusername/mediaweb.git
cd mediaweb

# 3. Run in dev mode
cargo tauri dev

# 4. On app launch, click "Choose" to set data directory
```

## 🏗️ Project Structure

```
mediaweb/
├── src/              # Rust backend
│   ├── main.rs       # Entry point
│   ├── models.rs     # Data types
│   └── commands/     # Tauri commands
├── frontend/         # Web UI
│   ├── index.html    # Layout
│   ├── styles.css    # Styles
│   └── app.js        # Logic
├── data/             # User data
└── docs/             # Documentation
```

## 📚 Documentation Files

| File | Purpose |
|------|---------|
| README.md | Features & overview |
| INSTALL.md | Setup instructions |
| DEVELOPMENT.md | Dev workflow |
| SPEC.md | Technical details |
| SHORTCUTS.md | Keyboard shortcuts |
| CHANGELOG.md | Version history |
| PROJECT_SUMMARY.md | Complete overview |

## 💻 Common Commands

```bash
# Development
cargo tauri dev              # Run dev server (with hot reload)
cargo test                   # Run Rust tests
cargo check                  # Check code without building

# Building
cargo tauri build            # Build for distribution
cargo clean                  # Clean build artifacts

# Debugging
RUST_LOG=debug cargo tauri dev  # With debug logging
F12                          # Open dev tools (in app window)
Ctrl+R                       # Reload (in app window)
```

## 🎨 Theme Colors

```css
/* Orange & Grey Theme */
--color-primary-orange: #FF8C42;
--color-grey-medium: #6B7280;
--color-grey-light: #F3F4F6;
```

## 🔑 Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `M` | Media section |
| `P` | Pages section |
| `S` | Settings section |
| `/` | Focus search |
| `Esc` | Close modal |
| `Ctrl+U` | Upload |
| `Ctrl+S` | Save |

## 📁 Data Directory Structure

```
~/mediaweb/data/
├── media/          # Original files (never modified)
├── meta/           # Metadata JSON sidecars
├── pages/          # Page definitions (JSON)
└── tags.json       # Global tag registry
```

## 🔧 Adding a Feature

### New Tauri Command

1. **Define in `src/commands/`**
   ```rust
   pub async fn my_function(base_path: &Path) -> Result<String, String> {
       // implementation
       Ok("result".to_string())
   }
   ```

2. **Export from `src/commands/mod.rs`**
   ```rust
   pub mod my_module;
   ```

3. **Register in `src/main.rs`**
   ```rust
   #[tauri::command]
   async fn my_function(data_path: String) -> Result<String, String> {
       // wrapper
   }

   // In .invoke_handler!():
   my_function
   ```

4. **Call from `frontend/app.js`**
   ```javascript
   const result = await invoke('my_function', { dataPath: this.dataPath });
   ```

### New UI Component

1. Add HTML to `index.html`
2. Add CSS to `styles.css`
3. Add event listeners in `frontend/app.js`
4. Add save logic to `saveToDisk()` method

## 🐛 Debugging Tips

### Rust Errors
```bash
cargo check              # Find errors without full build
cargo build --verbose   # See compiler details
```

### Frontend Errors
- Open DevTools: `F12` in app window
- Check browser console
- Use `console.log()` for debugging

### File System Issues
- Check `data/` directory exists
- Verify files are readable/writable
- Inspect `.json` files directly

## 📊 Performance Notes

- Media grid optimized for ~500 items
- All filtering is client-side
- Auto-save happens immediately
- No caching needed (all in memory)

## 🚢 Release Checklist

- [ ] Update version in `Cargo.toml`
- [ ] Update `CHANGELOG.md`
- [ ] Run `cargo test`
- [ ] Run `cargo tauri build`
- [ ] Test on Windows, macOS, Linux
- [ ] Git tag: `v0.x.x`
- [ ] Upload binaries to GitHub Releases

## 📦 Dependencies

### Rust (keep minimal!)
- tauri - Desktop framework
- tokio - Async runtime
- serde_json - JSON handling
- uuid - ID generation
- chrono - Timestamps

### Frontend
- **None** - Pure vanilla JavaScript!

## 🎯 Development Goals

✅ Zero-friction offline app
✅ Human-readable data format
✅ Minimal dependencies
✅ Cross-platform support
✅ Fast startup & responsiveness
✅ Comprehensive documentation

## 📝 Code Style

### Rust
```rust
pub fn snake_case_functions() {
    // Implementation
}

pub struct PascalCaseStructs {
    pub field: Type,
}
```

### JavaScript
```javascript
function camelCaseFunctions() {
    const CONSTANTS = 'ALL_CAPS';
    let variables = 'camelCase';
}
```

### CSS
```css
.component__child--modifier {
    --variable-name: value;
    color: var(--variable-name);
}
```

## 🔗 Useful Links

- [Tauri Docs](https://tauri.app/docs/)
- [Rust Book](https://doc.rust-lang.org/book/)
- [MDN Web Docs](https://developer.mozilla.org/)
- [Serde JSON](https://docs.rs/serde_json/)

## ❓ FAQ

**Q: Can I run from USB?**
A: Yes! Set data directory to USB path on first launch.

**Q: How do I backup data?**
A: Copy `~/mediaweb/data/` folder to backup location.

**Q: Can multiple instances run?**
A: Yes, just use different data directories.

**Q: How do I distribute my changes?**
A: Fork on GitHub, commit, push, and share your branch.

**Q: Is my data safe?**
A: Yes, it's local only. Always keep backups!

## 🆘 Getting Help

1. Check relevant documentation file (README, SPEC, DEVELOPMENT)
2. Review example in `data/EXAMPLE.md`
3. Check existing GitHub issues
4. Open a new issue with details

---

**MediaWeb v0.1.0**
Built for offline-first workflows.
