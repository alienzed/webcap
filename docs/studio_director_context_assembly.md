# Studio Director context assembly — implementation and rollout

## Why this exists

Studio Director historically sent every visible chat message again on every Chat
and explicit Write request. That includes repeated assistant paraphrases of the
author's instructions. The complete transcript must remain durable; the working
model context does not need to equal that transcript.

## Code ownership

- `tool/js/director_chat.js`: visible conversation, explicit Read snapshots,
  request assembly and exact Director I/O inspector
- `tool/server/director_chat_history.py`: durable, unabridged conversations
- `tool/server/app.py`: the existing `/fs/director/chat` API; no new operation
- `tool/server/llm_runner.py`: one enqueue boundary shared by Studio Chat and
  explicit Write; exact outbound request diagnostics
- `tool/server/director_context.py`: pure, deterministic context selection

## Safe phases

**Phase 1 — source-grounded assembly (implemented).** For short requests,
forward every message unmodified. At roughly 24,000 characters of message
content, keep the latest 12 messages verbatim, build an *extractive* author
checkpoint from older exact text, and retrieve relevant older user/assistant
pairs by query-term overlap. Each excerpt is labeled with its original
1-based message position. The checkpoint is request-only; it does not
contain inferred facts or silently alter Project/Scene state. Large
noncompressible requests continue verbatim.

**Phase 2 — one deterministic execution boundary (implemented).** Invoke the
assembler for `studio_chat` inside `llm_runner.enqueue`, after WebCap has
constructed the task and before the queued job/diagnostic snapshot. Explicit
Project/Scene Writes remain full-history by default until creative regression
comparisons justify enabling their compact context. The optional `all` mode
can run that comparison without further code changes. Ordinary Assistant Chat,
the optional Action Advisor, and dedicated workshop operations are unchanged.
No extra LLM request, background summarizer, embedding DB, or automatic Read.
All explicitly Read data available to the assembler comes from prior,
visible conversation messages.

**Phase 3 — inspectability and recovery (implemented).** The exact assembled
messages are present in the existing Director I/O request inspector. Its
context status reports original and outbound sizes; provenance includes
selected message indexes. Full conversation history stays unchanged on disk,
so toggling back to full history or opening old chats never loses anything.
`WEBCAP_STUDIO_CONTEXT_MODE=full` forces all requests to remain verbatim;
the default `chat` mode compacts only Studio Chat; `all` additionally enables
compaction in explicit Studio Writes for deliberate comparison.

**Phase 4 — validation (implemented in regression suite).** Test short-chat
identity, large-history reduction, verbatim latest instructions, explicitly
Read snapshot retrieval without re-reading, correction handling, deterministic
output, and compatibility with unusual system-message placement. Run these
in the Storyboard header CI alongside the existing Director persistence tests.

## Boundaries and future evaluation

This is a deliberately conservative *extractive* checkpoint, not abstractive
LLM memory. It cannot reliably infer implicit long-distance references or
settle conflicting creative decisions. That is why saved Project/Scene fields
and explicit Reads remain authoritative, and why source labels and a
full-history escape hatch are required. Do not claim that smaller prompts
automatically improve creative usefulness.

Before introducing a model-authored summary or semantic index, compare this
strategy against full-history requests in the existing Director evaluation
harness: older-decision recall, changing one's mind, multiple Projects,
long Read snapshots, author/assistant echo duplication, exact Scene Writes,
context size, and subjective creative utility. Preserve the transcript and
source positions through any later iteration. No strict rejection gate, silent
repair call, or automatic source refresh is warranted by this change.
