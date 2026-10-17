import unittest
from unittest.mock import patch
from pathlib import Path

from tool.server.caption_vision import build_reference_comparison_messages
from tool.server.epoch_reference import find_reference_candidates


class ReferenceComparisonTests(unittest.TestCase):
    def test_two_images_in_order(self):
        msgs = build_reference_comparison_messages("bikini bottom v-front", "data:image/png;base64,AAA", "data:image/png;base64,BBB")
        parts = msgs[0]["content"]
        urls = [p["image_url"]["url"] for p in parts if p["type"] == "image_url"]
        self.assertEqual(urls, ["data:image/png;base64,AAA", "data:image/png;base64,BBB"])
        self.assertIn("bikini bottom v-front", parts[0]["text"])

    def test_missing_feature_or_image_rejected(self):
        with self.assertRaises(ValueError):
            build_reference_comparison_messages("", "a", "b")
        with self.assertRaises(ValueError):
            build_reference_comparison_messages("bottom", "", "b")


if __name__ == "__main__":
    unittest.main()
