# Studio Director creative-charter comparison — isolated live protocol

**Status:** live comparison completed, with mixed findings and no universal charter winner. The author subsequently requested applying practical lessons to the real default. Classic now retains D plus one separately checked coherence sentence. See [actual results, limitations and full active wording](studio-director-creative-charter-results.md). No H3 renders were feasible; ComfyUI was unavailable. PR #1099's 86 calls were not repeated.

The preference workflow below was the original proposed review protocol. No human ratings were requested or supplied; its blank workbooks are optional and were not a prerequisite for the author's requested implementation. Actual conclusions distinguish operation diagnostics from Codex's unscored observations. They do not claim human preference validation.

## Purpose and controlled variants

Test transferable creative-director judgment rather than accumulating scene-specific checklists. `packages.json` defines:
- `d-frozen`: exact historical Classic (D) role + H3 toolkit, now resolved from `experiments/studio_guidance/frozen-d-20261122.json` so subsequent production defaults cannot move the control.
- `d-plus-core`: same D plus the proposed charter as an all-operation creative addendum.
- `consolidated-core`: replace D's overlapping role introduction, creative-scope paragraph, and Classic profile paragraph with the charter. Preserve D's **WEBCAP MATERIAL** and **COLLABORATION** sections verbatim, including Project/Scene/Invariants, standalone Scenes, and explicit Write boundaries. The shared H3 toolkit is identical.

For Scene writing, the existing separate H3 prompt reference, task, operation, schema, Project fixture and timing contract remain unchanged. This is not a new profile, new Settings entry or save mechanism.

## New briefs and what to judge

There are 12 fresh development and four fresh held-out cases across Chat, Project and Scene authoring, deliberately ranging from minimalism and stillness to crowds, choreography, documentary, surreal worlds, editing and sound. All retained literal checks are **diagnostic**.

**Primary:** blind pairwise human preference for the **whole contribution**, per same-case same-repeat comparison. Choose left/right/tie/both unusable with brief reason; favor intention-sensitive imagination, confident and appropriate creative choices, artistic judgment, audiovisual realization, structural coherence and useful collaboration. Do not reward verbosity, phrase matching or invented additions in conflict with deliberate author choices. Chat is judged as conversation; Project as an inspiring flexible map; Scene as independently useful audiovisual direction.

**Secondary:** use the existing single-output blind cards to score intent fidelity, creative value, H3 readiness, first-pass usefulness, estimated corrections, and literal checks. Check failures, response lengths and potential over-instruction separately. A second human should independently rate disputed pairs and a balanced sample from each operation/model. Do not use Codex's own unscored textual impressions as a substitute for blind human preference.

## Live sequence

Run only where the real Director endpoint is accessible. Use a newly named output folder for every invocation. Set `BASE_URL` to the running WebCap URL; these commands assume localhost:5000. A `plan` is purely offline; `run` queues actual configured models.

**Optional pilot reference: 9 calls** — three representative cases, one pass, all three packages. The completed execution used a split nine-call Nullguard pilot and proceeded directly on Gemma's established accessibility; the command below is a reference, not another requested run:

```sh
python scripts/studio_guidance_eval.py run \
  --design-dir experiments/studio_guidance/creative_charter \
  --base-url http://127.0.0.1:5000 \
  --model 'remote-1::mo-shakib/gemma4-e4b-uncensored:q4_k_m' \
  --case chat-theatrical-restraint --case project-ambient-portraits --case scene-museum-gesture \
  --split development --repeats 1 --seed 84 \
  --output experiments/studio_guidance/runs/charter-gemma-pilot-01
```

If assembly and response behavior are sound, run the full **Gemma development: 72 calls** (12 cases × three arms × two repeats). Check the running Director's discovered models for an accessible alternative such as Nullguard, and establish usability with a small Chat/Project/Scene pilot before running the same design separately. A larger model is **not required**. Smaller local models provide relative within-model comparisons; their limitations do not define the creative quality ceiling or invalidate an abstract creative approach. Record exact model IDs, runtime/sampling settings, and immutable input hashes. A seed here controls trial ordering, not generation determinism. Do not combine raw score totals across different models and claim a universal winner.

