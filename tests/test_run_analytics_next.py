import unittest
from unittest.mock import patch

from tool.server import run_analytics as analytics


class RunAnalyticsNextTests(unittest.TestCase):
    def _snapshot(self, ids):
        return {
            "runs": [{"jobId": value, "label": value} for value in ids],
            "campaigns": [{"id": "campaign-a", "name": "Same campaign", "modelId": "h3",
                           "visionModel": "vl", "runs": ids}],
            "reports": [{
                "jobId": value, "run": {"label": value, "stage": "h3", "archive": None},
                "coverage": {"campaigns": 1}, "campaigns": [{
                    "id": "campaign-a", "status": "complete", "visionModel": "vl",
                    "points": [{"epoch": 12, "score": .9, "observations": 8, "renders": 2}]}],
                "testPoints": [], "lossPoints": [], "warnings": []
            } for value in ids],
            "sessionFilter": "", "availableSessions": ["test-1"], "warnings": [],
        }

    def test_rejects_invalid_run_selections_without_reading_any_evidence(self):
        with patch.object(analytics, "report") as reader:
            for ids in ([], ["run1"] * 2, ["run" + str(i) for i in range(7)], [""]):
                with self.subTest(ids=ids), self.assertRaises(ValueError):
                    analytics.report_selected("/set", ids)
            reader.assert_not_called()

    def test_same_campaign_keeps_each_run_separate(self):
        ids = ["job1", "job2"]
        snapshot = self._snapshot(ids)
        with patch.object(analytics, "report", side_effect=[
                dict(snapshot["reports"][0], runs=snapshot["runs"], availableSessions=["test-1"], sessions=["test-1"]),
                dict(snapshot["reports"][1], runs=snapshot["runs"], availableSessions=["test-1"], sessions=["test-1"]),
        ]):
            result = analytics.report_selected("/set", ids)
        self.assertEqual(len(result["reports"]), 2)
        self.assertEqual(result["campaigns"][0]["runs"], ids)

    def test_director_preview_is_numeric_and_bounded(self):
        facts = analytics.director_facts(self._snapshot(["job1"]), "campaign-a")
        self.assertIn("weightedObservations", str(facts))
        self.assertNotIn("sourcePrompt", str(facts))
        self.assertNotIn("caption", str(facts).lower())
        self.assertNotIn("image", str(facts).lower())
        self.assertRaises(ValueError, analytics.director_facts, self._snapshot(["job1"]), "wrong")

    def test_director_contract_and_output_fields(self):
        contract = analytics.director_contract(analytics.director_facts(self._snapshot(["job1"])))
        self.assertEqual(contract["operation"], "interpret_run_analytics")
        self.assertEqual(set(contract["response_schema"]["required"]),
                         {"observed", "hypotheses", "tryNext", "limits"})
        self.assertRaises(ValueError, analytics.normalize_director_response, {"observed": "ok"})


if __name__ == "__main__":
    unittest.main()
