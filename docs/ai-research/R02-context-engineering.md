# R02 — Context engineering

Status: initial evidence notes, 2026-11-27. Documentation only. No changes to request assembly, history, Read, Write, retrieval, prompt guidance, settings, or product contracts. See the [research index](README.md), [bibliography](references.md), and [R01 prompt structure](R01-prompt-structure.md).

## Scope and method

Context engineering here means selecting and presenting the information a model needs for its current task: source evidence, task instructions, earlier conversation, saved state, and relevant specialist knowledge. Distinguish durable application state and complete stored conversation from the information actually sent in an individual request.

This targeted pass uses primary publication records and abstracts for P04 and P28–P37. It is not a systematic or full-text review. Reported benchmark results are descriptions of the authors' experiments, not estimates for WebCap. No local inference, benchmark reproduction, architecture change, or new validation requirement is proposed.

## Evidence

| Question | Published finding | Limits and relevance |
| --- | --- | --- |
| Does placement matter? | [P04 — Liu et al. (TACL 2024)](https://aclanthology.org/2024.tacl-1.9/) varied relevant information's position in document QA and key-value retrieval. Accuracy was often strongest near the start or end and weaker in the middle. | Important information can become hard to use even when present. This does not establish an ideal universal message order, justify duplicating every important fact, or prove the same pattern in creative dialogue. |
| Can irrelevant information interfere? | [P28 — Shi et al. (ICML 2023)](https://proceedings.mlr.press/v202/shi23a.html) introduced irrelevant details into grade-school arithmetic problems and observed worse reasoning. [P36 — Amiraz et al. (ACL 2025)](https://aclanthology.org/2025.acl-long.892/) studied particularly distracting irrelevant retrieval passages and demonstrated improvements from training with those passages. | Context relevance is consequential. Related but misleading text may be especially distracting. Neither study shows that removing older creative discussion is safe or that WebCap needs a retriever or another trained model. |
| Is the advertised context window an effective working window? | [P29 — RULER](https://arxiv.org/abs/2404.06654) found many of 17 tested models deteriorated with length and harder synthetic retrieval, aggregation and tracing tasks. [P30 — NoLiMa (ICML 2025)](https://proceedings.mlr.press/v267/modarressi25a.html) reported that at 32K tokens, 11 of 13 evaluated models fell below half their short-context baseline when finding facts required semantic associations rather than literal matches. [P35 — LongBench v2 (ACL 2025)](https://aclanthology.org/2025.acl-long.183/) extended evaluation to challenging realistic tasks including dialogue histories and structured data. | Input acceptance, literal retrieval and meaningful synthesis are different abilities. The studies do not establish a fixed useful limit for WebCap's models, a character-to-token conversion, or a universal compaction threshold. |
| What changes across conversation turns? | [P31 — Laban et al. (ICLR 2026)](https://arxiv.org/abs/2505.06120) simulated underspecified requests delivered incrementally rather than all at once. Across six tasks and over 200,000 simulated conversations the authors report an average 39% performance decline, associated with premature solutions and continued reliance on earlier assumptions. | Highly relevant to iterative creative discussion followed by explicit authoring. Simulated task completion is not the same as collaborative artistic exploration. The result does not imply avoiding conversation, deleting history, or requiring a final restatement on every Write. |
| Can the model distinguish older facts from updated facts? | [P32 — LongMemEval (ICLR 2025)](https://proceedings.iclr.cc/paper_files/paper/2025/hash/d813d324dbf0598bbdc9c8e79740ed01-Abstract-Conference.html) evaluates retrieval, cross-session and temporal reasoning, knowledge updates and abstention. Existing assistants and long-context models struggled with sustained history; the authors report benefits from improved indexing and time-aware retrieval. | A snapshot, later correction, assistant suggestion, and saved value have different authority and temporal scope. This benchmark is QA over histories, not evidence that automatic memory or hidden reads are appropriate for WebCap. |
| Is selective retrieval always better than full context? | [P33 — Li et al. (EMNLP Industry 2024)](https://aclanthology.org/2024.emnlp-industry.66/) compared retrieval with supplying long contexts on several datasets using three LLMs. Full context gave better average results when sufficiently resourced; retrieval was cheaper. | Counterweight to simplistic advice to minimize every prompt. Selection can omit indispensable information. These results involve powerful models and retrieval-based QA, not the current local model mix or WebCap's deterministic context assembler. |
| Can compression preserve important information? | [P34 — LLMLingua-2 (Findings ACL 2024)](https://aclanthology.org/2024.findings-acl.57/) trained an extractive compressor and measured efficiency and task performance on several benchmarks. [P37 — Min and Song (Findings EMNLP 2026)](https://aclanthology.org/2026.findings-emnlp.1075/) studied streaming dialogue summarization and found benefits from retrieving evidence needed to resolve dependencies of the current dialogue window. | There are demonstrated compression and selection approaches, but success on these tasks does not guarantee preservation of a particular creative decision, exact wording, uncommon attribute, or rejected alternative. The studies do not support introducing a new summarizer, memory subsystem, or learned retriever without a separate decision. |

## WebCap's existing context contracts

The following describes the inspected implementation and existing documentation, rather than adopting a new context architecture. Source baseline: [main at 5e4c7bb4185e](https://github.com/alienzed/webcap/tree/5e4c7bb4185ec1bcda1a56cfa9683c175c60d708).

### Director: transcript, Read, and request context

- [Studio Director contract](../studio-director-contract.md) distinguishes explicit user-visible Read snapshots, persisted conversation, and exact saved Write targets. It also states that the entire history is sent verbatim.
- [Context assembly implementation note](../studio_director_context_assembly.md) documents an extractive working request view for longer conversations, with retained recent messages, selected older source text and pinned Read snapshots. It retains the complete transcript separately and exposes the assembled messages in I/O.
- [Current enqueue implementation](https://github.com/alienzed/webcap/blob/5e4c7bb4185ec1bcda1a56cfa9683c175c60d708/tool/server/llm_runner.py#L1360-L1376) defaults WEBCAP_STUDIO_CONTEXT_MODE to chat, calls the assembler for Studio Chat unless mode is full, and allows it for enumerated Write operations in all mode. [Assembler source](https://github.com/alienzed/webcap/blob/5e4c7bb4185ec1bcda1a56cfa9683c175c60d708/tool/server/director_context.py) owns selection logic. The deployed environment's override is not known.

**Documented discrepancy:** the full-history language in the Director contract and the working-context assembly implementation are not aligned. This is not a conclusion about which is preferable. The research is relevant to both. The functional contract, implementation and default/override semantics should be reconciled separately with the author; this pass deliberately changes neither. Do not infer a hidden Read or transcript deletion from selective request assembly.

### Feature connections

| Feature | Existing context boundary | Research question for later review |
| --- | --- | --- |
| Director Chat and explicit Read | Full persisted transcript; explicit source snapshots; request compaction described above. | Which historical facts and decisions are needed, which earlier proposals were rejected, and what happens when the task refers implicitly to an older decision? P04, P28–P32, P35, P37. |
| [Write Project / Scenes](../llm-guidance-architecture.md) | Separate operation task, selected saved target baseline and specialist guidance; full-history default in enqueue implementation. | How should the model distinguish the current authoring request, approved material, previous drafts and relevant continuity? P04, P31, P32, P33. |
| [Caption Assist](../../tool/server/caption_ops.py) | Current item draft, annotations, Sight and template/Primer context have different roles. | Is factual item evidence distinguishable from structural examples, and is unrelated vocabulary or prior draft material distracting? P28, P36. |
| [Discover Vocabulary and Guided Tagging](../vision_schema_assist.md) | Discovery uses a group-aware inspection withholding existing terms, then aggregates observations; guided tagging uses current vocabulary and evidence. | Which evidence aids open discovery versus assignment, and which could anchor the model to already-known terms? P28, P30, P33; direct taxonomy/vision evidence belongs to R05/R12. |
| [Set Deep QA / Concept Check](../set_intelligence.md) | Bounded set evidence for hypotheses; focused item evidence for concrete checks, with freshness and scope ownership. | Which rare but important observations survive bounded aggregation? When is evidence insufficient for a conclusion? P29, P30, P32, P33. |
| [Prompt Assist / Project Deep QA](../studio-prompt-assist-project-deep-qa.md) | One Scene and relevant optional current findings versus whole-Project analysis. | What information is essential for a local revision versus cross-Scene reasoning? P04, P28, P33, P35. |
| [First Cut](../storyboard_llm_guidance.md) and [Action Advisor](../studio-action-advisor-mvp.md) | Task-specific planning context or known operation context, not unrestricted hidden state. | How much prior discussion or state does the explicit task actually require? P28, P31, P32. |

## Evidence synthesis for a later pass

These are considerations, not adopted changes.

- Relevance and completeness are both important. Supplying less text may reduce interference, but omission can prevent the requested task from being completed.
- Preserve the distinction between conversation history, current saved fields, point-in-time Read snapshots, proposals, and the current task.
- Context length, placement, model capability and source authority are separate questions. A request fitting a runtime's context limit is not proof that all necessary facts will be used.
- Long conversations require attention to decisions that change over time and earlier proposals that may be incorrect. The studies do not determine whether full history, extractive selection, explicit user Read, or a different design is best for WebCap.
- Keep these research observations separate from ordinary software correctness and user-authorized mutations. No new context gate, model-based selection, summarizer, or live experiments are introduced.

## Open questions

Direct evidence remains limited for small quantized models producing long creative specifications, maintaining precise narrative continuity, and preserving author-approved choices through iterative revisions. We also lack direct evidence for WebCap's specific extractive selection strategy, its threshold, its interaction with multiple Projects, and the model's treatment of later corrected snapshots. These are applicability gaps, not a mandate to reproduce the research.

Next topic: R03 — structured outputs and schema design.