```sh
python scripts/studio_guidance_eval.py run \
  --design-dir experiments/studio_guidance/creative_charter \
  --base-url http://127.0.0.1:5000 \
  --model 'remote-1::mo-shakib/gemma4-e4b-uncensored:q4_k_m' \
  --split development --repeats 2 --seed 84 \
  --output experiments/studio_guidance/runs/charter-gemma-dev-01

python scripts/studio_charter_preference.py review \
  --run-dir experiments/studio_guidance/runs/charter-gemma-dev-01
python scripts/studio_guidance_eval.py review \
  --run-dir experiments/studio_guidance/runs/charter-gemma-dev-01
```

Separate `preference_key.json` and `review_key.json` from reviewers. Fill the preference cards **before** running `studio_charter_preference.py report` and the other reviewed cards **before** `studio_guidance_eval.py report`. Both reports preserve missing human scores and make no automatic selection. Keep all run evidence in the ignored local run folder. The earlier 86-call findings are previous evidence, not outputs of this new design.

Each new review uses an independent random assignment, even when trial-order seeds match across models. The assignment seed is retained only in the private key; `--review-seed` optionally reproduces a specified assignment. Never overwrite existing cards or keys. Preference reports distinguish `tie` from `both_unusable`; `first_package_wins` and `second_package_wins` refer to the ordered `packages` array, not the randomized left/right positions. Failed operations retain their actual status and error in pair cards, and single-output cards include the supplied Project context. Preserve raw model wording even if it happens to mention a package-like term.

Keep three evidence sources distinct: objective operation/length diagnostics, **Codex's qualitative observations**, and **actual human preferences**. Codex may inspect outputs blind and record its own unscored observations separately; those observations must not populate human vote/score fields. Reports with no human input remain unrated. A small-model shortfall can motivate a hypothesis, not a growing list of subject-specific fixes.

On development evidence, shortlist only promising charter variants and compare against frozen D on **four untouched holdout briefs**, with two repeats on each confirmed model. For three arms, full holdout costs 24 calls per model. Preserve frozen D and technical reference from the corresponding development `manifest.json`; the existing runner's `--baseline-from` locks the control and rejects scenario changes.

## Subsequent experiments — not part of the first comparison

1. **Phrase ablations:** once an additive or consolidated charter shows convincing preference, remove **one conceptual clause at a time** (initiative, deliberate author fidelity, full audiovisual experience, coherence, technique serving experience, proportionate collaboration). Test paired development trials with frozen control; use holdouts only for final shortlisted candidates. An ablation must not alter WebCap functional/H3 contracts.
2. **Two author-approved examples:** test no examples versus two contrasting examples, separately from clause ablations. Choose one expansive and one deliberately restrained artistic case. Obtain author approval before calling either a quality reference. Neither example should be an existing evaluation brief. Avoid turning them into fixed visual templates.
3. **Profile-transfer check:** the repository currently provides Classic, Current/editorial, Imaginative, and Render-focused. After selecting a promising charter, test whether it reinforces or homogenizes these *distinct postures*. Compare each original profile to its own charter treatment on a small fresh, matched subset across Chat/Project/Scene. Keep the baseline four profiles untouched. Candidate profile nudges should follow evidence, not contaminate the first D three-arm test. Current may benefit from calibrated critique; Imaginative from purposeful novelty; Render-focused from comprehensive realized specificity; Classic from balanced direction.

Literal checks, small-model weaknesses, verbosity or one flattering example do not validate a creative winner. Render-quality validation requires actual matched H3 outputs and assessment of user-valued quality, identity, action, audio and continuity. The author's later request authorized the limited default refinement documented in the results; it does not turn this text-only study into render-quality validation.

## Repository safeguards

The original design remains confined to `experiments/studio_guidance/creative_charter/` and offline-preference script/tests. All older experiments retain their resolved content; their D sources now use the frozen historical snapshot. CI performs **offline** syntax, request-assembly, immutable-guidance and blind-review tests and dry-run plans only, with no live endpoints, model calls or persistence actions. Following the author's explicit request, the separate `default_candidate/` and `coherence_clause/` checks informed the limited Classic default refinement documented in the results. Other profiles, `llm_guidance.py`, Studio UI/Settings behavior and H3 contracts were preserved. A default decision on this evidence is not rendered-quality or human-preference validation.
