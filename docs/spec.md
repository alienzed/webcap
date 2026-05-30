# WebCap Specification (Current Behavior)

Last updated: 2026-05-30

## 1. Scope
WebCap is a local-first media curation and captioning app for dataset preparation workflows. It focuses on explicit, reversible file mutations and fast iteration on set quality.

## 2. Architecture
1. Backend: Flask routes for filesystem/media operations and dataset workflow actions.
2. Frontend: plain global JavaScript state and functions (intentionally non-module).
3. Storage:
- App config: `tool/config.json`
- Per-folder state: `.webcap_state.json`
- Metadata cache: `media_metadata.json`
- Backup folder: `originals/`
- Prepare outputs: `auto_dataset/`

## 3. Folder Classes
1. Set folder (normal working folder):
- Captioning, review, prepare, generate, train preview are available.
- `originals/` backup behavior applies.
2. System/source folders:
- `originals`: backup container, protected semantics.
- `auto_dataset`: generated artifacts.
- `src_videos`: source-inspection workspace (metadata and clip flow allowed, set scaffolding excluded).

## 4. Core Workflows
1. Navigation and selection:
- Folder browsing and media selection are driven by `/fs/describe`.
 - Filter summary row shows match count plus folder-level rating progress as `Rated A/B`.
2. Caption editing:
- Load/save caption sidecars per media.
- Autosave/manual save flows are supported.
3. Review:
- `Review Captions` runs on the current visible/filtered set.
- Report links can focus file subsets in the UI.
4. Reversible media mutation:
- Prune/reset/restore/crop/transform/deface/clip workflows are exposed through context menus and routes.
- Set-folder mutations rely on `originals/` backups for reversibility.
- UI mutation indicator:
- Media rows and preview actions show `Mutated` state when files differ from their baseline original.
- Video mutation state is best-effort (action-sourced + persisted).
- Image mutation state is reconciled by deterministic SHA256 compare (`/fs/mutation_status`) against `originals/<fileName>`.
 - Preview quick actions:
 - Images show always-visible `Crop` and `Deface`.
 - Videos show always-visible `Clip` and `Deface`.
 - A preview `More` menu preserves full media-list context-menu action parity.
5. Dataset prep/generate:
- Prepare can run on visible subset with selection snapshot metadata.
- Generate can auto-run Prepare once if prep manifest is missing.
6. Train:
- Train route returns command preview text; execution is currently disabled in-app.

## 5. State Model (`.webcap_state.json`)
Primary persisted fields include:
1. `reviewedKeys`
2. `flags`
3. `stats`
4. `primer`
5. `caption_requirements`
6. `caption_requirements_checked`
7. `caption_requirement_keywords`
8. `caption_phrases`
9. `caption_set_notes`
10. `caption_tags_by_media`
11. `ratings_by_media`
12. `mutated_media_keys`

## 6. Config Template Behavior
1. Config templates are not created on folder load.
2. Missing config files are created during generate/train paths when needed.
3. Placeholder substitution uses the configured filesystem/training roots.

## 7. Safety and Guardrails
1. Explicit user actions for destructive operations.
2. Backups in `originals/` for set-folder mutation flows.
3. Protected handling for system folders (`originals`, `auto_dataset`, `src_videos`).
4. Streaming endpoints surface command output and errors directly.

## 8. Current Non-Goals
1. In-app long-running training orchestration.
2. TensorBoard lifecycle management.
3. Broad multi-hour process orchestration.

## 9. Primer Mappings V2
Structured primer mappings and review rules are specified in:
- `docs/primer_mappings_v2.md`

This defines:
1. `primer.mappings` structured rows (`scope`, `token`, `key`, `value`, `fallback`, `enabled`)
2. `stats.reviewRules` structured rows (`scope`, `trigger`, `required`, `enabled`)
3. Deterministic evaluation semantics and UI contract.
