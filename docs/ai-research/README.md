# AI research reference index

Status: initial evidence notes completed for all 18 research topics, 2026-11-27. Documentation only; not an implementation plan or claim that existing behavior is supported by the listed studies.

## Purpose

Design meaningful AI/model interactions using relevant published research and established practices. Maintain traceable links from features to research topics and from those topics to primary publications. The goal is to adopt applicable knowledge, not reproduce research experiments. Normal software correctness and regression testing remain separate.

Bibliography references are candidates unless discussed in a linked topic evidence note. A link identifies a research question, not an endorsement. Topic notes distinguish findings, limits and possible applicability; none adopts a product change. This index does not authorize implementation or prompt changes. Leave evidence gaps visible.

## Research topics

All 18 topics now have an initial source-grounded note. Reference IDs resolve to the [bibliography](references.md), which distinguishes publications (P) from living model-developer guidance (V). Topic IDs are stable. A completed topic note is not a completed systematic review: open questions and limits remain within each note.

| ID | Topic / initial evidence notes | Scope and questions | Related references |
| --- | --- | --- | --- |
| R01 | [Prompt structure and instruction hierarchy](R01-prompt-structure.md) — initial evidence notes | Role, task, specificity, formatting, positive vs negative instructions | P01 P02 P03 P17–P27 |
| R02 | [Context engineering](R02-context-engineering.md) — initial evidence notes | Selection, placement, length, interference, history, explicit grounding | P04 P28–P37 |
| R03 | [Structured outputs and schema design](R03-structured-outputs.md) — initial evidence notes | Schema descriptions, JSON, constrained decoding, partial results | P05 P38–P48 |
| R04 | [In-context learning and examples](R04-in-context-learning.md) — initial evidence notes | Examples, ordering, selection, few-shot prompting | P01 P02 P17 P49–P51 |
| R05 | [Visual grounding](R05-visual-grounding.md) — initial evidence notes | Hallucinations, resolution, visual evidence, video frame sampling | P06 P07 P08 P25 P52–P54 P90 P91 |
| R06 | [Hierarchical planning](R06-hierarchical-planning.md) — initial evidence notes | Concept to overview to scenes, decomposition, coherence | P09 P55 P56 P65 |
| R07 | [Critique and revision](R07-critique-revision.md) — initial evidence notes | Controlled edits, external feedback, limits of self-correction | P10 P11 P57 P58 |
| R08 | [Human-AI collaboration](R08-human-ai-collaboration.md) — initial evidence notes | Clarification, turn-taking, short exchanges, agency and action recommendations | P03 P31 P58–P60 P89 |
| R09 | [Confidence and abstention](R09-confidence-abstention.md) — initial evidence notes | Calibration, uncertain observations, selective classification | P06 P12 P61 P62 P90 P91 |
| R10 | [Attribute binding and compositional reasoning](R10-attribute-binding.md) — initial evidence notes | Object-property binding, spatial relations, independent attributes | P06 P13 P63–P65 P78 |
| R11 | [Caption supervision for generative training](R11-caption-supervision.md) — initial evidence notes | Training focus, caption density, trigger tokens, redundancy | P52 P66–P69 P87 |
| R12 | [Taxonomy and semantic classification](R12-taxonomy-classification.md) — initial evidence notes | Vocabulary induction, synonym consolidation, multi-label tagging | P05 P70–P72 P86 |
| R13 | [Dataset selection and coverage](R13-dataset-selection.md) — initial evidence notes | Diversity, redundancy, rare concepts, sample weighting | P14 P69 P73 P74 P84 P85 P87 |
| R14 | [Image and video prompt authoring](R14-generative-media-prompting.md) — initial evidence notes | Temporal instructions, motion, shot structure, H3/Krea2 model-specific guidance | P13 P64 P65 P75 P87 P88 V01 V02 |
| R15 | [Vision-language evaluation](R15-vision-language-evaluation.md) — initial evidence notes | Prompt adherence, visual questions, paired references, bias | P06 P12 P13 P65 P75–P78 P90 P91 |
| R16 | [Model assessment and judge reliability](R16-model-assessment.md) — initial evidence notes | Representative benchmarks, model comparisons, LLM-as-judge | P15 P24 P29 P38 P53 P79 |
| R17 | [Fine-tuning and checkpoint selection](R17-fine-tuning-checkpoints.md) — initial evidence notes | LoRA, learning rates, repeat exposure, loss curves, generalization | P16 P68 P69 P80 P92 V03 |
| R18 | [Model and runtime differences](R18-model-runtime-differences.md) — initial evidence notes | Small/local models, quantization, instruction tuning, context limits | P03 P07 P08 P17 P29 P38 P53 P81–P83 |

## Feature-to-topic map

Baseline: main at `c7f7d9919c55`. The [documentation map](../README.md), [LLM guidance architecture](../llm-guidance-architecture.md), [root README](../../README.md) and selected backend contracts supplied this initial inventory. Some linked notes contain historical phases; their current-status notices and live code remain authoritative. This is not an exhaustive inference call-site audit.

