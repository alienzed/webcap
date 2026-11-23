# Studio Director: charter findings and default refinement

**Result, 23 November 2026:** retain D as the working foundation and add one
general coherence sentence to the default Classic profile. The running app now
serves that wording. The broader charter variants did not establish a universal
creative winner; the compact rewrite was rejected after a concrete completion
regression. This is a modest engineering refinement, not a claim of validated
creative superiority.

The author initially requested an isolated experiment, then explicitly requested
applying the lessons to the real default, with practical adherence and usability
given greater weight. The three-way experiment remained fixed throughout. The
subsequent implementation checks were separate and are identified below.
**None of PR #1099's established 86 calls was repeated.**

## Applied wording

Classic retains its entire D role, WebCap definitions, collaboration rules and
profile emphasis, then adds:

> Envision the work as a fully realized experience; give its chosen elements coherent form and relationships.

This is 108 additional characters including the newline: 2,566 role characters
versus D's 2,458. Classic is version `balanced-v3-2026-11-23`. Current, Imaginative
and Render-focused retain their previous text and versions byte for byte. The
H3 toolkit, authoring reference, operation tasks, response schemas, parsing,
saved Projects/Scenes, settings overrides and queue/GPU semantics are unchanged.

The default's role-plus-toolkit package hash is
`f4781c8c8c6c91a84e113696c64f2b725275ec7e99a1c567a757b9dc079c19e8`.
The [source](../tool/server/studio_guidance_defaults.py) remains the runtime owner;
the full role wording appears at the end of this report.

## Safe phases completed

1. **Audit:** checked root AGENTS.md, actual Chat/Write tasks and schemas, the
   harness, tests, guidance ownership and profile boundaries. Commit `a8031b86c`
   fixed a failing synthetic fixture, cross-model review-assignment leakage,
   missing Project/error context in cards, ambiguous package-win labels, and
   conflation of ties with both-unusable outcomes. Its offline CI passed.
2. **Compare:** used real Director jobs, frozen inputs, fresh development and
   held-out briefs, two repeats and separate model groups. Retained useful partial
   results. No Project/Scene persistence or rendering endpoint was invoked.
3. **Refine:** rejected a larger rewrite after its practical check. Ran a separate,
   bounded single-sentence addition check while retaining D verbatim. Reused
   development probes are explicitly distinguished from held-out evidence.
4. **Integrate:** changed only Classic's sentence/version; froze historical D
   sources before changing the default; tested actual app guidance and restarted
   the identified idle server. Read-only HTTP checks verified the served wording,
   other profiles, H3 reference and preserved local app queue pause flags.

The final related offline suite passed **73 tests**; compile checks passed.
CI remains offline: pure harness tests and request plans, with no model endpoints,
inference calls or saves. The PR remains draft and unmerged.

## Actual calls and models

| Stage | Gemma | Nullguard | Total |
| --- | ---: | ---: | ---: |
| Alternative-model feasibility, Chat/Project/Scene | 0 | 9 | 9 |
| Original three-way development | 72 | 72 | 144 |
| Original three-way held-out | 24 | 24 | 48 |
| Separate compact-default rewrite check | 12 | 12 | 24 |
| Separate single-coherence-sentence check | 12 | 12 | 24 |
| **Total new calls** | **120** | **129** | **249** |

Exact model IDs:

- `remote-1::mo-shakib/gemma4-e4b-uncensored:q4_k_m`
- `remote-1::h4rithd/nullguard:latest`

Nullguard was discovered through the running Director and demonstrated usable
Chat, Project and Scene output in its nine-call pilot. Missing Style in two pilot
Projects did not erase their usable concepts/invariants or trigger repair calls.
It is an accessible alternative, not a claimed larger or stronger model. Gemma's
accessibility was already established; its old comparison was not repeated.

All **249 requests completed**, with received finish reason `stop` and context
8,192. The configured output cap was 16,384, with context selection left to the
runtime. Chat sampling used temperature 0.35/top-p 0.9; Project/Scene used
0.2/0.85; presence/frequency penalties were zero. No model configuration was
changed. Requested limits are not actual token use or proof of completion.

Order seed 84 governed the original experiment; seed 113 governed the later
development probes. Neither is a generation seed. These ordinary repeated trials
are exploratory within-model comparisons, not a significance or noninferiority
study. Small-model limitations do not define the creative ceiling.

## Original three-way design and diagnostics

Each model received three arms on 12 fresh development briefs and four held-out
briefs, twice per arm. The nine feasibility calls are excluded from the balanced
192-call main comparison.

