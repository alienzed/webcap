# Video Clip Feature Specification

## Goal

Allow the user to extract a named video clip from a raw source file — trimming time range and cropping to an aspect ratio — and save the result directly into the working set folder for captioning.

This is a source-to-training-clip workflow, not a general video editor. V1 is intentionally narrow.

## Implementation Strategy

The safest way to build this is in phases, with a deliberately small V1 and the rest documented as V2.

- Phase 1: source video -> exported clip, using video playback for start time selection, a crop UI that can be simplified if needed, duration, filename, and export.
- Phase 2: editing ergonomics and polish only if V1 is stable.

The point of the split is to keep the first implementation small enough that the backend and modal wiring can be verified before any more interactive complexity is added.

If a sub-feature starts pushing toward hundreds of lines of new code, stop and check whether the repo already has a helper or whether a small third-party package would do the job better. Crop and clip are separate concerns that can share one modal, but V1 should preserve video playback/scrubbing even if crop has to be simplified or deferred.

## Code Paths To Reuse

These are the strongest local anchors for implementation and should be treated as the default patterns unless a better fit is proven.

- `tool/server/dataset_prep.py` provides the canonical ffmpeg subprocess pattern in this repo: build a list of args, call `subprocess.run([...], capture_output=True, text=True)`, and raise on non-zero returncode.
- `tool/server/crop_ops.py` shows the crop-side safety pattern: validate inputs, back up originals when mutating in place, write to a temp file, then atomically replace the destination.
- `tool/js/crop.js` and the crop modal in `tool/tool.html` already show a working Cropper.js-based crop flow. That is the best evidence that V1 should piggyback on Cropper.js rather than hand-roll canvas hit-testing.
- `tool/server/media.py` shows the response pattern for crop/reset/prune, including immediate metadata refresh after a mutation.
- `tool/js/media_context_actions.js` is the exact place where the `Clip...` and `Flip Horizontal` actions should be wired into the context menu.
- `tool/tool.html` is where the modal markup and script include should be added, without disturbing the rest of the page.

This repo already gives us the primitives we need; the new feature should mostly compose them rather than inventing new infrastructure.

## Source Folder Convention

- Raw source videos live in a subfolder named `src_videos` inside the set folder.
- The user populates `src_videos` manually (drag-in from OS). No upload UI is provided.
- `src_videos` is naturally excluded from Prepare Dataset because the folder scan is non-recursive.
- `src_videos` items appear in the media list when the user navigates into that subfolder, exactly like any other subfolder.

## User Flow

### V1: Minimal Reliable Clip Export
- User navigates into `src_videos` in the media list.
- User right-clicks a video file.
- Context menu shows `Clip...` for video files only.
- A modal opens with a video player for the source video.
- User chooses an aspect ratio preset for the crop box.
- User positions/resizes the crop box using the existing Cropper.js-based crop interaction pattern from the image crop feature, but over a placeholder that matches the video’s native dimensions rather than over the video itself, if that can be done without interfering with playback.
- User finds the start position by playing and scrubbing the video in the modal. Precise controls may still exist for frame stepping or numeric start time entry, but the video player is the primary way to pick the clip point.
- User enters duration.
- User enters an output filename.
- User confirms overwrite only if the output file already exists.
- User clicks `Export`.
- Backend writes a non-destructive MP4 clip to the parent set folder (sibling of `src_videos`).
- Modal closes, the set folder reloads.

### V2: Better Editing Ergonomics / Polish
- Independent end-frame scrubber.
- Timeline mouse dragging as an optional convenience, not the primary control.
- Horizontal flip.
- Preview playback in the modal.
- Batch clipping.
- Codec / output configuration.
- Extra UX polish around frame stepping and preview feedback.

## Safety Model

- The clip export is fully non-destructive: the source file in `src_videos` is never modified.
- The output is always a new file written to the set folder. No in-place mutation.
- No originals backup is needed for clip export (source is untouched, output is new).
- If the output filename already exists in the set folder, the backend should only overwrite after an explicit user confirmation. No silent overwrite.
- No caption `.txt` sidecar is created on export. The app creates one automatically on next folder load if the caption system requires it.

## UI Scope


- Clip export lives entirely in a modal (`id="video-clip-modal"`).
- The modal shows:
  - An HTML5 `<video>` element for playback, scrubbing, and start time selection. The user can play, pause, and scrub through the video to find the desired start time for the clip.
  - A crop surface that may be a transparent overlay or blank canvas matching the video’s native resolution, if that keeps playback usable. If the overlay risks blocking playback or scrubbing, V1 can reduce or defer cropping rather than compromise the video player.
  - The crop rectangle, when present, is always relative to the video’s native resolution and is independent of video playback.
  - A duration number field.
  - A live pixel readout of the current crop selection (`W × H px`), updating as the rectangle is adjusted.
  - An output filename text input, pre-populated as `<source_stem>_clip`.
  - An `Export` button and a `Cancel` button.
  - A warning / confirm affordance when the target filename already exists.
  - Minimal status/error text area.
- Do not add clip or flip controls to the normal preview pane.

The cropper and video playback are decoupled: the video element is for finding the start time, and crop is a secondary feature that should not interfere with playback. No backend still frame extraction is needed for scrubbing or playback. The only requirement is that any crop UI, if present in V1, uses the video’s native dimensions.

The crop interaction should stay close to the existing image crop UX if that keeps the implementation compact. If a tiny helper or existing library reduces the amount of custom UI code, use it.

## Technical Direction

