# Insights (Run Analytics backend) — implemented workflow

Status: implemented in Evaluations → Insights. This replaces the proposed-only description in PR #461. Backend uses `tool/server/run_analytics.py`, with the existing `/fs/epoch_finder` command route (a stable internal name) and a separate opt-in Director endpoint; UI uses `tool/js/run_analytics.js`.

## Use

1. Select the active Set, open Evaluations → Insights, check 1–6 training runs and click **Analyze selected**. Choose from runs known to training history, archives, or persisted campaigns; the list may be incomplete if run identities were discarded before archiving.
2. Choose a **campaign** to compare only checkpoint fidelity within that exact Campaign test protocol. The same campaign can contain several selected training runs. Do not treat results from different campaigns as comparable. The chart uses cumulative weighted observations. The expandable round history shows cumulative results for rounds with actual evaluated work; scores with no observed denominator remain missing.
3. Choose an individual **Test session**, or select a compatible **Test cohort**, when comparing manual ratings or Test VL. The backend groups saved evidence by exact generation identity, LoRA strength, VL model and available per-assessment rubric fields; multiple session sources appear with each measured checkpoint. Results from multiple differing Test cohorts do **not** become a pooled chart. Separate independent charts cover archive loss; loss is not a quality score.
4. Inspect a checkpoint via **Inspect epoch** to open its Campaign or use **Test session** for a linked session. These work only when the underlying evidence still exists.
5. Expand **Preview numerical evidence sent to Director** to read the numerical/metadata facts. The backend rechecks these facts at execution and rejects requests if they changed after review. Click **Interpret with Director** to enqueue an opt-in LLM job on the existing Test LLM queue. It returns **Observed, Hypotheses, Try next, Limits**. Progress is visible; stop is available. The response is an interpretation, not a new rating.

## Featured contenders (Insights)

Insights leads with the highest average manually rated checkpoint that has **at least five saved ratings**; tied averages prefer more ratings, then a stable run/epoch order. Five is a transparent evidence threshold, **not** a statistical confidence estimate. If no checkpoint reaches five ratings, the highest-average checkpoint appears as a provisional leader. When the best-supported checkpoint differs from the raw highest-average checkpoint, Insights displays that raw leader separately as provisional; when they match, it shows one card. The comparison actions inspect these same choices. The full Contenders table keeps its existing average/count sorting, and pooled ratings from different Test settings remain descriptive rather than controlled comparisons.

## Blind rating (Insights)

**Blind rate** reviews saved, unrated Test renders continuously until the user closes it or eligible renders run out. Selecting 1–5 saves through the existing Test rating route and immediately advances; Skip leaves that item unrated for another review pass. Back allows correction or undo of an earlier decision. Run and epoch stay hidden while reviewing. The backend retrieves small batches internally, but the UI does not stop after an arbitrary batch size. Progress counts reflect only available Test renders with recorded training provenance; missing or unlinked media remain excluded.

## Provenance and limits

Identity joins use the recorded source training job ID and Set folder, plus the recorded epoch; archived runs use `archive.sourceJobId`. Do not join by similar filenames, epoch numbers alone, or time proximity. Persisted campaign `candidateMap` resolves synthetic multi-run epochs back to their source run and epoch. Deleted per-image sessions cannot be resurrected from surviving aggregate ratings. Unknown provenance is excluded and flagged.

Reference VL, whole-image DINO, original campaign VL, manual Test ratings and training loss are separate evidence classes. Only original campaign VL is charted as a campaign fidelity metric. The reference comparison counts are retained but **not normalized into** a composite quality score. Multiple Test sessions are grouped by frozen settings before showing a cohort chart. Treat tiny denominators as weak evidence; no extrapolation, causal attribution, or automatic winning-checkpoint selection.

The dashboard never initiates Test rendering, rescans, automatic LLM work, writes an analysis ledger, or changes GPU scheduling. The optional Director call transmits bounded derived numbers and IDs/labels, not captions, prompts, media, raw logs, or private chats. Model answers are ephemeral; server restart can interrupt them.

## Validation expectations

Automated contract tests reside in `tests/test_run_analytics_next.py`; JS source parses with the existing classic-script loading order. Before claiming full real-machine validation, test the view against at least one single-run campaign, a multi-run campaign, one archived run with loss data, mismatching frozen Test sessions, an interrupted campaign, and a deleted Test session; verify browser navigation and Director runtime with an actual configured model. The development machine has no authoritative training runtime.

## Out of scope

Global cross-Set search, causal learning-rate optimization, composite quality scoring, image resurrection, new training schedulers, new image analyzers, and new persistent data stores.

## Original VL coverage across Test sessions

The **Evaluate saved renders** card counts saved Original VL assessments across the active Set's Test sessions, independently of the selected training runs or evidence filters. Campaign staging is excluded. Unavailable previews are reported separately from the available-render denominator.

**Evaluate missing** uses the global Vision model selection and existing LLM queue to submit only available previews without saved Original VL evidence or active automatic evaluation jobs. Saved assessments are retained; choosing another Vision model does not re-evaluate completed previews. Failed and stopped work can be explicitly retried. Admission is serialized so separate tabs cannot enqueue the same preview twice.

**Stop** cancels outstanding automatic Original VL jobs belonging to this Set's Test sessions, including generation-time auto-VL. It leaves other LLM work alone. Leaving Insights stops progress polling, while submitted jobs continue independently of navigation. Returning or refreshing reads their saved receipts and current queue states. Progress distinguishes queued, running, failed, stopped, unavailable and completed work; it does not merge Original VL with reference VL or DINO diagnostics or change ranking protocols.

The backend operations are `test_evaluation_progress`, `test_evaluate_missing` and `test_evaluation_stop` on the existing `/fs/test_generations` route. Focused tests cover coverage, duplicate admission, retries, Stop scope, async Set targeting, polling lifecycle and error reporting. Real-model browser verification uses disposable sessions; it is not evidence about training-machine runs.

## Reconciliation and validation

The UI invalidates a displayed analysis when the selected runs change. Compatible Test cohorts can be selected independently of the session filter; selecting a campaign changes the visible evidence without enqueuing work. Director preview is explicit, not fetched on every render, and the server verifies that the requested numbers still match the reviewed snapshot. Real-machine testing, including training archives and historical cohorts, remains required before claiming verified operation on actual data.
