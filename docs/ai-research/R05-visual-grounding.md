# R05 — Visual grounding

Status: initial evidence notes, 2026-11-27. Documentation only; no product changes, prompt rewrites, additional experiments or runtime validation authorized. See the [research index](README.md) and [bibliography](references.md).

## Scope and method

Grounding observed attributes in images and sampled video; distinguishing open description, targeted observation, model priors and pose estimates.

Targeted first-pass review of primary publication records and abstracts, plus relevant developer guidance where explicitly marked. Source findings are bounded to the studied models and tasks. This is not a systematic or full-text review and does not establish WebCap-specific effectiveness.

## Published evidence

- [P52](https://arxiv.org/abs/1809.02156) — Image-captioning systems can mention nonexistent objects despite good conventional caption metrics. Language priors contribute to errors on the authors' MSCOCO experiments.
- [P06](https://arxiv.org/abs/2305.10355) — POPE's experiments show object hallucination in vision-language models, including susceptibility to objects suggested by instructions or frequent co-occurrence. Targeted questions are useful evaluation probes, but are not an infallible observation mechanism.
- [P53](https://openaccess.thecvf.com/content/CVPR2025/html/Fu_Video-MME_The_First-Ever_Comprehensive_Evaluation_Benchmark_of_Multi-modal_LLMs_in_Video_Analysis_CVPR_2025_paper.html) — Video-MME distinguishes video comprehension from static-image understanding and evaluates multiple temporal durations and input modalities. Sampled frames are a partial observation of an event; a static answer does not establish motion or persistence.
- [P54](https://arxiv.org/abs/2006.10204) — BlazePose demonstrates efficient single-person body landmark estimation. Its 33 keypoints are a different kind of evidence from descriptive Sight; the paper does not establish the accuracy of every derived pose class, face orientation or expression.
- [P90](https://proceedings.iclr.cc/paper_files/paper/2025/hash/21b5788d81f886ff81671379b4ff9453-Abstract-Conference.html) — CertainlyUncertain evaluates answerable and unanswerable visual questions and reports poor handling of uncertain scenarios by evaluated VLMs. See also [R09](R09-confidence-abstention.md).

## Feature connections

The following are relevance mappings to the existing feature contracts, not approved changes or proof that the current implementation follows the research.

| WebCap feature / reference | Research relevance |
| --- | --- |
| [Vision captioning](../../tool/server/caption_vision.py) and [Structured Sight](../vision_schema_assist.md) | Distinguish visually observed facts from language-based guesses. Open inspection and targeted group-aware inspection have different purposes. |
| [Guided Tagging / Deep QA](../set_intelligence.md) | A cached observation is fallible evidence, not automatic proof. Unseen, occluded or unobserved features are not necessarily absent. |
| [Selection Pose Stack](../selection_pose_stack.md) | Keep landmark-derived measurements and coarse inferred classifications separate from textual descriptions; the user still owns annotations. |
| [Prompt Tests and Campaigns](../epoch_finder_implementation.md) | Assess what is actually visible in supplied frames. A first-frame observation cannot substantiate a whole clip's temporal behavior. |

## Synthesis for later consideration

Open observation, targeted recognition and semantic interpretation are distinct tasks. A grounded description may be incomplete; a detailed or confident description may still be wrong. Input resolution, framing and frame selection condition what can be observed.

## Open applicability questions

No reviewed paper establishes WebCap's optimal resolution, number/timing of sampled frames, rare garment/shape/detail recognition accuracy, or derived facial-expression reliability. No rescan, detector or frame strategy is changed.
