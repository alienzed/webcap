# R10 — Attribute binding and compositional reasoning

Status: initial evidence notes, 2026-11-27. Documentation only; no product changes, prompt rewrites, additional experiments or runtime validation authorized. See the [research index](README.md) and [bibliography](references.md).

## Scope and method

Associating the correct properties, actions and spatial relationships with their respective subjects, including change over time.

Targeted first-pass review of primary publication records and abstracts, plus relevant developer guidance where explicitly marked. Source findings are bounded to the studied models and tasks. This is not a systematic or full-text review and does not establish WebCap-specific effectiveness.

## Published evidence

- [P63](https://arxiv.org/abs/2210.01936) — The ARO study finds contrastive vision-language models can fail to connect attributes to the correct objects, understand relations and respect word order. Retrieval performance alone may hide these deficiencies.
- [P64](https://doi.org/10.1109/TPAMI.2025.3531907) — T2I-CompBench++ separates color, shape, texture, relationships, count and complex compositions. Its comparisons reveal distinct compositional challenges even in modern image generation systems.
- [P65](https://openaccess.thecvf.com/content/CVPR2025/html/Sun_T2V-CompBench_A_Comprehensive_Benchmark_for_Compositional_Text-to-video_Generation_CVPR_2025_paper.html) — T2V-CompBench separates stable and changing attributes, motion, action, interactions, spatial relations and counting. Current video models struggle with several of these tasks, demonstrating why image alignment alone is insufficient.
- [P78](https://arxiv.org/abs/2310.11513) — GenEval measures specific object properties rather than an overall similarity score. It highlights remaining weaknesses in spatial relations and attribute binding.

## Feature connections

The following are relevance mappings to the existing feature contracts, not approved changes or proof that the current implementation follows the research.

| WebCap feature / reference | Research relevance |
| --- | --- |
| [Structured Sight](../vision_schema_assist.md) | Thing-bound properties and colors are more informative than a disconnected list of attributes; the model must still observe the correct association. |
| [Caption Assist / tags](../../tool/server/caption_ops.py) | A caption should preserve which garment/object has each property. Vocabulary groups need not be mutually exclusive unless the concept really is exclusive. |
| [Write Scenes / Visual Direction](../llm-guidance-architecture.md) | Actor-action binding, subject identity, visible construction, position and changes are meaningful authoring concerns. Explicitness is a plausible response to the observed challenges, not a guaranteed renderer fix. |
| [Wildcard and Campaigns](../epoch_finder_implementation.md) | Independent variation dimensions and exact expected terms help identify which attribute a test is meant to assess; combinations can still interact. |

## Synthesis for later consideration

Compositional correctness is not the sum of isolated word or attribute matches. Separating concepts and binding them to their subjects makes the intended relationship explicit, but does not prove that any particular textual structure solves it.

## Open applicability questions

Direct experiments comparing alternative authoring formats for H3/Krea 2 and fine-grained WebCap training concepts are not established by these benchmarks.
