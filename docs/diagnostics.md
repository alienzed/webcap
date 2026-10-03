# Diagnostics

Last reviewed against code: 2026-10-03

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

### Director Models

Assesses selected local or remote Director models progressively from small probes upward. The assessment records mechanical evidence WebCap can defend: usable context/output tiers, clean completion, truncation/capacity limits, runtime failures, empty output, obvious repetition/looping, garbled output, and obvious control/reasoning-token leakage.

Assessment intentionally does **not** score writing quality. Compact current findings and strict Auto calibration profiles live under app-data `state/diagnostics`. Full probe prompts and full model outputs are timestamped temporary evidence under app-data `cache/director-model-assessments`; they can be inspected in Diagnostics or purged independently through Storage Manager.

Normal Director model selectors receive only a compact operational signal:

- serious observed pathology -> warning marker;
- reduced proven long-form capacity -> limited marker;
- unknown / unassessed -> neutral.

A clean coherent-output tier of at least 8K is the current simple full-story signal. Lower proven output can recommend individual Scene development without making the model unusable.

### Benchmark

Runs the editable Director benchmark prompt across selected local or remote models for side-by-side qualitative comparison. Benchmark sessions remain server-session work, with timings, token counts, output, stop behavior, and export.

Benchmark and Director Model Assessment deliberately own separate UI selection/session state. Benchmark results do not become model capability lessons automatically.

## Implementation

- Modal markup: `tool/tool.html`
- Modal lifecycle and Health/H3 behavior: `tool/js/diagnostics.js`
- Director assessment and benchmark UI behavior: `tool/js/director_model_test.js`
- Durable Director calibration / learned findings: `tool/server/director_model_calibration.py`
- Temporary raw assessment evidence: `tool/server/director_model_assessment_store.py`
- Advertised capability hints: `tool/server/director_model_capabilities.py`
- Shared modal styling: `tool/css/modals.css`
- Environment checks: `tool/server/environment_check.py`
- H3 probe: `tool/server/h3_probe.py`
- Director assessment / benchmark routes: `tool/server/director_model_test_store.py`

Diagnostics shares Director model discovery and the LLM execution lane, but Assessment and Benchmark keep separate lifecycle semantics rather than sharing one diagnostic session.
