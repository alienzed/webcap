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
    assert "window.runAnalyticsOpen=function(){labLoad();};" in js
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


def test_testing_lab_exposes_all_epoch_ratings_without_pooling_cohort_scores(tmp_path, monkeypatch):
    from tool.server import run_analytics as analytics
    session = tmp_path / "session"
    session.mkdir()
    provenance = {"sourceJobId": "job-a", "sourceFolder": "set/a", "sourceEpoch": 14}
    stored = {"modelId": "h3", "sourcePrompt": "{red|blue}", "settings": {"strength": 0.9},
              "results": [{"kind": "lora", "mediaFile": "red.png", "provenance": provenance, "strength": 0.9},
                          {"kind": "lora", "mediaFile": "blue.png", "provenance": provenance, "strength": 0.9},
                          {"kind": "lora", "mediaFile": "unrated.png", "provenance": provenance, "strength": 0.9}]}
    monkeypatch.setattr(analytics, "_folder_key", lambda _: "set/a")
    monkeypatch.setattr(analytics.bench, "_session_directories", lambda _: [session])
    monkeypatch.setattr(analytics.bench, "_read_status", lambda _: stored)
    monkeypatch.setattr(analytics.bench, "_session_rating_map", lambda _: {"red.png": 5, "blue.png": 3})
    monkeypatch.setattr(analytics.bench, "_session_vision_state", lambda _: {"byMedia": {
        "red.png": {"modelId": "v1", "comparison": [{"id": "color", "result": "match"}]}}})
    monkeypatch.setattr(analytics, "_campaigns", lambda _, warnings: [])
    result = analytics.overview(tmp_path)
    assert result["coverage"]["ratedPreviews"] == 2
    assert result["epochs"][0]["ratedCount"] == 2
    assert result["epochs"][0]["allManualAverage"] == 4
    assert "ratingSum" not in result["epochs"][0]
    assert len(result["cohorts"]) == 2
    assert sum(group["ratedPreviews"] for group in result["cohorts"]) == 2
    assert sorted(point["manualCount"] for group in result["cohorts"] for point in group["points"]) == [1, 1]


def test_lab_ranking_uses_all_epoch_ratings_without_cohort_filter():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    script = (root / "tool/js/run_analytics.js").read_text(encoding="utf-8")
    html = (root / "tool/tool.html").read_text(encoding="utf-8")
    assert "function labRanked()" in script
    assert "labSnapshot.epochs||[]" in script
    assert "p.allManualAverage" in script
    assert "p.ratedCount" in script
    assert "var p=labRanked()[0]||labPoints()[0]" in script
    assert "data-lab-show-all" in script
    assert "operation:'checkpoint_workspace'" in script
    assert "savedRating.textContent=item.rating==null?'Unrated':'Rated '+item.rating+'/5'" in script
    assert "All runs (separately)" not in script
    assert "Comparable group <select id=\"run-lab-cohort\"" not in html
    assert 'id="run-lab-metric"' not in html
    assert 'id="run-lab-cohort"' in html  # VL-only group remains separate

def test_testing_lab_aggregates_independent_sessions_and_protocols(tmp_path, monkeypatch):
    from tool.server import run_analytics as analytics

    first, second, third = (tmp_path / name for name in ("one", "two", "three"))
    for path in (first, second, third):
        path.mkdir()

    def result(name, job, epoch, kind="lora"):
        return {"kind": kind, "mediaFile": name, "provenance": {
            "sourceJobId": job, "sourceFolder": "set/a", "sourceEpoch": epoch,
            "sourceRunName": job}}

    sessions = {
        first: {"modelId": "h3", "sourcePrompt": "red", "settings": {"strength": .8},
                "results": [result("first.png", "run-a", 67), result("base.png", "run-a", 67, "base")]},
        second: {"modelId": "h3", "sourcePrompt": "blue", "settings": {"strength": .9},
                 "results": [result("second.png", "run-a", 67),
                             result("unrated.png", "run-a", 67),
                             result("other.png", "run-b", 67)]},
        third: {"modelId": "h3", "sourcePrompt": "green", "settings": {"strength": .7},
                "results": [result("third.png", "run-a", 67), result("different.png", "run-a", 80),
                            result("unlinked.png", "", 80)]},
    }
    ratings = {first: {"first.png": 5}, second: {"second.png": 3, "other.png": 5},
               third: {"third.png": 4, "different.png": 5, "unlinked.png": 5}}
    monkeypatch.setattr(analytics, "_folder_key", lambda _: "set/a")
    monkeypatch.setattr(analytics.bench, "_session_directories", lambda _: list(sessions))
    monkeypatch.setattr(analytics.bench, "_read_status", lambda path: sessions[path])
    monkeypatch.setattr(analytics.bench, "_session_rating_map", lambda path: ratings[path])
    monkeypatch.setattr(analytics.bench, "_session_vision_state", lambda _: {})
    monkeypatch.setattr(analytics, "_campaigns", lambda _, warnings: [])

    snapshot = analytics.overview(tmp_path)
    rows = {(row["jobId"], row["epoch"]): row for row in snapshot["epochs"]}
    assert rows["run-a", 67]["ratedCount"] == 3
    assert rows["run-a", 67]["allManualAverage"] == 4
    assert rows["run-a", 67]["testCount"] == 4
    assert len(rows["run-a", 67]["sessions"]) == 3
    assert rows["run-a", 80]["ratedCount"] == 1
    assert rows["run-b", 67]["ratedCount"] == 1
    assert snapshot["coverage"]["unlinkedPreviews"] == 1
    assert sum(row["ratedCount"] for row in rows.values()) == 5


