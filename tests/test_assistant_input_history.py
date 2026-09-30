from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_assistant_input_history_is_session_only_and_survives_new_chat():
    script = (ROOT / "tool" / "js" / "director_chat.js").read_text(encoding="utf-8")

    assert "var inputHistory = [];" in script
    assert "var inputHistoryIndex = 0;" in script
    assert "var inputHistoryDraft = '';" in script
    assert "event.key === 'ArrowUp' || event.key === 'ArrowDown'" in script
    assert "inputHistoryIndex = inputHistory.length;" in script
    assert "inputHistoryDraft = input.value;" in script
    assert "inputHistoryIndex === inputHistory.length" in script
    assert "input.value = inputHistoryIndex === inputHistory.length" in script
    assert "localStorage" not in script[script.index("var inputHistory = []"):script.index("function activeContextMode()")]

    new_chat = script[script.index("function newChat()"):script.index("function jobRequest(", script.index("function newChat()"))]
    assert "inputHistory" not in new_chat
