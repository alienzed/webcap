# R04 — In-context learning and examples

Status: initial evidence notes, 2026-11-27. Documentation only; no product changes, prompt rewrites, additional experiments or runtime validation authorized. See the [research index](README.md) and [bibliography](references.md).

## Scope and method

What demonstrations communicate: target format, task distribution, choice of examples, order and the boundary between examples and evidence.

Targeted first-pass review of primary publication records and abstracts, plus relevant developer guidance where explicitly marked. Source findings are bounded to the studied models and tasks. This is not a systematic or full-text review and does not establish WebCap-specific effectiveness.

## Published evidence

- [P49](https://aclanthology.org/2022.emnlp-main.759/) — In classification and multiple-choice tasks across 12 models, Min et al. found that replacing demonstration labels randomly often had little effect. The label space, input distribution and sequence format mattered. This is not permission to give incorrect examples: it is evidence that demonstrations serve several different functions.
- [P50](https://aclanthology.org/2022.acl-long.556/) — Lu et al. found major differences when changing only the order of a few examples. Effective permutations did not reliably transfer across models. Their experiments concern text classification rather than creative production.
- [P51](https://aclanthology.org/2022.deelio-1.10/) — Liu et al. studied selecting semantically similar examples for GPT-3 rather than sampling them randomly. Example choice was consequential; the study is not a guarantee that retrieval or additional examples help a different task.
- [P17](https://arxiv.org/abs/2310.11324) — Equivalent few-shot formats can produce materially different results across models; see [R01](R01-prompt-structure.md).

## Feature connections

The following are relevance mappings to the existing feature contracts, not approved changes or proof that the current implementation follows the research.

| WebCap feature / reference | Research relevance |
| --- | --- |
| [Caption Assist / Caption Template Assist](../../tool/server/caption_ops.py) | A populated Primer or approved example demonstrates structure, while current item evidence establishes content. Does the demonstration show useful connective wording and order without copying unrelated attributes? |
| [Director Chat and Project/Scene Write](../studio-director-contract.md) | A creative example can communicate desired deliverable, level of detail or field purpose; it is not necessarily a fact about the current Project. |
| [Generate Director](../llm-guidance-architecture.md) | A model-specific example can illustrate useful prompt form, but its subjects and style should not accidentally become universal requirements. |

## Synthesis for later consideration

Examples are part of the model's instruction surface. Their role, representativeness and ordering matter; more examples are not automatically better. Separate illustrative form from the actual subject/task.

## Open applicability questions

Direct evidence for exemplar number, order and selection in small local models writing H3 prompts or applying a Set's exact caption vocabulary is missing. No new example corpus, retrieval mechanism or prompt rewrite is authorized.
