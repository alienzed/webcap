# Studio Director — PR #1021 implementation and acceptance tracker

The [normative Studio contract](studio-director-contract.md) and
[implementation map](studio-director-implementation.md) are authoritative.
This file is an audit/verification tracker, not another architecture.
Previous phases referring to Review, draft retention or refusal of non-error
LLM output have been superseded and removed from current documentation.

## Staged work

1. **Contract and hostile guidance audit:** separate conversational and
   structured authoring responsibilities; affirm GIGO, direct field writes,
   History for reversal and I/O for raw failures. No prose interpretation,
   automatic compaction, or semantic validation.
2. **Focused request paths:** Chat = all real conversation turns and
   conversational primer only. Write = same conversation exactly once,
   selected operation-specific positive instructions and matching response
   schema; H3 reference only for prompt authoring.
3. **Deterministic apply:** route each actual response to its initiating
   operation and intended fields/selected records, update editors and
   authoritative saves. Do not add a second approval phase.
4. **Delete old runtime:** remove Chat `reply/changes/scenes` authoring,
   suggested actions, readiness, Review/Apply forms, retained draft
   orchestration and duplicated writers; keep saved old conversations readable
   but inert.
5. **Prove behavior:** unit/backend schema tests, Playwright mock Chat→Write,
   real-model creative flows, History backward/forward, exact I/O and real save
   failures. Tests should not reward old systems remaining.

## Required acceptance evidence

- Chat across more than eight turns; requests contain complete role-separated
  turns and responses are prose without H3 schema.
- Explicit Create Project, Overview revision, Scene creation (actual returned
  records), Scene revision with title-only/duration-only/prompt changes.
- No prompts to Review or speculative extracts; no prose-derived Write actions.
- Returned fields are placed deterministically with working History.
- Failed provider or save leaves full copyable raw response and request in I/O
  and the actual operational error in Console.
- Historical Project/Scene data and conversation archive still load without
  reviving obsolete execution paths.
- CI, focused unit suites and Playwright real/mock acceptance actually run and
  pass before the PR can merge.

**Current status:** Work in progress on `studio/focused-chat-write-contracts`.
Do not infer acceptance or merge readiness from syntax-only checks.
