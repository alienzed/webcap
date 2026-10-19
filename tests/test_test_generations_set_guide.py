"""A missing Set guides Test Generations navigation without changing Set ownership."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_shell_guides_only_invalid_set_context_before_closing_other_workspaces():
    shell = (ROOT / "tool/js/workspace_shell.js").read_text(encoding="utf-8")
    start = shell.index("function openTestGenerationsFromShell()")
    body = shell[start:shell.index("function completePendingTestGenerationsSetGuide()", start)]
    assert "!state.folderStateWritable || !isSetFolderContext(state.folder, state.items)" in body
    assert body.index("showTestGenerationsSetGuide();") < body.index("window.closeStoryboardActivity()")
    assert "openPrepActivity();" in body
    assert "window.openTestBenchActivity();" in body
    assert "setApplicationSetContext(" not in body


def test_guide_is_cancelable_and_not_persisted():
    shell = (ROOT / "tool/js/workspace_shell.js").read_text(encoding="utf-8")
    start = shell.index("function showTestGenerationsSetGuide()")
    body = shell[start:shell.index("function openTestGenerationsFromShell()", start)]
    assert "document.getElementById('media-list-wrapper')" in body
    assert "event.key !== 'Escape'" in body
    assert "shade.onclick = closeTestGenerationsSetGuide" in body
    assert "note.querySelector('button').onclick = closeTestGenerationsSetGuide" in body
    assert "sessionStorage" not in body and "localStorage" not in body


def test_auto_continue_waits_for_successful_folder_load():
    ui = (ROOT / "tool/js/ui.js").read_text(encoding="utf-8")
    shell = (ROOT / "tool/js/workspace_shell.js").read_text(encoding="utf-8")
    start = ui.index("function refreshCurrentDirectory()")
    body = ui[start:ui.index("// Ensure live filtering", start)]
    assert body.index("state.folderStateWritable = true;") < body.index("window.completePendingTestGenerationsSetGuide();")
    complete = shell.split("function completePendingTestGenerationsSetGuide()", 1)[1].split("function openPrepActivity()", 1)[0]
    assert "if (!testGenerationsSetGuide) return;" in complete
    assert "!state.folderStateWritable || !isSetFolderContext(state.folder, state.items)" in complete
    assert "openTestGenerationsFromShell();" in complete


def test_spotlight_does_not_block_folder_selection():
    css = (ROOT / "tool/css/workspace_shell.css").read_text(encoding="utf-8")
    assert ".test-generations-set-guide-shade" in css
    assert ".test-generations-set-guide-highlight" in css
    assert "pointer-events: none;" in css
    assert ".test-generations-set-guide-note" in css
