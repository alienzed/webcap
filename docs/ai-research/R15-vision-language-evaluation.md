# R15 — Vision-language evaluation

Status: initial evidence notes, 2026-11-27. Documentation only; no product changes, prompt rewrites, additional experiments or runtime validation authorized. See the [research index](README.md) and [bibliography](references.md).

## Scope and method

Assessing render adherence to an intended attribute or reference without conflating similarity, aesthetics, prompt compliance and temporal fidelity.

Targeted first-pass review of primary publication records and abstracts, plus relevant developer guidance where explicitly marked. Source findings are bounded to the studied models and tasks. This is not a systematic or full-text review and does not establish WebCap-specific effectiveness.

## Published evidence

- [P13](https://arxiv.org/abs/2303.11897) — TIFA uses visual question answering over generated images to evaluate specific prompt propositions, reporting stronger correlation with human faithfulness judgments than prior metrics. It depends on question construction and the VQA model's correctness.
- [P78](https://arxiv.org/abs/2310.11513) — GenEval targets count, color, position and co-occurrence with object-focused evaluation. Global similarity metrics are insufficient for many instance-specific questions.
- [P76](https://arxiv.org/abs/2406.16855) — DreamBench++ uses multimodal GPT judgments and designed prompts to better align personalized-image evaluation with human ratings. Its results apply to the benchmark and selected judges; not every reference comparison transfers.
- [P77](https://arxiv.org/abs/2306.09344) — DreamSim studies human visual similarity and finds that semantic content, pose, layout and other properties contribute differently from low-level pixel matching. Whole-image similarity is not the same task as comparing one named construction or feature.
- [P65](https://openaccess.thecvf.com/content/CVPR2025/html/Sun_T2V-CompBench_A_Comprehensive_Benchmark_for_Compositional_Text-to-video_Generation_CVPR_2025_paper.html) — T2V-CompBench and [P75](https://openaccess.thecvf.com/content/CVPR2024/html/Huang_VBench_Comprehensive_Benchmark_Suite_for_Video_Generative_Models_CVPR_2024_paper.html) (VBench) separate temporal and compositional outcomes. A single-frame evaluation cannot establish duration-wide motion or continuity.
- [P90](https://proceedings.iclr.cc/paper_files/paper/2025/hash/21b5788d81f886ff81671379b4ff9453-Abstract-Conference.html) — Unanswerable visual questions remain difficult. [P91](https://aclanthology.org/2024.findings-acl.250/) likewise finds no universally best selective-answering method. Unclear is a substantive result distinct from mismatch.

## Feature connections

The following are relevance mappings to the existing feature contracts, not approved changes or proof that the current implementation follows the research.

| WebCap feature / reference | Research relevance |
| --- | --- |
| [Original VL / Ask VL](../epoch_finder_implementation.md) | A question should assess the intended concept or resolved option, using the supplied image rather than the desired prompt as proof. |
| [Paired reference VL](../epoch_finder_reference_evaluation.md) | Compare the explicitly named attribute with an approved training reference; unrelated variation is not a mismatch for that attribute. This is separate from overall similarity. |
| [Campaign tag-grounded plan](../epoch_finder_tag_grounded_plan.md) | Preserve reference identity, exact scoped tag options and comparison context. Repeated comparable tests are evidence, not an automatic declaration of the best checkpoint. |
| [Model Assessment](../model-assessment-consolidation.md) | Judge quality, evidence coverage and actual rendering outcomes should remain distinguishable. |

## Synthesis for later consideration

Fine-grained, interpretable evaluation has stronger relevance to WebCap's named-attribute tests than a single holistic score. Reference fidelity, prompt adherence, generalization and appearance are distinct dimensions; the judge is fallible and the supplied evidence limits its conclusions.

## Open applicability questions

No reviewed study establishes the reliability of WebCap's actual local judges, exact RVN labels, score weights, frame extraction or retention formula. DINOv2 is retired; these references do not propose restoring it or replacing current evaluation methods.
