"""Focused DOM/source contract checks for the localized Director UI pass.

These avoid model calls and intentionally do not replace browser acceptance.
Run: python -m unittest discover -s tests -p test_studio_director_ui_contract.py
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
WORKBENCH = (ROOT / "tool/js/studio_director_workbench.js").read_text(encoding="utf-8")
CHAT = (ROOT / "tool/js/director_chat.js").read_text(encoding="utf-8")
STORY = (ROOT / "tool/js/storyboard.js").read_text(encoding="utf-8")
SHELL_CSS = (ROOT / "tool/css/workspace_shell.css").read_text(encoding="utf-8")
STORY_CSS = (ROOT / "tool/css/storyboard.css").read_text(encoding="utf-8")


class StudioDirectorUiContractTests(unittest.TestCase):
    def test_manual_scene_instruction_is_editable_and_authoritative(self):
        self.assertIn('id="studio-dw-write-instruction"', HTML)
        self.assertIn("function manualSceneInstruction()", WORKBENCH)
        self.assertIn("var instruction = manualSceneInstruction();", WORKBENCH)
        self.assertEqual(WORKBENCH.count("var instruction = manualSceneInstruction();"), 2)
        self.assertIn("seedManualSceneInstruction()", WORKBENCH)
        self.assertIn("if (input.dataset.instructionSeeded === 'true') return;", WORKBENCH)
        self.assertIn("delete instruction.dataset.instructionSeeded;", WORKBENCH)
        self.assertIn("el('studio-dw-write-instruction-row').classList.toggle('hidden', !sceneWrite)", WORKBENCH)
        self.assertIn("writeSelectedScene({", WORKBENCH)
        self.assertIn("writeNewScene({", WORKBENCH)

    def test_history_and_save_receipts_remain_inspectable(self):
        self.assertIn('id="director-chat-history-search"', HTML)
        self.assertIn("oninput = renderSessionHistory", CHAT)
        self.assertIn("menu.appendChild(rename)", CHAT)
        self.assertIn("menu.appendChild(remove)", CHAT)
        self.assertIn("director-chat-save-receipt", CHAT)
        self.assertIn("[WEBCAP APPLIED FIELD VALUES]", CHAT)
        self.assertIn("persistSession('storyboard')", CHAT)
        self.assertIn(".director-chat-history-menu", SHELL_CSS)

    def test_active_scene_and_collapsed_project_access(self):
        self.assertIn("sceneTitle: story && target.sceneId", STORY)
        self.assertIn("selectedScene.sceneId === navigation.sceneId", CHAT)
        self.assertIn("sceneContext.title = sceneContext.textContent", CHAT)
        self.assertIn('id="storyboard-collapsed-director"', HTML)
        self.assertIn("el('storyboard-collapsed-director').classList.toggle", STORY)
        self.assertIn("#storyboard-collapsed-director", STORY_CSS)

    def test_controls_are_reachable_at_medium_widths(self):
        self.assertIn("grid-template-columns:minmax(0,1fr) minmax(260px,36%)", SHELL_CSS)
        self.assertIn("grid-template-columns: minmax(340px, 440px) minmax(0, 1fr)", STORY_CSS)
        self.assertIn("overflow-x:auto", STORY_CSS)


if __name__ == "__main__":
    unittest.main()
