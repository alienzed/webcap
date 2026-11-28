# R07 — Critique and revision

Status: initial evidence notes, 2026-11-27. Documentation only; no product changes, prompt rewrites, additional experiments or runtime validation authorized. See the [research index](README.md) and [bibliography](references.md).

## Scope and method

Explicit requests to edit authored material; critique, actionable feedback, external evidence and preservation of unaffected content.

Targeted first-pass review of primary publication records and abstracts, plus relevant developer guidance where explicitly marked. Source findings are bounded to the studied models and tasks. This is not a systematic or full-text review and does not establish WebCap-specific effectiveness.

## Published evidence

- [P10](https://arxiv.org/abs/2303.17651) — Self-Refine reported average improvements on seven diverse tasks when an LLM provided feedback and refined its output iteratively. It measured a specific procedure and model set, not all self-review.
- [P11](https://arxiv.org/abs/2310.01798) — Huang et al. found that intrinsic reasoning self-correction without external feedback could fail or worsen performance. This qualifies positive self-refinement results; neither study supports universal automatic critique.
- [P57](https://arxiv.org/abs/2305.09857) — CoEdIT trained a task-specific editing model on diverse edit instructions. It generalized to unseen and composite editing tasks and was preferred by writers in its evaluated comparisons. The model was trained for editing; prompting an arbitrary model is not equivalent.
- [P58](https://doi.org/10.1145/3290605.3300233) — Human-AI interaction guidance addresses correction, user control and recovery from errors. This is interaction design evidence, not a finding that a suggested edit is correct.

## Feature connections

The following are relevance mappings to the existing feature contracts, not approved changes or proof that the current implementation follows the research.

| WebCap feature / reference | Research relevance |
| --- | --- |
| [Caption Assist](../../tool/server/caption_ops.py) | A saved caption is an authored draft. A revision can improve phrasing or add grounded detail while leaving unaffected facts and style intact. |
| [Deep QA corrections](../progressive_deep_qa.md) | A finding, evidence, proposed correction and user acceptance are different outcomes. Valid alternative edits need not be all accepted or rejected together. |
| [Studio Prompt Assist / Project Deep QA](../studio-prompt-assist-project-deep-qa.md) | A focused issue and an actionable candidate fix can be useful without another approval gate. Project-level critique and one-Scene revision address different scopes. |
| [Generate and Visual Direction](../llm-guidance-architecture.md) | Explicit revision intent is the scope; a rewritten prompt is a proposal or requested authored result, not evidence that the renderer will improve. |

## Synthesis for later consideration

Revision is useful as an independent task with an explicit goal and relevant evidence. The research contains conflicting results for self-correction, so it cannot justify adding compulsory review, self-validation or repair passes.

## Open applicability questions

Direct comparative evidence for targeted partial edits versus full rewrites of WebCap captions and production prompts remains limited. No changes to review UX, mutation semantics or prompt guidance are authorized.
