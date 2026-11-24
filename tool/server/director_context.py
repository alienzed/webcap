"""Verbatim, source-linked conversation compaction for Studio Director.

The full transcript remains in director_chat_history. This is a derived
request view, never a model-authored summary or saved creative authority.
"""
import re

TRIGGER_CHARS = 24_000
RECENT_MESSAGES = 12
MEMORY_CHARS = 7_000
RETRIEVAL_CHARS = 9_000
RETRIEVAL_GROUPS = 3

_TERMS = re.compile(r"[a-z0-9][a-z0-9'-]{2,}", re.IGNORECASE)
_STOP = frozenset("""about after again also always another because before between could would
should there their these those things this that then them from have into just like made
make more most only over same some such than thank what when where which while with
want were will your you're please scene scenes project projects director studio write
read prompt prompts conversation context answer give tell explain consider now here
new old one two three four five around within still going work do does did
have had has was are for not and the you our its who how can but why any yet
""".split())
_ACK = frozenset({"agreed", "yes", "yes.", "okay", "ok", "proceed", "do it", "sounds good", "correct"})


def _terms(value):
    return {word.lower() for word in _TERMS.findall(value)
            if len(word) >= 4 and word.lower() not in _STOP}


def _chars(messages):
    return sum(len(message["content"]) for message in messages)


def _role_message(message):
    return message.get("role") in {"user", "assistant"} and isinstance(message.get("content"), str)


def _read_snapshot(content):
    return content.startswith("[WEBCAP EXPLICIT READ")


def _checkpoint(rows, title):
    if not rows:
        return ""
    return "\n".join([title] + ["[Original message %d, %s]\n%s" % (i + 1, m["role"], m["content"])
                               for i, m in rows])


def assemble_studio_context(messages):
    """Build a shorter, inspectable request from a complete saved transcript.

    Recent turns and current Write payloads stay verbatim. Older author messages
    become an extractive checkpoint; topical older pairs are retrieved verbatim.
    Only explicitly present Read snapshots are eligible for retrieval.
    """
    if not isinstance(messages, list) or any(
            not isinstance(m, dict) or not isinstance(m.get("content"), str)
            for m in messages):
        raise ValueError("Studio context expects messages with text content.")
    total = _chars(messages)
    base = {"strategy": "verbatim", "originalMessages": len(messages),
            "originalChars": total, "outboundMessages": len(messages),
            "outboundChars": total, "checkpointSources": [], "retrievedSources": []}
    if total <= TRIGGER_CHARS:
        return messages, base
    systems = []
    for item in messages:
        if item.get("role") == "system":
            systems.append(item)
        else:
            break
    body = messages[len(systems):]
    # Keep unusual interleaved system instructions in their original order.
    if len(body) <= RECENT_MESSAGES or any(not _role_message(item) for item in body):
        return messages, base
    older = body[:-RECENT_MESSAGES]
    recent = body[-RECENT_MESSAGES:]
    question = next((m["content"] for m in reversed(recent) if m["role"] == "user"), "")
    focus = _terms(question)
    offset = len(systems)
    scored = []
    for pos, entry in enumerate(older):
        matches = focus.intersection(_terms(entry["content"]))
        if not matches:
            continue
        score = len(matches) * 6 + (3 if _read_snapshot(entry["content"]) else 0)
        group = [pos]
        if entry["role"] == "user" and pos + 1 < len(older) and older[pos + 1]["role"] == "assistant":
            group.append(pos + 1)
        elif entry["role"] == "assistant" and pos and older[pos - 1]["role"] == "user":
            group.insert(0, pos - 1)
        scored.append((score, pos, group))
    scored.sort(key=lambda row: (-row[0], -row[1]))
    retrieval = set()
    retrieval_chars = 0
    for _score, _pos, group in scored:
        extra = [idx for idx in group if idx not in retrieval]
        required = sum(len(older[idx]["content"]) for idx in extra)
        if len(retrieval) >= RETRIEVAL_GROUPS * 2:
            continue
        if retrieval_chars + required > RETRIEVAL_CHARS:
            # A long assistant echo must not prevent retrieving an exact
            # author instruction or an explicitly provided Read snapshot.
            extra = [_pos] if _pos not in retrieval else []
            required = sum(len(older[idx]["content"]) for idx in extra)
            if retrieval_chars + required > RETRIEVAL_CHARS:
                continue
        retrieval.update(extra)
        retrieval_chars += required
        if sum(older[idx]["role"] == "user" for idx in retrieval) >= RETRIEVAL_GROUPS:
            break
    memory = set()
    memory_chars = 0
    for pos in range(len(older) - 1, -1, -1):
        item = older[pos]
        if pos in retrieval or item["role"] != "user":
            continue
        required = len(item["content"])
        if required > MEMORY_CHARS - memory_chars:
            continue
        memory.add(pos)
        memory_chars += required
        # The previous assistant reply can hold a proposal the author accepted.
        if item["content"].strip().lower() in _ACK and pos and older[pos - 1]["role"] == "assistant":
            prior = len(older[pos - 1]["content"])
            if pos - 1 not in retrieval and prior <= MEMORY_CHARS - memory_chars:
                memory.add(pos - 1)
                memory_chars += prior
        if memory_chars >= MEMORY_CHARS:
            break
    if not memory and not retrieval:
        # Oversized noncompressible context: preserve current valid behavior.
        return messages, base
    memory_rows = [(offset + i, older[i]) for i in sorted(memory)]
    retrieved_rows = [(offset + i, older[i]) for i in sorted(retrieval)]
    note = ["[WEBCAP EXTRACTIVE CONVERSATION CHECKPOINT]",
            "Verbatim historical excerpts, not current saved Project or Scene values.",
            "Later author statements take precedence. This checkpoint does not reread saved fields.",
            _checkpoint(memory_rows, "AUTHOR HISTORY (verbatim):"),
            _checkpoint(retrieved_rows, "RELEVANT EARLIER EXCHANGES (verbatim):"),
            "[END WEBCAP CONVERSATION CHECKPOINT]"]
    checkpoint = {"role": "assistant", "content": "\n\n".join(part for part in note if part)}
    outbound = systems + [checkpoint] + recent
    trace = {"strategy": "extractive", "originalMessages": len(messages),
             "originalChars": total, "outboundMessages": len(outbound),
             "outboundChars": _chars(outbound),
             "checkpointSources": [i + 1 for i, _ in memory_rows],
             "retrievedSources": [i + 1 for i, _ in retrieved_rows],
             "recentStart": len(messages) - len(recent) + 1,
             "omittedMessages": len(older) - len(memory | retrieval)}
    if trace["outboundChars"] >= total:
        return messages, base
    return outbound, trace
