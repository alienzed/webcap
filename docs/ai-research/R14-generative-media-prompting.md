# R14 — Image and video prompt authoring

Status: initial evidence notes, 2026-11-27. Documentation only; no product changes, prompt rewrites, additional experiments or runtime validation authorized. See the [research index](README.md) and [bibliography](references.md).

## Scope and method

Downstream renderer instructions, as distinct from the LLM instructions that author them; model-specific capabilities, motion, temporal structure and creative control.

Targeted first-pass review of primary publication records and abstracts, plus relevant developer guidance where explicitly marked. Source findings are bounded to the studied models and tasks. This is not a systematic or full-text review and does not establish WebCap-specific effectiveness.

## Published evidence

- [P64](https://doi.org/10.1109/TPAMI.2025.3531907) — Compositional text-to-image benchmarks separate object/property and relationship fidelity, showing that image quality and requested composition are distinct.
- [P65](https://openaccess.thecvf.com/content/CVPR2025/html/Sun_T2V-CompBench_A_Comprehensive_Benchmark_for_Compositional_Text-to-video_Generation_CVPR_2025_paper.html) — Video compositional benchmarks add temporal change, action and motion association to image-style attributes. These measures identify possible rendering failure modes, not a proven universal prompt syntax.
- [P75](https://openaccess.thecvf.com/content/CVPR2024/html/Huang_VBench_Comprehensive_Benchmark_Suite_for_Video_Generative_Models_CVPR_2024_paper.html) — VBench decomposes video quality into dimensions including subject consistency, temporal flickering, motion and spatial relations. The study supports distinguishing these outcomes, not forcing them all into every prompt.
- [P88](https://arxiv.org/abs/2412.03603) — HunyuanVideo describes a model-specific system integrating data curation, architecture and training. Different video model systems are relevant background but do not define the MiniMax H3 prompt contract.
- [P87](https://www.krea.ai/blog/krea-2-technical-report) — Krea reports a learned prompt-expansion system intended to bridge underspecified user inputs and its dense training captions while preserving intent. It also describes house-style collapse as a concern. This is directly relevant developer evidence, not an independent test of WebCap's Director.

## Feature connections

The following are relevance mappings to the existing feature contracts, not approved changes or proof that the current implementation follows the research.

| WebCap feature / reference | Research relevance |
| --- | --- |
| [MiniMax H3 prompt guidelines](../mmh3-prompt-guidelines.md) and [active H3 authoring reference](../mmh3-prompt-runtime-context.txt) | H3 vendor documentation [V01](https://design.minimax.io/h3) distinguishes base/keyframe and multi-reference modes and links mode-specific prompt guides. Its hosted refinement path and open weights must not be assumed identical. |
| [Generate Director / Krea 2](../llm-guidance-architecture.md) | Krea's own prompt guide [V02](https://github.com/krea-ai/krea-2/blob/main/docs/prompting.md) recommends natural-language prompts and describes a prompt-expansion option. Its recommendations are model-specific; they do not determine H3 wording. |
| [Studio Director](../studio-director-contract.md) and [Prompt Assist](../studio-prompt-assist-project-deep-qa.md) | An authored scene needs meaningful depiction, visual specifics, motion and audio where appropriate to the author's intent. Separate generation-mode constraints from creative decisions. |
| [Wildcard and Prompt Tests](../epoch_finder_implementation.md) | Controlled prompts can help compare individual aspects of model behavior; a generated render is still the evidence. |

## Synthesis for later consideration

Model-developer documentation is the closest source for supported conditioning modes, prompt conventions and reference semantics. Independent benchmarks characterize limitations; they do not validate a particular WebCap template or prove that longer prompts always win.

## Open applicability questions

Direct independent prompt-ablation studies for WebCap's precise H3/Krea 2 checkpoints, reference modes and short clips are limited. The vendor guidance is living documentation checked on the stated date. No runtime reference, duration limit, scene template or guidance module has changed.