- **Backend**: New file `tool/server/video_clip_ops.py`.
  - `clip_video(source_path, set_folder, output_name, start_sec, duration_sec, crop_rect)` — runs a single FFmpeg subprocess for trim + crop in one pass. Follows the `subprocess.run([...], capture_output=True, text=True)` pattern from `dataset_prep.py`. Non-zero returncode raises `RuntimeError`.
  - Output is MP4/H.264. Source container is not preserved.
  - Backend should do basic validation only: non-empty filename, no path traversal, source file exists, crop values are sane, and writes stay in the set folder.
  - Backend should not silently correct crop geometry or timing. If values are invalid, fail loudly and return the FFmpeg/backend error.

### Practical Complexity Notes

- The clip export itself is straightforward once the ffmpeg command is fixed; the main risk is input normalization, overwrite confirmation, and error reporting.
- Fixed-aspect crop using an existing helper/library is the lowest-risk path, but it is acceptable for V1 to simplify or postpone crop if that is what keeps playback reliable.
- Start selection by frame-step buttons or numeric inputs is lower risk than timeline mouse dragging and gives the user more control.
- The video player is the critical part of the modal; crop must not block it.

### Recommended Backend Command Shape

- Use one filter chain for the exported clip so trim and crop happen in a single encode pass.
- Keep the command explicit and linear rather than trying to be clever with branching logic.
- Treat any ffmpeg failure as a hard error and surface the stderr text directly in the modal status area.
- Do not overbuild backend crop correction. Prefer visible failures over silent correction when the crop geometry or trim values are wrong.

- **Routes**:
  - `POST /media/video_clip` → `clip_video`
- **Frontend**: New file `tool/js/video_clip.js`.
  - Plain global variables for modal state.
  - `openVideoClipModal(mediaItem)` — loads the source video into the modal player, sets crop ratio, initializes start time and duration controls, and opens the modal.
  - `applyVideoClip()` — reads form values, posts to `/media/video_clip`, reloads folder on success, shows error on failure.
  - `closeVideoClipModal()` — hides modal, resets state.
  - No flip behavior in V1.
  - No end scrubber in V1.
  - No primary mouse-drag timeline selection in V1.
- **Context menu** (`tool/js/media_context_actions.js`):
  - Add `Clip...` for video files inside `src_videos` (check that `mediaItem.folder` ends with `/src_videos` or `\src_videos`).
- **HTML** (`tool/tool.html`): Add `id="video-clip-modal"` alongside the existing crop modal.

## V1 Non-Goals

- No upload UI for `src_videos`.
- No batch clip.
- No freeform crop.
- No end-frame scrubber.
- No flip horizontal.
- No preview playback inside the modal.
- No batch clipping.
- No codec/output configuration.
- No timeline mouse dragging as the primary selection mechanism.
- No audio handling configuration (strip or pass through — backend default; not user-configurable in V1).
- No caption copy or caption creation on export.
- No clip-from-clip chaining (source must be in `src_videos`).
- No output format/codec selection (always MP4/H.264).

## V2: Better Editing Ergonomics / Future Enhancements

- Independent end-frame scrubber.
- Timeline mouse dragging as a convenience control.
- Horizontal flip.
- Freeform crop or advanced crop resize handles if Cropper.js does not already cover the needed interaction.
- Preview playback in the modal.
- Batch clipping.
- Codec / output configuration.
- More frame stepping and keyboard shortcut polish.
- Any other UI polish that improves comfort without changing the V1 export model.

## Expected Edge Cases

- Source video shorter than the requested clip duration: end time is clamped to video length; no error.
- Output filename already exists: show an explicit overwrite warning and require confirmation before the backend writes.
- Filename field is empty: Export button is disabled (validated client-side before submit).
- FFmpeg not available: `RuntimeError` propagates, error shown in modal status area.
- Crop inputs are invalid: fail loudly rather than silently adjusting them.
- User navigates away while modal is open: modal state is abandoned; no partial write.
- Crop UI cannot initialize: show the error and leave the source untouched.

## V1 Acceptance Checklist

- [ ] `Clip...` appears in context menu only for video files inside `src_videos`.
- [ ] Modal opens.
- [ ] Video playback is available in the modal.
- [ ] If crop is present in V1, it does not block video playback or scrubbing.
- [ ] User can select a fixed aspect-ratio crop.
- [ ] User can choose start position with precise controls.
- [ ] User can set duration.
- [ ] User can enter a safe output filename.
- [ ] Export writes MP4 to the parent set folder.
- [ ] Existing output files trigger an explicit overwrite warning/confirmation.
- [ ] Source video is never modified.
- [ ] FFmpeg/backend errors are shown clearly in the modal.
- [ ] Removing the new V1 files/routes/context-menu entry removes the feature cleanly.

## V2 Acceptance Checklist

- [ ] Independent end-frame scrubber exists.
- [ ] Horizontal flip exists.
- [ ] Timeline dragging exists if it is still worth the added complexity.
- [ ] Preview playback exists if it proves useful.
- [ ] Extra crop and frame-stepping polish is available if it was not already covered by V1.

## Implementation Touchpoints

- `tool/js/video_clip.js` — new file: all clip/flip modal JS.
- `tool/server/video_clip_ops.py` — new file: `clip_video` and any minimal helpers needed for export-time crop handling.
- `tool/server/app.py` — add the V1 route registration(s), import from `video_clip_ops`.
- `tool/tool.html` — add `video-clip-modal` markup, include `video_clip.js`, and reuse the existing Cropper.js assets if the modal piggybacks on that library.
- `tool/js/media_context_actions.js` — add the `Clip...` entry for source videos.
- `tool/css/styles.css` — minimal modal styling if needed (likely reuse existing modal styles).
