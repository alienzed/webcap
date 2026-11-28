# R08 — Human-AI collaboration

Status: initial evidence notes, 2026-11-27. Documentation only; no product changes, prompt rewrites, additional experiments or runtime validation authorized. See the [research index](README.md) and [bibliography](references.md).

## Scope and method

Human-AI co-authoring, conversational proportionality, clarification, advice and explicit action boundaries.

Targeted first-pass review of primary publication records and abstracts, plus relevant developer guidance where explicitly marked. Source findings are bounded to the studied models and tasks. This is not a systematic or full-text review and does not establish WebCap-specific effectiveness.

## Published evidence

- [P58](https://doi.org/10.1145/3290605.3300233) — Amershi et al. developed human-AI interaction guidelines through a multi-stage process, including making capabilities understandable, supporting correction and maintaining user control. These are broad interaction guidelines rather than prompt recipes.
- [P59](https://doi.org/10.1145/3490099.3511105) — Wordcraft's short-story user study found LLMs useful for discussing writing, responding to custom edits and unblocking creative work. It is a closer task analogue to Director Chat than a factual QA benchmark, but concerns prose rather than generated video.
- [P60](https://arxiv.org/abs/2201.06796) — CoAuthor recorded 1,445 creative and argumentative writing sessions with 63 writers and four GPT-3 instances. The study emphasizes that what counts as good collaboration depends on task, context and the author's aims.
- [P89](https://aclanthology.org/2025.findings-naacl.306/) — Clarify When Necessary frames questioning as a trade-off between the cost of interruption and uncertain intent. Experiments across QA, translation and NLI show benefits from identifying cases worth clarifying, not from asking questions on every turn.
- [P31](https://arxiv.org/abs/2505.06120) — Multi-turn performance can deteriorate as early assumptions persist; see [R02](R02-context-engineering.md).

## Feature connections

The following are relevance mappings to the existing feature contracts, not approved changes or proof that the current implementation follows the research.

| WebCap feature / reference | Research relevance |
| --- | --- |
| [Studio Director Chat](../studio-director-contract.md) | Discussion, critique, ideation and full authored responses are distinct conversational requests. Brief focused clarification can preserve intent when a consequential choice is unresolved. |
| [Action Advisor](../studio-action-advisor-mvp.md) | A proposed next action is advice, not authorization. The existing user action still controls execution. |
| [Set Intelligence / Ask QA](../set_intelligence.md) | Short focused exchanges can help resolve an issue without creating an autonomous task or another mandatory workflow. |
| [Caption Template and Wildcard assistance](../../README.md) | Task-centered conversations may refine a specific artifact while leaving its review and application explicit. |

## Synthesis for later consideration

Useful assistance respects the user's actual objective, authorship and ability to correct it. The interaction should match the task's depth; clarification is a trade-off rather than a universal requirement. These findings are compatible with existing product values, not proof of a particular interface.

## Open applicability questions

No direct research establishes the best number of turns, modal/drawer layout, response length or degree of initiative for this user's WebCap workflows. Do not consolidate UI or change Director behavior in this pass.
