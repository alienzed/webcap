# R11 — Caption supervision for generative training

Status: initial evidence notes, 2026-11-27. Documentation only; no product changes, prompt rewrites, additional experiments or runtime validation authorized. See the [research index](README.md) and [bibliography](references.md).

## Scope and method

The training caption as supervision: accurate visual details, relevance to the intended learned concept, density, identifiers and variability.

Targeted first-pass review of primary publication records and abstracts, plus relevant developer guidance where explicitly marked. Source findings are bounded to the studied models and tasks. This is not a systematic or full-text review and does not establish WebCap-specific effectiveness.

## Published evidence

- [P66](https://cdn.openai.com/papers/dall-e-3.pdf) — The DALL-E 3 technical report describes training on more descriptive synthetic image captions and reports improved prompt following. This is developer-reported large-scale training evidence, not a prescription for every fine-tuning set.
- [P67](https://arxiv.org/abs/2310.00426) — PixArt-alpha combines architecture/training changes with dense pseudo-captions to improve text-image learning. Its results support the relevance of informative image-text pairs, not caption length as an isolated universal cause.
- [P87](https://www.krea.ai/blog/krea-2-technical-report) — Krea's technical report describes rich caption supervision and varied caption lengths/formats, reporting faster convergence with dense captions while retaining exposure to shorter prompts. This is particularly relevant model-developer evidence for Krea 2, but primarily describes its own large-scale training.
- [P68](https://openaccess.thecvf.com/content/CVPR2023/html/Ruiz_DreamBooth_Fine_Tuning_Text-to-Image_Diffusion_Models_for_Subject-Driven_Generation_CVPR_2023_paper.html) — DreamBooth associates a unique identifier with a subject and uses prior-preservation training to retain flexibility. It supports separating a target concept from surrounding context in personalization, but does not prescribe trigger-token spelling or the number of repeats for LoRA.
- [P69](https://arxiv.org/abs/2305.20086) — Somepalli et al. find text conditioning matters for diffusion-model copying and study caption variation as mitigation. This cautions against treating identical captions or duplicated images as automatically benign; it does not establish that a user-authored consistent template is harmful.

## Feature connections

The following are relevance mappings to the existing feature contracts, not approved changes or proof that the current implementation follows the research.

| WebCap feature / reference | Research relevance |
| --- | --- |
| [Caption Assist / Caption Template Assist](../../tool/server/caption_ops.py) | Relevant accurate visual evidence and coherent structure matter more than mechanically increasing words or repeating the same term. Approved tags, saved captions and template form have distinct roles. |
| [Set Intelligence](../set_intelligence.md) and [Curate](../qa_training_set_curation_plan.md) | Training focus makes some attributes more important than others. An unobserved attribute or an irrelevant caption phrase is not useful supervision merely because a template contains it. |
| [Dataset configuration](../dataset_config.md) and [Training](../train.md) | Caption supervision, dataset membership and exposure operate together; a model-family training result does not choose local fine-tuning parameters. |
| [Wildcard Builder](../../README.md) | Test variations should represent intended learned attributes and contextual variation rather than blindly reproducing repeated caption phrases. |

## Synthesis for later consideration

Accurate, informative supervision is a defensible objective. Appropriate density depends on the model and learning objective; consistent structure is not identical to redundant facts or identical captions. The literature does not establish a universal caption format, minimum length, trigger phrase or word ordering.

## Open applicability questions

Direct ablations of small H3 and Krea 2 LoRA Sets, template phrasing, optional fields, caption length, duplication and trigger-word effects remain open. No caption or training policy changes.
