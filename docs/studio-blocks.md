# Studio Blocks MVP

Studio Blocks is a standalone library of reusable text with **explicit slash insertion in the Studio Director composer**. Blocks remain independent of Projects and Scenes.

- Global types: Idea and Guidance (labels only).
- Data: `app_state_root()/studio_blocks.json`, array of `{id, title, type, content}`.
- Backend: `tool/server/studio_blocks.py`. GET/POST `/fs/studio-blocks`; PUT/DELETE `/fs/studio-blocks/<id>`.
- UI: Blocks button in Studio opens a searchable list and text editor; New, Save, Delete, and Copy to Clipboard. Content is copied as plain text.
- Type `/` at the beginning of a word in Studio Director's composer to search saved Idea/Guidance Blocks by name, type, or content. Select with arrows + Enter/Tab, or click. Esc dismisses. WebCap replaces only the slash query at the cursor with that Block's plain text; the entire author draft remains editable and is sent only if the author chooses Send.
- On-demand GET only while using `/`; ordinary Chat mode never retrieves Blocks for autocomplete. No hidden context injection or LLM calls.
- No revision tracking, Project/Scene linkage, or Director mutation authority.
- Atomic write protects the JSON file from partial writes.

## Verification still required
Run WebCap locally and test create/save/reopen/edit/copy/delete, slash lookup after creating a Block, caret-aware insertion in a partly written draft, keyboard navigation, Enter not sending prematurely, composer persistence, narrow window layout, and default/dark themes. No hidden context is sent. Node test covers matching and insertion; real browser behavior remains unverified. The GitHub connector cannot run the local WebCap browser/server.
