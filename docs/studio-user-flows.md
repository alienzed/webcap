# Studio Director — user flows and browser acceptance

**Current contract (2026-11-17).** This file follows [the authoritative Studio Director contract](studio-director-contract.md). Historical chat-draft, Review and Apply workflows are retired. The model contributes creative work; WebCap deterministically chooses destinations and saves actual returned fields.

## Universal pass criteria

- Chat is conversational and does not author structured saved fields, create action suggestions, or save. Unexpected structured text is shown verbatim; malformed text remains inspectable.
- An author explicitly chooses **Write → Project** (Create/Revise) or **Write → Scene(s)** (Create/Revise) and a destination. Each Write is a fresh, task-scoped model request using the **complete conversation history**, not a cached reply or shortened transcript.
- Ordinary chat and Project Write never receive H3 production reference instructions. Scene writing receives the H3 reference and the operation-specific response schema.
- Only author-approved saved Read references are automatically shared. Project navigation, conversation attachment and Write destination are independent.
- Saves occur directly, without a Studio Review/Apply stage. Verify actual persisted values after reload; do not infer saves from model prose, UI status or job completion.
- WebCap displays real errors/raw I/O rather than making creative-completeness judgments, inventing missing values or automatically repairing model output.
- Keep standalone **Develop Scenes**, **Revise Scenes**, **Revise & Generate**, **First Cut** and **Coherence** operational. Specialist review surfaces used by those distinct functions are not the retired Director Write Review.

## Core journeys

### 1. Conversation, then create Project

Start with no attached Project. Discuss an idea and ask for a recommendation. Confirm the first request is `studio_chat`, has no Project/Scene schema and makes no saved changes. Click Write → Project → Create, optionally leaving the instruction empty after clear discussion. Confirm the next request is `studio_project_draft`, includes the entire preceding conversation and a Project-only schema, and saves title, concept, style and invariants directly. Reload to verify; no Review dialog appears.

### 2. Write new Scenes

Choose a saved Project; discuss staging in chat. Click Write → Scene(s) → Create. Confirm the `studio_scenes_draft` request includes the full conversation, selected Project, relevant Scene continuity, approved Read sources and H3 guidance. Save each mechanically usable returned Scene (title, prompt, supported duration) with a generated ID. Actual record count may differ from the request. On a mixed valid/invalid batch, preserve usable records, explain what could not save and make raw I/O available. Never synthesize a prompt/title/duration.

### 3. Revise only a selected Scene

Select one Scene, write a creative revision and verify `studio_scene_field_draft` includes that Scene's fresh saved prompt and task-scoped H3 guidance. Confirm direct save changes only requested fields; sibling Scenes, takes, title and duration stay unchanged unless explicitly selected. Check Scene History; repeat Write and confirm a fresh model call with the latest saved baseline, not an old cached draft.

### 4. Revise a Project independently

Choose a Project Write destination independently of navigation/attachment. Revise the atmosphere only. The model should return a complete Project baseline while preserving unrelated fields; WebCap compares with current saved values and writes only actual changes. Confirm Scenes remain untouched. Test another destination without changing conversation attachment.

### 5. Explicit cross-Project Read

Approve an Overview in Project A, an individual Scene in B and one character Invariant in C. Discuss the references in chat, then explicitly Write to D. Confirm all approved facts reach the real model in both chat and Write, no unapproved creative fields leak and only D receives the write. Revoke one source; all other approvals remain.

### 6. Continue across navigation and repeated Writes

Discuss an idea, navigate between Projects without reattaching, and return. Confirm complete chat messages survive in sequence. Explicitly create a Scene, discuss its outcome and create another; confirm each Write is a distinct model request and the first saved Scene remains unchanged.

### 7. Failure and recovery

Exercise invalid JSON, unexpected prose from an explicit structured Write, provider failure, interrupted job, save conflicts and post-save receipt failure. Check raw request/response and error in I/O and Console; no implicit retry/repair. A confirmed save remains saved even if later conversation recording fails. An unsaved response never appears saved. Existing field History/Undo/Redo handles recoverable saved text versions.

### 8. Specialist workflows

Develop Scenes, revise one/many saved Scenes, Revise & Generate and check Coherence through their existing controls. Preserve current functional behavior and separate task-specific guidance; do not replace these with generic Director chat, or remove necessary specialist review interfaces. Check First Cut and continuity where relevant.

## Evidence and commands

The deterministic Chromium suite is `npx playwright test --config=playwright.config.cjs`. The opt-in real-model suite is `npx playwright test --config=playwright.live.config.cjs`; its actual model, inference backend and configuration must be available on the machine running it. `node --test tests/studio_director_*.test.cjs tests/studio_scene_*.test.cjs` and focused Python tests verify request construction, state and persistence but do **not** substitute for real-model results.

Tests must record the actual operation, relevant outbound message/schema, raw response, persisted fields and relevant error. A response's creative *quality* may be judged separately; schema compliance and persistence correctness are application tests, not creative quality scores. Do not rewrite failing tests to reinstate retired behavior or treat a skipped live test as a pass.
