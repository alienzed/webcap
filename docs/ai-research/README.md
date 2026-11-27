# AI research reference index

Status: initial bibliography and research agenda, 2026-11-27. Documentation inventory only; not a literature review, implementation plan, or claim that existing behavior is supported by the listed studies.

## Purpose

Design meaningful AI/model interactions using relevant published research and established practices. Maintain traceable links from features to research topics and from those topics to primary publications. The goal is to adopt applicable knowledge, not reproduce research experiments. Normal software correctness and regression testing remain separate.

Every reference at this stage is a **candidate for later review**. A link identifies a question to investigate, not an endorsement. Applicability to actual models/workloads, contrary findings and design implications belong to a subsequent pass. This index does not authorize implementation or prompt changes. Leave evidence gaps visible.

## Research topics

Reference IDs resolve to the [candidate bibliography](references.md). Topic IDs are stable.

| ID | Topic | Questions for later review | Candidate references |
| --- | --- | --- | --- |
| R01 | Prompt structure and instruction hierarchy | Role, task, specificity, formatting, positive vs negative instructions | P01 P02 P03 |
| R02 | Context engineering | Selection, placement, length, interference, history, explicit grounding | P04 |
| R03 | Structured outputs | Schema descriptions, JSON, constrained decoding, partial results | P05 |
| R04 | In-context learning | Examples, ordering, selection, few-shot prompting | P01 P02 |
| R05 | Visual grounding | Hallucinations, resolution, visual evidence, video frame sampling | P06 P07 P08 |
| R06 | Hierarchical planning | Concept to overview to scenes, decomposition, coherence | P09 |
| R07 | Critique and revision | Controlled edits, external feedback, limits of self-correction | P10 P11 |
| R08 | Human-AI collaboration | Clarification, turn-taking, short exchanges, agency and action recommendations | P03; direct sources pending |
| R09 | Confidence and abstention | Calibration, uncertain observations, selective classification | P12 P06 |
| R10 | Attribute binding and composition | Object-property binding, spatial relations, independent attributes | P13 P06 |
| R11 | Caption supervision | Training focus, caption density, trigger tokens, redundancy | Direct diffusion-training sources pending |
| R12 | Taxonomy and semantic classification | Vocabulary induction, synonym consolidation, multi-label tagging | P05; direct sources pending |
| R13 | Dataset selection and coverage | Diversity, redundancy, rare concepts, sample weighting | P14; diffusion-specific sources pending |
| R14 | Image/video prompt authoring | Temporal instructions, motion, shot structure, H3/Krea2 model-specific guidance | P13; model-specific sources pending |
| R15 | Vision-language evaluation | Prompt adherence, visual questions, paired references, bias | P13 P06 P12 |
| R16 | Model assessment | Representative benchmarks, model comparisons, LLM-as-judge | P15 |
| R17 | Fine-tuning and checkpoint selection | LoRA, learning rates, repeat exposure, loss curves, generalization | P16; diffusion-specific sources pending |
| R18 | Model and runtime differences | Small/local models, quantization, instruction tuning, context limits | P03 P07 P08; comparative sources pending |

## Feature-to-topic map

Baseline: main at `c7f7d9919c55`. The [documentation map](../README.md), [LLM guidance architecture](../llm-guidance-architecture.md), [root README](../../README.md) and selected backend contracts supplied this initial inventory. Some linked notes contain historical phases; their current-status notices and live code remain authoritative. This is not an exhaustive inference call-site audit.

