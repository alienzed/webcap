# Training Review

Training Review is a compact visual editor for the set-owned dataset TOML. It
does not maintain a second training plan in `.webcap_state.json`, produce an
immutable review record, or decide whether a run is recoverable. The canonical
config and dataset TOMLs remain the only editable training authority.

The normal **Run setup** exposes learning rate, rank, epochs, and dropout as
first-class run parameters populated from the current model template. Changing
them creates a run-specific override for the next capture; it does not rewrite
the persistent set-owned config TOML. **Reset** on the Run setup parameter card
restores the current template-derived values.

Training Review itself remains focused on the dataset/bucket plan. Raw TOML
editing and per-file TOML Reset controls remain under **Advanced configuration**.

## Bucket editor

**Adjust buckets** opens a full-screen, internally scrolling modal. It shows:

- `Images`, `Balanced`, `Temporal`, and `Detail` tabs when their media exists;
- the existing populated aspect-ratio cohorts: 4:3, 3:4, 16:9, 9:16, and
  Square;
- supported target chips from the current model bucket policy for the active cohort;
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

If a valid dataset TOML uses stanzas the editor cannot represent exactly—for
video, any bucket outside the current model ladder—Review shows the concise
raw-TOML state instead. Bucket controls are disabled, but Fresh,
Resume, Init LoRA, and Train remain available. The raw dataset can be opened
directly or explicitly reset from that state.

Managed video targets always come from the same current policy that supplies
the selectable ladder and the chart's Max. A changed compatible H3 calibration
can therefore make an old managed TOML raw/custom; opening Review never clamps
or rewrites that TOML. **Reset Buckets** is the deliberate way back to managed
targets.

## Launch interaction

Train flushes raw editor edits and recomputes Review from the current TOMLs
immediately before it captures the action. The normal Run setup overrides for
learning rate, rank, epochs, and dropout are then applied to the captured config
only. Resume additionally writes the selected learning rate as
`force_constant_lr`.

Repeat calculation is independent of the selected run Epochs value. Generated
dataset repeats use the configured `training.repeat_reference_epochs` planning
horizon (90 by default), while the actual run epochs remain part of the
captured config and progress estimate.

Review does not consume a hidden `reviewIntent` or maintain a second bucket
authority. Capture and queue semantics, Resume, and Init LoRA discovery are
documented in [train.md](train.md).
