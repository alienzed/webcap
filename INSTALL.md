# MediaWeb Installation Guide

## System Requirements

- **Windows 10+**, **macOS 10.13+**, or **Linux** (most distributions)
- **4 GB RAM** (minimal)
- **100 MB disk space** (for app, data varies by media)

## Option 1: Pre-built Binary (Recommended)

### Windows

1. Download `mediaweb-setup.exe` from [Releases]
2. Run the installer
3. Launch MediaWeb from Start Menu
4. On first run, choose a data directory

### macOS

1. Download `MediaWeb.dmg` from [Releases]
2. Double-click to open
3. Drag MediaWeb to Applications
4. Launch from Applications folder
5. On first run, choose a data directory

### Linux

1. Download `mediaweb.AppImage` from [Releases]
2. Make executable: `chmod +x mediaweb.AppImage`
3. Run: `./mediaweb.AppImage`
4. On first run, choose a data directory

## Option 2: Build from Source

### Prerequisites

**All Platforms:**
- Rust 1.70+ - https://rustup.rs/
- Git

**Windows:**
- Visual Studio Build Tools or Visual Studio Community
- WebView2 Runtime (usually pre-installed on Windows 10+)

**macOS:**
- Xcode Command Line Tools: `xcode-select --install`

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get install \
  build-essential \
  webkit2gtk-4.0 \
  libgtk-3-dev
```

**Linux (Fedora):**
```bash
sudo dnf install \
  gcc \
  webkit2gtk3-devel \
  gtk3-devel
```

### Installation Steps

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/mediaweb.git
   cd mediaweb
   ```

2. **Build the application**
   ```bash
   cargo tauri build
   ```

   This takes 5-10 minutes on first build.

3. **Run the app**
   
   **Windows:**
   ```
   Double-click: src-tauri\target\release\bundle\msi\mediaweb_0.1.0_x64_en-US.msi
   ```

   **macOS:**
   ```bash
   open src-tauri/target/release/bundle/macos/MediaWeb.app
   ```

   **Linux:**
   ```bash
   ./src-tauri/target/release/mediaweb
   ```

4. **First launch**
   - Click "Choose" in Settings
   - Select or create a data directory
   - Default: `~/mediaweb/data`

## Development Installation

For development or customization:

1. **Install Rust** (if not already done)
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **Clone and enter**
   ```bash
   git clone https://github.com/yourusername/mediaweb.git
   cd mediaweb
   ```

3. **Run in development mode**
   ```bash
   cargo tauri dev
   ```

   The app opens in a debug window. 
   - Hot reload: Edit files and press `Ctrl+R` in the app window
   - Console: `F12` opens browser DevTools

4. **Make changes**
   - Edit `frontend/app.js` for logic
   - Edit `frontend/styles.css` for styling
   - Edit `src/*.rs` for backend changes
   - Restart `cargo tauri dev` for Rust changes

## Portable Setup (No Installation)

If you want to run MediaWeb without installing:

1. Build from source (see above)
2. Copy the binary to a USB drive
3. Run it directly from the USB drive
4. Data directory can be on the same USB drive

**Recommended directory structure:**
```
mediaweb-portable/
├── mediaweb.exe (or mediaweb on Linux/macOS)
└── data/
    ├── media/
    ├── meta/
    ├── pages/
    └── tags.json
```

## Data Directory Setup

### Location Options

**Default (Recommended):**
- Windows: `C:\Users\YourUsername\mediaweb\data`
- macOS/Linux: `~/mediaweb/data`

**Custom Locations:**
- Cloud synced folder (Dropbox, OneDrive, etc.)
- External drive
- USB drive
- Network drive (if accessible)

### Initial Structure

After first run, the app creates:

```
data/
├── media/          # Add your images/videos here
├── meta/           # Auto-created metadata
├── pages/          # Auto-created page files
└── tags.json       # Auto-created tag list
```

### Manual Setup (Optional)

If you prefer to pre-create the directory:

```bash
# Windows (PowerShell)
mkdir $env:USERPROFILE\mediaweb\data
mkdir $env:USERPROFILE\mediaweb\data\media
mkdir $env:USERPROFILE\mediaweb\data\meta
mkdir $env:USERPROFILE\mediaweb\data\pages
echo "[]" > $env:USERPROFILE\mediaweb\data\tags.json

# macOS/Linux
mkdir -p ~/mediaweb/data/{media,meta,pages}
echo "[]" > ~/mediaweb/data/tags.json
```

## Troubleshooting

### "App won't start"

**Windows:**
- Install WebView2: https://go.microsoft.com/fwlink/p/?LinkId=2124703
- Restart your computer

**macOS:**
- Run: `xcode-select --install`
- Restart your computer

**Linux:**
- Ensure GTK development libraries are installed
- Check distribution-specific instructions above

### "Can't find data directory"

- Click "Choose" in Settings
- Navigate to or create the directory
- Ensure it's readable/writable

### "Files not appearing"

- Place files in `data/media/` manually
- Restart the app
- Check file permissions

### "Out of memory with large media"

- MediaWeb is client-side JavaScript
- Large videos may cause slowness
- Workaround: Create multiple data directories for different projects
- Or upgrade to 8+ GB RAM

## Updating

### Pre-built Binary

- Download the latest release
- Reinstall (your data directory won't be affected)
- Or just replace the executable

### From Source

```bash
cd mediaweb
git pull origin main
cargo tauri build
```

## Uninstalling

### Windows
- Settings → Apps → Apps & Features → MediaWeb → Uninstall
- Data directory (`~/mediaweb/data`) is NOT deleted

### macOS
- Drag MediaWeb to Trash from Applications

### Linux
- If AppImage: just delete the file
- If installed: `sudo apt remove mediaweb` or similar

### Portable
- Just delete the folder

## Data Backup

**Always backup your data directory!**

```bash
# Windows (PowerShell)
Copy-Item -Path $env:USERPROFILE\mediaweb\data -Destination $env:USERPROFILE\mediaweb\data.backup -Recurse

# macOS/Linux
cp -r ~/mediaweb/data ~/mediaweb/data.backup
```

**Recommended backup strategy:**
- Weekly: Copy `data/` folder to external drive
- Cloud: Sync `data/` with Dropbox/OneDrive
- Version Control: Commit to git regularly

## Advanced: Custom Installation Paths

If you want MediaWeb in a specific location:

**Windows (Command Prompt):**
```cmd
set MEDIAWEB_DATA=D:\MyProjects\mediaweb\data
mediaweb.exe
```

Then choose `%MEDIAWEB_DATA%` in Settings.

## Migrating from Another Tool

If you're moving from another CMS:

1. Export media from your old tool
2. Place files in `mediaweb/data/media/`
3. Create metadata JSON files in `mediaweb/data/meta/`
4. Run MediaWeb

See `data/EXAMPLE.md` for metadata format.

## Security Notes

- **No auto-updates** (you control when to update)
- **No telemetry** (works entirely offline)
- **No accounts needed** (local-only)
- **Backup sensitive data** (deleting files is permanent)

## Getting Help

- 📖 See [README.md](README.md) for usage
- ⌨️ See [SHORTCUTS.md](SHORTCUTS.md) for keyboard tips
- 💻 See [DEVELOPMENT.md](DEVELOPMENT.md) for technical details
- 🐛 Report bugs on GitHub Issues
- 💬 Ask questions in GitHub Discussions

## Next Steps

1. [Read the README](README.md)
2. [Learn keyboard shortcuts](SHORTCUTS.md)
3. [Check the examples](data/EXAMPLE.md)
4. Start uploading media!

---

**Enjoy MediaWeb!** 🎉
