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
                    "id": "campaign-a", "name": "Same campaign", "modelId": "h3",
                    "status": "complete", "visionModel": "vl",
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
        with patch.object(analytics, "_campaigns", return_value=[]), patch.object(analytics, "_catalog", return_value=(snapshot["runs"], {})), patch.object(analytics, "_test_cohorts", return_value=[]), patch.object(analytics, "_round_trajectories", return_value=[]), patch.object(analytics.bench, "_session_directories", return_value=[]), patch.object(analytics, "report", side_effect=[
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

    def test_training_protocol_fingerprint_keeps_different_settings_separate(self):
        a = {"modelId": "h3", "sourcePrompt": "example", "resolvedPrompt": "example",
             "settings": {"strength": .6}, "workflowSha256": "digest"}
        b = dict(a, settings={"strength": .9})
        self.assertNotEqual(analytics._cohort_key(a), analytics._cohort_key(b))
        self.assertNotEqual(analytics._cohort_key(a, {"strength": 0.6}), analytics._cohort_key(a, {"strength": 0.9}))
        self.assertNotEqual(analytics._cohort_key(a, {}, {"modelId": "vl1"}), analytics._cohort_key(a, {}, {"modelId": "vl2"}))
        self.assertEqual(analytics._cohort_key(a), analytics._cohort_key(dict(a)))

    def test_coverage_deduplicates_shared_campaign(self):
        ids = ["job1", "job2"]
        snapshot = self._snapshot(ids)
        with patch.object(analytics, "_campaigns", return_value=[]), patch.object(analytics, "_catalog", return_value=(snapshot["runs"], {})), patch.object(analytics.bench, "_session_directories", return_value=[]), patch.object(analytics, "report", side_effect=[
                dict(snapshot["reports"][0], runs=snapshot["runs"],
                     availableSessions=["test-1"], sessions=["test-1"], warnings=[]),
                dict(snapshot["reports"][1], runs=snapshot["runs"],
                     availableSessions=["test-1"], sessions=["test-1"], warnings=[]),
            ]), patch.object(analytics, "_test_cohorts", return_value=[]), patch.object(
                analytics, "_round_trajectories", return_value=[]):
            result = analytics.report_selected("/set", ids)
        self.assertEqual(result["coverage"]["campaigns"], 1)
        self.assertEqual(result["coverage"]["testSessions"], 1)
        self.assertEqual(result["coverage"]["runs"], 2)

    def test_director_contract_and_output_fields(self):
        contract = analytics.director_contract(analytics.director_facts(self._snapshot(["job1"])))
        self.assertEqual(contract["operation"], "interpret_run_analytics")
        self.assertEqual(set(contract["response_schema"]["required"]),
                         {"observed", "hypotheses", "tryNext", "limits"})
        self.assertRaises(ValueError, analytics.normalize_director_response, {"observed": "ok"})


if __name__ == "__main__":
    unittest.main()


def test_run_analytics_picker_distinguishes_runs_and_uses_compact_rows():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    frontend = (root / "tool/js/run_analytics.js").read_text(encoding="utf-8")
    backend = (root / "tool/server/run_analytics.py").read_text(encoding="utf-8")
    css = (root / "tool/css/epoch_finder.css").read_text(encoding="utf-8")
    assert '"runSequence": run.get("runSequence")' in backend
    assert "ID ' + shortId" in frontend
    assert "run-analytics-run-choice" in frontend
    assert "#run-analytics-screen .run-analytics-run-choice" in css


def test_run_analytics_guides_selection_and_empty_evidence_states():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    script = (root / "tool/js/run_analytics.js").read_text(encoding="utf-8")
    html = (root / "tool/tool.html").read_text(encoding="utf-8")
    assert 'id="run-analytics-selection-count"' in html
    assert "function updateScopeUi()" in script
    assert "el('selection-count').textContent = selection.size + ' / 6 runs selected'" in script
    assert "el(name).disabled = !report" in script
    assert "No checkpoint observations match the current evidence filters." in script
    assert "Expand to load and review the numerical facts before interpreting." in script


def test_testing_lab_isolated_to_analytics_and_read_only():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    html = (root / "tool/tool.html").read_text(encoding="utf-8")
    js = (root / "tool/js/run_analytics.js").read_text(encoding="utf-8")
    css = (root / "tool/css/epoch_finder.css").read_text(encoding="utf-8")
    routing = (root / "tool/server/epoch_finder.py").read_text(encoding="utf-8")
    region = html.split('id="run-analytics-screen"', 1)[1].split('</section>\n', 1)[0]
    assert 'id="run-analytics-lab"' in region or 'id="run-analytics-lab"' in html
    for element in ("summary", "challenge-title", "contenders", "discoveries",
                    "chart", "coverage", "explorer", "refresh"):
        assert 'id="run-lab-' + element + '"' in html
    assert "window.runAnalyticsOpen=function(){discover();labLoad();};" in js
    assert "window.runAnalyticsViewEpoch" in js
    assert "operation:'run_analytics_overview'" in js
    assert "el('report-surface').classList.remove('hidden')" in js
    assert 'if operation == "run_analytics_overview":' in routing
    assert '#run-analytics-screen .run-lab-' in css


def test_testing_lab_overview_groups_saved_test_evidence(tmp_path, monkeypatch):
    from tool.server import run_analytics as analytics
    from types import SimpleNamespace
    session = tmp_path / "session"
    session.mkdir()
    source = {"sourceJobId": "job-1", "sourceFolder": "set/a", "sourceEpoch": 85,
              "sourceRunName": "Run 039"}
    stored = {"modelId": "h3", "settings": {"strength": .9}, "results": [
        {"kind": "lora", "mediaFile": "a.png", "provenance": source, "strength": .9},
        {"kind": "lora", "mediaFile": "b.png", "provenance": source, "strength": .9},
        {"kind": "base", "mediaFile": "base.png"},
    ]}
    monkeypatch.setattr(analytics, "_folder_key", lambda _: "set/a")
    monkeypatch.setattr(analytics.bench, "_session_directories", lambda _: [session])
    monkeypatch.setattr(analytics.bench, "_read_status", lambda _: stored)
    monkeypatch.setattr(analytics.bench, "_session_rating_map", lambda _: {"a.png": 5})
    monkeypatch.setattr(analytics.bench, "_session_vision_state", lambda _: {"byMedia": {
        "a.png": {"modelId": "vl", "comparison": [
            {"id": "cloth", "expectedText": "red", "result": "match"}]},
    }})
    monkeypatch.setattr(analytics, "_campaigns", lambda _, warnings: [])
    result = analytics.overview(tmp_path)
    cov = result["coverage"]
    assert cov["sessions"] == 1
    assert cov["testPreviews"] == 3
    assert cov["ratedPreviews"] == 1
    assert cov["vlReviewedPreviews"] == 1
    assert cov["vlJudgments"] == 1
    assert cov["runsWithResults"] == 1
    assert cov["epochsWithResults"] == 1
    assert len(result["cohorts"]) == 2  # VL-reviewed and non-reviewed are separate protocols
    scored = next(g for g in result["cohorts"] if g["vlJudgments"])
    assert scored["points"][0]["manual"] == 5
    assert scored["points"][0]["testVl"] == 1
    assert result["epochs"][0]["testCount"] == 2
