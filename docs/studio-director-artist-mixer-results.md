# Artist + Mixing Engineer: bounded pilot findings

## Decision

**This pilot does not justify an automatic Artist → Engineer call on every
Studio turn.** The second pass preserved the ambitious structured concepts but
added little useful execution work, exposed internal processing in Chat, and
introduced a technical-format regression. It cost 2.57 times the model-reported
tokens and 2.20 times the measured wall time of the single-pass baseline.

That is a result for this small model and these instructions, not evidence
against complementary creative/technical intelligence in general. A model or
specialist with demonstrated production expertise could behave differently.
No larger model was required to complete this feasibility test.

**Production remains unchanged:** Classic v3 is still the default and all four
existing profiles remain available. Proposed consolidation was set aside at
the author's explicit boundary. This study adds isolated experiment files,
tests and documentation; it does not change Read/Write, sampling defaults,
saved Projects/Scenes, guidance overrides, or H3 requirements.

## Account for the profile comparison first

The previous 249 calls compared Classic/D charter variants, not the four
product profiles. The subsequent **18-call cleaned-profile screen** compared
all four postures and then Current versus Render-focused on new cases with
Nullguard. Cleaned Current was the most consistent practical choice; a separate
Render-focused personality did not earn a clear second place. The sample has
no repeats, and model/split are confounded. See the
[full profile findings](studio-director-profile-cleanup-results.md).

That cleaned Current role/toolkit was frozen as the new single-pass baseline.
It is an experimental baseline, not a newly promoted production default.

## What was tested

Five fresh cases: a casual conversational signoff, an entire library breathing
under a fixed wide camera, a flexible kite/weather Project, a suitcase storm
expanding to fill a station under a fixed camera, and a three-shot intimate
handoff with precise screen positions, hands, object identity and dialogue.

| Treatment | Calls | Role and sampling |
| --- | ---: | --- |
| Single-pass baseline | 5 | Cleaned Current; temperature 0.35 Chat / 0.2 Write. |
| Combined single pass | 5 | Same baseline plus invention/refinement focus; same sampling. |
| Artist → Engineer | 10 | One cleaned Imaginative draft at 0.7, then cleaned Render-focused refinement at 0.15, receiving that exact draft and the original task. |

The five Artist drafts are also reviewed as independent material, without extra
generation. There was no candidate search, judge, selection model, or merging
of different drafts. The completed pilot used **20 actual inference requests**,
all completed with `finishReason=stop`; no truncations or model-call retries.
Actual outgoing requests, original-draft lineage and unchanged schemas were
verified against receipts. All calls reported an 8192-token context and used
a 2048-token output cap. `top_p` stayed 0.9 Chat / 0.85 Write; penalties zero,
thinking disabled. Role and temperature are coupled treatments; their individual
effects are not identified.

Model: `remote-1::mo-shakib/gemma4-e4b-uncensored:q4_k_m`.

The HTTP chat API has no per-request temperature parameter. The isolated CLI
uses the existing Python runtime's `chat(..., sampling=...)` interface on the
configured remote runtime. It records actual outgoing payloads and returned
usage/timing. A first preflight failed before inference because the explicit
context override is supported only by local llama.cpp; the corrected run left
remote context to the configured runtime. That attempt spent zero model calls.
Production configuration and queue behavior were not changed to run the test.

## Actual creative and technical contribution

These are **Codex qualitative observations**, saved before opening the treatment
keys where possible, followed by an explicitly unblinded lineage inspection.
They are not human preference scores. Two Chat outputs disclosed their own
refinement role, compromising blinding for those outputs. The analyst also
authored the candidate instructions and knew the model and scenarios.

| Case | Observation |
| --- | --- |
| Casual signoff | None of the treatments respected the request to continue tomorrow proportionately. The Artist asked for an emotional direction; baseline and combined asked for Project planning. The Engineer evaluated the Artist draft, exposed response construction, and supplied an unsolicited nostalgia interpretation. |
| Breathing library | The Artist supplied the strongest concrete conception in this review: central-aisle scale, compressed space, a paper scrim, wood/paper sounds, low-frequency pressure and silence at the peak. The Engineer selected a mystery branch the Artist had left open, but substituted metacritique and further questions for practical refinement. |
| Kite/weather Project | All four outputs supplied title, concept, style and invariants. The Engineer returned the Artist's entire Project byte for byte. The combined single pass was slightly preferred for developed style and flexibility, while still adding questionable camera-angle constraints to an invariant. |
| Suitcase storm | Every treatment retained the full-scale impossible transformation and fixed camera. The Engineer changed only one whitespace character in the Artist's prompt; missing dialogue notation remained. The ordinary single pass was preferred for committed appearance and tagged dialogue. |
| Handoff | The Engineer clarified the source/destination hands, but retained contradictory depth-of-field wording and changed `non_diegetic_music:` to the malformed `on-diegetic-music:`. The combined single pass gave the clearest release/receiving sequence in this review. |

The second stage did **not** automatically suppress the ambitious weather
concept: its scale, fixed camera, chosen appearance and sound were preserved.
Preservation is useful. In that case it was almost a no-op, with no demonstrated
added technical benefit. In the handoff, more explicit prose came with a format
regression. In Chat, the final text sounded like a reviewer evaluating another
assistant rather than one natural creative collaborator.

