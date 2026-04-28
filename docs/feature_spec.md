# New Feature Specifications (2026)

This document tracks major new features and their implementation specs. See individual files in `docs/` for full details.

---

## 1. Expandable Console Panel (Streaming Output)
- See: [docs/console_panel.md](docs/console_panel.md)
- Purpose: Show streaming output (e.g., autoset, deface) in a resizable overlay, keeping the main UI clean.
- Status: Spec complete.

## 2. Media Metadata Panel in Review Captions
- See: [docs/media_metadata_panel.md](docs/media_metadata_panel.md)
- Purpose: Collapsible section in Review Captions area showing all clips with resolution, duration, frame count.
- Status: **Implemented (2026-04-28)**

> **Note:** This feature is now live. The Review Captions screen displays the metadata panel as specified, with all required fields populated from `media_metadata.json`.

## 3. Config File Editing (Safe, Minimal)
- See: [docs/config_file_editing.md](docs/config_file_editing.md)
- Purpose: Edit TOML config files via contextual menu or review report, with a dedicated backend endpoint for safety.
- Status: Spec complete.

---

All features are designed for minimal UI impact, regression-free integration, and future extensibility.
