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

## Assessment-backed model selection (opt-in pilot)

The existing assessment journals and optional saved-output judge serve a second purpose: recommend a model for an actual production operation. The first supported operation is Vocabulary Discovery synthesis (`vision_schema_suggest`), the exact production contract already exercised by `language_synthesis` and `set_vocabulary_synthesis`. No additional model probes or inference run automatically.

- Existing completed current-protocol Director-only fixture results can be rejudged against their frozen input. New synthesis attempts record an input fingerprint, not a second prompt copy. Set-derived inputs are reconstructed from their source assessment's retained Sight evidence; the fingerprint must match for the result to inform selection. Historical Set-derived results without a fingerprint remain useful for advisory review, not automatic selection.
- The same existing Judge Model action reviews normalized schema output against the actual task instructions and evidence. Its per-task score is advisory. Comparisons require the same independent judge, review rubric and input fingerprint; they can reuse separate assessment runs. Self-reviews, imported host evidence, unavailable models, unrelated tasks and incompatible protocols do not influence routing.
- Diagnostics > Model Assessment shows the recommendation and an explicit **Auto-select Vocabulary Synthesis model** toggle, off by default. The selected Director remains the default. Only the Vocabulary Discovery synthesis request can opt in; explicit requests and the challenge stage retain their normal model choices. Resolve a real model ID before enqueueing and report the selection in the Console and job receipt. Never change GPU coordination, retry behavior, or saved source data.
- Prefer a higher reviewed quality score over the selected default; retain the default on a tie. Measured synthesis latency breaks ties between better-rated alternatives when present. This is a pilot ranking policy, not a statistically validated universal model ordering.

### Remaining phases and exit criteria

1. Use the existing quick suite and Judge Model action on the production runtime, comparing the current Director and alternatives with an independent judge. Reuse compatible saved probes; compare actual Vocabulary Discovery work products with the default on representative Sets. Assess quality, actual latency and model switching cost before expanding the pilot.
2. Expand only to operations with representative evidence. Scene-plan probes measure the older `develop_story` contract and structured capacity, not current Studio Chat/Write quality; completed journals deliberately compact generated Scene text. Sight completion is not visual accuracy, and schema challenge receives each model's own draft, not a common challenge input. Do not substitute those measurements for task quality. Caption Assist and Studio Chat need appropriate representative tests if selected for later expansion.
3. Codex can use the existing `GET /app/model-lab?summary=1`, `GET /app/model-lab?run=<id>` and POST actions `preview`, `start`, `judge`, `stop`, plus existing export. No separate benchmark service is needed. Access should be through an explicitly authorized private connection to the running WebCap app; this change adds no public listener, remote credentials, or production access. Actual remote/live evaluation is required before enabling additional operations.

### Remote Codex assessment runbook

Use the existing running WebCap app over an already authorized private connection. No runtime credentials, direct inference port, remote shell, or public WebCap listener are required by these calls. Run commands on the authorized client, with the base URL of the reachable WebCap instance (not the Ollama/llama.cpp endpoint). Keep response files on that client.

```bash
# Set WEBCAP_URL to the authorized WebCap base URL first.
curl -fsS "$WEBCAP_URL/app/model-lab?summary=1" > assessment-summary.json
```

From `models.directors` choose the currently configured Director, at least one alternative, and an independent judge (not either candidate). Use the exact returned catalog model objects, including runtime identity. The minimal comparable pilot uses a Director-only quick assessment. Construct `assessment-config.json` with this shape; the abbreviated model objects below are placeholders for actual catalog entries:

```json
{
  "depth": "quick",
  "directorModels": [
    {"modelRef": "RUNTIME::BASELINE"},
    {"modelRef": "RUNTIME::ALTERNATIVE"}
  ]
}
```

Preview first, using the existing assessment admission and reuse rules:

```bash
python -c 'import json; print(json.dumps({"action":"preview","config":json.load(open("assessment-config.json"))}))' |
  curl -fsS -H 'Content-Type: application/json' --data-binary @- "$WEBCAP_URL/app/model-lab"
```

Only if `plan.total` is positive and the user has authorized production inference, submit the same request with action `start`. Record the returned `run.id`; poll `GET /app/model-lab?run=<id>` until the run has finished. The existing shared queue coordinates GPU work. If `noWork` is true, no new journal was saved: use completed runs from the summary rather than trying to poll the returned transient ID. Do not reset evidence to force extra probes.

For each candidate, use the completed local run containing its saved `language_synthesis` result. If the probe was reused, the run's `reused` references identify its source. Judge the existing output with the same independent reviewer for both candidates:

```json
{
  "action": "judge",
  "runId": "EXISTING_COMPLETED_RUN",
  "modelRef": "RUNTIME::BASELINE",
  "judgeModelRef": "RUNTIME::JUDGE"
}
```

POST this JSON to `/app/model-lab` only when that comparable review is missing. Wait until `run.qualityReviews[modelRef].status` is terminal before starting the next review, because Model Assessment intentionally admits one active assessment/review at a time. Existing compatible reviews can be used without another judge call. A failed review is visible evidence, not a reason to invent a score. To stop an explicitly started assessment or review, use its existing `stop` or `stop_judge` action with its run ID; do not stop another user's work.

Refresh the summary. Its `schemaRecommendation` is the same decision WebCap would use in the opt-in pilot; no client-side ranking is required. Record per-task scores and reasons, source run IDs, latency if available, and whether the recommendation changed. Codex should then compare actual Vocabulary Discovery outputs on representative Sets before recommending broader adoption. No setting changes are required for this read/evaluation workflow; Auto remains disabled unless explicitly enabled in Diagnostics.

A fixed fixture comparison establishes a useful initial observation, not production superiority. Report mismatched, missing or failed evidence rather than treating a synthetic-fixture win as a general model-quality result.

## Validation

- `tests/test_model_lab.py`, `tests/test_model_assessment_completion.py`, `tests/test_assessment_transfer.py`, `tests/test_director_model_calibration.py`, `tests/test_model_assessment_thinking_unified.py`, and `tests/test_model_lab_progress.js` run in the targeted CI.
- The Storyboard scene-header and Test Generations workflows guard unrelated UI/workflow regressions.
- No local model inference smoke test can run on GitHub's Linux runner. A representative local/remote real-model run should be verified before relying on performance or capacity comparisons as production facts.
- No database, new app-private storage root, new GPU lane, localStorage, hidden run actions, or background inference was introduced. Follow `AGENTS.md`.

## Related AI research

See the [AI research index](ai-research/README.md) (R09 R16 R18) for candidate publications and future research questions. This reference does not change the feature contract or establish evidence for its current implementation.

See [R03 — Structured outputs and schema design](ai-research/R03-structured-outputs.md) for published evidence, limits, and questions about schema meaning, decoding and output quality. This research reference does not change the feature contract.
