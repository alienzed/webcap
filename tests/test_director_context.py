"""Regression tests for Studio's source-grounded conversation compaction."""
from copy import deepcopy

from tool.server.director_context import assemble_studio_context, TRIGGER_CHARS


def conversation(read=None):
    messages = [
        {"role": "system", "content": "Creative guidance"},
        {"role": "user", "content": "Keep the cobalt costume on the protagonist."},
        {"role": "assistant", "content": "I'll retain the cobalt costume."},
    ]
    if read:
        messages += [{"role": "user", "content": read},
                     {"role": "assistant", "content": "I can use that snapshot."}]
    for i in range(20):
        messages.extend([
            {"role": "user", "content": f"Iteration {i}, atmosphere and dialogue: " + "cloud " * 90},
            {"role": "assistant", "content": "Details of atmospheric dialogue: " + "echo " * 170},
        ])
    messages.append({"role": "user", "content": "Return to the cobalt costume decision."})
    assert sum(len(item["content"]) for item in messages) > TRIGGER_CHARS
    return messages


def test_short_conversations_and_new_write_payloads_pass_through():
    messages = [{"role": "system", "content": "Studio guidance"},
                {"role": "user", "content": "Develop the Scene"},
                {"role": "user", "content": '{"projectId":"p","prompt":"Complete task"}'}]
    outbound, trace = assemble_studio_context(messages)
    assert outbound is messages
    assert trace["strategy"] == "verbatim"


def test_long_context_keeps_recent_turns_and_creates_verbatim_author_checkpoint():
    messages = conversation()
    original = deepcopy(messages)
    outbound, trace = assemble_studio_context(messages)
    assert messages == original
    assert trace["strategy"] == "extractive"
    assert trace["outboundChars"] < trace["originalChars"]
    assert outbound[0] == messages[0]
    assert outbound[-12:] == messages[-12:]
    assert outbound[1]["role"] == "user"
    assert "cobalt costume" in outbound[1]["content"]
    assert "[Original message 2, user]" in outbound[1]["content"]
    assert 2 in trace["retrievedSources"]
    assert trace["omittedMessages"] > 0


def test_explicit_read_is_retrievable_only_from_existing_saved_messages():
    read = '[WEBCAP EXPLICIT READ - SAVED SNAPSHOT]\\n{"concept":"Blue cathedral roof"}\\n[END WEBCAP READ]'
    messages = conversation(read=read)
    messages[-1]["content"] = "What was the blue cathedral roof in the earlier Read?"
    outbound, trace = assemble_studio_context(messages)
    assert read in outbound[1]["content"]
    assert 4 in trace["pinnedSources"]
    without_read = [item for item in messages if item["content"] != read]
    other, _ = assemble_studio_context(without_read)
    assert read not in "".join(item["content"] for item in other)


def test_large_explicit_read_and_applied_receipt_survive_unrelated_followups():
    read = "[WEBCAP EXPLICIT READ — SAVED SNAPSHOT]\\n" + ("Saved scene prompt. " * 650) + "\\n[END WEBCAP READ]"
    receipt = "Saved Scene changes\\n[WEBCAP APPLIED FIELD VALUES]\\n" + "Red scarf. " * 60
    messages = conversation(read=read)
    messages[4:4] = [{"role": "user", "content": receipt}]
    # A later topic must not make an earlier author-selected Read disappear.
    for i in range(20):
        messages[-1:-1] = [{"role": "user", "content": f"New iteration {i}: " + "scene detail " * 70},
                            {"role": "assistant", "content": "Direction " * 110}]
    messages[-1]["content"] = "Tell me about the camera movement."
    outbound, trace = assemble_studio_context(messages)
    assert trace["strategy"] == "extractive"
    assert read in outbound[1]["content"]
    assert receipt in outbound[1]["content"]
    assert 4 in trace["pinnedSources"]
    assert 5 in trace["pinnedSources"]
    assert trace["outboundChars"] < trace["originalChars"]


