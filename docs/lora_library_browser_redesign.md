# LoRA Library browser redesign — implementation plan

## Existing contracts (confirmed in source)
- `tool/server/lora_library.py`: configured Test-copy roots are authoritative; scans recursive *.safetensors files; profile enrichment lives in sibling `.webcap.json`. No ComfyUI dependency or persistent index.
- `tool/server/model_epoch_profile.py:validate_enrichment`: editable fields are description, trainedWords, promptOptions (named arrays), guidance. All additional sidecar keys are preserved by the backend.
- `tool/js/app_settings.js`: original Settings/Models LoRA UI was a flat unsorted button list plus raw JSON editing. Generations called `window.openLoraMetadataEditor`.
- `tool/server/lora_library.py:resolve_for_inference`: inference name resolution and enriched eligibility are separate and MUST remain unchanged.
- `AGENTS.md`: own DOM/state locally, no new store or event bus, no app state persisted for UI filters, visible failures, preserve DOM identity when changing lists, avoid destructive operations.

## Delivered phases
1. **Preserve contracts.** No backend/schema, inference, filesystem, or training behavior changes. Use existing GET/POST profile endpoint and root configuration.
2. **New browser surface.** Replace the Settings button dump with a launch button and a wider dedicated dialog. Add a direct link from Generations, and retain the `openLoraMetadataEditor(name, stage)` entry point.
3. **Discovery and navigation.** Search across existing metadata, filter by stage/folder/profile state, and sort. Keep a selected profile in a separate scrollable details pane. Reconcile keyed rows in place.
4. **Profile editing.** Keep the editable fields and API payload identical. Offer add/remove prompt-option groups and phrases; retain raw JSON editing under Advanced. Preserve unsaved edits on selection/close via confirmation and expose save or retrieval errors.
5. **Verification.** Static interface checks, server tests for catalogue/profile semantics, manual browser checks for tab navigation, thousands-of-entries scrolling, selection, save/reload, partial/empty/malformed JSON, dark mode, and responsive viewport. Check Generations metadata entry and confirm no interference with inference.

## Remaining manual QA gates
The GitHub connector has repository-file write access but the execution container cannot resolve GitHub, so no local application runtime, visual browser, or real configured LoRA roots were accessible. Run targeted tests and a visual test in a working WebCap environment before release. Never interpret this environment as the user's actual training machine.

## Scope boundaries
No permanent thumbnails/index/database, inferred model traits, new storage, sorting by nonexistent metrics, checkpoint mutation, auto-enrichment, or cross-workspace registry. A later thumbnail gallery should require a reliable existing preview reference instead of fabricated images.
