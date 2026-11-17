# Studio Director — focused Chat and explicit Write implementation

Status: implemented on `studio/focused-chat-write-contracts`, pending executable tests and browser/live-model acceptance. The [functional-contract amendment](studio-director-contract.md) supersedes earlier mixed-conversation authoring requirements. This document does not certify runtime behavior.

## Baseline and evidence
- `tool/server/studio_director.py` supplied creative and H3 authoring instructions to every ordinary Director chat, even discussion-only requests.
- `tool/server/app.py` attached a combined `reply` / `changes` / `scenes` schema to `studio_chat`.
- `tool/js/director_chat.js` passed only eight conversation turns, abbreviated long history messages, and could promote structured chat fields to reviewable writes. A recorded live conversation lost its earlier Scene context as a result.
- The explicit `studio_project_draft`, `studio_brief_draft`, `studio_scenes_draft`, and `studio_scene_field_draft` operations and existing save APIs already support focused Write. The existing batch Scene writer applies single-Scene revisions successively.

## Incremental implementation
1. **Contract first:** document Chat as prose, Write as an explicit action, retain existing independently approved saved Read references and destination ownership. Do not infer operations from conversation words.
2. **Conversation isolation:** add a small Chat-only system primer; run `studio_chat` without a structured schema; stop prompting ordinary Chat to author Project or Scene records; reject unexpected JSON visibly without silently displaying it as dialogue. Preserve old conversation transcripts without rewriting them.
3. **History correctness:** send the complete user/assistant exchange for Chat and explicit Write, filtering only existing machine-generated receipt markers. Remove eight-message tail selection, long-message shortening and implicit compaction. Surface provider failures.
4. **Focused writing:** retain the existing operation-specific field schemas and H3 references only for writes requiring H3 prompts. Supply the full conversation alongside task-specific inputs. Use existing authoritative Project, Overview and Scene save endpoints and preserve their field history; no new general agent, intent classification or repair loop.
5. **No new review layer:** newly authored Project and Overview writes save through existing endpoints; new Scene uses existing direct-save; batch Scene revisions already save per Scene. Keep old Review code for historical saved draft compatibility rather than deleting state formats. Incomplete direct writes fail visibly instead of inventing fields.
6. **Regression coverage:** update obsolete assertions about eight-message truncation and combined conversational authoring; add deterministic request-assembly/schema tests and mock browser Chat → explicit Write coverage. Real-model and browser verification remain required before merge.

## Acceptance before merge
- Run the focused Node tests, the Studio/Storyboard regression suites and browser tests in an environment with the repository checked out.
- Run a real Director chat with ordinary natural prose; verify provider request has no response schema or H3 production text and visible response contains no raw JSON.
- Chat across more than eight alternating turns and inspect the exact outbound request to confirm no earlier turns or long passages were dropped.
- Explicitly Write a new Project, revise its Overview, create a Scene and revise its Prompt/title; inspect actual saved fields, field Undo/Redo, errors and the direct-save behavior.
- Switch navigation while keeping the same conversation; verify approved saved references remain explicit, the conversation remains independent, and authored content is placed only into the selected Write destination.
- Restore older saved conversations containing structured drafts and confirm their historical content remains readable.
- Observe one incomplete Write and one model context error: neither should be silently treated as success.

## Rollback
No migration of saved conversation storage is performed. The feature branch leaves `main` unchanged until review. Revert the isolated commits if acceptance fails. Existing historical Review code remains for compatibility.

## Known limitations
- A focused schema does not prove the model followed creative semantics or returned every required field.
- Unlimited history can exceed the model's actual usable context. Automatic compaction and model-limit prediction are explicitly out of scope.
- Full live/provider/browser acceptance has **not** been run as part of this connector-only change; do not report these flows as verified.
