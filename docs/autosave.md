# Autosave

## Scope

Autosave in this document applies only to content edited in `ui.editorEl`:

| Mode | Trigger condition | Endpoint |
|---|---|---|
| Caption | `state.currentItem` set | `/caption/save` |
| Config file | `state.currentConfigFile` set | `/fs/save_config` |

Stats/primer autosave (`wireStatsPrimerAutoSave` / `saveFolderStateForCurrentRoot`) is out of scope and must not be modified.

## Common mechanism

Caption and config autosave share one `input` listener on `ui.editorEl`, wired once in `wireAllUi()` in `main.js`.

On every `input` event, the save payload is captured immediately at event time (atomic snapshot):

```js
// Caption payload
{ folder, media, text }

// Config payload
{ folder, file, text }
```

When the debounce callback fires, it sends exactly the captured payload for that event; it must not re-read mutable selection state.

Programmatic assignment of `ui.editorEl.value` (e.g. loading a caption or config file) does **not** fire an `input` event in JavaScript, so autosave will not trigger on content loads.

## Per-target debounce timers

Debounce must be keyed by save target (media file or config file), not shared globally.

Example structure:

```js
autosaveTimers[targetKey] = timerId
```

Behavior:
1. Event occurs while editing target `A` -> (re)start timer for `A`
2. Switch to target `B`, type before `A` timer expires -> (re)start timer for `B`
3. `A` timer is unaffected by `B` input and still flushes `A` snapshot

This guarantees that only subsequent input for the same target can reset that target's timer.

## Ctrl+S behavior

`saveCurrentEditorContent` remains fully supported. Ctrl+S should:
1. prevent browser page-save behavior
2. trigger immediate save for the currently edited target

Autosave and Ctrl+S coexist. Ctrl+S is explicit user-triggered immediate save; autosave is background save after inactivity.

## Debounce delay and correctness

Any debounce delay (`100ms`, `2s`, `10s`, etc.) still preserves correctness of target mapping: the saved payload will belong to the target from the originating input event snapshot.

What delay changes:
- Freshness (how soon changes persist)
- Network request frequency

Longer delays increase loss window if the app/tab/process exits before timer fire. That is a latency/durability tradeoff, not a target-mismatch risk.

## Guard

Only one fallback guard is required: if neither caption nor config target can be resolved at input time, skip save.

## Consequences

- All explicit `savePathCaption()` calls that exist purely as pre-operation safety flushes become redundant and should be removed.
- `saveCurrentEditorContent` / Ctrl+S remains available and should continue to work.

## Files to change

| File | Change |
|---|---|
| `tool/js/main.js` | Replace separate config autosave listener with unified per-target autosave listener in `wireAllUi()`; preserve Ctrl+S call to `saveCurrentEditorContent`; remove explicit `savePathCaption()` calls used as safety flushes |
| `tool/js/ui.js` | Remove `savePathCaption()` call in `runReview()` |
| `tool/js/media.js` | Remove `await savePathCaption()` in `resetMediaItem()` |
