# Epoch Finder — Working Vision

*WebCap / Test Generations · Discussion draft · 16 October 2026*

## Why it exists

Training produces many saved epochs, often across runs with different learning rates, model variants, adapters, and other settings. Manually generating and reviewing enough samples from every epoch is impractical. Epoch Finder should turn that large population into a **ranked, manageable set of promising checkpoints for human review**.

It is a discovery and triage tool, **not an automatic declaration of the single best LoRA**. An epoch that is sidelined is not deleted, and an early unfavorable score is not a permanent verdict. We want a useful answer after an unattended campaign, without pretending that a handful of generations constitutes a definitive quality measurement.

## Product shape

Epoch Finder is a **campaign workflow built on the existing Test Generations technology**, not a competing image-generation, VL, or GPU scheduling system. Test Generations remains useful for interactive experiments; Epoch Finder coordinates many of those experiments across saved epochs; a possible **Run Analytics** view would help explore ranked candidates, per-run trajectories, and evidence. The exact navigation and screen layout are deliberately undecided.

Over time, one selected epoch should be easy to inspect in greater depth: its scored tests, representative frames, nearby epochs, manual comparisons, additional renders, or weight sweeps. This should be a natural continuation into Test Generations rather than a rigid new workflow.

## Core campaign flow

1. **Discover candidates directly from training runs.** A campaign can ultimately cover multiple runs and their saved epochs, including distinct revisions and training variants. Checkpoints need not first be copied into Test Generations. The first MVP should start with **all available saved epochs from one run**.
2. **Plan the evaluation.** A short wizard accepts the training concept and uses an LLM, drawing on the Set's captions, tags, vocabulary, and other available context, to *propose* a test plan. The user reviews it before launch.
3. **Curate the test dimensions.** Display both proposed attributes **and their proposed values**, which can be edited or consolidated. Distinguish **primary concept attributes** (scored most strongly), **leakage probes** (scored but secondary), and **vary-only attributes** (can appear in prompts but are not scored). Do not build machinery to balance the distribution of attributes that are deliberately unimportant.
4. **Freeze comparable test cases.** Within a round, each tested epoch faces the same resolved prompts, seeds, resolution, and generation settings; only the candidate checkpoint differs. Across rounds, additional frozen prompt/seed combinations provide fresh evidence. The objective is representative, repeated measurements—not trick prompts or escalating adversarial tests.
5. **Run preset rounds.** Every saved epoch begins in the pool. After each round, compute cumulative concept-fidelity results and select the next, smaller active pool using an editable *relative retention percentage*. **All candidates tied at the cutoff advance.** Sidelined candidates keep their records and can re-enter automatically at a later round boundary if their existing scores rise above the newly ranked cutoff. Re-entry does not require catching up on tests they missed.
6. **Finish with a ranked list**, not a required number of finalists. A completed campaign stays inspectable. The user can choose to add another round later or move into focused manual testing; there is no automatic continuation after the approved plan ends.

## Scoring and interpretation

The initial automated evaluation focuses **only on concept fidelity**, extending the existing Ask VL attribute-assessment mechanism. Primary attributes should have a higher default influence than leakage probes; unscored prompt variation does not affect rankings.

VL should distinguish **observably correct**, **observably absent/incorrect**, and **genuinely uncertain**. An uncertain individual judgment is excluded from the score; absent or incorrect is a failure. The evaluator should not use “uncertain” as a general substitute for deciding what clearly appears in the image. Preserve individual judgments, observation counts, and their provenance—not merely a final average.

Use a simple, transparent cumulative ranking for the MVP. **The exact averaging method** (per attribute versus per render), round allocations, and cutoff percentages remain configurable or subject to empirical calibration. Do not preemptively add variance penalties, confidence machinery, tie-breaking tests, or automatic catastrophic-defect disqualifications. With few observations, some promising epochs will be unlucky; the goal is useful triage, not flawless statistical inference.

General image quality, anatomy, recurring visual anomalies (such as unwanted background patterns), and under-/overtraining diagnostics are **separate future investigations**, not prerequisites or hidden components of the v1 concept score. Existing VL performance on attributes is encouraging, but new claimed detection abilities must be demonstrated first.

## Practical defaults, not fixed policy

The wizard should offer a **sensible, editable round table**, with the LLM allowed to suggest adjustments when justified. A starting resolution progression could be **0.2 → 0.3 → 0.3 → 0.4 megapixels**; 0.4 MP is a proposed economical campaign ceiling, not a technical limit. Resolution primarily controls render cost; higher resolution does not imply harder prompts. Round count, new renders per candidate, retention percentages, resolution, and the curated test matrix are adjustable.

Favor **front-loading enough tests to make the first cut useful**, then spending less per epoch as the active pool narrows and evidence accumulates. No particular cutoff schedule or sample count is established as optimal yet. A wizard must show projected candidate counts and approximate rendering workload before launch.

Preflight validation of source checkpoints, models, prompts, settings, and estimated workload is required. A **small representative live generation/VL sample** is optional; it should never silently trigger the full campaign. The complete approved plan is frozen for that campaign, even if editable defaults or LLM proposals evolve later.