| Arm | Treatment | Role characters | Extra charter characters |
| --- | --- | ---: | ---: |
| `d-frozen` | Unchanged Classic D | 2,458 | 0 |
| `d-plus-core` | D plus the creative charter | 2,458 | 536 |
| `consolidated-core` | Charter replaces overlapping introduction/scope/Classic emphasis | 1,860 | 0 |

All arms shared the same H3 toolkit/reference, author messages, fixtures, tasks,
operation and response schemas. Consolidated retained D's WebCap material and
collaboration sections verbatim. It changes several creative instructions at
once, so its effects cannot identify a winning phrase.

| Model / split | Calls completed | Write JSON | Projects with all fields present | Scene duration field matches request |
| --- | ---: | ---: | ---: | ---: |
| Gemma development | 72/72 | 54/54 | 18/18 | 36/36 |
| Gemma held-out | 24/24 | 18/18 | 5/6 | 12/12 |
| Nullguard development | 72/72 | 54/54 | 3/18 | 32/36 |
| Nullguard held-out | 24/24 | 18/18 | 1/6 | 12/12 |

Every Scene reply in the main comparison contained one record with a nonempty
prompt and a duration in the supported 4–15s range. This does **not** establish
complete timed action, correct notation, actual renderability or quality. All
Project omissions were the separate Style field; one of Nullguard's three
field-complete development Projects supplied only the Style label as its value.
Field presence therefore overstates meaningful delivery. Useful partials remain
retained. Valid JSON and a completed job are insufficient success criteria.

## Whole-contribution observations

These are **Codex's unscored qualitative observations**, including package-blind
inspection. They are not human preference ratings.

| Dimension | Observed pattern | Implication |
| --- | --- | --- |
| Imagination | Arms frequently converged on the same theatrical-chef gag, luminous alien botany, dusty melancholy and conventional cinematic light. | No broad new class of invention was demonstrated by adding or consolidating the charter. |
| Artistic judgment | All Gemma held-out critique replies affirmed an overloaded eight-second proposal; Nullguard acknowledged risk but mostly accommodated it or delegated the choice. | Confidence and cohesion language do not establish independent discernment. Preserve the working editorial role rather than assume an inspirational rewrite improves it. |
| Audiovisual conception | Many useful sound/image relationships across all arms; local gains in fixed-shot piano conception, shared relief and mechanical counterpoint. | Assess the conceived experience, not adjectives or length. Quiet and dense work can both be successful. |
| Coherence | Clear continuous action sometimes improved with less prose; extra shot labels, contradictory camera instructions and unmotivated sound sources also appeared. | A complete inventory is not the same as elements working together. |
| Deliberate-choice fidelity | One D dialogue omitted a line; an additive museum draft omitted the loop; a consolidated piano draft showed orchestral figures in an intentionally empty space; four Nullguard durations changed15s to12s. | Local failures cross arms. Preserve usable work and expose unmet intent; none justifies a universal charter winner or scene-specific rule growth. |
| Collaboration | Long menus, repeated explanations and closing questions persisted. Consolidated Gemma sometimes imposed Project/Invariants formatting on a casual Chat pitch. | Shorter text alone did not produce consistently natural, proportionate collaboration. |

The additive arm staged shared relief well in Gemma's dialogue repeats and kept
both Nullguard dance repeats at15s, where D changed them to12s. The consolidated
arm offered clearer Gemma piano holds and more meaningful Nullguard Project
Style content, but those strengths did not transfer reliably: its Nullguard
piano could introduce people, and one dialogue used malformed speech tags.
Held-out Project maps also tended to add unrequested global mood/lighting/tableware
rules, narrowing deliberate variation. These are mixed local effects.

**Verdict:** neither full charter treatment established a broadly stronger
creative Director. This does not disprove an ambitious creative charter or
justify treating small models as the desired quality ceiling. D remains the
strongest defensible foundation for the practical default decision here.

## Was it just more text?

Average received characters, ordered **D / additive / consolidated** within each
cell. Length is a diagnostic, not a quality score.

| Model / split | Chat | Project | Scene |
| --- | --- | --- | --- |
| Gemma development | 4081 / 3742 / 3237 | 2372 / 2387 / 2640 | 2257 / 1900 / 2246 |
| Gemma held-out | 3246 / 3878 / 3126 | 2644 / 2719 / 3016 | 2263 / 2054 / 2584 |
| Nullguard development | 2884 / 2717 / 2311 | 1398 / 1387 / 1614 | 1649 / 1708 / 1718 |
| Nullguard held-out | 3154 / 2056 / 2413 | 1390 / 1570 / 1402 | 1651 / 1563 / 1828 |

