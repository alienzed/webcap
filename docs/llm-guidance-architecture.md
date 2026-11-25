# Configurable LLM guidance — implementation and request inventory

## Purpose

Give the author explicit, editable ownership of creative prompts while keeping WebCap's deterministic contracts, saving and queue behavior in code. A configured module **replaces** its named default; blank/reset restores the versioned built-in source. This is not a second prompt appended on top of an uneditable copy.

## Active sources

| Path / operation | Creative guidance source | Task/technical material |
| --- | --- | --- |
| Studio Chat | Selected `studio.*` profile + basic H3 capabilities | Saved conversation (source-grounded context assembly); concise conversational instruction; no H3 authoring reference |
| Studio Write Project | Selected `studio.*` profile + basic H3 capabilities | Author's selected task and Project fields, operation response schema |
| Studio Write Scene | Selected `studio.*` profile | `h3.toolkit` + `h3.authoring`, current task and saved Scene/Project context, response schema; empirical playbook |
| First Cut concept / Scene planning | `storyboard.director` | Operation-specific request, relevant Project context; Scene development also uses `h3.authoring` + `h3.toolkit` + empirical playbook |
| Standalone Visual Direction | `task.visual_direction` | Existing Scene prompt, relevant Project scope, `h3.authoring` + `h3.toolkit`, schema |
| Prompt Assist | `task.prompt_assist` | Text-only Scene, relevant Project context and optional Project Deep QA findings; schema |
| Project Deep QA | `task.project_deep_qa` | Complete supplied Project Scene text and exact finding schema |
| Generate Director | `task.generate` | User idea / refine instruction; model-dependent `h3.authoring` + `h3.toolkit` + playbook for H3; image guidance remains model-specific |
| Action Advisor | `task.action_advisor` | Known action context, output schema; no access to hidden saved Project facts |

The existing `generation_model_guidance` remains the empirical playbook in app config. Its data is neither discarded nor duplicated into module overrides; it is edited in **Settings → LLM Guidance** and delivered to existing authoring operations.

## Ownership

- `tool/server/studio_guidance_defaults.py` contains the four versioned profile defaults. The four profiles retain their IDs and share a lean creative core; Classic has no extra emphasis. Prior experimental packages retain their frozen text.
- `tool/server/llm_guidance.py` owns the catalog, H3 creative toolkit, standalone specialist role defaults, and replacement lookup.
- `docs/mmh3-prompt-runtime-context.txt` remains the canonical H3 prompt reference default. `docs/storyboard-director-context.txt` remains the Storyboard Director default.
- `config.json.llm_guidance` contains only sparse text overrides, validated against known IDs.
- `/fs/llm/guidance/catalog` returns module identities, descriptions, defaults and saved override status for the Settings editor.
- `tool/js/app_settings.js` edits one selected module at a time, with immediate Reset to Default and the existing Save buttons.
- Subsequent requests see saved guidance immediately without reboot; in-flight jobs are unchanged.

## Boundaries preserved

User-configurable instructions are *creative/behavioral prompts*. WebCap still owns operation selection, current task parameters, selected/saved context, target IDs, response schemas, parsing, persistence, model queueing, GPU coordination, first/last-frame alignment, and failure reporting. Dynamic operation task payloads remain assembled in the owning function. No implicit chat Write, changed Scene count policy, new gating, or automatic model review is introduced.

## Audited remaining hardcoded material

The following are currently **task payloads**, not editable persona/modules: operation-specific `[CURRENT TASK]` segments inside `storyboard_llm_contract.py`, per-target Write instructions built by `director_chat.js`, response schema descriptions, certain text/image captioning assistants in separate workspaces, and specialized LoRA/training guidance. Their scope must be individually checked before extraction because many contain concrete task parameters, selected scope, or output requirements. Do not blindly move every string into global H3 guidance.

One verified drift was reconciled: Storyboard prompt revision's 6–15s wording now matches supported H3 4–15s generation. The H3 and Storyboard defaults now respect author-selected pacing rather than prescribing a central event. The toolkit is limited to prompt writing, and the technical reference retains timing, structure and dialogue notation.

## Verification and rollout

1. Check current profile content and frozen historical experiments independently, and the scope of the Scene-only H3 technical reference.
2. Test each override as a replacement, default reset by omission, validation of unknown IDs, and immediate settings persistence.
3. Test Generate, First Cut/Storyboard, Visual Direction, Prompt Assist, Project Deep QA, Advisor, and Studio request assembly independently.
4. Inspect real outbound Studio Model I/O and representative live LLM operations, comparing content before/after editing a module.
5. Keep unchanged behavior in unrelated captioning, media, queues, and saved Scene prompts.

Automation/live LLM tests may require the author's configured runtime and cannot be claimed passed solely from Python or static tests.
