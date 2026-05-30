# Dataset Workflow (Current App Behavior)

This document reflects current WebCap behavior and a practical end-to-end workflow.

---

## 1. Ingest and Organize Source Media
1. Place source videos in `src_videos/` under the target set folder.
2. Keep source naming clear so later clips remain traceable.

Notes:
- `src_videos` is source-only. It is excluded from set-scaffold behavior such as `originals/` creation.

---

## 2. Create Working Media
1. Use `Clip...` on videos in `src_videos` to export clips into the parent set folder.
2. Use image and video transforms from context menus as needed (crop, rotate, flips, deface).
3. Keep only intended training media in the set folder root.

Notes:
- Clip export is non-destructive to source videos.
- Mutating operations in set folders use `originals/` backups for reversibility.
- Mutation indicators appear in the media list and preview overlay.
- Image mutation state is hash-verified against originals for supported formats (`.jpg/.jpeg/.png/.webp`).
- Video mutation state is best-effort from action success + persisted state.

---

## 3. Caption and Curate
1. Caption media in the set folder.
2. Use requirements, phrases, tags, reviewed state, and ratings to curate quality.
3. Use prune/reset/restore/rename workflows to keep the set clean.

---

## 4. Review and Filter
1. Use `Review Captions` to analyze only the currently visible (filtered) subset.
2. Use report links to focus on failures, duplicates, and similarity clusters.
3. Iterate on captions or media selection until review output is acceptable.

---

## 5. Prepare Dataset
1. Run `Prepare Dataset`.
2. If filtered to a subset, confirm partial prepare when prompted.
3. Inspect `auto_dataset/prep_manifest.json` for selection snapshot details.

---

## 6. Generate Configs
1. Run `Generate` to write/update dataset config output.
2. If prep manifest is missing, Generate auto-runs Prepare once.
3. Missing config templates are created during generate/train flows, not on folder load.

---

## 7. Training Handoff
1. Use `Train` to print command preview and resolved config paths.
2. Execute training externally.

Notes:
- Current Train flow is command preview only; execution is intentionally disabled in-app.

---

## Folder Semantics
- `originals/`: baseline backups for reversible mutation workflows in set folders.
- `auto_dataset/`: prepared outputs and prep manifest artifacts.
- `src_videos/`: source media workspace; metadata is available, scaffold behavior is excluded.

---

## Principles
1. Explicit actions over hidden automation.
2. Reversible media mutation in set folders.
3. Selection-aware prepare/generate behavior.
4. Keep source media (`src_videos`) separate from working/training media.