def test_insights_review_reuses_available_unrated_results_and_wildcards(tmp_path, monkeypatch):
    from tool.server import run_analytics as analytics
    first, second = tmp_path / "one", tmp_path / "two"
    first.mkdir()
    second.mkdir()

    def result(name, epoch=67, job="run-a", kind="lora", folder="set/a"):
        return {"kind": kind, "mediaFile": name, "prompt": "a red bikini", "provenance": {
            "sourceJobId": job, "sourceFolder": folder, "sourceEpoch": epoch}}
    status = {
        first: {"sourcePrompt": "a {red|blue} bikini", "results": [
            result("rated.png"), result("a.png"), result("b.png"),
            result("base.png", kind="base"), result("wrong.png", folder="other/set")]},
        second: {"sourcePrompt": "a {red|blue} bikini", "results": [
            result("c.png"), result("d.png"), result("e.png"),
            result("f.png"), result("missing.png")]},
    }
    for path, name in ((first, "rated.png"), (first, "a.png"), (first, "b.png"),
                       (first, "base.png"), (first, "wrong.png"),
                       (second, "c.png"), (second, "d.png"), (second, "e.png"),
                       (second, "f.png")):
        (path / name).touch()
    monkeypatch.setattr(analytics, "_folder_key", lambda _: "set/a")
    monkeypatch.setattr(analytics.bench, "_session_directories", lambda _: [first, second])
    monkeypatch.setattr(analytics.bench, "_read_status", lambda directory: status[directory])
    monkeypatch.setattr(analytics.bench, "_session_rating_map",
                        lambda directory: {"rated.png": 4} if directory == first else {})
    monkeypatch.setattr(analytics.bench, "_resolved_wildcard_summary",
                        lambda source, resolved, folder: [{"phrase": "red bikini"}])

    first_batch = analytics.insights_review_batch(tmp_path)
    assert len(first_batch["items"]) == 5
    assert first_batch["remaining"] == 6
    assert first_batch["unavailable"] == 1
    assert all(item["jobId"] == "run-a" and item["epoch"] == 67 for item in first_batch["items"])
    assert all(item["wildcards"] == [{"phrase": "red bikini"}] for item in first_batch["items"])
    assert not {"rated.png", "base.png", "wrong.png", "missing.png"} & {
        item["mediaFile"] for item in first_batch["items"]}
    skipped = first_batch["items"][0]["id"]
    next_batch = analytics.insights_review_batch(tmp_path, excluded=[skipped])
    assert skipped not in {item["id"] for item in next_batch["items"]}
    assert next_batch["remaining"] == 5


def test_insights_vl_visibility_is_set_scoped_and_keeps_original_state(tmp_path):
    import json
    from tool.server import run_analytics as analytics
    from tool.server.folder_state_store import read_folder_state
    state_path = tmp_path / ".webcap_state.json"
    state_path.write_text(json.dumps({"ratings_by_media": {"old.png": 5},
                                      "test_vision": {"byMedia": {"old.png": {"comparison": []}}}}),
                          encoding="utf-8")
    result = analytics.save_insights_groups(tmp_path, ["background", "bust", "background"])
    assert result["hiddenVlGroups"] == ["background", "bust"]
    saved = read_folder_state(state_path)
    assert saved["ratings_by_media"]["old.png"] == 5
    assert "old.png" in saved["test_vision"]["byMedia"]
    assert analytics.save_insights_groups(tmp_path, [])["hiddenVlGroups"] == []
    assert read_folder_state(state_path)["insightsHiddenVlGroups"] == []


def test_insights_ui_reuses_existing_evaluation_and_test_launch_contracts():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    js = (root / "tool/js/run_analytics.js").read_text(encoding="utf-8")
    test_js = (root / "tool/js/test_generations.js").read_text(encoding="utf-8")
    html = (root / "tool/tool.html").read_text(encoding="utf-8")
    finder = (root / "tool/server/epoch_finder.py").read_text(encoding="utf-8")
    for phrase in ("run_insights_review", "run_insights_groups", "test_rate_result"):
        assert phrase in js and phrase in finder + js
    assert "window.testGenerationsPrepareContender" in test_js
    assert "source.sourceJobId" in test_js
    assert "selectedCandidates=new Set([candidate])" in test_js
    assert "saveTestBenchState()" in test_js
    assert "test_enqueue" not in js  # no automatic GPU work in Insights
    assert 'id="run-lab-review-dialog"' in html
    assert 'id="run-lab-featured"' in html
    assert 'data-test-workspace-mode="analytics"' in html  # internal routing unchanged
    assert ">Insights</button>" in html
