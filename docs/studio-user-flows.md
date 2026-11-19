# Studio Director — user flows and browser acceptance

**Current contract (2026-11-17).** This file follows [the authoritative Studio Director contract](studio-director-contract.md). Historical chat-draft, Review and Apply workflows are retired. The model contributes creative work; WebCap deterministically chooses destinations and saves actual returned fields.

## Universal pass criteria

- Chat is conversational: short remarks and straightforward questions usually receive one or two short paragraphs, with greater detail or complete creative material when requested. Chat can discuss draft ideas but does not create structured saved application fields, trigger Write or save. Unexpected structured text is shown verbatim; malformed output remains inspectable.
- An author explicitly chooses **Write → Project** (Create/Revise) or **Write → Scene(s)** (Create/Revise) and a destination. Each Write is a fresh, task-scoped model request using the **complete conversation history**, not a cached reply or shortened transcript.
- Ordinary chat and Project Write never receive H3 production reference instructions. Scene writing receives the H3 reference and the operation-specific response schema. The optional Action Advisor is a separate, default-enabled, settings-controlled sidecar that can prefill manual actions only after Prepare.
- Only explicit Read captures saved material. Each complete snapshot is visible and persisted as a user conversation message; subsequent requests transmit the unchanged message, without rereading or hidden system context. Project navigation, attachment and Write destination remain independent.
- Saves occur directly, without a Studio Review/Apply stage. Verify actual persisted values after reload; do not infer saves from model prose, UI status or job completion.
- WebCap displays real errors/raw I/O rather than making creative-completeness judgments, inventing missing values or automatically repairing model output.
- Keep standalone **Develop Scenes**, **Revise Scenes**, **Revise & Generate**, **First Cut** and **Coherence** operational. Specialist review surfaces used by those distinct functions are not the retired Director Write Review.

## Core journeys

### 1. Conversation, then create Project

Start with no attached Project. Discuss an idea and ask for a recommendation. Confirm the first request is `studio_chat`, has no Project/Scene schema and makes no saved changes. Click Write → Project → Create, optionally leaving the instruction empty after clear discussion. Confirm the next request is `studio_project_draft`, includes the entire preceding conversation and a Project-only schema, and saves title, concept, style and invariants directly. Reload to verify; no Review dialog appears.

### 2. Write new Scenes

Choose a saved Project; discuss staging in chat. Click Write → Scene(s) → Create. Confirm the `studio_scenes_draft` request includes the full conversation, selected Project, relevant Scene continuity, previously captured Read messages and H3 guidance. Save each mechanically usable returned Scene (title, prompt, supported duration) with a generated ID. Actual record count may differ from the request. On a mixed valid/invalid batch, preserve usable records, explain what could not save and make raw I/O available. Never synthesize a prompt/title/duration.

### 3. Revise only a selected Scene

Select one Scene, write a creative revision and verify `studio_scene_field_draft` includes that Scene's fresh saved prompt and task-scoped H3 guidance. Confirm direct save changes only requested fields; sibling Scenes, takes, title and duration stay unchanged unless explicitly selected. Check Scene History; repeat Write and confirm a fresh model call with the latest saved baseline, not an old cached draft.

### 4. Revise a Project independently

Choose a Project Write destination independently of navigation/attachment. Revise the atmosphere only. The model receives the current Project baseline but is requested to return **only** the selected replacement field(s); WebCap applies only values in scope and ignores returned off-scope fields. Confirm saved unrelated Project fields and Scenes remain untouched. Test another destination without changing conversation attachment.

### 5. Explicit cross-Project Read

Read an Overview in Project A, an individual Scene in B and a character Invariant in C. Each click captures the current saved fields and appends one full visible message to the existing conversation; Read itself makes no LLM call. Compare that exact message text with the user messages supplied to later ordinary chat and Write operations. Edit and empty the original fields, reload the conversation and confirm the old snapshots are identical. Only an additional explicit Read reflects later values. Write to D and confirm A/B/C remain unchanged and D is the sole destination. Navigation, attachment and source mutation cannot add, refresh or remove a snapshot.

### 6. Continue across navigation and repeated Writes

Discuss an idea, navigate between Projects without reattaching, and return. Confirm complete chat messages survive in sequence. Explicitly create a Scene, discuss its outcome and create another; confirm each Write is a distinct model request and the first saved Scene remains unchanged.

### 7. Failure and recovery

Exercise invalid JSON, unexpected prose from an explicit structured Write, provider failure, interrupted job, save conflicts and post-save receipt failure. Check raw request/response and error in I/O and Console; no implicit retry/repair. A confirmed save remains saved even if later conversation recording fails. An unsaved response never appears saved. Existing field History/Undo/Redo handles recoverable saved text versions.

### 8. Specialist workflows

Develop Scenes, revise one/many saved Scenes, Revise & Generate and check Coherence through their existing controls. Preserve current functional behavior and separate task-specific guidance; do not replace these with generic Director chat, or remove necessary specialist review interfaces. Check First Cut and continuity where relevant.

## Evidence and commands

The deterministic Chromium suite is `npx playwright test --config=playwright.config.cjs`. The opt-in real-model suite is `npx playwright test --config=playwright.live.config.cjs`; its actual model, inference backend and configuration must be available on the machine running it. `node --test tests/studio_director_*.test.cjs tests/studio_scene_*.test.cjs` and focused Python tests verify request construction, state and persistence but do **not** substitute for real-model results.

Tests must record the actual operation, relevant outbound message/schema, raw response, persisted fields and relevant error. A response's creative *quality* may be judged separately; schema compliance and persistence correctness are application tests, not creative quality scores. Do not rewrite failing tests to reinstate retired behavior or treat a skipped live test as a pass.
