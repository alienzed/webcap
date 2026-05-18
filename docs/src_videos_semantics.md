# src_videos Semantics (Decision Note)

## Status
`PROPOSED` (May 18, 2026)

This note defines how `src_videos` should behave relative to set-folder rules.
No implementation is included here.

## Implementation Note (May 18, 2026)
The blacklist tweak has now been applied:

1. Frontend set-folder blacklist now includes `src_videos`.
- File: `tool/js/common.js`
- Effect: `Config/Review/Train` left workspace does not appear in `src_videos`.

2. Backend originals blacklist now includes `src_videos`.
- File: `tool/server/originals.py`
- Effect: `src_videos/originals` is not created by folder describe/backup flow.

3. Metadata path unchanged.
- File: `tool/server/media.py` (`/fs/media_metadata`)
- Effect: metadata still generates for current folder, including `src_videos`.

## Problem
When browsing `src_videos`, the app currently creates `src_videos/originals`.
That indicates `src_videos` is being treated like a set folder for backup/scaffolding logic.

Observed trigger path:
- `GET /fs/describe` calls `copy_media_to_originals(dir_path)` for the current folder.
- No special-case exclusion exists for `src_videos`.

## Required Behavior
`src_videos` is a source-inspection workspace, not a training set workspace.

### Must Do
1. Keep metadata available when user is inside `src_videos`.
2. Allow video inspection (resolution, duration, fps, etc.) in current-folder context.

### Must Not Do
1. Do not create or manage `originals/` inside `src_videos`.
2. Do not treat `src_videos` as a folder that receives set scaffolding behavior.

## Policy Split
Define two folder classes instead of one overloaded "set folder" concept:

1. `Set-scaffold-eligible` folder
- Used for: originals backup creation, config template creation, and similar set lifecycle behaviors.
- Excludes: `originals`, `auto_dataset`, `src_videos`.

2. `Metadata-eligible` folder
- Used for: `/fs/media_metadata` generation and display.
- Includes: normal set folders and `src_videos` (current folder only).
- Excludes only true system/internal folders as needed by policy.

## Impact on Existing "Set Folder" Condition
Current frontend set-folder check excludes only `originals` and `auto_dataset`.
This is fine for review gating today, but backend scaffold logic needs a stricter exclusion set for mutation scaffolding.

Practical meaning:
1. No need to block metadata in `src_videos`.
2. No need to redefine metadata eligibility around review.
3. Need to tighten scaffold eligibility so `src_videos` is treated as source-only.

## Non-Goals
1. No recursive metadata merge into parent set folder from `src_videos`.
2. No review-panel inclusion of `src_videos` rows when reviewing parent set.
3. No changes to wildcard/template work in this note.

## Validation Checklist (for later implementation)
1. Navigating into `<set>/src_videos` does not create `<set>/src_videos/originals`.
2. Selecting a media item in `src_videos` still shows metadata fields.
3. Existing behavior for normal set folders remains unchanged.
4. `originals` and `auto_dataset` exclusions still work as before.
