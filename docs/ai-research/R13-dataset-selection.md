# R13 — Dataset selection and coverage

Status: initial evidence notes, 2026-11-27. Documentation only; no product changes, prompt rewrites, additional experiments or runtime validation authorized. See the [research index](README.md) and [bibliography](references.md).

## Scope and method

Choosing useful training samples while preserving intended concept coverage, diversity and difficult or rare examples.

Targeted first-pass review of primary publication records and abstracts, plus relevant developer guidance where explicitly marked. Source findings are bounded to the studied models and tasks. This is not a systematic or full-text review and does not establish WebCap-specific effectiveness.

## Published evidence

- [P14](https://arxiv.org/abs/2206.14486) — Sorscher et al. demonstrate that selecting useful examples can improve scaling in image classification. Their data-pruning results depend on the selection metric; they do not establish a universally useful pruning score for diffusion fine-tuning.
- [P73](https://arxiv.org/abs/2304.14108) — DataComp compares curated image-text pools under a standardized CLIP training setup and shows that dataset selection can improve downstream performance at matched compute. Its target is contrastive pretraining rather than personalized generation.
- [P69](https://arxiv.org/abs/2305.20086) — Somepalli et al. study copying in conditional diffusion and identify both image duplication and text conditioning as relevant. P74 provides complementary evidence that diffusion models can reproduce training images. This supports treating redundancy and memorization as real issues without claiming that perceptually similar images are always redundant.
- [P84](https://arxiv.org/abs/2512.16905) — Alchemist (preprint) reports improved image generation from subsets selected by learned sample influence; the authors' learned rating and selection method is substantially different from WebCap's deterministic curation.
- [P85](https://arxiv.org/abs/2509.15267) — Autoguided Online Data Curation (preprint) finds modest benefits from some early selection settings but added complexity and time can make simpler methods preferable. This is a useful counterweight to assuming elaborate selection pays off.
- [P87](https://www.krea.ai/blog/krea-2-technical-report) — Krea's own data-curation report emphasizes diversity and broad coverage and warns that aesthetic/quality filtering may eliminate intentional visual styles. Their large-scale pipeline is not a verified rule for a small training Set.

## Feature connections

The following are relevance mappings to the existing feature contracts, not approved changes or proof that the current implementation follows the research.

| WebCap feature / reference | Research relevance |
| --- | --- |
| [QA Curate](../qa_training_set_curation_plan.md) | Current purpose is useful training coverage, not merely matching histogram counts. Distinguish concept relevance, actual supervision, duplicate evidence, unique viewpoints and quality signals. |
| [Set variables and distribution](../set_dashboard.md) | A declared variable describes intended coverage. Missing, not visible, unknown and rare are different states; no fixed uniform target follows from the studies. |
| [Dataset configuration](../dataset_config.md) and [repeat targeting](../repeat_targeting.md) | Membership and repeat exposure both influence the effective training distribution; dataset size alone is not exposure. |
| [Media Explorer quality analysis](../media_explorer_quality_analysis.md) | Resolution and measured detail are limited evidence, not globally calibrated quality or guaranteed training utility. |

## Synthesis for later consideration

Selection can matter, but usefulness depends on the training objective and reliable measurement. Preserve unique relevant evidence and distinguish diversity from visual noise or simply increasing counts. A proxy score cannot certify LoRA quality.

## Open applicability questions

No reviewed paper validates WebCap's exact Curate weighting, balance policy, duplicate hash threshold, rare-term treatment or fixed repeat target for H3/Krea 2. No ranking, pruning or exposure logic is changed.
