# Visual Director prompt experiment — Round 3 (final comparison)

This is the final, tightly scoped prompt comparison. No production code changes.

## What Round 2 established
Generic visual exhaustiveness (B) led with 50/72; concise visual exhaustiveness scored 48/72; the longer combined state-accounting candidate scored 43/72; the original state-accounting baseline scored 42/72. The reported weaknesses were incomplete fashion outfits (footwear omitted in 8/12 fashion outputs), carry-over of previous garments, and occasional scope drift (unrequested crowds, camera directions, or alternatives).

The local Round 2 report/raw outputs were not available for direct inspection when this round was prepared. This design therefore uses the reported findings and the exact candidate prompts stored in the repository. Do not claim a deeper raw-output audit was performed.

## Candidates
1. `A_B_unchanged.txt`: exact Round 2 Candidate B, unchanged.
2. `B_B_plus_visual_completion.txt`: B plus one focused rule: describe a complete resulting visual state rather than only the changed item, with explicit replacement of prior state where relevant.
3. `C_visual_completeness.txt`: concise, general instruction to fully describe the rendered visuals, without a category checklist or extra role-play.

## Fixtures
Use the same seven Round 2 fixtures:
- `experiments/visual_director_round2/fixtures/01_fashion_transition.json`
- `experiments/visual_director/fixtures/02_tennis_to_basketball.json`
- `experiments/visual_director/fixtures/03_emotional_transition.json`
- `experiments/visual_director/fixtures/04_day_to_night.json`
- `experiments/visual_director/fixtures/05_negative_control.json`
- `experiments/visual_director_round2/fixtures/06_casual_to_evening.json`
- `experiments/visual_director_round2/fixtures/07_denim_look_completion.json`

## Execution
Run exactly 3 candidates x 7 fixtures = 21 requests.

Use WebCap's existing `POST /fs/director/chat`, `operation: "freeform_chat"`, with the candidate as an actual `system` message and the fixture as a `user` message. Use a fresh request for every pair; no chat history. Use the same selected Gemma model, runtime and sampling settings throughout. Reuse the existing queue/GPU coordination. Capture raw outputs, actual model identity, request/job metadata and timings. Never apply results to Projects.

Do not change candidate prompts, fixture content, model settings or evaluation criteria mid-run. No retries of usable model outputs. Infrastructure recovery may be attempted only when no usable model response was produced; preserve each attempt separately.

## Evaluation
Score revised prompts, not explanations. Use the same rubric and weighting for all candidates:
- Visual completeness: complete intended visible state, not just named changes.
- Replacement/state transition: prior visual elements do not accidentally persist.
- Appropriate creative completion: necessary missing visual details are sensibly established.
- Scope discipline: no invented story, events, crowds, or unnecessary camera direction.
- H3 usability: concrete, self-contained instructions.
- Negative-control restraint: no gratuitous rewriting.

Fashion cases must be judged as complete outfits. Missing footwear counts as an omission when footwear is relevant to the look; do not require decorative accessories when they are not relevant. Reward explicit replacement of prior garments. Do not reward verbosity for its own sake.

Report scores by candidate and fixture, identify concrete successes/failures, compare against Round 2, and recommend one prompt. If results remain inconsistent, state that prompt wording alone has not solved the reliability problem. This is the final experiment; do not launch another prompt-tuning round without discussing the evidence first.
