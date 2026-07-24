# Video Clip Follow-up

## Status

The focused Clip modal improvements were implemented on 2026-07-24:

- Output naming is editable in every folder while retaining the existing
  overwrite-first default outside `src_videos`.
- A changed output name creates a sibling clip atomically and copies the source
  caption.
- The blue timeline range moves Start and End together by pointer drag.
- Redundant full-frame and export-summary rows were removed.

The automatic dataset segmentation ideas remain intentionally deferred.

## Product Direction

Keep clipping explicit and user-directed. Most source clips are short enough
that automatic segmentation would usually produce only two or three samples,
which does not justify integrating segmentation into `auto_dataset`.

The useful training-side behavior is already available through ordinary media:
keep the full source clip and create a small number of offset clips when they
contain useful later motion. Dataset buckets can then choose how many frames to
read from each prepared file.

## Output Name

Unlock the existing output-name field in every folder without changing the
current default intent.

- Outside `src_videos`, initialize Output to the source filename as today.
- If Output still matches the source filename, export in place using the
  existing reversible-originals workflow.
- If the user changes Output, create a new MP4 beside the source.
- Inside `src_videos`, retain the current non-destructive default that exports a
  named clip to the parent set folder.
- An existing destination continues to require explicit overwrite confirmation.
- A newly named clip copies the source caption text beside it.

This uses the backend's existing named-output path. The frontend should derive
`overwriteSource` from whether the normalized output name matches the source
instead of forcing the mode from the current folder.

For new-file exports, FFmpeg should write to a temporary file in the destination
folder and replace the final path only after successful completion. A failed
export must not leave a partial destination.

## Move the Selected Range

Make the existing blue timeline selection draggable as one piece.

- Pointer-down on the blue range starts a move operation.
- Horizontal movement changes Start and End together while preserving Duration.
- Clamp the range to `0` and the source duration.
- Update the three numeric Trim fields and preview playhead continuously.
- Use `grab` / `grabbing` cursors and pointer capture so the interaction remains
  stable when the pointer leaves the range.
- Do not add resize handles, another timeline row, or automatic batch export.
- Numeric fields and Mark Start / Mark End remain the precise fallback.

This supplies the missing offset workflow without asking the user to reset both
markers for each clip.

## Layout Condensation

Do not add another control group. Recover vertical space from information that
is already duplicated:

- In Crop Ratio, remove the full explanatory sentence when no crop is placed;
  the existing `Full frame` state beside Place Crop is sufficient.
- In Output, remove the always-visible export summary that repeats the filename,
  Start, End, Duration, and crop state shown directly above.
- Keep status and error feedback below the controls; it communicates information
  not available elsewhere.
- Keep Navigation, Trim, Crop Ratio, and Output as the four visible groups for
  now. Further collapsing should be driven by actual use, not by adding hidden
  modes preemptively.

These reductions should win back roughly two text rows and make the panel feel
less dense while retaining every current action.

## Explicit Non-goals

- No automatic splitting during Prepare Dataset.
- No provenance or segment statistics in `auto_dataset`.
- No batch clip queue UI.
- No training-specific 16 fps or `4n+1` preset in the Clip modal yet.
- No automatic generation of every possible temporal window.
- No change to video bucket policy as part of the Clip enhancement.

Video bucket duration, resolution, and OOM behavior remain a separate training
configuration problem and should be measured independently.

## Verification

- In a normal set folder, unchanged Output overwrites reversibly; a changed
  Output creates a sibling clip and leaves the source untouched.
- In `src_videos`, named export still targets the parent set.
- Caption text is copied only for a newly named clip.
- Destination conflicts still require confirmation.
- Dragging the blue range preserves duration and clamps correctly at both ends.
- Mouse and pointer release outside the timeline cannot leave a stuck drag.
- Existing numeric trim, marker, crop, loop preview, queue status, and duplicate
  request behavior continue to work.
