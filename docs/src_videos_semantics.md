# src_videos Semantics (Decision Note)

## Status
`IMPLEMENTED` (updated May 19, 2026)

This note defines how `src_videos` behaves relative to set-folder workflows.

## Current Behavior
1. `src_videos` is treated as a source-inspection workspace, not a set-scaffold workspace.
2. Media metadata still works while browsing `src_videos`.
3. The `Clip...` action is available for video files in `src_videos`.

## What Is Excluded in src_videos
1. No `originals/` creation or backup management inside `src_videos`.
2. No set-scaffold behavior that belongs to training-set folders.

## Implementation Anchors
1. Frontend set-folder gating excludes `src_videos`.
- File: `tool/js/common.js`
2. Backend originals/scaffold gating excludes `src_videos`.
- File: `tool/server/originals.py`
3. Metadata endpoint remains folder-local and available.
- File: `tool/server/media.py` (`/fs/media_metadata`)

## Validation Checklist
1. Navigating into `<set>/src_videos` does not create `<set>/src_videos/originals`.
2. Selecting media in `src_videos` still shows metadata fields.
3. Existing behavior for `originals` and `auto_dataset` exclusions remains unchanged.
