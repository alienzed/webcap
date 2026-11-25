# Artist + Mixing Engineer — isolated pilot

The author's analogy is one inspired draft improved by faithful technical
craftsmanship. There is no candidate search, judge, selection/merging model,
production chat change, new framework or automatic save.

The preceding [18-call profile screen](../../../docs/studio-director-profile-cleanup-results.md)
favored cleaned Current as a practical single-pass baseline, with limited
confidence. Its exact role/toolkit are frozen here. Production retains all
four profiles and Classic v3 while this new approach is investigated.

## Preregistered design

Five fresh situations: a casual conversational signoff, an ambitious library
concept with a fixed wide camera, a flexible Project, an impossible large-scale
weather transformation under a fixed camera, and a three-shot handoff with
deliberate screen positions, stable identities and exact dialogue.

For every case, compare:

1. `single`: cleaned Current, normal per-operation sampling.
2. `combined`: the same baseline plus one-pass invention/refinement guidance,
   with the same sampling as baseline.
3. `artist`: cleaned Imaginative plus an adventurous proposal focus, temperature
   0.7. Retain the actual result as an independently inspectable output.
4. `mixed`: cleaned Render-focused plus faithful-refinement guidance,
   temperature 0.15, receiving **that exact Artist draft** and the original task.

Only three strategies are independent alternatives: baseline, combined and
Artist-to-Engineer. The Artist output is reused evidence from the pipeline,
not a fourth extra call. **Maximum 20 calls**, one model, one trial per case,
no retries or extra probes. Shuffled treatment blocks keep Artist immediately
before its own Engineer. Use the same configured Gemma model as the screen;
smaller-model behavior supports relative observations, not a quality ceiling.

Baseline/combined temperatures are 0.35 Chat and 0.2 Write. `top_p` stays 0.9
for Chat and 0.85 Write across all stages, penalties zero, thinking disabled,
remote context left to the configured runtime and its actual size recorded,
output cap 2048 tokens per invocation. Temperature and
role are coupled parts of the pipeline treatment; this does not isolate a
causal temperature effect. Both single-pass alternatives have equal call caps.
Report every truncation and preserve its partial text without automatic repair.

The current Chat/Project/Scene response schemas were captured from the real
Flask route with enqueue mocked: zero model jobs. All stages use those exact
schemas. Scene stages share the unchanged technical H3 reference. The Artist
retains the author's functional contracts; the second pass is an execution
refinement, not permission to ignore those contracts initially.

## Implementation and evidence

`scripts/studio_artist_mixer_eval.py` reuses the existing experiment package,
message, receipt and anonymous-review formats. Production's HTTP chat API does
not expose per-request temperature. The isolated CLI therefore calls the existing
Python runtime `chat(..., sampling=...)` interface sequentially on a configured
remote runtime, recording the actual outgoing payload and returned usage/timing.
It does not change configuration or production sampling, start a local managed
GPU runtime, create a Project/Scene, or inject internal steps into live chat.

Individual outputs receive anonymous qualitative review before keys are opened.
Then compare actual Artist/Engineer pairs for preservation and changes; that
lineage analysis is necessarily unblinded. Keep objective diagnostics separate
from Codex observations and actual human ratings. No human scores are invented
or required. Retain raw requests, results, review keys and notes under ignored
local runs; publish sanitized findings.

Assess complete creative contribution, deliberate-choice fidelity, usable
fields/H3 structure, purposeful specificity and natural conversation. Added
length and apparent sophistication are not improvement. Measure actual prompt,
completion and total tokens, per-stage wall time and the sum for each pipeline;
report empty usage as unavailable rather than estimating it as fact.

This is a feasibility pilot, without repeats or an independent reviewer. It
cannot validate broad superiority, prove different-model complementarity,
separate temperature from role effects, or establish rendered quality. Actual
H3 renderability requires renders; textual diagnostics support narrower claims.
Production adoption or automatic turn-by-turn refinement is not part of this
experiment. Stop after the fixed budget and recommend the smallest justified
next step.
