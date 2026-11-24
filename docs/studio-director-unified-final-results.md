# Studio Director: final unified-guidance comparison

## Final recommendation

**Retain production Classic v3 as the established operational default. Do not
promote the proposed unified role from this comparison.** The unified treatment
was useful in conversation and Project development, and stayed appropriately
clinical in the restrained subject. It did not meet the predeclared consistency
bar for the imaginative authoring task: one repeat omitted the exact dialogue;
the other produced three five-second Scenes instead of one fifteen-second Scene.

Classic v3 is a fallback decision under mixed evidence, not a claim that it is
flawless or the best creative voice on every task. It kept the requested single
fifteen-second Scene in both imaginative repeats. Cleaned Current supplied the
best individual clinical response, but also split the imaginative Scene in one
repeat. All three treatments showed model unreliability on some deliberate
choices. No subject-specific prompt fixes were added after observing results.

**The fixed comparison is complete: 24 calls, no retries, no prompt-search
iterations and no more inference queued.** Production wording, four profiles,
settings, saved Projects/Scenes, Read/Write and queues remain unchanged. PR #1102
stays draft and unmerged pending review of this recommendation.

## Design and exact scope

Read AGENTS.md and the earlier charter, cleaned-profile and Artist/Engineer
documentation before preparing the experiment. The earlier draft-refinement
pilot did not cleanly isolate invention from technical realization; that separate
question and specialized Visual Direction were not reopened here.

| Treatment | Role characters | What was frozen |
| --- | ---: | --- |
| Production Classic v3 | 2,566 | Actual `balanced-v3-2026-11-23` role, including the existing coherence sentence. |
| Cleaned Current | 1,508 | Exact role from the preceding 18-call screen. |
| Proposed unified | 1,453 | Author's exact creative paragraph replacing Current's opening and editorial profile paragraph; cleaned material/collaboration retained. |

Four fresh briefs × three treatments × two repeats = **24 requests**:

1. Natural conversation: recommend lighting or a small human action for an
   understated dawn-pool film, in a few sentences.
2. Project: independent films about balance, with a recurring glass sphere and
   freedom for documentary precision, dry comedy and spectacular imagination.
3. Restrained Scene: a ten-second fixed close-up of a gauge-block measurement,
   neutral light, visible contact/needle behavior and quiet physical sounds.
4. Imaginative Scene: a fifteen-second, three-shot workshop-scale wooden sea,
   a ceramic whale returning to human hands, and exact dialogue.

The [protocol](../experiments/studio_guidance/unified_final/README.md),
[complete treatments](../experiments/studio_guidance/unified_final/packages.json)
and [briefs](../experiments/studio_guidance/unified_final/scenarios.json) were
frozen before inference. No cases or wording changed after outputs were seen.
The harness's `development` split name is bookkeeping; this was the final fixed
comparison, with no subsequent tuning or holdout round.

### Normalization and runtime

All treatments used the same **1,375-character production H3 toolkit** and the
unchanged technical H3 reference for Scene authoring. This preserves Classic's
actual knowledge and controls that variable. Cleaned Current's earlier toolkit
was 547 characters; this run retained its role but normalized its medium knowledge
to production. It therefore does not retest the earlier full cleaned package.

Production Classic's module wording was copied verbatim. The existing harness
strips module-ending whitespace when joining system modules; production retains
the trailing role newline. This known boundary-spacing difference is the only
assembly normalization of the production control.

All requests used the existing app job API and the same model:
`remote-1::mo-shakib/gemma4-e4b-uncensored:q4_k_m`.
Chat sampling was temperature 0.35 / top_p 0.9; structured Write used 0.2 / 0.85;
presence/frequency penalties were zero. The configured output cap stayed 16,384,
with no per-request overrides. Actual context was 8,192 in every receipt. All
24 returned `finishReason=stop`; no reasoning text or truncations were reported.
Shuffle seed 323 controlled order, not a model generation seed.

Original author messages, operation tasks and actual schemas matched across
treatments. Input hashes and queued message text were verified. Production file
and configuration hashes matched before/after the run. No saved creative state
was read into the fixtures or written by the experiment.

## Results: whole contribution and repeat consistency