All four Project outputs supplied all requested field names. All eight Scene
outputs supplied one Scene with the requested duration and nonempty prompt.
Those transport/structure diagnostics do not establish complete instruction
fidelity or creative quality. Dialogue language markers and stable speaker-ID
notation remained imperfect. No output was discarded for those defects.

## Measured cost

| Strategy, same five cases | Requests | Prompt tokens | Completion tokens | Total tokens | Summed wall time |
| --- | ---: | ---: | ---: | ---: | ---: |
| Single pass | 5 | 3,809 | 2,706 | 6,515 | 44.3 s |
| Combined single pass | 5 | 4,119 | 2,606 | 6,725 | 41.8 s |
| Artist → Engineer | 10 | 11,463 | 5,293 | 16,756 | 97.5 s |

The entire pilot used **29,996 model-reported tokens**. These are the experimental
runtime's token receipts, not a measurement of Codex chat billing or a monetary
price. Pipeline totals include both stages, including the Artist draft supplied
again as Engineer input; the author would see only the final Engineer response.

For the casual signoff, baseline took 3.1 s and 606 tokens; the pipeline took
19.2 s and 1,668 tokens. For the ambitious fixed-camera Scene, baseline took
10.2 s / 1,836 tokens; pipeline took 20.0 s / 4,517 tokens for a whitespace-only
change to its own Artist draft. These are single observations, not latency
benchmarks. Wall time includes runtime initialization/loading when present;
warm starts were not standardized. Queue wait, browser rendering and save time
are not included. Runtime request-time sums were respectively 43.6, 41.1 and
96.1 seconds, close to the measured wrapper totals.

The combined single pass used about 3.2% more tokens overall, with mixed quality
effects and no clear overall winner. Its two preferred authoring cases motivate
careful selective use of that concept, not a validated new default.

## Wording tested

The complete frozen roles and medium knowledge are in
[packages.json](../experiments/studio_guidance/artist_mixer/packages.json).
The new focus passages were:

**Artist:**

> Develop one distinctive, ambitious proposal suited to the request. Commit to coherent artistic choices where the author leaves room. Treat unconventional ideas as opportunities to realize.

**Engineer:**

> You receive the author's request and one Artist draft. Give the author's deliberate choices priority. Refine the draft's execution while preserving its defining imagery, emotional intent, tone, scale, chosen technique and deliberate variations. Resolve concrete visual, spatial, performance, timing and sound ambiguities that weaken the intended result. Realize technically ambitious choices in service of their effect. Give the author one natural answer appropriate to this turn, or the complete requested Project/Scene fields. Return the draft unchanged when it already serves the request.

**Combined single pass:**

> Develop one distinctive artistic proposal and refine its execution before answering. Preserve its defining imagery, rhythm, emotional intent and the author's deliberate choices while making consequential visual, spatial and audiovisual details clear. Match refinement to the current task. Deliver one natural answer or the requested authored artifact.

These passages express hypotheses. Their attractive wording does not establish
that a model can execute the intended distinction; the observed outputs show
several concrete capability gaps.

## Recommendation and limits

Keep ordinary conversation single-pass. An unconditional technical stage adds
cost even to a goodbye and can displace the creative voice. The current pilot
does not support production adoption of the two-call sequence.

If the idea is pursued later, the smallest useful follow-up is **selective
refinement of an already-authored Scene with a concrete execution problem**.
WebCap already has an explicit `visual_direction` operation, its own editable
role, the existing H3 reference and an unchanged-result path. That is a plausible
entry point for a more faithful production specialist, with the Artist's actual
material kept visible and intact. It has not been compared here against this
experimental Engineer. No new turn classifier or general orchestration is needed
to evaluate that specific capability.

A genuinely complementary engineer might use a different model, a specialist
with verified technical competence, or better grounded medium knowledge. This
same-model pilot does not establish which would help. Temperature is an observed
experimental parameter, not evidence of guaranteed originality or precision.

There are no repeats, independent reviewers, larger-model comparisons or H3
renders. The available ComfyUI service was unavailable; textual analysis cannot
validate actual renderability. Small-model limitations are relative evidence
for this implementation, not the creative ceiling or a rejection of the analogy.
No human ratings were supplied, invented or required. **No more calls are queued.**

## Reproducibility and verification

Use [the protocol](../experiments/studio_guidance/artist_mixer/README.md) and
`scripts/studio_artist_mixer_eval.py`. The new three offline tests cover the
fixed call budget/lineage, exact original draft delivery, and preservation of
Artist/independent successes when the Engineer fails. The related offline
experiment suites passed 32 tests; CI runs tests and request plans only.

Ignored local evidence:

- `experiments/studio_guidance/runs/artist-mixer-gemma-20261123-02/`
- `manifest.json`, `trials.jsonl`, anonymous cards/key and `actual-results.json`
- `codex-blind-notes.json`, SHA-256 `cf11d3dbe289b7c894dab553cd53ab47b77ee9eaeed5bca4275484a94a17a9aa`
- The failed zero-inference preflight remains in `artist-mixer-gemma-20261123-01/`.

Production source hashes matched before/after all 20 calls, and the live app was
confirmed to serve Classic v3 with four profiles afterward. No raw responses,
keys, private configuration or inference logs are committed.
