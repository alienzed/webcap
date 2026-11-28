# R17 — Fine-tuning and checkpoint selection

Status: initial evidence notes, 2026-11-27. Documentation only; no product changes, prompt rewrites, additional experiments or runtime validation authorized. See the [research index](README.md) and [bibliography](references.md).

## Scope and method

Adapter training, training exposure, checkpoint trade-offs and why loss or a single sample cannot establish best model behavior.

Targeted first-pass review of primary publication records and abstracts, plus relevant developer guidance where explicitly marked. Source findings are bounded to the studied models and tasks. This is not a systematic or full-text review and does not establish WebCap-specific effectiveness.

## Published evidence

- [P16](https://arxiv.org/abs/2106.09685) — The original LoRA study freezes base weights and learns low-rank updates, demonstrating efficient adaptation on language-model tasks. It does not determine image/video adapter rank, learning rate, repeat count or checkpoint policy.
- [P68](https://openaccess.thecvf.com/content/CVPR2023/html/Ruiz_DreamBooth_Fine_Tuning_Text-to-Image_Diffusion_Models_for_Subject-Driven_Generation_CVPR_2023_paper.html) — DreamBooth shows subject personalization with few reference images and a prior-preservation objective. It addresses the relationship between identity fidelity and novel contexts, using a different training procedure from WebCap LoRA.
- [P92](https://openaccess.thecvf.com/content/WACV2025/html/Ram_DreamBlend_Advancing_Personalized_Fine-Tuning_of_Text-to-Image_Diffusion_Models_WACV_2025_paper.html) — DreamBlend reports a checkpoint trade-off in its personalized diffusion experiments: earlier checkpoints better preserve prompt fidelity/diversity, while later checkpoints better preserve subject fidelity but may reduce flexibility. The authors' inference method is not a recommendation to combine checkpoints in WebCap.
- [P80](https://arxiv.org/abs/2312.02696) — Karras et al. investigate training dynamics in a diffusion architecture and how EMA, architecture and training time interact. Their results caution against inferring generation quality from a simple loss trajectory without evidence of its relationship to the intended output.
- [P69](https://arxiv.org/abs/2305.20086) — Copying in conditional diffusion depends on data and text conditioning. This is relevant to repeat exposure and memorization, not a derivation of a safe fixed training-step count.

## Feature connections

The following are relevance mappings to the existing feature contracts, not approved changes or proof that the current implementation follows the research.

| WebCap feature / reference | Research relevance |
| --- | --- |
| [Training](../train.md) / [dataset configuration](../dataset_config.md) / [repeat targeting](../repeat_targeting.md) | Exposure, sample mix, learning rate and training objective interact. The current deterministic repeat calculation is a product choice, not a universal research-backed optimum. |
| [LoRA initializer](../lora_initializer.md) | Continuing from an existing adapter is distinct from training a new one. Original LoRA does not validate a particular restart, initialization or weight strategy for the supported models. |
| [Loss-valley candidate detection](../webcap-lora-valley-candidate-detection.md) | Loss-based candidates can support discovery; the cited literature does not validate WebCap's multiscale loss-basin algorithm as a predictor of best generated fidelity. |
| [Campaigns](../epoch_finder_implementation.md) | Compare checkpoint evidence across relevant controlled test cases and concept/reference dimensions. This records existing workflow rationale, not a new experimental requirement. |
| Krea 2 model-specific training | Krea's repository [V03](https://github.com/krea-ai/krea-2) recommends RAW for LoRA training and Turbo for generation. This is developer guidance for that model family, not a rule transferable to H3. |

## Synthesis for later consideration

Checkpoint choice involves fidelity, flexibility and diversity, not minimizing loss alone. LoRA is a parameter-efficient adaptation method, not a universal prescription for hyperparameters. Vendor compatibility guidance should be kept distinct from empirical research.

## Open applicability questions

No direct study in this pass supports a particular valley threshold, optimal epoch, adapter rank, learning rate, repeat target, warm start or H3/Krea 2 LoRA checkpoint selection policy for WebCap. No training, checkpoint or inference configuration is modified.
