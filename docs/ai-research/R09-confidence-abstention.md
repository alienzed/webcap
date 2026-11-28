# R09 — Confidence and abstention

Status: initial evidence notes, 2026-11-27. Documentation only; no product changes, prompt rewrites, additional experiments or runtime validation authorized. See the [research index](README.md) and [bibliography](references.md).

## Scope and method

Model uncertainty, insufficient visual evidence, confidence calibration and the difference between a reported label and measured reliability.

Targeted first-pass review of primary publication records and abstracts, plus relevant developer guidance where explicitly marked. Source findings are bounded to the studied models and tasks. This is not a systematic or full-text review and does not establish WebCap-specific effectiveness.

## Published evidence

- [P12](https://arxiv.org/abs/2207.05221) — Kadavath et al. find useful self-evaluation/calibration under selected formats and tasks; the same format and model conditions matter. A model's statement of confidence is not inherently a calibrated probability.
- [P61](https://arxiv.org/abs/2305.14975) — Tian et al. found verbalized confidence often better calibrated than conditional token probabilities for tested RLHF models on QA benchmarks. This is relative calibration evidence, not a universal probability mapping.
- [P62](https://arxiv.org/abs/2205.14334) — Lin et al. demonstrate that a model trained to express uncertainty can produce calibrated verbal confidence on their math tasks. The result depends on training and evaluation distribution.
- [P90](https://proceedings.iclr.cc/paper_files/paper/2025/hash/21b5788d81f886ff81671379b4ff9453-Abstract-Conference.html) — CertainlyUncertain finds evaluated VLMs weak at recognizing uncertain scenarios; unanswerable and ambiguous visual questions are distinct from ordinary recognition errors.
- [P91](https://aclanthology.org/2024.findings-acl.250/) — Selective visual QA experiments compare calibration and abstention methods without a clear universal winner. Visual grounding and sampling can change which confidence measures work.

## Feature connections

The following are relevance mappings to the existing feature contracts, not approved changes or proof that the current implementation follows the research.

| WebCap feature / reference | Research relevance |
| --- | --- |
| [Guided Tagging / QA](../set_intelligence.md) | Distinguish a model's stated confidence, missing evidence, an uncertain observation and human-confirmed tags. |
| [Vision captioning](../../tool/server/caption_vision.py) | A feature may be outside the frame, occluded, too small or simply unclear; absence of a detection is not proof of visual absence. |
| [Reference and Original VL assessment](../epoch_finder_reference_evaluation.md) | A genuine unclear result is different from a confirmed mismatch. A valid answer option is not evidence of calibration. |
| [Model Assessment](../model-assessment-consolidation.md) | Keep observed reliability and task-specific output separate from confidence prose; optional judges remain fallible. |

## Synthesis for later consideration

A confidence field is a model-reported observation unless calibrated on representative outcomes. Uncertainty has different causes, and useful abstention is distinct from a failure to perform the task. The research does not mandate thresholds, rejection gates or extra validation.

## Open applicability questions

No evidence here calibrates WebCap's specific high/medium/low labels, rare visual attributes or local quantized models. No scores, filters or action policies are modified.
