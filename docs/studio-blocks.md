# Studio Blocks MVP

Studio Blocks is a standalone library of reusable text. It does not integrate with Studio Director messages yet.

- Global types: Idea and Guidance (labels only).
- Data: `app_state_root()/studio_blocks.json`, array of `{id, title, type, content}`.
- Backend: `tool/server/studio_blocks.py`. GET/POST `/fs/studio-blocks`; PUT/DELETE `/fs/studio-blocks/<id>`.
- UI: Blocks button in Studio opens a searchable list and text editor; New, Save, Delete, and Copy to Clipboard. Content is copied as plain text.
- No revision tracking, slash commands, injected context, Project/Scene linkage, or Director chat changes.
- Atomic write protects the JSON file from partial writes.

## Verification still required
Run WebCap locally and test create/save/reopen/edit/copy/delete, persistence after restart, narrow window layout and default/dark themes. Validate no changed Director chat behavior. The GitHub connector cannot run the local WebCap browser/server.
