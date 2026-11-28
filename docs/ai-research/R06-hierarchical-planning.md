# R06 — Hierarchical planning

Status: initial evidence notes, 2026-11-27. Documentation only; no product changes, prompt rewrites, additional experiments or runtime validation authorized. See the [research index](README.md) and [bibliography](references.md).

## Scope and method

Planning a production from intent to Project structure to individual Scenes; maintaining relevant continuity without prescribing a single story form.

Targeted first-pass review of primary publication records and abstracts, plus relevant developer guidance where explicitly marked. Source findings are bounded to the studied models and tasks. This is not a systematic or full-text review and does not establish WebCap-specific effectiveness.

## Published evidence

- [P55](https://aclanthology.org/2022.emnlp-main.296/) — Re3 combines an overarching plan, repeated context injection, reranking and editing. Human comparisons found improved long-story coherence and premise relevance relative to direct generation by the same model. The reported gains apply to the combined system, not planning alone.
- [P56](https://aclanthology.org/2023.acl-long.190/) — DOC adds a detailed hierarchical outline and a controller that aligns generated passages to that outline. Human evaluations found stronger coherence, outline relevance, interestingness and interactive controllability than Re3. The controller and outline work together.
- [P65](https://openaccess.thecvf.com/content/CVPR2025/html/Sun_T2V-CompBench_A_Comprehensive_Benchmark_for_Compositional_Text-to-video_Generation_CVPR_2025_paper.html) — Video compositional evaluation separates consistent and changing attributes, action and motion binding, interactions and spatial relations. This identifies downstream constraints on independently rendered Scenes, not a prescribed planning method.

## Feature connections

The following are relevance mappings to the existing feature contracts, not approved changes or proof that the current implementation follows the research.

| WebCap feature / reference | Research relevance |
| --- | --- |
| [Studio Director Project and Scene writing](../studio-director-contract.md) | The concept/overview, visual atmosphere and invariants express different levels of production intent. A useful overview should guide a coherent, intentional set of Scenes. |
| [First Cut / Storyboard authoring](../storyboard_llm_guidance.md) | Story planning research is relevant when decomposing a premise into Scenes. Montages, collections and independently rendered clips need different relations from a continuous narrative. |
| [H3 authoring](../mmh3-prompt-guidelines.md) | An individual clip needs its own renderable description; a high-level outline is not itself that description. |
| [Campaign test planning](../epoch_finder_implementation.md) | A hierarchical plan can separate the evaluation concept, scored dimensions and concrete test cases; this is a transfer hypothesis, not a tested application of Re3. |

## Synthesis for later consideration

Evidence supports planning as a meaningful way to improve control in long-form text generation. It does not establish a required story structure, mandatory planning gates, additional model calls, or automatic coherence repair in WebCap.

## Open applicability questions

Direct studies of author-guided, multi-Scene video specification generation, short-clip boundaries, montage/non-narrative planning and rendering fidelity are needed to establish transfer.