| Feature / operation | Existing reference | Research topics |
| --- | --- | --- |
| Prep: Caption Assist / enrichment | [../../tool/server/caption_ops.py](../../tool/server/caption_ops.py) | [R01](R01-prompt-structure.md) [R02](R02-context-engineering.md) [R03](R03-structured-outputs.md) [R04](R04-in-context-learning.md) [R07](R07-critique-revision.md) [R11](R11-caption-supervision.md) |
| Prep: Caption Template Assist | [../../tool/server/caption_ops.py](../../tool/server/caption_ops.py) | [R01](R01-prompt-structure.md) [R03](R03-structured-outputs.md) [R04](R04-in-context-learning.md) [R11](R11-caption-supervision.md) [R12](R12-taxonomy-classification.md) |
| Prep: Vision captioning and questions | [../../tool/server/caption_vision.py](../../tool/server/caption_vision.py) | [R03](R03-structured-outputs.md) [R05](R05-visual-grounding.md) [R09](R09-confidence-abstention.md) [R10](R10-attribute-binding.md) [R11](R11-caption-supervision.md) |
| Prep: Structured Sight | [../vision_schema_assist.md](../vision_schema_assist.md) | [R03](R03-structured-outputs.md) [R05](R05-visual-grounding.md) [R09](R09-confidence-abstention.md) [R10](R10-attribute-binding.md) [R18](R18-model-runtime-differences.md) |
| Prep: Discover Vocabulary | [../vision_schema_assist.md](../vision_schema_assist.md) | [R02](R02-context-engineering.md) [R05](R05-visual-grounding.md) [R07](R07-critique-revision.md) [R12](R12-taxonomy-classification.md) |
| Prep: Guided and Single Item Tag Assist | [../set_intelligence.md](../set_intelligence.md) | [R03](R03-structured-outputs.md) [R05](R05-visual-grounding.md) [R09](R09-confidence-abstention.md) [R10](R10-attribute-binding.md) [R12](R12-taxonomy-classification.md) |
| Prep: Deep QA / Concept Check / Ask QA | [../set_intelligence.md](../set_intelligence.md) | [R02](R02-context-engineering.md) [R05](R05-visual-grounding.md) [R07](R07-critique-revision.md) [R08](R08-human-ai-collaboration.md) [R09](R09-confidence-abstention.md) [R11](R11-caption-supervision.md) |
| Prep: Progressive corrections | [../progressive_deep_qa.md](../progressive_deep_qa.md) | [R03](R03-structured-outputs.md) [R07](R07-critique-revision.md) [R08](R08-human-ai-collaboration.md) [R09](R09-confidence-abstention.md) |
| Prep: Curate | [../qa_training_set_curation_plan.md](../qa_training_set_curation_plan.md) | [R09](R09-confidence-abstention.md) [R11](R11-caption-supervision.md) [R12](R12-taxonomy-classification.md) [R13](R13-dataset-selection.md) |
| Prep: Pose and face analysis | [../selection_pose_stack.md](../selection_pose_stack.md) | [R05](R05-visual-grounding.md) [R09](R09-confidence-abstention.md) |
| Studio: Director Chat and explicit Read | [../studio-director-contract.md](../studio-director-contract.md) | [R01](R01-prompt-structure.md) [R02](R02-context-engineering.md) [R04](R04-in-context-learning.md) [R08](R08-human-ai-collaboration.md) [R18](R18-model-runtime-differences.md) |
| Studio: Write Project and Scenes | [../llm-guidance-architecture.md](../llm-guidance-architecture.md) | [R01](R01-prompt-structure.md) [R02](R02-context-engineering.md) [R03](R03-structured-outputs.md) [R04](R04-in-context-learning.md) [R06](R06-hierarchical-planning.md) [R10](R10-attribute-binding.md) [R14](R14-generative-media-prompting.md) |
| Studio: First Cut and scene planning | [../storyboard_llm_guidance.md](../storyboard_llm_guidance.md) | [R02](R02-context-engineering.md) [R03](R03-structured-outputs.md) [R06](R06-hierarchical-planning.md) [R14](R14-generative-media-prompting.md) |
| Studio: Visual Direction and revisions | [../llm-guidance-architecture.md](../llm-guidance-architecture.md) | [R01](R01-prompt-structure.md) [R03](R03-structured-outputs.md) [R07](R07-critique-revision.md) [R10](R10-attribute-binding.md) [R14](R14-generative-media-prompting.md) |
| Studio: Prompt Assist and Project Deep QA | [../studio-prompt-assist-project-deep-qa.md](../studio-prompt-assist-project-deep-qa.md) | [R02](R02-context-engineering.md) [R03](R03-structured-outputs.md) [R06](R06-hierarchical-planning.md) [R07](R07-critique-revision.md) [R09](R09-confidence-abstention.md) [R14](R14-generative-media-prompting.md) |
| Studio: Action Advisor | [../studio-action-advisor-mvp.md](../studio-action-advisor-mvp.md) | [R02](R02-context-engineering.md) [R03](R03-structured-outputs.md) [R08](R08-human-ai-collaboration.md) [R09](R09-confidence-abstention.md) |
| Studio: H3 prompt authoring | [../mmh3-prompt-guidelines.md](../mmh3-prompt-guidelines.md) | [R01](R01-prompt-structure.md) [R06](R06-hierarchical-planning.md) [R10](R10-attribute-binding.md) [R14](R14-generative-media-prompting.md) [R18](R18-model-runtime-differences.md) |
| Generate: Director prompt authoring/refinement | [../llm-guidance-architecture.md](../llm-guidance-architecture.md) | [R01](R01-prompt-structure.md) [R04](R04-in-context-learning.md) [R07](R07-critique-revision.md) [R10](R10-attribute-binding.md) [R14](R14-generative-media-prompting.md) [R18](R18-model-runtime-differences.md) |
| Evaluation: Wildcard Builder | [../../README.md](../../README.md) | [R03](R03-structured-outputs.md) [R10](R10-attribute-binding.md) [R11](R11-caption-supervision.md) [R12](R12-taxonomy-classification.md) [R14](R14-generative-media-prompting.md) |
| Evaluation: Campaign test planning | [../epoch_finder_implementation.md](../epoch_finder_implementation.md) | [R03](R03-structured-outputs.md) [R10](R10-attribute-binding.md) [R12](R12-taxonomy-classification.md) [R13](R13-dataset-selection.md) [R15](R15-vision-language-evaluation.md) |
| Evaluation: Original VL / Ask VL | [../epoch_finder_implementation.md](../epoch_finder_implementation.md) | [R05](R05-visual-grounding.md) [R09](R09-confidence-abstention.md) [R10](R10-attribute-binding.md) [R15](R15-vision-language-evaluation.md) |
| Evaluation: Paired reference VL | [../epoch_finder_reference_evaluation.md](../epoch_finder_reference_evaluation.md) | [R05](R05-visual-grounding.md) [R09](R09-confidence-abstention.md) [R10](R10-attribute-binding.md) [R15](R15-vision-language-evaluation.md) |
| Evaluation: Model Assessment and judge | [../model-assessment-consolidation.md](../model-assessment-consolidation.md) | [R09](R09-confidence-abstention.md) [R16](R16-model-assessment.md) [R18](R18-model-runtime-differences.md) |
| Media Explorer: prompt-derived tag suggestions | [../media_explorer_design.md](../media_explorer_design.md) | [R03](R03-structured-outputs.md) [R10](R10-attribute-binding.md) [R12](R12-taxonomy-classification.md) |
| Training: LoRA training | [../train.md](../train.md) | [R11](R11-caption-supervision.md) [R13](R13-dataset-selection.md) [R17](R17-fine-tuning-checkpoints.md) |
| Training: dataset configuration | [../dataset_config.md](../dataset_config.md) | [R11](R11-caption-supervision.md) [R13](R13-dataset-selection.md) [R17](R17-fine-tuning-checkpoints.md) |
| Training: repeat targeting | [../repeat_targeting.md](../repeat_targeting.md) | [R13](R13-dataset-selection.md) [R17](R17-fine-tuning-checkpoints.md) |
| Training: epoch candidate detection | [../webcap-lora-valley-candidate-detection.md](../webcap-lora-valley-candidate-detection.md) | [R16](R16-model-assessment.md) [R17](R17-fine-tuning-checkpoints.md) |
| Training: LoRA initialization | [../lora_initializer.md](../lora_initializer.md) | [R17](R17-fine-tuning-checkpoints.md) |

## Status of the initial pass

All 18 research topics are linked to topic notes, the initial feature inventory, and source references. This pass establishes an evidence map, not an implementation backlog. Research can inform subsequent feature-specific design decisions only when the author requests that work. Do not convert open questions into mandatory experiments, validation layers, or product changes. The remaining model-specific and task-specific evidence gaps are recorded in the topic notes and bibliography. The original feature inventory is not an exhaustive audit of every model call site.

## Maintenance

- Add publications with stable primary-source links, year, title and relevant topic IDs; distinguish peer-reviewed findings, preprints, developer technical reports and living model documentation.
- Keep candidate references separate from findings; distinguish observed research results, applicability questions and any separately approved engineering decisions.
- Maintain links from feature documentation rather than copying research text into each feature.
- Include contrary evidence and gaps; adjacent papers are not automatically transferable evidence.
- Exclude retired capabilities (such as DINOv2); identify future-only designs rather than claiming they are shipped.
- Keep deterministic software behavior outside the research agenda unless it affects model inputs, interpretation, training or evaluation.
