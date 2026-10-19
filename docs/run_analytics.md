# Run Analytics — implemented workflow

Status: implemented in Test Generations → Analytics. This replaces the proposed-only description in PR #461. Backend uses `tool/server/run_analytics.py`, with the existing Epoch Finder command route and a separate opt-in Director endpoint; UI uses `tool/js/run_analytics.js`.

## Use

1. Select the active Set, open Test Generations → Analytics, check 1–6 training runs and click **Analyze selected**. Choose from runs known to training history, archives, or persisted campaigns; the list may be incomplete if run identities were discarded before archiving.
2. Choose a **campaign** to compare only checkpoint fidelity within that exact Epoch Finder test protocol. The same campaign can contain several selected training runs. Do not treat results from different campaigns as comparable. The chart uses cumulative weighted observations. The expandable round history shows each completed round's cumulative result; scores with no observed denominator remain missing.
3. Choose an individual **Test session** when comparing manual ratings or Test VL. The backend groups frozen sessions by model, source/resolved prompt, settings, workflow hash and sweep weights. Results from multiple differing Test cohorts do **not** become a pooled chart. Separate independent charts cover archive loss; loss is not a quality score.
4. Inspect a checkpoint via **Inspect epoch** to open its Epoch Finder campaign or use **Test session** for a linked session. These work only when the underlying evidence still exists.
5. Expand **Preview numerical evidence sent to Director** to read the exact bounded, recomputed numerical/metadata facts. Click **Interpret with Director** to enqueue an opt-in LLM job on the existing Test LLM queue. It returns **Observed, Hypotheses, Try next, Limits**. Progress is visible; stop is available. The response is an interpretation, not a new rating.

## Provenance and limits

Identity joins use the recorded source training job ID and Set folder, plus the recorded epoch; archived runs use `archive.sourceJobId`. Do not join by similar filenames, epoch numbers alone, or time proximity. Persisted Epoch Finder campaign `candidateMap` resolves synthetic multi-run epochs back to their source run and epoch. Deleted per-image sessions cannot be resurrected from surviving aggregate ratings. Unknown provenance is excluded and flagged.

Reference VL, whole-image DINO, original campaign VL, manual Test ratings and training loss are separate evidence classes. Only original campaign VL is charted as a campaign fidelity metric. The reference comparison counts are retained but **not normalized into** a composite quality score. Multiple Test sessions are grouped by frozen settings before showing a cohort chart. Treat tiny denominators as weak evidence; no extrapolation, causal attribution, or automatic winning-checkpoint selection.

The dashboard never initiates Test rendering, rescans, automatic LLM work, writes an analysis ledger, or changes GPU scheduling. The optional Director call transmits bounded derived numbers and IDs/labels, not captions, prompts, media, raw logs, or private chats. Model answers are ephemeral; server restart can interrupt them.

## Validation expectations

Automated contract tests reside in `tests/test_run_analytics_next.py`; JS source parses with the existing classic-script loading order. Before claiming full real-machine validation, test the view against at least one single-run campaign, a multi-run campaign, one archived run with loss data, mismatching frozen Test sessions, an interrupted campaign, and a deleted Test session; verify browser navigation and Director runtime with an actual configured model. The development machine has no authoritative training runtime.

## Out of scope

Global cross-Set search, causal learning-rate optimization, composite quality scoring, image resurrection, new training schedulers, new image analyzers, and new persistent data stores.
