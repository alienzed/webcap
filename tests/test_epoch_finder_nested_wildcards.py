"""Regression coverage for Epoch Finder / Test Generations wildcard parity."""
import unittest

from tool.server.epoch_finder_plan import prompt_options, normalize_dimensions
from tool.server.epoch_test_bench import _wildcard_evaluation_groups


class EpochFinderNestedWildcardsTests(unittest.TestCase):
    def test_nested_options_match_session_vocabulary(self):
        cases = [
            ("a {red|blue} bikini", "a red bikini"),
            ("a {small {red|blue}|large} bikini", "a small blue bikini"),
            ("a {red|{blue|green}} bikini", "a green bikini"),
            ("a {red|} bikini", "a  bikini"),
            ("a {red|blue} {top|bottom}", "a blue bottom"),
        ]
        for source, resolved in cases:
            with self.subTest(source=source, resolved=resolved):
                planned = prompt_options(source)
                actual = _wildcard_evaluation_groups(source, resolved)
                self.assertEqual(planned, [group["options"] for group in actual])
                self.assertEqual(len(planned), len(actual))

    def test_dimensions_preserve_order_and_roles(self):
        prompt = "a {small {red|blue}|large} bikini"
        values = prompt_options(prompt)[0]
        result = normalize_dimensions(prompt, [
            {"label": "Variant", "role": "primary", "options": values},
        ])
        self.assertEqual(result[0]["options"], values)
        self.assertEqual(result[0]["weight"], 2.0)


if __name__ == "__main__":
    unittest.main()
