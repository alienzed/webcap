# R16 — Model assessment and judge reliability

Status: initial evidence notes, 2026-11-27. Documentation only; no product changes, prompt rewrites, additional experiments or runtime validation authorized. See the [research index](README.md) and [bibliography](references.md).

## Scope and method

Representative task probes, measurement boundaries, model comparisons and optional model judgment of saved results.

Targeted first-pass review of primary publication records and abstracts, plus relevant developer guidance where explicitly marked. Source findings are bounded to the studied models and tasks. This is not a systematic or full-text review and does not establish WebCap-specific effectiveness.

## Published evidence

- [P79](https://arxiv.org/abs/2211.09110) — HELM motivates measuring several desiderata across explicitly defined scenarios rather than relying on a single accuracy score. It also records coverage gaps and trade-offs.
- [P15](https://arxiv.org/abs/2306.05685) — MT-Bench and Chatbot Arena demonstrate that strong LLM judges can approximate human preferences in their tested setting, while identifying position, verbosity, self-enhancement and reasoning biases. Agreement on a general chat benchmark is not proof of agreement on creative specs.
- [P24](https://arxiv.org/abs/2311.07911) — IFEval measures verifiable instruction following; its scope is concrete constraints, not overall useful output. See [R01](R01-prompt-structure.md).
- [P38](https://arxiv.org/abs/2501.10868) — Structured-generation benchmarking separates schema support, efficiency and substantive output quality; see [R03](R03-structured-outputs.md).
- [P29](https://arxiv.org/abs/2404.06654) — Long-context benchmarks measure actual task performance over length rather than nominal capacity. [P53](https://openaccess.thecvf.com/content/CVPR2025/html/Fu_Video-MME_The_First-Ever_Comprehensive_Evaluation_Benchmark_of_Multi-modal_LLMs_in_Video_Analysis_CVPR_2025_paper.html) similarly assesses distinct video-understanding capabilities.

## Feature connections

The following are relevance mappings to the existing feature contracts, not approved changes or proof that the current implementation follows the research.

| WebCap feature / reference | Research relevance |
| --- | --- |
| [Model Assessment contract](../model-assessment-consolidation.md) | Use existing real-workflow probes and distinguish runtime failures, malformed material, visible output, model opinion and measured throughput. |
| [Studio guidance evaluation](../studio-guidance-evaluation.md) | An earlier comparison is evidence about its model, requests and criteria; it should not be generalized to an untested profile, model or rendering outcome. |
| [Prompt Tests / Campaigns](../epoch_finder_implementation.md) | Training-checkpoint evaluation and language-model assessment answer different questions. Preserve comparable settings and provenance when interpreting existing results. |

## Synthesis for later consideration

The published methodology supports interpreting evidence by task, metric and model rather than one universal winner. A judge is a source of fallible evidence, not a correctness gate. Existing assessment and ordinary software testing remain separate from reproducing published studies.

## Open applicability questions

The cited studies do not rank WebCap's actual model variants or establish human agreement on its production specifications. No new benchmark, test suite, judge, scoring formula or empirical validation is commissioned by this documentation.
