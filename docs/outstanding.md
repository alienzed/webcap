This file details bugs, enhancements and feature requests.

Review for safety, anticipate regressions, think of multiple ways of achieving these and suggest the most minimal less impactful option.
If complete and confirmed, move to Completed section.

## Bugs

## Enhancements
- Training section should become the explicit prep hub:
  - Add `Run Autoset` as a first-class button in Training while keeping the folder context-menu action.
  - Show config files in HI/LO grouped columns for faster scan and editing flow.
  - Keep `Generate Config` explicit; avoid hidden assumptions about when files mutate.
- Training command generation and inspection:
  - Generate and print concrete HI/LO training commands to console (resolved paths/config refs).
  - Validate config wiring before printing commands (e.g., config->dataset references).
- Config artifact lifecycle cleanup:
  - Revisit automatic config creation-on-folder-load behavior now that config generation is first-class.
  - Prefer explicit generation/update actions over implicit mutation during folder navigation.
- Media metadata report enhancements:
  - Optionally group metadata by AR and/or sortable headings.
  - Within groups, allow sorting by resolution (smallest to largest).
- Tags are currently available but lower priority:
  - Keep stable, but do not prioritize expanding tag features until a clear workflow need appears.

## Cleanup Candidates
- Consolidate set-context gating behavior around one shared helper (`isSetFolderContext`) and remove stale duplicated checks.
- Remove/retire disabled-only UX paths where visibility gating is now the intended behavior.
- Audit legacy folder-load side effects (especially training/config related) and keep only those clearly required for safety.
- Consider de-emphasizing optional UI features (like tags) if they remain unused and add cognitive load.

## Nice to Haves (Out of Scope for Now)
- In-app training execution/lifecycle management (launching long runs from WebCap/WSL directly).
- TensorBoard lifecycle helpers (start service, open browser tab, monitor state).
- Broader in-app process orchestration for multi-hour jobs.

## Backlog - Do not implement these yet
- Dataset infered number of samples, MegaFramePixels, if we want to get really crafty, try to estimate VRAM, step time...
- Many operations on files/folders will refresh the entire directory. For prune and rename, only the affected item is now updated (no full refresh). Other operations may still refresh the directory; consider further optimization if needed.
- [Future] Allow placing .txt files (e.g., expressions.txt, places.txt, lighting.txt) in a folder to auto-populate additional phrase tabs. Each file is a list of phrases (one per line). Not implemented yet.
- Set-wide (only current folder) search and replace. Use case: changing keyphrase or correcting a repeated typo.

## To think about more / Not clearly necessary
- Up / Down keys to browse while media list is focused (lost when editing of course...).
- Dataset infered number of samples, MegaFramePixels, if we want to get really crafty, try to estimate VRAM, step time...

## Requires validation
- Refactor app.py to split routes from heavy logic.
- Status bar and console toggle should be fixed to the bottom of the left side panel, always visible; the rest of that panel can scroll behind it.
- Caption requirements/phrases/tags should render as 3 columns on wide screens and tabs on narrower screens.
- Config files seem to be getting the wrong path in at least one failed use case.
- Config files do not seem to be autosaving.
- Upon save of a previous empty caption, it takes a directory refresh for the missing state to clear.
- Generate appropriate config files based on set metadata.
- A way to crop images to preset AR.
- Autoset may require some adjustments, especially for images.
- Make it so that the primer caption alone doesn't get saved. (Currently only implemented for autosave; manual saves still save primer-only captions. Needs fix.)
- Reset Review state (contextual menu option on Current folder only).

## Complete
- After a rename, the item gets reselected after refresh (pendingSelectFileName logic implemented).
- Make colors in context menu bigger.
- Prune now uses a pruned_ prefix in the originals folder (not a separate folder). All collision and backup logic is handled there. (Current design; see prune.md)
- Caption Requirements.
- Status bar and console toggle fixed to bottom of left panel, always visible, scrollable content behind it.
- Media Metadata grouped by AR (optionally), color column hidden if not relevant.
- When a caption is missing, the item gets a yellowish background; after saving, the background updates correctly.
- Console appends and scrolls to bottom automatically.
- Open in Explorer works; also works in WSL with powershell.exe fallback.
- Review and Filter reflect edits immediately (state.items updated after every save).
- Prune removes only the affected item from state/items and DOM (no full refresh).
- F2 to rename media files.
- Captions save only when actually changed (no unnecessary saves).
- Prune clears caption/preview when the current item is pruned.
