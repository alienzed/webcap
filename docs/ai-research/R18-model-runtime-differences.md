# R18 — Model and runtime differences

Status: initial evidence notes, 2026-11-27. Documentation only; no product changes, prompt rewrites, additional experiments or runtime validation authorized. See the [research index](README.md) and [bibliography](references.md).

## Scope and method

Differences in instruction training, parameter scale, precision, visual capability, context limits and actual backend behavior.

Targeted first-pass review of primary publication records and abstracts, plus relevant developer guidance where explicitly marked. Source findings are bounded to the studied models and tasks. This is not a systematic or full-text review and does not establish WebCap-specific effectiveness.

## Published evidence

- [P03](https://arxiv.org/abs/2203.02155) — Instruction tuning changes behavior and preference outcomes; model size alone does not determine suitability for an instruction-following task.
- [P81](https://arxiv.org/abs/2306.00978) — AWQ demonstrates low-bit weight quantization with reduced resource use and favorable benchmark performance under its method. [P82](https://arxiv.org/abs/2210.17323) demonstrates a separate weight-quantization method. Neither paper establishes equivalence for every model, format or creative task.
- [P83](https://aclanthology.org/2024.lrec-main.461/) — Liu et al. examine in-context learning, reasoning and instruction following under quantization. Their tested four-bit models retained emergent capabilities better than two-bit variants; sensitivity varied with the ability and model components.
- [P17](https://arxiv.org/abs/2310.11324) — Formatting rankings can change between models; [P29](https://arxiv.org/abs/2404.06654) documents differences in effective long-context use. Nominal capacity and successful input submission do not imply equivalent task behavior.
- [P53](https://openaccess.thecvf.com/content/CVPR2025/html/Fu_Video-MME_The_First-Ever_Comprehensive_Evaluation_Benchmark_of_Multi-modal_LLMs_in_Video_Analysis_CVPR_2025_paper.html) — Video-MME evaluates differently capable multimodal systems across durations/modalities. A VLM's strong static-image performance does not establish video comprehension.
- [P38](https://arxiv.org/abs/2501.10868) — Runtime schema support differs by implementation; see [R03](R03-structured-outputs.md). A response_format request is not evidence of identical decoding across providers.

## Feature connections

The following are relevance mappings to the existing feature contracts, not approved changes or proof that the current implementation follows the research.

| WebCap feature / reference | Research relevance |
| --- | --- |
| [Configurable LLM guidance](../llm-guidance-architecture.md) | Task-specific behavior and model-specific knowledge should be distinguished from provider transport. A successful profile on one model does not establish general superiority. |
| [Studio Director](../studio-director-contract.md) and [context assembly](../studio_director_context_assembly.md) | Model identity, context configuration, template, prompt and exact outbound material jointly define a request. The deployed configuration is not inferred from a source-code default. |
| [Structured Sight and Tagging](../vision_schema_assist.md) | Observation capabilities vary by VLM, input modality, resolution and available evidence. Record model provenance when interpreting existing observations. |
| [Model Assessment](../model-assessment-consolidation.md) | Keep actual host/model/quantization, runtime version, settings and measured output distinct. Hardware and speed evidence from one machine does not establish behavior on another. |

## Synthesis for later consideration

Model-specific behavior is real and cannot reliably be inferred from parameter count, bit width, API compatibility or advertised context alone. Research can guide what properties to consider without mandating that WebCap reproduce every comparison.

## Open applicability questions

The cited quantization methods are not a direct evaluation of WebCap's exact GGUF variants, models, local/remote servers, chat templates, output schemas or H3/Krea 2 render workflows. No model defaults, loading, sampling, queue or runtime settings are altered.