| Feature / operation | Existing reference | Research topics |
| --- | --- | --- |
| Prep: Caption Assist / enrichment | [../../tool/server/caption_ops.py](../../tool/server/caption_ops.py) | R01 R02 R03 R04 R07 R11 |
| Prep: Caption Template Assist | [../../tool/server/caption_ops.py](../../tool/server/caption_ops.py) | R01 R03 R04 R11 R12 |
| Prep: Vision captioning and questions | [../../tool/server/caption_vision.py](../../tool/server/caption_vision.py) | R03 R05 R09 R10 R11 |
| Prep: Structured Sight | [../vision_schema_assist.md](../vision_schema_assist.md) | R03 R05 R09 R10 R18 |
| Prep: Discover Vocabulary | [../vision_schema_assist.md](../vision_schema_assist.md) | R02 R05 R07 R12 |
| Prep: Guided and Single Item Tag Assist | [../set_intelligence.md](../set_intelligence.md) | R03 R05 R09 R10 R12 |
| Prep: Deep QA / Concept Check / Ask QA | [../set_intelligence.md](../set_intelligence.md) | R02 R05 R07 R08 R09 R11 |
| Prep: Progressive corrections | [../progressive_deep_qa.md](../progressive_deep_qa.md) | R03 R07 R08 R09 |
| Prep: Curate | [../qa_training_set_curation_plan.md](../qa_training_set_curation_plan.md) | R09 R11 R12 R13 |
| Prep: Pose and face analysis | [../selection_pose_stack.md](../selection_pose_stack.md) | R05 R09 |
| Studio: Director Chat and explicit Read | [../studio-director-contract.md](../studio-director-contract.md) | R01 R02 R04 R08 R18 |
| Studio: Write Project and Scenes | [../llm-guidance-architecture.md](../llm-guidance-architecture.md) | R01 R02 R03 R04 R06 R10 R14 |
| Studio: First Cut and scene planning | [../storyboard_llm_guidance.md](../storyboard_llm_guidance.md) | R02 R03 R06 R14 |
| Studio: Visual Direction and revisions | [../llm-guidance-architecture.md](../llm-guidance-architecture.md) | R01 R03 R07 R10 R14 |
| Studio: Prompt Assist and Project Deep QA | [../studio-prompt-assist-project-deep-qa.md](../studio-prompt-assist-project-deep-qa.md) | R02 R03 R06 R07 R09 R14 |
| Studio: Action Advisor | [../studio-action-advisor-mvp.md](../studio-action-advisor-mvp.md) | R02 R03 R08 R09 |
| Studio: H3 prompt authoring | [../mmh3-prompt-guidelines.md](../mmh3-prompt-guidelines.md) | R01 R06 R10 R14 R18 |
| Generate: Director prompt authoring/refinement | [../llm-guidance-architecture.md](../llm-guidance-architecture.md) | R01 R04 R07 R10 R14 R18 |
| Evaluation: Wildcard Builder | [../../README.md](../../README.md) | R03 R10 R11 R12 R14 |
| Evaluation: Campaign test planning | [../epoch_finder_implementation.md](../epoch_finder_implementation.md) | R03 R10 R12 R13 R15 |
| Evaluation: Original VL / Ask VL | [../epoch_finder_implementation.md](../epoch_finder_implementation.md) | R05 R09 R10 R15 |
| Evaluation: Paired reference VL | [../epoch_finder_reference_evaluation.md](../epoch_finder_reference_evaluation.md) | R05 R09 R10 R15 |
| Evaluation: Model Assessment and judge | [../model-assessment-consolidation.md](../model-assessment-consolidation.md) | R09 R16 R18 |
| Media Explorer: prompt-derived tag suggestions | [../media_explorer_design.md](../media_explorer_design.md) | R03 R10 R12 |
| Training: LoRA training | [../train.md](../train.md) | R11 R13 R17 |
| Training: dataset configuration | [../dataset_config.md](../dataset_config.md) | R11 R13 R17 |
| Training: repeat targeting | [../repeat_targeting.md](../repeat_targeting.md) | R13 R17 |
| Training: epoch candidate detection | [../webcap-lora-valley-candidate-detection.md](../webcap-lora-valley-candidate-detection.md) | R16 R17 |
| Training: LoRA initialization | [../lora_initializer.md](../lora_initializer.md) | R17 |

## Maintenance

- Add candidate publications with stable primary-source links, year, title and relevant topic IDs.
- Keep candidate references separate from findings; document applicability only after a subsequent review.
- Maintain links from feature documentation rather than copying research text into each feature.
- Include contrary evidence and gaps; adjacent papers are not automatically transferable evidence.
- Exclude retired capabilities (such as DINOv2); identify future-only designs rather than claiming they are shipped.
- Keep deterministic software behavior outside the research agenda unless it affects model inputs, interpretation, training or evaluation.
