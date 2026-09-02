# Training Review

Training Review is a compact visual editor for the set-owned dataset TOML. It
does not maintain a second training plan in `.webcap_state.json`, produce an
immutable review record, or decide whether a run is recoverable. The canonical
config and dataset TOMLs remain the only editable training authority.

The normal Run Setup keeps only a bucket-plan summary and **Adjust buckets**.
Raw config settings—learning rate, target steps, rank, dropout, and the TOML
Reset controls—remain under **Advanced configuration**.

## Bucket editor

**Adjust buckets** opens a full-screen, internally scrolling modal. It shows:

- `Images`, `Balanced`, `Temporal`, and `Detail` tabs when their media exists;
- the existing populated aspect-ratio cohorts: 4:3, 3:4, 16:9, 9:16, and
  Square;
- supported target chips for the active cohort;
- a native-short-edge histogram and source-resolution dots, overlaid with the
  selected target markers and their assignment counts;
- a five-band scale-impact bar across every cohort of the active media view;
- only actionable warnings, such as substantial resizing, a very small target,
  or invalid-AR media.

A neutral target chip adds that supported target. A selected chip removes it.
Each selected target also has lower/higher arrow controls that move it through
the supported ladder while skipping duplicates. A cohort always keeps at least
one and at most three targets. Changes are written immediately to the canonical
dataset TOML; **Done**, ×, and Escape simply close the modal.

Every valid image is assigned exactly once to its closest selected target by
short-edge scale. Resolution is a fitting preference, not an exclusion rule.
The chart uses `target short edge / native short edge`, so portrait and
landscape media are measured correctly. Balanced, Temporal, and Detail retain
their fixed frame counts; eligible clips may participate in all applicable roles.

## TOML behavior

Missing canonical TOMLs materialize normally. Existing unreadable or invalid
files fail visibly and are never replaced automatically. **Reset** is the only
way to regenerate a selected config or dataset default.

If a valid dataset TOML uses stanzas the editor cannot represent, Review shows
the concise raw-TOML state instead. Bucket controls are disabled, but Fresh,
Resume, Init LoRA, and Train remain available. The raw dataset can be opened
directly or explicitly reset from that state.

## Launch interaction

Train flushes raw editor edits and recomputes Review from the current TOMLs
immediately before it captures the action. It does not consume a Review
fingerprint, an immutable plan, or a hidden `reviewIntent`. Capture and queue
semantics, Resume, Init LoRA discovery, and the clean training-machine reset
procedure are documented in [training_stabilization.md](training_stabilization.md).
