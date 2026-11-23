# Hostile audit: main Studio Chat LLM request guidance

Scope: the main Studio Director **conversation** request (`studio_chat`). This is an actual source-level trace, not a claim to have observed live model behavior. The distinction from explicit Write and standalone specialists is essential.

## Exact traced chain

1. **Selected profile**: `tool/js/director_chat.js` obtains `state.studioProfile` from the compact profile selector, remembered in browser localStorage. The current conversation is `state.modeMessages.storyboard`, including explicitly captured Read snapshots and previous assistant messages.
2. **Guidance retrieval**: `studioDirectorChatRequestMessages` calls `studioDirectorRequestMessages(messages, false, false)`. The frontend fetches `/fs/studio/director/guidance?targetModel=minimax_h3&profile=<id>&includePromptContract=0`.
3. **Named authoritative guidance**: `tool/server/studio_director.py` composes `studio.<profile>` and `h3.toolkit` by calling `llm_guidance.text_for`. Sparse saved overrides replace their named defaults. `default_for` resolves only the requested module; Chat does **not** read the H3 technical reference or empirical playbook.
4. **Conversation assembly**: The frontend creates exactly one `system` message containing the composed role and toolkit, followed by the complete user/assistant message sequence in original order. A project selected in navigation is not injected into model content; an explicit Read is an ordinary saved user message.
5. **Backend boundary**: `POST /fs/director/chat` with `operation=studio_chat` passes those messages to `enqueue_llm("chat", ...)`. No creative system message is added by Flask. Ordinary Studio Chat has **no JSON response schema** or Write operation.
6. **Provider payload**: `llm_runner.py` gives this operation the named `studio_chat` sampling profile. `storyboard_llm_runtime.py` validates message roles/content, applies temperature 0.35 and top_p 0.90 (and provider-specific runtime flags), and transmits the messages as-is except for edge whitespace normalization. Neither the request runner nor the provider wrapper appends further creative instructions.
7. **Visible result**: The response text is displayed directly and persisted as an assistant message. Model I/O exposes the outbound messages and raw response. An optional Action Advisor launches a **separate** job with its own instructions after conversation; it neither changes the main chat prompt nor saves authoring material.

## Defects found and corrected

| Severity | Finding | Resolution |
| --- | --- | --- |
| High | Historic Classic and Current roles prescribed worthwhile events, physical changes and duration-driven choices; these can undermine static, atmospheric, abstract, audio-first or montage concepts. | Replaced with concept-led, visually substantial and audiovisually aware creative role. |
| High | Profiles consisted of several kilobytes of overlapping instructions, with Imaginative and Render-focused layering extra rules on top of Current. | Shared concise core and short, genuinely distinct profile emphases; all four retain the same competence. |
| High | JavaScript added an **uneditable** conversation-policy suffix after the editable guidance. | Removed. Chat behavior now lives in the editable profile text. |
| Medium | Chat fetched the complete H3 authoring contract despite never sending it to the LLM. Furthermore, every module lookup built **all defaults** and loaded both prompt documents. | Chat requests `includePromptContract=0`; lookup resolves only selected modules. Technical authoring and empirical notes remain reserved for explicit prompt-writing calls. |
| Medium | The shared H3 toolkit was framed partly as a universal generation instruction rather than creative capability knowledge. | Rewritten as a repertoire of visual/editing structures, synchronized audio/dialogue, meaningful density, selective continuity and explicit consequential details. |
| Low | Studio Chat borrowed a sampling preset named `expand_concept`, obscuring its runtime behavior. | Named `studio_chat` profile, preserving identical sampling values and runtime behavior. |
| Low | Documentation still claimed Chat had no H3 expertise and described events/progression as universal requirements. | Updated the functional contract to reflect the actual requests and neutral creative expectations. |

## Instruction ownership after the change

- **Studio profile**: role, creative judgment, conversational behavior, Project and Scene concepts, scope of authoring vs saving.
- **Shared H3 toolkit**: strengths and affordances of short, synchronized audiovisual clips; cinematic options (montage, sustained shot, multi-shot, tableau, dialogue/audio-led); explicit visually consequential details when authoring.
- **H3 authoring reference and playbook**: complete prompt layout, dialogue notation, technical timing details and empirical notes; supplied only with prompt-authoring tasks.
- **Application-owned**: conversation history, explicit Read/Write context, request schema, saved destinations, queue ownership and actual model selection.

The client-side `STORYBOARD_WORKSHOP_PRIMER`, Scene Workshop revision instructions and specialist tools are **separate request paths**. They are not part of the ordinary `studio_chat` system prompt and are not folded into it merely because they live in the same JavaScript file.

## Verification targets

- Every profile receives the same production knowledge, preserves Concept/Visual/Invariants ownership, and supports many distinct kinds of Scenes.
- A normal Chat request sends exactly one composite system message, unchanged complete conversation, **no frontend-added policy suffix**, no technical H3 reference, and no response schema.
- A Scene Write continues receiving the full H3 reference and saved playbook, while a Project Write does not.
- User-saved guidance overrides remain authoritative and untouched; built-in defaults change only for modules with no override.
- Real model comparisons should test: (a) static or atmospheric compositions without invented events, (b) dense rapid montage vs a sustained shot, (c) exact spoken dialogue and synced sound, (d) Project Invariants vs Scene-specific material, (e) short, natural conversation and optional drafting. The model and H3 renderer must be exercised to establish quality: passing assembly tests is not evidence of creative superiority.
