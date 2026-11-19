# Visual Director — broader failure-mode tests

One fixed 24-call run: six new fixtures against the unchanged four Round 2 candidates. A is original visual-state accounting, B generic exhaustiveness, C combined accounting/exhaustiveness, D concise exhaustiveness. Prompts are referenced from prior experiments without edits.

Tests cover equipment substitution, selective continuity of physical state, two-person prop-transfer geometry, filtering irrelevant Project context, precise camera continuity, and restraint on a complete moving Scene. These extend the fashion-heavy tests rather than repeat them.

Use existing `/fs/director/chat`, `operation: freeform_chat`, actual system candidate plus user fixture; same selected Gemma model/settings and existing queue/GPU policy. Fresh conversations, no expected findings in model inputs, no repair/judge calls or prompt tuning. Capture exact requests, raw HTTP receipts, output text, execution metadata and settings under ignored `results/`. No Project mutations or production changes. Stop on operation failure.

Score candidate-hidden outputs before revealing identities. Five dimensions scored 0/1/2: relevant visual completeness; correct state replacement/preservation; concrete physical or camera execution; Scene scope and invariant preservation; standalone readiness with decided details. Maximum 10 per fixture, 60 total. Add a separately reported 0/1/2 restraint score on fixture 06 (maximum 62 total). Generic plausible completion is allowed, but explicit invariants take precedence. Record critical misses separately; a high total cannot erase a broken camera constraint or handoff. For the complete control, cosmetic rewording is acceptable but gets less restraint credit than unchanged; added visual requirements are gratuitous.

This evaluates prompt text, not actual rendered video. One sample per combination gives exploratory evidence, not reliability estimates.