These are **Codex qualitative observations**, recorded with treatment keys
unopened, then mapped to treatments. The analyst knew the model and cases and
had prepared the fixtures/candidates. This is anonymous review, not independent
human preference validation. No human scores were supplied, invented or required.

| Area | Classic v3 | Cleaned Current | Unified |
| --- | --- | --- | --- |
| Conversation | Both concise, natural, specific and relevant. | Both useful, with slightly preferred concrete examples. | Both useful and proportionate; no clear improvement over controls. |
| Project | Complete fields and correct motif in both; cinematic polish/tension sometimes overprescribes the range. | Complete fields in both; useful compositional identity, still some prescriptive palette/tension. | First repeat best accommodated varying moods in this review; second imposed universal charged/high-drama treatment. Both useful, mixed versatility. |
| Clinical Scene | Both neutral with correct duration, but both invent a second pair of hands; multiple timed labels and one shallow-focus choice weaken clarity. | One response was the strongest precise execution: one pair, single continuous interval, sharp contact/dial view. The other invents extra hands and has multiple labels. | Both preserve neutral clinical tone and a single continuous interval, with no added music/dialogue. Both invent a second pair of hands. |
| Imaginative Scene | Both keep one fifteen-second Scene. One omits the line; the other keeps it but underdevelops explicit audio and changes the leap/catch toward a floating drift. | One keeps one fifteen-second Scene and the words but lacks complete audio structure. The other splits the work into three five-second Scenes. | One keeps one fifteen-second Scene with rich sound/material detail but omits the line. The other splits it into three five-second Scenes. |

Every imaginative response retains the ambitious workshop-scale transformation;
the unified paragraph did not make the clinical task fantastical or add music.
Those are useful signs of broad scope. They do not cancel the observed omissions
or establish reliable complete authoring.

The prompts' additional hand pair is explicit wording, not a fabricated render
observation: five of the six clinical prompts say two pairs of hands, whereas
the brief describes the operation's right hand and both hands withdrawing.
Multiple `[Shot N]` labels under a stated fixed camera were treated as ambiguous
continuous-shot treatment, not proof of actual cuts. The clearest clinical output
was Current's second repeat. No render was produced to validate visual fidelity.

### Objective diagnostics, separate from judgments

Each entry below is out of two responses per task/treatment. Field presence alone
does not establish meaningful content; exact words alone do not establish proper
dialogue notation or audiovisual realization.

| Diagnostic | Classic v3 | Cleaned Current | Unified |
| --- | ---: | ---: | ---: |
| Project title/concept/style/invariants present | 2/2 | 2/2 | 2/2 |
| Clinical reply: one ten-second Scene | 2/2 | 2/2 | 2/2 |
| Clinical prompt explicitly introduces two hand pairs | 2/2 | 1/2 | 2/2 |
| Imaginative reply: one fifteen-second Scene | 2/2 | 1/2 | 1/2 |
| Imaginative exact words `Easy, now.` present | 1/2 | 2/2 | 1/2 |

The twelve Scene requests returned **16 actual Scene records**, all retained.
Both extra-record responses contain three supported five-second durations whose
sum is fifteen seconds, but they do not satisfy the requested single clip.
Some per-clip prompts also retain global shot times or incompletely restate
identity, increasing correction effort. The schema intentionally accepts useful
multiple Scenes; these are unmet author intent, not parser/application failures.
No restrictive parser, repair invocation or rejection mechanism was introduced.

## Actual tokens and time

Totals cover eight requests per treatment, the same four cases twice.

| Treatment | Prompt tokens | Completion tokens | Total tokens | Elapsed job/poll time | Runtime request time |
| --- | ---: | ---: | ---: | ---: | ---: |
| Classic v3 | 9,676 | 9,514 | 19,190 | 162.0 s | 157.5 s |
| Cleaned Current | 8,124 | 9,483 | 17,607 | 170.2 s | 165.3 s |
| Unified | 8,044 | 9,597 | 17,641 | 163.8 s | 157.2 s |

The run used **54,438 model-reported tokens**: 25,844 prompt and 28,594 completion
tokens. Summed elapsed time was 495.9 seconds; runtime request time was 479.9.
These are experimental runtime receipts, not Codex chat billing or monetary cost.
Job/poll time includes API/poll overhead and any queue wait. Warm/cache conditions
were not standardized, so these times do not establish a speed ranking.

