# Studio Blocks — isolated MVP implementation contract

Status: feature branch `feature/studio-blocks-mvp`; pending local runtime/browser verification. Follows `AGENTS.md` and `docs/filesystem_state_contract.md`.

## Purpose
Small reusable, explicitly inserted text Blocks, distinct from Projects/Scenes and the Director Playbook. Two types: **Idea** (creative material), **Guidance** (material intended to guide Director). Type is descriptive; neither is silently injected into Director.

## Codebase audit
- WebCap is classic JS + HTML/CSS, not a component framework. Shell at `tool/tool.html`; Studio at `tool/js/storyboard.js`; Director composer at `tool/js/director_chat.js`.
- Director submits `director-chat-input` text to message history and model. Inserting a visible snapshot directly into the composer avoids changing model-facing prompt assembly, Project state, or persistence.
- Durable small host-local state belongs under `config.app_state_root()`, not FS_ROOT, output/storyboards, or browser localStorage.
- The new feature owns `tool/server/studio_blocks.py`, `tool/js/studio_blocks.js`, `tool/css/studio_blocks.css`. Shell-only integration: a Studio Blocks button, a dialog, a composer picker, and script/style inclusion. Backend only registers routes.

## Safe phases and acceptance
### Phase 1 — persistence/API (implemented)
- `GET/POST /fs/studio-blocks`; `PUT/DELETE /fs/studio-blocks/<id>`.
- Stable random ID, title, type, content, revision and timestamps. Revision conflict is a visible HTTP 409.
- Atomic JSON writes beneath `app_state_root()/studio_blocks.json`; isolated from Story/Director models.
- Verify create, list, update, revision conflict, delete, missing ID, malformed input, restart persistence, and read/write errors.

### Phase 2 — management UI (implemented)
- Studio library **Blocks** action opens a two-pane dialog, searchable Blocks list and focused editor.
- New, edit, save, delete with explicit confirmation. Dirty editor prompts before switching or closing.
- No startup network request: load on demand.
- Verify keyboard/focus, narrow viewport, error visibility and application color/type conventions.

### Phase 3 — composer slash references (implemented)
- In Studio Director, type `/` then filter by title, type or content; arrows/Tab/Enter select; Escape dismisses.
- Selection inserts a *visible, editable text snapshot* with explicit Block label, type and content. It is included in the normal user message and persistence; no permanent Block ID link or automatic future injection.
- No modifications to model request assembly or Director chat history storage.
- Verify multi-line drafts, cursor insertion, deletion, names with punctuation, send, session reopen, and unchanged non-Studio chat.

### Phase 4 — regression and release (pending environment)
- Run backend API tests and JS syntax/lint using repository's normal tooling; exercise app in a live browser.
- Specifically verify existing Project fields, Scene/Takes, Director send/restore, unrelated Assistants, and no initial network load.
- Merge only after runtime/browser validation. Rollback is limited to three feature files plus isolated markup/script and route registration; persisted library remains intact.

## MVP exclusions
No folders, tags, semantic search, implicit context injection, AI creation/updates, automatic Studio field writes, Block version history, or synchronization with Project fields.

## Known limit
The connector can commit GitHub files but cannot run the local WebCap server/browser; runtime checks remain explicitly unverified. This document records an implementation branch, not a claim of runtime validation.
