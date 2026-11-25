# Focused H3 authoring guidance experiment

The 80-call Director comparison retained **D (Classic + H3 toolkit)** as the provisional default. Its source summary identified three recurring authoring problems: fixed visual states, 1–2-second shot intervals, and H3 dialogue tag placement. This experiment tests **one small affirmative Scene-writing instruction at a time**. The regular creative primer, technical H3 reference, operation contract, model and runtime settings remain constant.

## Safe phases

1. **Isolate the intervention.** `packages.json` contains D unchanged and three separate authoring addenda: **state-anchor**, **timed-cuts**, and **spoken-lines**. All four packages resolve the same repository Classic profile and H3 creative toolkit. The experiment adds only one optional `SCENE AUTHORING FOCUS` paragraph to the system message of a Scene Write. It leaves the H3 technical reference and its default text untouched.
2. **Exercise the failure modes.** Twelve new Scene-writing cases cover three categories: visual state, shot timing, and dialogue notation. Nine are development cases (three per category), three held out (one per category). Every variant runs on every case, allowing spillover or regressions to be observed.
3. **Run actual comparisons.** Use the existing sequential WebCap LLM job queue, preferably with the exact model reported in the prior 80-call comparison, `remote-1::mo-shakib/gemma4-e4b-uncensored:q4_k_m`, with two repeats, seed 42, unchanged runtime settings, and the same technical reference snapshot. The random seed shuffles trials; it does not make model sampling deterministic.
4. **Score observed results.** Review package-blind responses, checking every scenario's concrete `fidelity_checks` (true/false) plus separate human judgments for first-pass usefulness, creative value, H3 readiness and correction effort. Reports break down literal check rates **by failure category**, preserving missing judgments as missing.
5. **Choose next tests, not automatic promotion.** Compare gains and tradeoffs first on development cases, then run the held-out cases with shortlisted variants and D. Any guidance promotion is a separate explicit decision, supported by reviewer judgments and a few actual H3 renders.

## Commands

The current WebCap production code and Settings are unchanged. These commands are for the **development machine running WebCap** with an accessible Director model. The example URL assumes port 5000; use the actual configured WebCap URL.

Create a harmless offline plan for one representative case in each category (12 planned requests, no model calls):

```sh
python scripts/studio_guidance_eval.py plan --design-dir experiments/studio_guidance/focused_h3 \
  --model 'remote-1::mo-shakib/gemma4-e4b-uncensored:q4_k_m' \
  --case state-pool --case timing-watch --case dialogue-ferry --repeats 1 \
  --output experiments/studio_guidance/runs/h3-focus-plan
```

Run a **small live pilot**, the same 12 real model jobs:

```sh
python scripts/studio_guidance_eval.py run --design-dir experiments/studio_guidance/focused_h3 \
  --base-url http://127.0.0.1:5000 \
  --model 'remote-1::mo-shakib/gemma4-e4b-uncensored:q4_k_m' \
  --case state-pool --case timing-watch --case dialogue-ferry --repeats 1 \
  --output experiments/studio_guidance/runs/h3-focus-pilot
```

If the pilot's requests and output are correct, compare all nine development cases with two repeats (72 actual model calls):

```sh
python scripts/studio_guidance_eval.py run --design-dir experiments/studio_guidance/focused_h3 \
  --base-url http://127.0.0.1:5000 \
  --model 'remote-1::mo-shakib/gemma4-e4b-uncensored:q4_k_m' \
  --split development --repeats 2 --seed 42 \
  --output experiments/studio_guidance/runs/h3-focus-dev-01
```

Then create blinded cards, fill the check results and human ratings, and produce a report:

```sh
python scripts/studio_guidance_eval.py review --run-dir experiments/studio_guidance/runs/h3-focus-dev-01
python scripts/studio_guidance_eval.py report --run-dir experiments/studio_guidance/runs/h3-focus-dev-01
```

For each card, `fidelity_checks` contains exact properties relevant to the scenario; fill its corresponding `fidelity_results` values with `true` or `false`. Mark ambiguous or unreviewed criteria as `null`. The report computes literal-check pass rates only from recorded human judgments. Fill other review fields independently and keep `review_key.json` separate from reviewers.

For a later iteration, change **only** the candidate addendum wording/revision in the focused `packages.json` and use `--baseline-from <prior manifest.json>` with the same unchanged scenarios. Recheck all candidates against the same D control. Use the held-out split only after selecting variants from development results.

## Interpretation

A candidate succeeds only if it improves its target failure mode without materially degrading the other two, and if reviewers find its outputs more useful with fewer corrections. The earlier 80-call comparison contained no rendered video and blank human scores, so its statistical claims were limited to observed text. This experiment also runs text-only Scene drafts; real render quality, lip-sync and pacing require subsequent matched H3 render trials.

**No model is invoked by CI.** Offline tests verify request scopes, package isolation, scenario integrity, blind scoring and trial assembly. Live evaluation runs only when explicitly invoked against a configured WebCap service. The experiment preserves raw responses and failures, does not insert repair passes or automatic grading, and does not mutate saved Projects, Scenes, Takes or production guidance.
