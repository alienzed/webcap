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

Assesses selected local or remote Director models with one representative long-form writing probe (2K token request budget by default) and, only on capacity exhaustion, one retry at half that budget. Published output guidance bounds the probe. No ascending context or structured-output ladder is run. The assessment records mechanical evidence WebCap can defend: usable context/output tiers, clean completion, truncation/capacity limits, runtime failures, empty output, obvious repetition/looping, garbled output, and obvious control/reasoning-token leakage.

Assessment intentionally does **not** score writing quality. Compact current findings and legacy Auto calibration profiles live under app-data `state/diagnostics`. Full probe prompts and full model outputs are timestamped temporary evidence under app-data `cache/director-model-assessments`; the latest evidence is expandable directly from each finding, full raw runs are listed below, and either can be purged independently through Storage Manager.

Normal Director model selectors receive only a compact operational signal:

- serious observed output pathology -> warning marker;
- reduced **proven** long-form capacity -> limited marker;
- unknown, unproven, or operationally failed assessment -> neutral.

Runtime/transport failures, probe-contract misses, and exhausted requested budgets are assessment outcomes, not model pathologies. A model is not marked unusable merely because the assessment itself could not establish a tier.

Assessment probes request non-thinking output from Ollama so the small starting budgets test answer generation rather than being consumed entirely by provider reasoning. Structured completion requires every consecutive item; prose completion requires every consecutive section and the requested minimum total prose length. Both require their completion marker; contract errors identify a missing marker. The prose prompt requests a total word range distributed across the sections, matching that mechanical length check. These checks do not score writing quality or semantic coherence. Assessment captures answer text verbatim, including empty and truncated completions, without appending Assistant truncation notices. Separate provider reasoning, when returned, is retained as its own readable evidence block. Ollama's reported runtime context is labelled as observed, not proven by a context stress test.

A clean coherent-output tier of at least 8K is the current simple full-story signal. Lower proven output can recommend individual Scene development without making the model unusable. Output tiers are requested generation budgets with deliberate prompt headroom; exhausting a tier is evidence about that probe budget, not proof of a provider or model hard maximum.

An inconclusive, interrupted, stopped, or operationally failed assessment remains neutral in normal selectors even when a smaller usable tier was established. Its finding reports the tested range without recommending individual scenes from that inconclusive result. Observed output pathologies still warn. Expanded findings, raw runs, and already captured probe disclosures retain their DOM identity as results arrive or another raw run is deleted. A finding links only to evidence carrying that exact saved report timestamp; deleting it shows evidence unavailable rather than substituting an older run. After server restart, unfinished raw evidence is shown as interrupted/incomplete; corrupt evidence surfaces a read failure rather than disappearing silently. Persistence errors fail the assessment visibly and are never converted into extra model probes.

A completed run whose higher probe misses its contract is labelled **Assessment complete · higher tier unproven**, separately from an unfinished run. Budget exhaustion and probe-contract misses are displayed as probe results rather than operational errors; the underlying evidence and neutral selector signal remain unchanged.

### Benchmark

Runs the editable Director benchmark prompt across selected local or remote models for side-by-side qualitative comparison. Benchmark sessions remain server-session work, with timings, token counts, output, stop behavior, and export.

Benchmark and Director Model Assessment deliberately own separate UI selection/session state. Benchmark results do not become model capability lessons automatically.

## Implementation

- Modal markup: `tool/tool.html`
- Modal lifecycle and Health/H3 behavior: `tool/js/diagnostics.js`
- Director assessment and benchmark UI behavior: `tool/js/director_model_test.js`
- Durable Director calibration / learned findings: `tool/server/director_model_calibration.py`
- Temporary raw assessment evidence: `tool/server/director_model_assessment_store.py`
- Advertised capability hints: shipped `tool/data/director_model_capabilities.json`, loaded and validated at startup by `tool/server/director_model_capabilities.py` (restart after edits). These are published hints, not measured calibration results.

Published `contextTokens` is separate from any packaged `runtimeContextTokens` (e.g. Ollama `num_ctx`). `contextKind`, `sourceUrl`, and optional `verifiedAt` document the evidence; `inherited` is not a measurement on a fine-tune or quantization. Unknown custom aliases do not receive guessed capacities. These catalogue hints do not change existing runtime settings, probe scheduling, or Auto calibration profiles.
- Shared modal styling: `tool/css/modals.css`
- Environment checks: `tool/server/environment_check.py`
- H3 probe: `tool/server/h3_probe.py`
- Director assessment / benchmark routes: `tool/server/director_model_test_store.py`

Diagnostics shares Director model discovery and the LLM execution lane, but Assessment and Benchmark keep separate lifecycle semantics rather than sharing one diagnostic session.

## Single-pass assessment rollout (2026-10-13)

The new one-pass assessment reuses the existing prose probe, report/evidence store and shared LLM execution lane. It does not clear, create, or replace legacy Auto calibration profiles, which may still influence ordinary Director requests; migrating that behavior requires separate validation. The benchmark remains separately selectable for qualitative comparison until its UI/evidence contracts can be safely consolidated. Existing raw historical reports and evidence are retained.

Short assessment reports use `assessmentKind: confirmation`, so a 2K sample is not interpreted as a model output limit. Legacy reports without this field retain their historical meaning. Storyboard does not recommend scene-only generation solely because a short confirmation passed. Existing Auto profiles remain active pending explicit migration.

The Benchmark view also displays previously saved, completed Director confirmation writing samples in a separate read-only disclosure; full raw prompts and prose are fetched only when an item is expanded. They are not benchmark runs, are not directly comparable to the custom benchmark prompt, and do not trigger inference; only evidence matching the current report timestamp is displayed. Historical raw assessment evidence remains independently managed.

Production Director inference no longer automatically imports limits from historical calibration profiles when settings are Auto. Explicit settings, per-request context/output limits and the runtime's native defaults retain their normal precedence. Existing profile files, reports, and UI evidence remain available; nothing is purged. The actual effective runtime limit still depends on the selected backend and available hardware.


### Unified Model Assessment (incremental consolidation)

Model Assessment offers Quick and Deep runs through the existing server-owned Model Lab runner. Quick samples eight Set items; Deep samples up to sixteen and additionally probes Director writing at 1K and 4K output request budgets alongside the representative 2K writing probe. Each attempt is recorded under its own key, so completed probes can be reused on explicit resume. A successful writing probe demonstrates a completed task at that budget, **not** maximum context capacity, instruction reliability in general, or guaranteed output size. Existing specialist Director calibration, benchmark, and H3 hardware tools remain until their distinct functionality has verified replacements. Deep Assessment does not alter shared GPU queue priority or scheduling. Model Lab stores raw model outputs in its diagnostics run journal: use the existing delete mechanism when raw diagnostic evidence is no longer needed.
