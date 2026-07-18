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
2. Use image and video transforms from context menus as needed (crop, blur background, remove background, rotate, flips, deface).
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
1. Use `Review Set` to analyze only the currently visible (filtered) subset.
2. Use report links to focus on failures, duplicates, and similarity clusters.
3. Iterate on captions or media selection until review output is acceptable.

---

## 5. Prepare Dataset
1. Run `Prepare Dataset`.
2. If filtered to a subset, confirm partial prepare when prompted.
3. Inspect `auto_dataset/prep_manifest.json` for selection snapshot details.

---

## 6. Choose profile and generate configs
1. Open `Train` and choose a model profile.
2. Choose a Dataset target (`POC`, `Normal`, or `Quality`).
3. Run `Generate Configs` to write the selected profile's dataset TOML and training plan.
4. Missing config templates are created during Generate, command preview, or launch; existing edited TOML is preserved unless explicitly reset.

---

## 7. Run or hand off training
1. Choose the profile's valid run option.
2. Use `Generate & Copy Manual Command` for a non-launching WSL handoff, or select `Train this set` to start/queue managed training.
3. Follow job-specific progress, output, checkpoint ETA, queue state, and history in Training.

See [training_profiles.md](training_profiles.md) for the current model and dataset combinations.

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
