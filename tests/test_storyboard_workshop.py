import unittest

from tool.server.storyboard_workshop import timed_shot_bounds, proposed_shot_prompt


PROMPT = (
    "Subject:\nPerson\n\nScene Overview:\nA scene\n\n"
    "integrated_multimodal_description:\n\n"
    "[Shot 1] (0s–4s)\nWalks slowly.\n\n"
    "[Shot 2] (4s–8s)\nRaises both hands.\n\n"
    "overall_soundscape:\nWind\n\nnon_diegetic_music:\nStrings\n"
)


class WorkshopShotTests(unittest.TestCase):
    def test_extracts_only_timed_shots(self):
        a, b = timed_shot_bounds(PROMPT)
        self.assertEqual(PROMPT[a:b], "[Shot 1] (0s–4s)\nWalks slowly.\n\n[Shot 2] (4s–8s)\nRaises both hands.")

    def test_replace_preserves_everything_outside_shots(self):
        replacement = "[Shot 1] (0s–4s)\nRuns.\n\n[Shot 2] (4s–8s)\nWaves."
        a, b = timed_shot_bounds(PROMPT)
        revised = proposed_shot_prompt(PROMPT, replacement)
        self.assertEqual(revised[:a], PROMPT[:a])
        self.assertEqual(revised[a + len(replacement):], PROMPT[b:])

    def test_rejects_ambiguous_headings(self):
        with self.assertRaisesRegex(ValueError, "one unambiguous"):
            timed_shot_bounds(PROMPT + "\nintegrated_multimodal_description:\n")

    def test_rejects_missing_closing_heading(self):
        with self.assertRaisesRegex(ValueError, "following"):
            timed_shot_bounds("integrated_multimodal_description:\n[Shot 1]\nTest")

    def test_rejects_missing_numbered_shots(self):
        with self.assertRaisesRegex(ValueError, "numbered"):
            timed_shot_bounds("integrated_multimodal_description:\nAn unlabelled shot.\noverall_soundscape:\nWind")

    def test_rejects_cross_section_proposals(self):
        with self.assertRaisesRegex(ValueError, "another H3"):
            proposed_shot_prompt(PROMPT, "[Shot 1] (0s–8s)\nWalks\n\noverall_soundscape:\nNoise")

    def test_rejects_unchanged_proposal(self):
        a, b = timed_shot_bounds(PROMPT)
        with self.assertRaisesRegex(ValueError, "no changes"):
            proposed_shot_prompt(PROMPT, PROMPT[a:b])


if __name__ == "__main__":
    unittest.main()