## Execution, durability, and media

This must be **server-coordinated** and browser-independent. Record each completed generation and VL assessment incrementally, including identity, test-case definition, settings, scores, errors, and completion state. Surviving evidence must not depend on finishing an entire batch or keeping a tab open. Reuse WebCap's existing inference/LLM infrastructure and global Activity/Console surfaces; do **not** create another GPU scheduler or execution lane.

Isolated generation or VL failures are recorded and surfaced, and evaluation continues for other candidates. Failed judgments do not quietly become scores. Interruption recovery should preserve completed results and expose unfinished work. **Startup must never automatically unpause or resume paused work**; resuming after a restart requires explicit user action, consistent with WebCap's operating rule.

For video models, v1 evaluates the **extracted first frame**, not motion or temporal quality. Generated clips are expensive temporary artifacts: after successful VL assessment and durable saving of its judgment/frame, they should generally be deleted. Retain the evaluated frames for the final active candidates and remove unnecessary screening media. The precise cleanup/retention policy can be refined during implementation; never delete source checkpoints as a side effect of ranking.

## Lightweight runtime estimates

The planning wizard should estimate total campaign runtime from **actual completed renders**, alongside the planned candidate counts and tests per round. This is a rough planning aid, not a performance prediction engine.

- **Unknown settings:** assume **60 seconds per render**. Do not require a calibration run to begin using Epoch Finder.
- **First useful measurement:** prefer the **second completed render** of a comparable sequence, since the first may include model-load/warm-up time. Subsequent successful render timings can refine the estimate.
- **Matching:** keep a small persistent, environment-specific timing profile keyed by **model, megapixels, and video duration**, following the existing H3 calibration Settings pattern rather than introducing a new framework.
- **Estimation:** use a simple observed typical time for matching settings; for unmeasured combinations, use the 60-second fallback. **No interpolation or complex performance modeling in the MVP.**
- **Scope:** distinguish generation time from VL evaluation overhead and GPU queue waiting. Forecast the work in the approved rounds and update the estimate as real measurements accumulate.

The estimator must remain cheaper to implement and maintain than the value it provides. Its purpose is to flag a potentially lengthy overnight campaign, not to promise an exact finishing time.

## MVP: learn by running a real campaign

Build the smallest end-to-end version capable of evaluating **one training run's saved epochs** under a short, configurable sequence of controlled rounds, with durable results, cumulative rankings, tie-aware narrowing, re-entry, and an inspectable outcome. Reuse the existing Test Generations rendering and Ask VL paths.

Then actually run it and answer:

- Do promising ranges of epochs emerge without manually reviewing hundreds of videos?
- How stable are rankings as new renders are added? Do seemingly strong averages sometimes fall?
- Does progressive narrowing save enough render time, and does re-entry behave sensibly?
- How well does the resulting ranked pool agree with manual review?
- Are resolution, VL scoring, round sizes, and media retention practical on the real machine?

Use those observations to refine defaults. Do not try to solve the statistical theory, all possible UI layouts, or cross-run analytics before this experiment.

## Longer-term opportunity

Once there is sufficient repeated, comparable evidence, Run Analytics may relate epoch performance trajectories to learning rate, training configuration, adapter usage, loss curves, and other known variables. The long-term aim is to learn which training approaches tend to work, when they peak, and which signals are useful. **Store provenance now; defer claims about predictive patterns until the data supports them.**

## Deliberately open

- Exact scoring aggregation and whether per-render normalization is useful.
- Number of rounds, samples per round, and retention percentages: editable defaults to be calibrated.
- How to best present campaigns, candidate drilldowns, and Run Analytics within Test Generations.
- Which final frames to retain and when to prune them.
- How to share the durable evaluation coordinator with today's Batch Test with minimal architectural disruption.

**Guiding principle:** Make a useful, reproducible experiment easy to configure, run, inspect, and refine. Keep the first implementation small; let real campaign results decide what sophistication is warranted.
## October 17 direction: training-aware evaluation (additive)

The existing Ask VL prompt-compliance scoring, ranking, retention and historical scores remain functional and unchanged. In addition, new campaigns may collect two independent forms of dataset-reference evidence: **paired-image RVN** for specific approved wildcard attributes, and **DINOv2** for full-image visual similarity. Both are selected by default as separately switchable campaign options. SigLIP2 is deferred. No new metric is automatically fed into existing ranking/elimination until validated against human judgments.

Campaign setup must select a user-approved, full-image training reference for **every scored wildcard option** using exact scoped Set-tag candidates. Missing references block launch until the choice is fixed or removed; vary-only dimensions are exempt. No cropping or category-specific detector is required. RVN retains the available-option vocabulary and records feature-specific comparison separately; DINO similarity is a distinct whole-image signal. Results must be browsable with actual references, renders, prompts, per-attribute verdicts, evidence counts and manual selection affordances.

Implementation contract and phased dependencies: [epoch_finder_reference_evaluation.md](epoch_finder_reference_evaluation.md). This new section supersedes earlier v1-only statements **only regarding the scope of evaluation methods**, not the established scheduling, persistence or legacy scoring behavior.
