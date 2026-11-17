"""Regression tests for Set-scoped caption find and replace."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tool.server import caption_ops


class SetCaptionReplaceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.folder = Path(self.temporary.name)
        (self.folder / "a.png").write_bytes(b"image")
        (self.folder / "b.mp4").write_bytes(b"video")
        (self.folder / "a.txt").write_text("red red\nBlue", encoding="utf-8")
        (self.folder / "b.txt").write_text("red-blue", encoding="utf-8")
        (self.folder / "notes.txt").write_text("red", encoding="utf-8")
        (self.folder / "nested").mkdir()
        (self.folder / "nested" / "other.txt").write_text("red", encoding="utf-8")
        self.folder_patch = patch.object(caption_ops, "_resolve_folder", return_value=self.folder)
        self.media_patch = patch.object(caption_ops, "list_media_files", return_value=["a.png", "b.mp4"])
        self.read_patch = patch.object(caption_ops, "run_with_directory_repair", side_effect=lambda path, fn: fn())
        self.folder_patch.start()
        self.media_patch.start()
        self.read_patch.start()

    def tearDown(self):
        self.read_patch.stop()
        self.media_patch.stop()
        self.folder_patch.stop()
        self.temporary.cleanup()

    def test_preview_is_read_only_and_apply_is_set_scoped(self):
        preview = caption_ops.replace_set_caption_text("set-one", "red", "green")
        self.assertEqual(preview["files"], 2)
        self.assertEqual(preview["occurrences"], 3)
        self.assertEqual((self.folder / "a.txt").read_text(encoding="utf-8"), "red red\nBlue")
        applied = caption_ops.replace_set_caption_text("set-one", "red", "green", preview["signature"])
        self.assertTrue(applied["replaced"])
        self.assertEqual((self.folder / "a.txt").read_text(encoding="utf-8"), "green green\nBlue")
        self.assertEqual((self.folder / "b.txt").read_text(encoding="utf-8"), "green-blue")
        self.assertEqual((self.folder / "notes.txt").read_text(encoding="utf-8"), "red")
        self.assertEqual((self.folder / "nested" / "other.txt").read_text(encoding="utf-8"), "red")

    def test_changed_caption_invalidates_previous_preview(self):
        preview = caption_ops.replace_set_caption_text("set-one", "red", "green")
        (self.folder / "a.txt").write_text("red changed", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Preview again"):
            caption_ops.replace_set_caption_text("set-one", "red", "green", preview["signature"])
        self.assertEqual((self.folder / "b.txt").read_text(encoding="utf-8"), "red-blue")

    def test_previously_unmatched_caption_becoming_matched_invalidates_preview(self):
        preview = caption_ops.replace_set_caption_text("set-one", "Blue", "green")
        (self.folder / "b.txt").write_text("Blue now", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Preview again"):
            caption_ops.replace_set_caption_text("set-one", "Blue", "green", preview["signature"])
        self.assertEqual((self.folder / "a.txt").read_text(encoding="utf-8"), "red red\\nBlue")

    def test_missing_preview_signature_does_not_apply(self):
        with self.assertRaisesRegex(ValueError, "Preview again"):
            caption_ops.replace_set_caption_text("set-one", "red", "green", "")
        self.assertEqual((self.folder / "a.txt").read_text(encoding="utf-8"), "red red\\nBlue")

    def test_preview_is_bound_to_find_and_replacement(self):
        preview = caption_ops.replace_set_caption_text("set-one", "red", "green")
        with self.assertRaisesRegex(ValueError, "Preview again"):
            caption_ops.replace_set_caption_text("set-one", "red", "orange", preview["signature"])
        with self.assertRaisesRegex(ValueError, "Preview again"):
            caption_ops.replace_set_caption_text("set-one", "Blue", "green", preview["signature"])
        self.assertEqual((self.folder / "a.txt").read_text(encoding="utf-8"), "red red\\nBlue")

    def test_case_sensitive_and_empty_search(self):
        preview = caption_ops.replace_set_caption_text("set-one", "RED", "green")
        self.assertEqual(preview["occurrences"], 0)
        with self.assertRaisesRegex(ValueError, "Find text cannot be empty"):
            caption_ops.replace_set_caption_text("set-one", "", "green")

    def test_duplicate_media_stems_modify_caption_once(self):
        (self.folder / "a.mp4").write_bytes(b"video")
        with patch.object(caption_ops, "list_media_files", return_value=["a.png", "a.mp4", "b.mp4"]):
            preview = caption_ops.replace_set_caption_text("set-one", "red", "blue")
            self.assertEqual(preview["files"], 2)
            self.assertEqual(preview["occurrences"], 3)


if __name__ == "__main__":
    unittest.main()
