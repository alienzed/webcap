# Model Assessment — consolidated WebCap contract

This replaces the old Model Lab, Director Calibration, and custom benchmark interfaces. It does **not** remove saved user evidence.

## The standard

- Each test must exercise a WebCap workflow. Prefer to measure structure, completeness, visible output, speed and optional quality from **one** already-needed inference.
- The quick Director suite exercises a real `develop_story` production prompt/schema, a small Storyboard continuity/reasoning check, and actual Schema Assist synthesis/challenge.
- When Vision models are selected too, the Director's Schema Assist inputs use those **already produced** Open/Guided Sight results, not a second unrelated synthetic assessment. Director-only tests use one frozen, representative WebCap Sight fixture.
- Vision tests use unguided Open Sight and, when groups exist, the production group-aware Sight contract; these are distinct, intentional tasks.
- Optional extended Scene plans exercise higher budgets but **do not claim the full budget was emitted**. Record validated completion with observed visible words/characters, trustworthy output token counts when available, and runtime tokens/second where supplied. Reasoning usage cannot be passed off as visible output.
- Retain observed output pathologies (empty, garbled, leaked reasoning and unmistakable repeated Scene prompts). Budget exhaustion is capacity pressure, not model pathology; ordinary structural misses and runtime errors are reported separately.
- Optional LLM judge reads saved production responses; it does not run another request against the assessed model. Its opinion is distinct from technical qualification.

## State and incremental work

Owner: `tool/server/model_lab.py`. Existing JSON run journals and shared LLM/GPU scheduling remain authoritative.

- Default action completes **missing** probes, reuses compatible successes, and performs a bounded deferred retry after a model's remaining work. Fully completed selections create no duplicate journal.
- Protocol `webcap-model-assessment-structured-v2` distinguishes real production Scene prompts from older hand-written probes. Older identical Sight/Schema Assist evidence may still be reusable.
- Vision reuse needs matching Set, sampled file identity (size and modified timestamp), and matching groups for guided Sight. No hashing scans or new index.
- Saved attempts retain runtime/host provenance; imported results are historical and never stand in for local throughput.
- Export materializes reused evidence; deletion of a source run similarly preserves required successful evidence inside dependent runs. Imported old bundles with missing referenced evidence fail visibly.
- Progress is resolved logical probes/planned probes, with separate completed/reused/skipped/failed/retry-pending counts, current model/probe/job state and elapsed time. It is **not** a pass-rate percentage or ETA.

## One UI, retained consumers

- Diagnostics > Model Assessment is the only model-testing surface: a compact real table, Complete Missing Tests, existing shared ProgressCard, optional saved-output review and evidence import/export.
- Old hidden panels, frontend engines, routes and unused comparison code are retired; no compatibility JS, fake routes, or column-hiding hacks remain.
- Storyboard uses current production-shaped assessment evidence while still honoring serious historical observations and genuinely proven older prose capabilities. New structured JSON evidence **does not** prove 8K prose capacity.
- Historical calibration reports and profiles remain readable for import/export and QA context preflight; old calibration execution and profile mutation UI are gone.
- Storage Manager still lists and explicitly deletes older Director assessment cache files through a **read/delete-only** compatibility reader. These historical files aren't automatically removed or used to run tests.
- H3 hardware calibration is unrelated and remains under its own Diagnostics area.
- Legacy files on disk are not automatically deleted.

## Validation

- `tests/test_model_lab.py`, `tests/test_model_assessment_completion.py`, `tests/test_assessment_transfer.py`, `tests/test_director_model_calibration.py`, `tests/test_model_assessment_thinking_unified.py`, and `tests/test_model_lab_progress.js` run in the targeted CI.
- The Storyboard scene-header and Test Generations workflows guard unrelated UI/workflow regressions.
- No local model inference smoke test can run on GitHub's Linux runner. A representative local/remote real-model run should be verified before relying on performance or capacity comparisons as production facts.
- No database, new app-private storage root, new GPU lane, localStorage, hidden run actions, or background inference was introduced. Follow `AGENTS.md`.
