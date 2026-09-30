# Diagnostics

Last reviewed against code: 2026-09-30

Diagnostics is a secondary maintenance utility, not a core WebCap workspace.

## Boundary

- **Settings** owns persistent configuration: paths, runtimes, endpoints, model visibility, feature enablement, defaults, debug logging, raw configuration, and reset actions.
- **Diagnostics** owns one-off inspection, validation, calibration, benchmarking, and direct repair resulting from those checks.
- **Workspaces** own tools that are part of normal media, training, testing, generation, storage, or storyboard workflows.

The Diagnostics button lives with the permanent utility controls beside Settings rather than with the activity/workspace navigation.

## Current sections

### Health

Runs the existing whole-app environment report across Core, Training, Inference, Director, and Optional Analysis. It exposes the existing Python-requirements repair action and sends command output and failures to the global Console.

Health reports configuration problems but does not own or rewrite the corresponding Settings controls.

### H3 Calibration

Runs the existing MiniMax H3 hardware probe against a suitable captioned video from the current folder and displays the saved hardware identity, safe buckets, and tested candidates.

Calibration continues to use the existing H3 probe routes and persisted training calibration data. It is not a training workspace.

### Director Model Test

Runs the existing fixed Director benchmark protocol across selected local or remote models, preserving sessions, timings, token counts, output, stop behavior, and export.

The test remains neutral about output quality; it records results and does not rank models.

## Implementation

- Modal markup: `tool/tool.html`
- Modal lifecycle and Health/H3 behavior: `tool/js/diagnostics.js`
- Director benchmark behavior: `tool/js/director_model_test.js`
- Shared modal styling: `tool/css/modals.css`
- Environment checks: `tool/server/environment_check.py`
- H3 probe: `tool/server/h3_probe.py`
- Director test persistence/routes: `tool/server/director_model_test_store.py`

Diagnostics deliberately reuses existing backend routes rather than creating a parallel diagnostic subsystem.
