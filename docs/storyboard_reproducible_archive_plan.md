# Storyboard reproducible archive — implementation plan

Grounded in `AGENTS.md`, `docs/storyboard.md`, `docs/filesystem_state_contract.md`, and the owner-backed Media Explorer discovery in `tool/server/media_explorer.py`.

## Phase 1 — Make archive an explicit destructive action
- Keep `status=complete` as a non-destructive authoring status.
- Keep `status=archived` for presentation while replacing the Story-library Archive button's plain status update with a preview and explicit confirmation.
- Preview must require a current exported sequence: `storyboard_assembly.current_export` already checks movie/manifest existence, Story ID and selected Take IDs.
- Calculate reclaimable bytes from generated Take paths only, including active and soft-removed Takes. Imported media is user-supplied and retained.
- Block committing while Story-bound Director or inference work is pending. Do not change any existing queue mechanics.

## Phase 2 — Reclaim expensive generated media safely
- Implement inside Storyboard's file-based owner using the existing `story.json`, serialized mutation lock, and media resolver.
- Preserve exported MP4/manifest, Story/Scene metadata, selected Take IDs, frozen Take provenance and ratings.
- Preserve referenced conditioning inputs from active and removed Scenes and Takes. Generated media referenced directly as an input stays on disk.
- Mark each cleaned Take with `mediaPurged`, leaving its full recipe in the manifest. Never simulate a reversible Remove/Restore for permanently deleted files.
- Re-running archiving is idempotent. Successful deletions stay recorded even when a later removal fails. No background cleanup, new global state or media index.
- Include missing-input warnings in the preview, rather than silently implying all prior generations can be reproduced.

## Phase 3 — Keep archived Stories usable
- Show a recipe placeholder instead of requesting missing Take media, including in Sequence view.
- Queue regeneration from frozen prompt/settings/seed/LoRAs/references through the existing inference lane. Do not silently overwrite the original Take: the new output is a new Take.
- Restore Recipe only changes editing status; it cannot undelete purged media.
- Media Explorer already discovers the exported movie under its Story owner; retain existing route and storage layout. A dedicated Completed Stories browsing facet can be polished separately without a migration.

## Verification and remaining technical caveat
- Test fresh archive preview, missing/stale export refusal, retained movie and imported/reference assets, missing-input warnings, idempotent retry, purged Take metadata and regeneration request.
- Older Takes only recorded available evidence. A frozen seed and effective input are not a guaranteed byte-identical reproduction: engine/model/workflow changes and wildcard expansion can affect output.
- `effectiveInput` captures resolved sampler inputs and required LoRAs, but currently is not a complete historical workflow snapshot. Exact checkpoint hashes and durable resolved wildcard text are not guaranteed on existing Takes. Do not label these archives bit-reproducible.
- Full pytest/browser runtime verification needs a checkout and representative local Storyboard media; GitHub connector editing alone does not execute tests.
