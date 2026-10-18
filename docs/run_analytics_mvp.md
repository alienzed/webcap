# Run Analytics — evidence-first MVP

Status: proposed MVP; implementation not yet complete. This document specifies a minimal read-only analytical workspace; user decisions at the end remain open.

## Goal

Answer three useful questions without inventing evidence:
1. Which saved checkpoints and runs performed best under comparable tests?
2. How did evaluation scores evolve across epochs, rounds, and later manual testing?
3. What can we responsibly infer about training choices, and what should we test next?

Run Analytics is **not** another scorer, training scheduler, campaign engine, rating store, or automated winner selector. It is a reader and interpreter of existing evidence. Place it under the existing Test Generations workspace as a third sidebar-switched pane, keeping Tests and Epoch Finder layouts intact. The separate **References** management proposal remains unresolved; do not silently claim the third/fourth slot.

## Existing evidence and integration

- Training Archive: `tool/server/training_archive.py:list_archives()` returns archived run identity, source folder, stage, summary, selected epoch, retained alternates, and errors for invalid manifests. `archive_metrics()` derives historical loss series from archived event data where present. `training_run_manifest.py` owns `webcap-run.json`. Active managed runs are discoverable via `training_history.py:discover_runs()`. Do not equate archived and active run availability.
- Epoch Finder: `tool/server/epoch_finder.py:list_campaigns()` supplies folder-scoped campaign identities; saved campaigns contain per-epoch units/scores and references. `checkpoint_evidence()` already reads evidence grouped by run/epoch while respecting evaluation protocols. Reuse its conventions. Original VL, paired-reference RVN, and whole-image DINO are **different metrics**; never blend them into a synthetic score.
- Test Generations: `tool/server/epoch_test_bench.py:list_sessions()` and `open_session()` expose folder-scoped sessions and details, including result evaluations. `docs/test_candidate_assessments.md` describes retired aggregates surviving deleted sessions; source session detail is not always available after deletion. No attempt to recreate lost per-image histories from aggregates.
- Existing route ownership and filesystem-state rules: `tool/server/app.py`, `docs/filesystem_state_contract.md`, `AGENTS.md`. Reuse routes or a small analytical read operation; avoid new persistent analysis ledgers.

## MVP experience

**Scope**: user selects a training run from the active Set's known runs or a matching archived run. Default to one run; permit comparative selection only when the data joins unambiguously. Present source completeness before promising analysis. A broader all-Set/all-history mode is an explicit follow-on decision, not an implicit global filesystem sweep.

**Screen**: consistent compact pane switcher in the existing left sidebar, Run Analytics as third choice. Sidebar: run chooser, included campaigns/sessions (with inclusion toggles), metric selector, and a prominent `Analyze` action. Main view:
1. Evidence coverage card: run identity; number of epochs, campaigns, sessions, evaluated samples; which sources and metrics are actually present; missing/retired/ambiguous data warnings.
2. Epoch trajectory chart: selected comparable score protocol, cumulative or per-round series labeled accurately, with evidence counts. Overlay loss only on a separate clearly labeled axis or chart. Gaps stay gaps; avoid interpolation and extrapolation.
3. Checkpoint table: per-epoch comparable observations, score and manual rating when available, and navigation into Epoch Finder/Test Generations where an actual destination survives. Training parameters shown only if recorded.
4. Findings section: deterministic, reproducible computed observations (leading candidates, peak region, observed differences, coverage weaknesses), including denominators and comparable protocol/settings. Avoid spurious 'winner' claims on tiny samples.
5. `Interpret with Director` optional, user-triggered: concise plain-language evidence review plus hypotheses and suggested next experiments. Preview exact compact **derived numerical facts and metadata** supplied to the model; do not send image contents, prompts, captions, private conversations, or raw logs. Use existing managed LLM execution and Activity integration. No inference on opening the pane.

**Director response contract**: sections `Observed`, `Hypotheses`, `Try next`, `Limits`. Every observation refers to visible evidence; do not assert that learning rate or loss *caused* an outcome from one run. Model may point out conflicts between manual ratings, VL, RVN, DINO but cannot manufacture combined numerical scores. Clearly label as interpretation. LLM unavailable => analytics still work; operation failure visible in Console.

## Identity and comparability

- Start joins with stable recorded run ID / folder / stage / checkpoint identity. Match explicit campaign run linkage and session candidate checkpoint metadata only. Never join purely on displayed filename, epoch number, or approximate timestamps.
- Preserve per-result protocol, model, prompt/test specification, generation settings, and observation count where available. Mark incomparable cohorts, missing identity, and irretrievable deleted-session detail; never silently discard meaningful conflicts.
- The default chart shows **one protocol and one comparable cohort at a time**. Loss is a training diagnostic, not an evaluation score. Manual ratings are subjective independent evidence.
- Read-only across source stores. Recompute on explicit Analyze/Refresh; no auto-scanning, no GPU work. Cache only in memory for the open pane if needed. No new on-disk source of truth.

## Safe implementation phases

1. **Data contract and fixtures**: inspect real archival manifests, campaign serialization, Test session assessment shapes, retired aggregate sidecars, and archive loss events; document joins and unavailable fields, including multi-run and deleted-session examples. Test identity and comparability without UI first.
2. **Read-only aggregate endpoint**: bounded, explicit set/run selection; reuse source readers; return typed coverage, epoch/cohort points, checkpoint rows, warnings, and actual navigation IDs. No new scan or rescoring. Unit tests for missing/archived/deleted evidence, mixed evaluator protocols, and reused checkpoint filenames.
3. **Third-pane UI**: add one sidebar switcher option in Tests, Epoch Finder, and Analytics sidebar, preserving current screens and lifecycle; render coverage, trajectory, and checkpoint table with empty/error/loading states. Retain earlier pane selections when navigating. Make existing navigation links actionable.
4. **Director interpretation**: prepare bounded aggregate-only payload; execute only on click using existing LLM coordination, visible activity/errors; fact-check response structure and differentiate calculations from narrative. No prompt retention or persistent transcript.
5. **Validation**: Python tests; JavaScript syntax/smoke tests; verify narrow sidebar width, collapsed Tests rail behavior, in-progress campaign data, no automatic LLM calls, and no source mutation. Review diff, audit, then merge.

## Not MVP

New reference-image management, predictive training optimization, causal learning-rate conclusions, cross-model leaderboards, multidimensional quality indices, new VL/DINO inference, historical image resurrection, custom analytics database, persistence of Director prose, scheduled auto-analysis, or statistical confidence theater.

## Decisions before full implementation

1. Scope: start **one Set / selected run**, including matching archive, or require cross-Set/multi-run analysis in v1?
2. Do you want **Director interpretation opt-in**, or triggered automatically after `Analyze`? Proposed: separate opt-in click.
3. References pane and Run Analytics both proposed: are they independent panes (Tests / Epoch Finder / References / Analytics) or should References be managed inside Tests, leaving three panes?

Proposed defaults: one Set / one run with room to expand; user-triggered Director; references managed inside Tests so Run Analytics becomes the third main pane. Do not implement a global cross-Set comparison or rearrange Reference management without a decision.