The charter is not merely an expansion: consolidated Chat usually shrinks, while
Projects and some Scenes grow; additive Chat grows on Gemma held-out. There is no
single verbosity effect, and no consistent creative-quality gain follows length.

## Separate default checks and the selected sentence

After the author requested a practical default update, a compact rewrite was
tested on three fresh development probes: critical florist Chat, a flexible
fabric-film Project and continuous pottery work. Two arms, two repeats and two
models produced24calls. It preserved the functional/collaboration text and Classic
emphasis, but changed creative wording. On Gemma, both rewrite potter drafts
omitted requested progression, including one with only0–4s authored for a13s
Scene; both D drafts completed shaping and hands-off. Nullguard completed all
four Scene progressions but still omitted or returned placeholders for Style.
The rewrite was **not adopted**. Attractive statements about usable delivery did
not substitute for actually delivering it.

A bounded follow-up then compared D with D plus the single coherence sentence,
using **the same declared development probes**, two repeats and both models:
24morecalls. These are reused post-selection development cases, not fresh
holdouts. All eight Scene drafts in that follow-up completed the physical
progression; the addition had no repeated omission like the rejected rewrite.
It yielded a clean continuous Gemma interpretation and developed physical sound
in both Nullguard replies. Baseline drafts were also largely useful. Projects
remained similar; all four Nullguard Projects still omittedStyle, while Gemma's
four provided it. Chat remained wordy across arms.

The isolated sentence is therefore a **small, goal-consistent engineering
refinement with limited local support**, not a validated causal improvement in
general creativity or fidelity. Its merit is that it expresses the distinctive
whole-experience concept without replacing D's useful role or adding subject,
shot-count, prop, dialogue or model-specific requirements. The tested default
role text matches the applied module byte for byte.

One new-probe diagnostic was corrected: it initially said only work/room audio,
but the actual potter brief asked those sounds to carry the experience and did
not prohibit music. Added scores were not counted as literal violations. The
[erratum](../experiments/studio_guidance/default_candidate/diagnostic-erratum.md)
changes diagnostic source metadata only; original manifests, cards, requests,
responses and assignments remain intact. No extra call was made for that correction.

## Reproducibility, boundaries and review limits

Frozen original package hashes:

```text
D                 7861b0cce4980a6343d0edea254825177c66cd7ef720cb342b71573a5e0a4681
D plus charter    7f8e73eed78205e777a50e834fd0b92b86d02b886fbe020c904d1581911594b7
Consolidated      6b4c2de48fd4a7a006071610761b5a9f2d79c868f362fb6ba48ca6cb3abe3b47
Original cases    a733ed8bb6593e7fe6b922111ec50d4469a5416d70fb82c3a93ddb92fb3a502a
H3 reference      7e717b14a5ed6783d7cfed42c7bc2e3d0a5076d50dac525a676056f359a7ed71
```

D matches PR #1099's established control hash. Before the production refinement,
13 repository-default references across the four archival designs were replaced
with a [frozen source snapshot](../experiments/studio_guidance/frozen-d-20261122.json).
Every resolved package stayed identical; a test proves later production-default
changes cannot move those controls. Historical scenarios/addenda and receipts
are preserved. New snapshot loading is confined to the offline experiment harness.

All249actual receipts were checked for frozen guidance/reference, reconstructed
input hashes and equality with the actual queued messages. The three actual
response schemas also match across all arms/models. The experiment runner
normalizes module-boundary whitespace; the app preserves it. Module wording is
identical, but the harness is not a byte-for-byte copy of the app's boundary
spacing. Live verification uses the app's actual composition.

Codex knew model/scenario identity. Independent randomized review assignments
were generated per run, and unscored notes saved/hashed before opening keys.
One Gemma development paper-world additive response was accidentally exposed
with identity during receipt inspection; its subsequent observations are marked
as not blind. The same analyst authored the candidate and assessed results, so
these are exploratory observations, not independent preference validation.

**No human ratings were supplied or invented.** The harness's optional blank
review workbooks are available if wanted; the author was not asked to complete
them, and they were not a prerequisite for the requested implementation. The
decision here uses actual diagnostics and explicitly labeled Codex judgment.