Unified saved about 8.1% total tokens relative to Classic, principally through
shorter input, with similar completion volume. Its total was effectively the same
as cleaned Current. Lower input cost did not establish the required reliability.

## Exact proposed wording and recommended production changes

The unified creative paragraph was used exactly as supplied:

> Develop the author's vision with imagination and discernment. Recognize what makes the concept compelling, preserve deliberate choices and extrapolate where the direction is open. Strengthen the intended experience through focused composition, expressive movement, deliberate pacing, sound and dialogue.

It was followed by the retained WebCap material paragraph and this cleaned
collaboration paragraph, with no additional editorial/personality instruction:

> Talk naturally and proportionately: brief comments merit a brief response; substantial requests merit developed ideas or complete drafts. Ask a focused question for a consequential unresolved choice; otherwise offer a practical direction. Use supplied Project and Scene facts as context and develop unsaved brainstorming. WebCap saves Project and Scene fields through the author's explicit Write actions.

The complete material definitions, role wording and shared medium knowledge for
all three treatments are in the frozen packages file. The exact recommended
existing role is also readable in the earlier
[full Classic wording](studio-director-creative-charter-results.md#full-classic-role-wording).

For production review, recommend:

1. **Keep Classic v3's existing wording.** Its consistent single-clip packaging
   makes it the established operational fallback under these mixed results.
   This choice acknowledges Current's strong clinical sample and Classic's own
   dialogue/audio/hand-count defects; it is not a universal creative ranking.
2. **If consolidating the product to one Director, use that existing role**
   rather than promoting another unproven personality. Keep saved custom texts
   and stable module/API identities available through an explicit compatibility
   plan; UI simplification must preserve authored overrides. This is a proposed
   change for review, not an implementation in this PR update.
3. Keep H3 medium knowledge, technical reference, operation contracts, sampling,
   Read/Write and saved creative state unchanged. Leave subject-specific choices
   in briefs and ordinary editing/retry available for observed individual faults.

The final stopping rule is satisfied. There are no further phrase ablations,
new role variants, specialist passes, agents or automatic refinement calls.

## Limits and evidence

Four cases, two repeats and one smaller model support a practical relative
decision, not statistical superiority or a creative-quality ceiling. The
observed failures are not causally attributable to a particular phrase. Shared
task/schema framing and model limitations may contribute. Clinical clarity,
realism and restraint were evaluated on their own terms, equally with ambitious
expression. ComfyUI was unavailable, so actual H3 renderability remains untested.

Local ignored evidence is under
`experiments/studio_guidance/runs/unified-final-gemma-20261123-01/`: manifest,
24 raw receipts, anonymous cards/key, pre-key and post-key notes,
`actual-results.json` and `criterion-diagnostics.json`. No raw responses or
private configuration are committed.

Pre-key notes SHA-256:
`5651fdf7fa23abb930b22aa36a2ca53f7d9048914b958b1af271a01628bc9f71`.
Package hashes:

```text
Classic v3       f4781c8c8c6c91a84e113696c64f2b725275ec7e99a1c567a757b9dc079c19e8
Cleaned Current  814ca48e45102e771a824e458fa3681aad6f07a8226811b97db1ebda341c2ce1
Unified          1509dfae3493aacb1bc435ef33bf9bf2c297849bd534363ede557e4d61186096
H3 reference     7e717b14a5ed6783d7cfed42c7bc2e3d0a5076d50dac525a676056f359a7ed71
```

After the comparison, main added source-grounded adaptive context (PR #1108).
The draft branch was synchronized, retaining that feature and the existing
fast-completion receipt fix. Two equivalent test-selector conflicts used main's
versions. Offline replay through the new context assembler verified that **all
24 recorded requests remain verbatim**; no inference was repeated. A regression
test preserves that integration boundary. Guidance and the experimental inputs
were unchanged.

Offline validation passed **35 experiment tests**; the expanded context/receipt
selection passed **47 Python tests**, and the related Node suite passed **235
tests with one existing skip**. CI runs tests and request
plans only. The running app was verified afterward as Classic v3 with four
profiles; no production change or merge was made.
