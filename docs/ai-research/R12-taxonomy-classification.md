# R12 — Taxonomy and semantic classification

Status: initial evidence notes, 2026-11-27. Documentation only; no product changes, prompt rewrites, additional experiments or runtime validation authorized. See the [research index](README.md) and [bibliography](references.md).

## Scope and method

Discovering a useful vocabulary, organizing concepts, applying existing terms, handling synonyms and allowing multiple applicable labels.

Targeted first-pass review of primary publication records and abstracts, plus relevant developer guidance where explicitly marked. Source findings are bounded to the studied models and tasks. This is not a systematic or full-text review and does not establish WebCap-specific effectiveness.

## Published evidence

- [P70](https://arxiv.org/abs/2303.05657) — Tag2Text learns tags from paired texts and uses them to guide visual-language pretraining. The reported gains support the usefulness of semantic tagging, but come from a trained architecture, not a general LLM applied to cached Sight.
- [P71](https://arxiv.org/abs/2306.03514) — Recognize Anything learns broad tagging categories with image-text supervision, annotation refinement and a higher-quality fine-tuning set. Its results show the value of vocabulary coverage and data quality, not perfect recognition of arbitrary specialist tags.
- [P72](https://aclanthology.org/2024.naacl-long.164/) — TopicGPT uses language-model prompts to create interpretable topic names and descriptions. It reports stronger alignment with human categories on its text datasets than its comparison methods. Topics in a text collection are not necessarily visual attribute groups.
- [P86](https://aclanthology.org/2026.emnlp-main.1502/) — SPARROW studies large hierarchical taxonomy induction, finding that partition-and-merge approaches need to preserve structural relations. This is relevant to synonym and group consolidation questions, but WebCap's scoped vocabulary is not necessarily a strict hierarchy.

## Feature connections

The following are relevance mappings to the existing feature contracts, not approved changes or proof that the current implementation follows the research.

| WebCap feature / reference | Research relevance |
| --- | --- |
| [Discover Vocabulary](../vision_schema_assist.md) | Discovery aims to surface missing distinctions, while existing group and term review lets the author decide the actual vocabulary. Evidence counts and observed wording can inform, not define, categories. |
| [Guided / Single Item Tag Assist](../set_intelligence.md) | Assignment is a separate multi-label task using current groups and terms. An exact allowed label can still be wrongly assigned. |
| [Caption Template Assist](../../tool/server/caption_ops.py) | A group can encode a mutually exclusive choice, a set of coexisting attributes or an optional visible feature. Do not infer exclusivity or required presence from group membership alone. |
| [Media Explorer](../media_explorer_design.md) / [Curate](../qa_training_set_curation_plan.md) | Prompt-derived tag suggestions and training-concept groupings have different provenance. Synonyms, aliases, co-occurrence and visual absence are different phenomena. |

## Synthesis for later consideration

Vocabulary induction and applying a vocabulary have different information requirements. Interpretability, meaningful distinctions, multi-label membership and evidence provenance matter more than collapsing everything into a small taxonomy.

## Open applicability questions

No reviewed study establishes WebCap-specific taxonomy granularity, whether groups should be exclusive, or optimal handling of rare visual attributes and absent groups. No automatic taxonomy merge or retagging is authorized.
