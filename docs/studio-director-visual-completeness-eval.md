# Director visual completeness and Studio-context guidance comparison

**Status:** controlled, opt-in model experiment. No production Studio guidance, Project/Scene persistence, WebCap routing, H3 technical reference, or creative-profile default has changed.

## Why these candidates exist (research and local evidence)

The earlier Director comparison made 80 real calls and retained Classic + H3 toolkit as provisional control; it did **not** establish a broadly better primer. Its weaknesses included literal H3 notation, requested shot timing, and physical-state fidelity. A separate focused H3 trial covers those problems.

The larger research basis is:
- Sun et al., *T2V-CompBench* (CVPR 2025): tests **consistent and dynamic attribute binding**, spatial and motion relations, action and object interaction, and counts; compositional control is hard. https://openaccess.thecvf.com/content/CVPR2025/html/Sun_T2V-CompBench_A_Comprehensive_Benchmark_for_Compositional_Text-to-video_Generation_CVPR_2025_paper.html
- *VBench++* (TPAMI 2025): evaluates dimensions such as subject identity consistency, motion smoothness and spatial relationships. https://pubmed.ncbi.nlm.nih.gov/41247905/
- Cheng et al., *VPO* (2025): prompt optimization must preserve author intent; changing prompts can lose important details. https://arxiv.org/abs/2503.20491
- Existing WebCap specialist guidance `task.visual_direction` already says **“Be exceptionally thorough and specific about the visuals that will actually be rendered.”** That exact phrase is one experimental arm, not a new creative claim.

These are **research-motivated hypotheses**, not proof that any wording improves MiniMax H3. A Scene-writing Director model and the downstream video generator have different error modes.

## Creative goal and concise model-facing instructions

Keep goal/rationale outside the instruction itself: **invent confidently, define what the Scene will render completely, preserve established continuity, allow intended change, and avoid constraining the scene's ambition**. The Project overview is a creative map, Invariants are recurring baseline facts, and Scene prompts carry the full standalone audiovisual definition. Long Scene descriptions are acceptable; the Director can define a recurring subject/location in depth once per Scene and reference it in later shots. One-off backgrounds need only their visually relevant identity. Never impose a number of people, mandatory minimal action count, or a short Scene-prompt budget as a substitute for visual completeness.

The `packages.json` text is the *actual* model-facing material. Only one field, `creative_addendum`, differs from the frozen `d-control`:
- **thorough**: the existing specialist's succinct explicit thoroughness cue.
- **fully-defined**: complete first-appearance definitions plus definitive choices.
- **studio-baseline**: Project/Invariants orientation and independent Scene completeness.
- **clear-choices**: coherent choice of elements, exhaustive description of those chosen, appropriate incidental/background detail.
- **combined**: concise synthesis, tested separately, not assumed superior.

The earlier `focused_h3` experiment remains unchanged for reproducibility. The new design lives in `experiments/studio_guidance/visual_completeness/`.

## Validation design

17 fixed scenario prompts: **13 development**, **4 held out**. Coverage: complete attire (including unspecified but visible garment layers), objects and locations, distinct actors and crowded scenes without reducing their scale, continuity within/across independently generated Scenes, purposeful evolving state, Project/Invariants scope, abstract Project freedom, concise ordinary chat, and three **verbatim** regression fixtures (still water, exact 2-second cuts, H3 dialogue).

The harness sends the same system profile/toolkit, case history, Write task, Project fixture and H3 technical reference for every package. A `creative_addendum` appears in all three Director operations (Chat, Project Write, Scene Write), whereas the older `authoring_addendum` remains restricted to Scene Write. This tests whether a helpful general cue adversely affects conversation and Project scope. The runner records raw requests, raw responses, failures, timings, seed and hashes. It uses existing `/fs/director/chat` and job polling only, without saving Scenes or Projects.

The blinded review contains case-specific **literal-fidelity checks** and independent human ratings of usability, intent, creative quality, H3 readiness and estimated correction. Reports now also show average **response characters and words**, not claimed token counts. These are descriptive output-cost measures; a longer Scene can be better. Evaluate regressions and creative quality alongside completeness, *not length alone*. Missing human scores remain missing; no automated winner, judge model, text parser that rejects partial results, or second-chance model calls.

## How to run with the same configured Director model

The commands below must execute **where WebCap and its actual Director model endpoint are accessible**. Replace the URL if WebCap uses another host or port. GitHub Actions performs only offline planning and Python tests.

**Offline pilot plan** (18 planned calls, no model use):

```sh
python scripts/studio_guidance_eval.py plan \
  --design-dir experiments/studio_guidance/visual_completeness \
  --model 'remote-1::mo-shakib/gemma4-e4b-uncensored:q4_k_m' \
  --case clothing-complete --case busy-market --case project-invariant-scope \
  --split development --repeats 1 --seed 42 \
  --output experiments/studio_guidance/runs/visual-complete-pilot-plan
```

**Pilot with real model** (18 calls, the six packages × three cases):

```sh
python scripts/studio_guidance_eval.py run \
  --design-dir experiments/studio_guidance/visual_completeness \
  --base-url http://127.0.0.1:5000 \
  --model 'remote-1::mo-shakib/gemma4-e4b-uncensored:q4_k_m' \
  --case clothing-complete --case busy-market --case project-invariant-scope \
  --split development --repeats 1 --seed 42 \
  --output experiments/studio_guidance/runs/visual-complete-pilot-live
```

If the pilot shows sound request and output behavior, run development **with two repeats (156 calls)** or select a smaller shortlist with repeated `--package` flags:

```sh
python scripts/studio_guidance_eval.py run \
  --design-dir experiments/studio_guidance/visual_completeness \
  --base-url http://127.0.0.1:5000 \
  --model 'remote-1::mo-shakib/gemma4-e4b-uncensored:q4_k_m' \
  --split development --repeats 2 --seed 42 \
  --output experiments/studio_guidance/runs/visual-complete-dev-01
python scripts/studio_guidance_eval.py review \
  --run-dir experiments/studio_guidance/runs/visual-complete-dev-01
python scripts/studio_guidance_eval.py report \
  --run-dir experiments/studio_guidance/runs/visual-complete-dev-01
```

Fill each blinded card's `fidelity_results` with `true`/`false` for observed facts, or `null` for unreviewed. The review cards contain no package IDs; keep `review_key.json` separate until grading is complete. Review representative outputs **without revealing their package**. Evaluate both high-density and intentionally simple scenes; success on clothing is not success if multi-person or Project creative flexibility degrades.

Once a shortlist is selected from development results, run the untouched held-out split on only the shortlist and D. Freeze `d-control` and the H3 technical context across candidate iteration with `--baseline-from <prior manifest.json>`. The command rejects changes to fixed scenarios when reusing that manifest. Keep the model, sampling configuration and seed consistent between comparisons; the seed controls trial ordering, not stochastic generation. Before promotion, perform a few same-settings **actual H3 renders** and human checks of identity, object continuity and audiovisual output.

## Interpretation and remaining dependency

The CI check proves only that the request assembly, isolation, frozen control, scenario integrity, blind review and report metrics work. It cannot establish live Director output quality or video fidelity. This workspace has access to the GitHub repository and CI but no live local WebCap model endpoint, so real pilot, development and video rendering evidence can only be collected on a machine with that runtime. Keep the previous D guidance active until that evidence supports a change.
