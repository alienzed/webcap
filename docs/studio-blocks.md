# Studio Blocks MVP

Studio Blocks is a standalone library of reusable text with **explicit slash insertion in the Studio Director composer and Project Invariant text fields**. Blocks remain independent of Projects and Scenes.

- Global types: Idea and Guidance (labels only).
- Data: `app_state_root()/studio_blocks.json`, array of `{id, title, type, content}`.
- Backend: `tool/server/studio_blocks.py`. GET/POST `/fs/studio-blocks`; PUT/DELETE `/fs/studio-blocks/<id>`.
- UI: Blocks button in Studio opens a searchable list and text editor; New, Save, Delete, and Copy to Clipboard. Content is copied as plain text.
- Type `/` at the beginning of a word in Studio Director's composer or an editable Project Invariant to search saved Idea/Guidance Blocks and current Project Invariants by name, type, or content where applicable. Select with arrows + Enter/Tab, or click. Esc dismisses. WebCap replaces only the slash query at the cursor with that Block's plain text; the entire author draft remains editable and is sent only if the author chooses Send.
- On-demand GET only while using `/`; ordinary Chat mode never retrieves Blocks for autocomplete. No hidden context injection or LLM calls.
- Blocks are stored globally and do not become linked to a Project or Scene through insertion. Project Invariants are separately persisted on their Project; slash insertion copies text rather than storing a reference. No Block revision tracking or Director mutation authority.
- Atomic write protects the JSON file from partial writes.

## Verification status
The deterministic Playwright suite now covers a Block's create/save/reopen/edit/copy/delete lifecycle and slash keyboard selection, Escape, Enter without Send, and draft retention; its execution is still required for the new test. Existing browser and live tests cover insertion of authored text and its delivery to the model. Project Invariant slash insertion, narrow layouts, and light/dark theme checks remain coverage gaps. No hidden Block context should be sent. The GitHub connector cannot run the local WebCap browser/server.