def test_an_old_director_proposal_can_be_recalled_by_its_own_terms():
    messages = conversation()
    messages[2]["content"] = "We could stage the cobalt costume beside a huge ferris wheel."
    messages[-1]["content"] = "What did you propose about the ferris wheel?"
    outbound, trace = assemble_studio_context(messages)
    assert "huge ferris wheel" in outbound[1]["content"]
    assert 3 in trace["retrievedSources"]


def test_latest_correction_and_final_write_payload_are_exact():
    messages = conversation()
    messages += [{"role": "assistant", "content": "Blue is right."},
                 {"role": "user", "content": "Actually use RED, not blue."},
                 {"role": "user", "content": '{"operation":"write_scene","prompt":"RED costume"}'}]
    outbound, trace = assemble_studio_context(messages)
    assert outbound[-2:] == messages[-2:]
    assert trace["originalMessages"] == len(messages)
    assert outbound[1]["content"].startswith("[WEBCAP EXTRACTIVE CONVERSATION CHECKPOINT]")


def test_history_excerpts_follow_original_order_when_corrections_supersede_older_ideas():
    messages = conversation()
    messages[1]["content"] = "The costume is AMBER."
    messages[3]["content"] = "Correction: the costume is COBALT."
    messages[-1]["content"] = "What did we decide about the costume?"
    outbound, trace = assemble_studio_context(messages)
    history = outbound[1]["content"]
    assert "AMBER" in history and "COBALT" in history
    assert history.index("AMBER") < history.index("COBALT")
    assert trace["strategy"] == "extractive"


def test_repeatability_and_nonstandard_system_messages():
    messages = conversation()
    a, trace_a = assemble_studio_context(messages)
    b, trace_b = assemble_studio_context(messages)
    assert a == b and trace_a == trace_b
    messages.insert(4, {"role": "system", "content": "Later override"})
    outbound, trace = assemble_studio_context(messages)
    assert outbound is messages
    assert trace["strategy"] == "verbatim"

def test_enqueue_compacts_only_studio_chat_by_default(monkeypatch):
    from tool.server import llm_runner

    queued = []
    monkeypatch.setattr(llm_runner, "_ensure_execution_reconciled", lambda: None)
    monkeypatch.setattr(llm_runner, "_ensure_monitor_started", lambda: None)
    monkeypatch.setattr(llm_runner, "execution_enqueue",
                        lambda _lane, payload, metadata: queued.append(payload) or {"id": "ctx-test"})
    monkeypatch.setattr(llm_runner, "execution_get_job", lambda job_id: {"id": job_id})
    monkeypatch.setattr(llm_runner, "_job_view", lambda job: {"jobId": job["id"]})
    monkeypatch.delenv("WEBCAP_STUDIO_CONTEXT_MODE", raising=False)
    transcript = conversation()
    original = deepcopy(transcript)

    def request(operation):
        return llm_runner.enqueue("chat", "remote-1::test-model",
                                  {"operation": operation, "messages": transcript})

    studio = request("studio_chat")
    assert studio["request"]["contextAssembly"]["strategy"] == "extractive"
    assert len(queued[-1]["contract"]["messages"]) < len(transcript)
    from tool.server.storyboard_llm_runtime import normalize_freeform_messages
    assert normalize_freeform_messages(queued[-1]["contract"]["messages"]) == studio["request"]["messages"]
    assert transcript == original

    for operation in ("studio_scenes_draft", "freeform_chat", "studio_action_advisor"):
        direct = request(operation)
        assert queued[-1]["contract"]["messages"] == transcript
        assert "contextAssembly" not in direct["request"]

    monkeypatch.setenv("WEBCAP_STUDIO_CONTEXT_MODE", "all")
    expanded = request("studio_scenes_draft")
    assert expanded["request"]["contextAssembly"]["strategy"] == "extractive"

    monkeypatch.setenv("WEBCAP_STUDIO_CONTEXT_MODE", "full")
    rollback = request("studio_chat")
    assert queued[-1]["contract"]["messages"] == transcript
    assert "contextAssembly" not in rollback["request"]

