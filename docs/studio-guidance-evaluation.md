# Studio guidance comparison experiments

**Status:** opt-in experiment harness, isolated from normal Studio Settings and default guidance. It compares *creative primers* over real WebCap Director calls. It does not save Project or Scene results, invoke H3 rendering, run an LLM judge, or change model configuration.

Historical compatibility: the established D role/toolkit in this design and its focused/completeness/charter follow-ups now resolve from `experiments/studio_guidance/frozen-d-20261122.json`. Their resolved content is unchanged even after the separately requested [Classic default refinement](studio-director-creative-charter-results.md). `--baseline-from` continues to freeze each run's technical reference and reject scenario changes. The harness does not automatically promote guidance, and the established 86-call PR #1099 comparison was not rerun.

## Implemented plan and phases

1. **Freeze a controlled comparison.** \`experiments/studio_guidance/packages.json\` defines four named hypotheses. A is a minimal role, B adds concise H3 capabilities, C adds production-minded creative principles, and D resolves the current repository Classic profile plus H3 toolkit as a baseline. Each run writes exact, hashed guidance and the unmodified H3 authoring reference to its manifest.
2. **Exercise representative behavior.** \`scenarios.json\` contains 12 synthetic scenarios: six Studio conversations, two Project Creates, four Scene Creates. Eight are development cases; four are held out for later selection. The requests preserve conversation order and use the existing \`studio_chat\`, \`studio_project_draft\`, and \`studio_scenes_draft\` operations, with their server-owned schemas.
3. **Run real configured models, retaining raw evidence.** \`scripts/studio_guidance_eval.py\` uses \`POST /fs/director/chat\` and polls \`GET /fs/director/job?job=…&consume=1\`. Every call uses the same explicitly selected model, the same source scenario and Write task, and the same H3 technical reference. Only the package's role and expertise change. Model jobs run sequentially through the existing queue. A deterministic seed interleaves packages and repeats. Each request, result, status, failure, timings and content hash goes to a local JSONL file.
4. **Review independently.** A separate step shuffles completed trial receipts into package-blind review cards. A human marks first-pass usability, intent fidelity, creative value, H3 readiness, and estimated correction rounds; *actual* revision rounds can be recorded separately if someone genuinely performs those rewrites. A report unblinds the results and splits them by operation. It never declares an automatic winner.
5. **Iterate carefully.** Codex can revise the candidate package text, rerun development cases against a frozen baseline, and interpret human feedback. Keep scenario definitions fixed for a comparison. Before adopting a candidate, test it on the four held-out cases and a small set of **actual H3 renders**. Promotion into production guidance remains a separate, explicit author decision.

## Running a comparison

Requires Python 3 and a running, accessible WebCap instance with an actual configured Director model. Use its **exact** model ID (for example \`local::my-director\` or your configured remote ID). The URL below is illustrative; use your WebCap server's actual URL and port.

Plan a single comparison without contacting a model:

\`\`\`sh
python scripts/studio_guidance_eval.py plan \
  --model 'local::my-director' \
  --case chat-tableau --repeats 1 \
  --output experiments/studio_guidance/runs/smoke-plan
\`\`\`

Execute one **real** model call per package:

\`\`\`sh
python scripts/studio_guidance_eval.py run \
  --base-url http://127.0.0.1:5000 \
  --model 'local::my-director' \
  --case chat-tableau --repeats 1 \
  --output experiments/studio_guidance/runs/smoke-live
\`\`\`

Run the 8 development cases with two repeats (64 actual model calls):

\`\`\`sh
python scripts/studio_guidance_eval.py run \
  --base-url http://127.0.0.1:5000 \
  --model 'local::my-director' \
  --split development --repeats 2 --seed 42 \
  --output experiments/studio_guidance/runs/development-01
\`\`\`

Create **human** review cards, edit the rating fields in \`review_cards.jsonl\`, and generate an evidence-based comparison:

\`\`\`sh
python scripts/studio_guidance_eval.py review \
  --run-dir experiments/studio_guidance/runs/development-01
python scripts/studio_guidance_eval.py report \
  --run-dir experiments/studio_guidance/runs/development-01
\`\`\`

Keep \`review_key.json\` away from reviewers until the review cards have been scored. Give reviewers only \`review_cards.jsonl\` (and the rubric below); package names are omitted from those cards. A failed request is retained as a failed record rather than retried or transformed into creative output.

After Codex edits A, B, or C in \`packages.json\`, use the original manifest to hold the baseline **D** and the technical authoring reference constant:

\`\`\`sh
python scripts/studio_guidance_eval.py run \
  --base-url http://127.0.0.1:5000 \
  --model 'local::my-director' \
  --split development --repeats 2 --seed 42 \
  --baseline-from experiments/studio_guidance/runs/development-01/manifest.json \
  --output experiments/studio_guidance/runs/development-02
\`\`\`

A final holdout comparison uses \`--split holdout\` with the selected candidate packages, the same model and baseline snapshot. Each run creates a **new** evidence directory and fails rather than overwriting an existing one. A \`plan\` run is not eligible for review: it is only an assembly check.

## Human rubric

**First-pass usable** means the result can guide the next creative step or be adopted without major author correction. The other attributes are scored from 1 (poor) to 5 (excellent):

- **Intent fidelity:** preserves exact requested subjects, dialogue, timing, mood and deliberate constraints.
- **Creative value:** makes a distinctive, useful contribution with concrete artistic judgment.
- **H3 readiness:** appropriately specific, clear and producible audiovisual direction, as relevant to the operation; for conversation, judge the *usefulness of the advice*, rather than requiring a Scene prompt.
- **Estimated correction rounds:** number of focused rewrites a reviewer believes are needed; this is a subjective estimate, **not** a measured editing count.
- **Actual revision rounds:** optional separately measured human correction count, only if someone genuinely revises the same result.

Always compare the same model and runtime configuration. Keep prompt cases and sampling fixed, repeat each case, and review the raw evidence when a model appears inconsistent. A high automated schema success rate is not proof of good H3 output.

## What this measures—and what it does not

The harness uses the actual WebCap model queue and **operation-specific JSON schema**, but supplies *synthetic fixed conversation and Project fixtures*, rather than navigating real Studio UI state. The request system message and Write task mirror the Studio assembly conventions; a fixture is not proof of identical UI state, source selection, or persistence. Browser live tests already cover those separately.

Because these operations only queue Chat/Write drafts, no Project, Scene, or Take is persisted. No full render is made, so a high text-quality score is not evidence that the H3 renderer delivered the described actions or dialogue. For final acceptance, independently render selected Scene candidates with the same H3 settings and assess fidelity, audiovisual synchronization, and author correction effort.

## Codex iteration contract

Codex may propose candidate role/toolkit revisions, but should change **only** the experiment package text and associated hypothesis/revision metadata during a controlled comparison. Keep both scenario splits, their rubric, runtime settings, technical authoring reference, and the D baseline fixed. Use the same seed, trial count, model ID and experiment protocol in comparable runs. Codex can surface patterns from the raw evidence and human ratings, but **human reviewers decide first-pass usefulness**. Once the top candidate passes held-out trials and rendered samples, propose a separate explicit change to production Settings or default guidance. This harness never auto-promotes a package.

There are no new dependencies or new WebCap routes. Trial results live under \`experiments/studio_guidance/runs/\`, which is ignored by Git because prompts, responses and review notes may be private. CI runs only compilation, mock-transport contract checks and dry-run planning; live model evaluation is an explicit opt-in on the machine with a configured runtime.