The restarted running app was verified to serve the selected Classic module,
preserve other profiles/H3 reference, preserve local app queue pause flags, and
have zero active app jobs. Guidance is fetched for each new Studio request, so
browser refresh or replacement of unsaved work is unnecessary. No guidance
override was written. **ComfyUI reports unavailable**, so no H3 renders were
performed and no rendered-quality or physical-reliability claim is supported.

## The four profiles and useful next tests

| Profile | Decision | Possible later test |
| --- | --- | --- |
| Classic | Keep D and add the checked general coherence sentence. | Broader fresh transfer and matched renders when available. |
| Current | Entire existing editorial text/version retained. | Its own baseline versus a targeted independent-judgment refinement, preserving posture. |
| Imaginative | Entire bold/inventive text/version retained. | Purposeful novelty across unrelated subjects, without reducing ambition. |
| Render-focused | Entire production text/version retained, including intended ambition/density. | Whole-experience coherence versus its own baseline, with actual renders. |

The Classic-based study cannot validate changes to all four personalities. The
[separate follow-up designs](studio-director-creative-charter-followups.md) cover
conceptual-clause ablations and two contrasting quality examples. No examples
were inserted or called author-approved. A different useful strategy is an
intention-contrast suite: same subject/different intended experience, then
different subjects/same principle. That tests abstract responsiveness instead
of success on particular scene ingredients. No further calls are queued here.

## Retained local evidence

Exact requests, receipts, immutable manifests, review cards/keys, sealed blind
notes, post-key notes and verification reports are retained under ignored
`experiments/studio_guidance/runs/`:

- `charter-nullguard-chat-probe-20261123-01` and `charter-nullguard-write-pilot-20261123-01`
- `charter-gemma-dev-20261123-01` and `charter-nullguard-dev-20261123-01`
- `charter-gemma-holdout-20261123-01` and `charter-nullguard-holdout-20261123-01`
- `default-candidate-gemma-20261123-01` and `default-candidate-nullguard-20261123-01`
- `coherence-gemma-20261123-01` and `coherence-nullguard-20261123-01`

`charter-audit-20261123-01/actual-results.json` records all249receipt checks;
`live-default-verification.json` records the activation checks. Readable blind
pair packets are derived copies; keep private keys and analyst notes separate
from anyone seeking an independent review. Raw model responses are not committed.

## Full Classic role wording

This is the active role wording, with paragraph spacing added for reading. H3
medium knowledge and the Scene-only authoring reference remain separate modules.

> STUDIO DIRECTOR | CREATIVE PARTNER

> You are the author's imaginative, discerning creative director and AI-video production collaborator. Understand the author's vision, taste and constraints; help develop and realize it with strong artistic judgment and original, practical ideas. Contribute confidently: explore possibilities, recognize weaknesses, offer meaningful improvements and recommend a choice when it helps. Make routine creative decisions independently while keeping the author's intended concept and deliberate choices at the center.

> CREATIVE SCOPE: Work in the visual and audiovisual language appropriate to the idea: composition, performance, movement, stillness, dialogue, editing, sound, music, atmosphere and contrast. Projects can be narratives, montages, thematic collections, experiments, repeated formats, parallel moments or independent clips. Let the author's concept determine which techniques and relationships matter.

> WEBCAP MATERIAL: A Project has a Title, Concept / overview, Visual / atmosphere and Invariants. Concept expresses the premise, appeal, overall structure and relationships between Scenes. Visual / atmosphere expresses the shared visual identity and mood. Invariants describe deliberately stable recurring subjects, locations and world details; individual Scenes carry their own actions, props and intended variations. Propose distinctive visible traits or defining layouts when recurring consistency matters. Each Scene has a Title, duration and a complete generation Prompt, and is rendered independently; when Scenes connect, each prompt establishes any important visible starting conditions.

> COLLABORATION: Talk naturally and proportionately. Brief comments merit a brief, useful response; substantial requests merit developed ideas or complete drafts. Be specific, constructive and willing to challenge an idea productively. Ask a focused question for a consequential unresolved choice; otherwise offer a practical direction. Use Project and Scene facts supplied in the conversation as context and treat unsaved brainstorming as material to develop. Conversation can explore or draft creative content; WebCap saves Project and Scene fields through the author's explicit Write actions.

> PROFILE | CLASSIC

> Be a versatile creative partner: inventive when invention adds value, precise when clarity matters, and direct in discussion. Find the strongest expression of the author's idea without imposing a house style.

> Envision the work as a fully realized experience; give its chosen elements coherent form and relationships.
