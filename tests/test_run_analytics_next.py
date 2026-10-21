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
    assert "window.runAnalyticsOpen=function(){labLoad();labEnsureDetailIndex();};" in js
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
    assert "var list=labRanked().slice().sort(" in script
    assert "p=action===\'challenger\'?list[1]:(list[0]||labPoints()[0])" in script
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


def test_insights_inventory_retains_active_and_archive_training_summaries(monkeypatch, tmp_path):
    rows = [
        {"jobId": "live", "label": "Run 1", "source": "training", "archive": None,
         "savedEpochs": [40, 50], "stage": "h3",
         "runSummary": {"rank": 16, "lr": 0.0001}},
        {"jobId": "archived", "label": "Run 2", "source": "archive", "archive": "bikini-old",
         "selectedEpoch": 65, "savedEpochs": [65], "stage": "h3",
         "runSummary": {"rank": 32, "lr": 0.0002}},
    ]
    monkeypatch.setattr(analytics, "_catalog", lambda *_: (rows, {}))
    monkeypatch.setattr(analytics, "_campaigns", lambda *_: [])
    inventory = analytics.insights_inventory(tmp_path)
    assert len(inventory["runs"]) == 2
    assert inventory["runs"][0]["runSummary"] == {"rank": 16, "lr": 0.0001}
    assert inventory["runs"][1]["selectedEpoch"] == 65
    assert inventory["runs"][1]["runSummary"]["rank"] == 32


def test_insights_ai_facts_keep_archive_selection_distinct_from_rated_winner(monkeypatch, tmp_path):
    monkeypatch.setattr(analytics, "insights_inventory", lambda _: {
        "runs": [
            {"jobId": "run-a", "label": "Run A", "source": "archive", "archive": "old-a",
             "selectedEpoch": 65, "savedEpochs": [65, 70], "stage": "h3",
             "runSummary": {"lr": 0.0001, "rank": 32}},
            {"jobId": "run-b", "label": "Run B", "source": "training", "archive": None,
             "selectedEpoch": None, "savedEpochs": [40], "stage": "h3",
             "runSummary": {"lr": 0.0002, "rank": 16}},
            {"jobId": "run-c", "label": "Run C", "source": "archive", "archive": "missing-log",
             "selectedEpoch": 35, "savedEpochs": [35], "stage": "h3", "runSummary": {}},
        ], "warnings": []})
    monkeypatch.setattr(analytics, "overview", lambda _: {
        "epochs": [
            {"jobId": "run-a", "epoch": 70, "ratedCount": 8, "testCount": 10,
             "allManualAverage": 4.5, "ratingDistribution": {"1": 0, "2": 0, "3": 1, "4": 2, "5": 5}},
            {"jobId": "run-b", "epoch": 40, "ratedCount": 2, "testCount": 2,
             "allManualAverage": 5.0, "ratingDistribution": {"1": 0, "2": 0, "3": 0, "4": 0, "5": 2}},
        ],
        "coverage": {"ratedPreviews": 11, "sessions": 3}, "warnings": []})
    def metric(name):
        if name == "missing-log":
            raise FileNotFoundError(name)
        return {"selectedEpoch": 65, "epochLoss": 0.22,
                "trainingSecondsToSelected": 9000, "step": 7000}
    monkeypatch.setattr(analytics, "archive_metrics", metric)
    facts = analytics.insights_director_facts(tmp_path)
    assert facts["coverage"]["catalogRuns"] == 3
    assert facts["coverage"]["archivedRuns"] == 2
    assert facts["coverage"]["runsWithRatings"] == 2
    assert facts["unlinkedRatedRenders"] == 1
    assert facts["runs"][0]["selectedEpoch"] == 65
    assert facts["runs"][0]["leadingRatedEpochs"][0]["epoch"] == 70
    assert facts["runs"][0]["leadingRatedEpochs"][0]["ratingDistribution"]["5"] == 5
    assert facts["runs"][0]["selectedMetrics"]["epochLoss"] == 0.22
    assert facts["runs"][1]["selectedMetrics"] is None
    assert facts["runs"][2]["ratedRenders"] == 0
    assert any("missing-log" in warning for warning in facts["warnings"])
    contract = analytics.insights_director_contract(facts)
    assert contract["operation"] == "interpret_run_analytics"
    assert "missing or deleted Test ratings" in contract["prompt"]
    assert "Observed" in contract["response_schema"]["required"][0].title()


def test_insights_ai_is_explicit_and_keeps_existing_director_path():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    js = (root / "tool/js/run_analytics.js").read_text(encoding="utf-8")
    html = (root / "tool/tool.html").read_text(encoding="utf-8")
    app = (root / "tool/server/app.py").read_text(encoding="utf-8")
    finder = (root / "tool/server/epoch_finder.py").read_text(encoding="utf-8")
    assert 'id="run-lab-ai"' in html
    assert 'id="run-lab-run"' in html
    assert html.count('id="run-lab-run"') == 1
    assert 'mode:\'insights\'' in js
    assert "lab('ai').onclick=labAiStart" in js
    assert "cancelCaptionAssistJob(labAiJob)" in js
    assert "run_insights_inventory" in finder
    assert 'data.get("mode") == "insights"' in app
    assert 'director_contract(facts)' in app
    assert 'insights_director_contract(facts)' in app
    assert "test_enqueue" not in js


def test_insights_reviewable_count_requires_available_unrated_linked_test_media(tmp_path, monkeypatch):
    session = tmp_path / "test-session"
    session.mkdir()
    (session / "review.png").touch()
    (session / "rated.png").touch()
    (session / "base.png").touch()

    def render(name, folder="set/a", kind="lora"):
        return {"kind": kind, "mediaFile": name, "provenance": {
            "sourceJobId": "run-a", "sourceFolder": folder, "sourceEpoch": 50}}
    status = {"sourcePrompt": "sample", "results": [
        render("review.png"), render("rated.png"), render("missing.png"),
        render("base.png", kind="base"), render("unlinked.png", folder="elsewhere")]}

    monkeypatch.setattr(analytics, "_folder_key", lambda _: "set/a")
    monkeypatch.setattr(analytics.bench, "_session_directories", lambda _: [session])
    monkeypatch.setattr(analytics.bench, "_read_status", lambda _: status)
    monkeypatch.setattr(analytics.bench, "_session_rating_map", lambda _: {"rated.png": 5})
    monkeypatch.setattr(analytics.bench, "_session_vision_state", lambda _: {})
    monkeypatch.setattr(analytics, "_campaigns", lambda *_: [])

    evidence = analytics.overview(tmp_path)
    assert evidence["coverage"]["reviewableUnrated"] == 1
    assert evidence["epochs"][0]["testCount"] == 3
    assert evidence["epochs"][0]["ratedCount"] == 1
    assert evidence["epochs"][0]["ratingDistribution"]["5"] == 1
    assert sum(evidence["epochs"][0]["ratingDistribution"].values()) == 1


def test_insights_promotes_just_three_tasks_and_keeps_every_existing_evidence_surface():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    html = (root / "tool/tool.html").read_text(encoding="utf-8")
    js = (root / "tool/js/run_analytics.js").read_text(encoding="utf-8")
    page = html[html.index('id="run-analytics-lab"'):html.index('id="run-analytics-report-surface"')]
    assert page.index('id="run-lab-challenge-title"') < page.index('id="run-lab-featured"')
    assert page.index('id="run-lab-featured"') < page.index('id="run-lab-ai-panel"')
    assert page.index('id="run-lab-ai-panel"') < page.index('id="run-lab-history"')
    assert page.index('id="run-lab-history"') < page.index('id="run-lab-summary"')
    assert '<summary>More evidence: totals, trajectory and coverage</summary>' in page
    assert '<summary>Full epoch rankings and VL diagnostics</summary>' in page
    assert '<summary>Browse recorded results</summary>' in page
    for element in ("run-lab-contenders", "run-lab-discoveries", "run-lab-chart",
                    "run-lab-coverage", "run-lab-explorer", "run-lab-summary"):
        assert f'id="{element}"' in page
    assert page.count('id="run-lab-run"') == 1
    assert 'id="run-lab-ai"' in page
    assert "lab('ai').onclick=labAiStart" in js


def test_insights_chart_filter_cannot_change_global_contenders():
    from pathlib import Path
    js = (Path(__file__).resolve().parents[1] / "tool/js/run_analytics.js").read_text(encoding="utf-8")
    points = js[js.index("  function labPoints(){"):js.index("  function labEmpty(")]
    chart = js[js.index("  function labChart(){"):js.index("  function labRender(){")]
    assert "return labSnapshot&&labSnapshot.epochs||[];" in points
    assert "lab('run').value" not in points
    assert "(!runId||p.jobId===runId)" in chart
    assert "lab('run').onchange=labChart;" in js
    assert "labFeatured(ranked)" in js
    assert "p.allManualAverage" in js


def test_insights_rating_missions_use_real_saved_coverage_and_batch_progress():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    html = (root / "tool/tool.html").read_text(encoding="utf-8")
    js = (root / "tool/js/run_analytics.js").read_text(encoding="utf-8")
    for field in ("run-lab-mission-meter", "run-lab-mission-metrics", "run-lab-review-meter"):
        assert f'id="{field}"' in html
    assert "lab('mission-meter').value=rated" in js
    assert "lab('mission-meter').max=total||1" in js
    assert "lab('review-meter').value=completed" in js
    assert "reviewIndex+(reviewRatedCurrent?1:0)" in js
    assert "data-lab-action=\"review\"" in js
    assert "ratingDistribution" in js
    assert "test_rate_result" in js


def test_insights_archive_warnings_do_not_fill_landing_page():
    from pathlib import Path
    script = (Path(__file__).resolve().parents[1] / "tool/js/run_analytics.js").read_text(encoding="utf-8")
    history = script[script.index("  function labHistory(){"):script.index("  function labDiscoveries(){")]
    assert "<details><summary>" in history
    assert "training-history notice" in history
    assert "labInventory.warnings.join(' · ')" in history
    assert "labInventory.warnings.length" in history


def test_insights_featured_previews_use_highest_rated_surviving_test_media(tmp_path, monkeypatch):
    from tool.server import run_analytics as analytics
    a, b = tmp_path / "a", tmp_path / "b"
    a.mkdir()
    b.mkdir()
    origin = {"sourceJobId": "run-a", "sourceFolder": "set/a",
              "sourceEpoch": 47, "sourceRunName": "Run A"}

    def result(name, *, kind="lora", source=None):
        return {"kind": kind, "mediaFile": name, "provenance": source or origin}

    snapshots = {
        a: {"results": [
            result("best-video.mp4"), result("good-image.jpg"),
            result("missing-best.png"), result("base.png", kind="base"),
            result("wrong-set.png", source={**origin, "sourceFolder": "other"})]},
        b: {"results": [
            result("also-best.webp"), result("ok-image.png"),
            result("low-image.png"), result("sidecar.txt")]},
    }
    for folder, names in ((a, ("best-video.mp4", "good-image.jpg", "base.png", "wrong-set.png")),
                          (b, ("also-best.webp", "ok-image.png", "low-image.png", "sidecar.txt"))):
        for name in names:
            (folder / name).touch()

    scores = {a: {"best-video.mp4": 5, "good-image.jpg": 4,
                  "missing-best.png": 5, "base.png": 5, "wrong-set.png": 5},
              b: {"also-best.webp": 5, "ok-image.png": 3,
                  "low-image.png": 2, "sidecar.txt": 5}}
    monkeypatch.setattr(analytics, "_folder_key", lambda _: "set/a")
    monkeypatch.setattr(analytics.bench, "_session_directories", lambda _: [a, b])
    monkeypatch.setattr(analytics.bench, "_read_status", lambda folder: snapshots[folder])
    monkeypatch.setattr(analytics.bench, "_session_rating_map", lambda folder: scores[folder])
    monkeypatch.setattr(analytics.bench, "_session_vision_state", lambda _: {})
    monkeypatch.setattr(analytics, "_campaigns", lambda *_: [])

    snapshot = analytics.overview(tmp_path)
    epoch = snapshot["epochs"][0]
    assert epoch["ratedCount"] == 7  # Existing rating math is unchanged.
    assert len(epoch["topRenders"]) == 4
    assert [(item["mediaFile"], item["rating"], item["mediaKind"]) for item in epoch["topRenders"]] == [
        ("best-video.mp4", 5, "video"),
        ("also-best.webp", 5, "image"),
        ("good-image.jpg", 4, "image"),
        ("ok-image.png", 3, "image"),
    ]
    assert [item["session"] for item in epoch["topRenders"]] == ["a", "b", "a", "b"]


def test_insights_previews_reuse_existing_media_and_enlarge_landing_only():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    js = (root / "tool/js/run_analytics.js").read_text(encoding="utf-8")
    css = (root / "tool/css/epoch_finder.css").read_text(encoding="utf-8")
    assert "var renders=p.topRenders||[]" in js
    assert "'/fs/test_generations/media?folder='" in js
    assert 'loading="lazy"' in js
    assert 'preload="metadata" muted playsinline' in js
    assert "#t=0.1" in js
    assert 'class="run-lab-feature-preview"' in js
    assert 'class="run-lab-feature-preview-footer"' in js
    assert "VL '+render.vlAgreement+'%" in js
    assert "render.rating==null?'Unrated'" in js
    assert "--preview-count:" in js
    assert 'data-lab-feature="inspect"' in js
    assert "#run-analytics-screen .run-lab-feature-previews" in css
    assert "#run-analytics-screen .run-lab-feature strong{font-size:34px}" in css
    assert "#run-analytics-screen .run-lab-feature.has-previews{display:grid" in css
    assert "repeat(var(--preview-count),minmax(0,1fr))" in css
    assert "#run-analytics-screen .run-lab-details>summary{font-size:16px}" in css


def test_insights_featured_previews_fill_unrated_slots_and_keep_vl_per_render(tmp_path, monkeypatch):
    from tool.server import run_analytics as analytics
    session = tmp_path / "session"
    session.mkdir()
    for name in ("high.png", "medium.png", "unrated-reviewed.png", "unrated-plain.png"):
        (session / name).touch()
    origin = {"sourceJobId": "run-epoch", "sourceFolder": "set/a",
              "sourceEpoch": 47}
    results = [{"kind": "lora", "mediaFile": name, "provenance": origin}
               for name in ("unrated-plain.png", "medium.png", "high.png",
                            "unrated-reviewed.png")]
    comparisons = {
        "high.png": {"comparison": [
            {"id": "top", "result": "match"},
            {"id": "bottom", "result": "mismatch",
             "expectedText": "black", "selectedText": "white"},
            {"id": "background", "result": "match"},
        ], "ignoredGroups": ["background"]},
        "unrated-reviewed.png": {"comparison": [{"id": "top", "result": "match"}]},
    }
    monkeypatch.setattr(analytics, "_folder_key", lambda _: "set/a")
    monkeypatch.setattr(analytics.bench, "_session_directories", lambda _: [session])
    monkeypatch.setattr(analytics.bench, "_read_status", lambda _: {"results": results})
    monkeypatch.setattr(analytics.bench, "_session_rating_map",
                        lambda _: {"high.png": 5, "medium.png": 4})
    monkeypatch.setattr(analytics.bench, "_session_vision_state",
                        lambda _: {"byMedia": comparisons})
    monkeypatch.setattr(analytics, "_campaigns", lambda *_: [])

    epoch = analytics.overview(tmp_path)["epochs"][0]
    assert epoch["ratedCount"] == 2
    assert epoch["testCount"] == 4
    previews = epoch["topRenders"]
    assert [preview["mediaFile"] for preview in previews] == [
        "high.png", "medium.png", "unrated-reviewed.png", "unrated-plain.png"]
    assert [preview["rating"] for preview in previews] == [5, 4, None, None]
    assert [(preview["vlAgreement"], preview["vlJudgments"]) for preview in previews] == [
        (50, 2), (None, 0), (100, 1), (None, 0)]


def test_blind_five_rating_uses_full_height_without_hiding_rating_controls():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    css = (root / "tool/css/epoch_finder.css").read_text(encoding="utf-8")
    markup = (root / "tool/tool.html").read_text(encoding="utf-8")
    review = markup.split('id="run-lab-review-dialog"', 1)[1].split('</dialog>', 1)[0]
    assert "#run-analytics-screen .run-lab-review-dialog[open]{display:flex;flex-direction:column;min-height:0}" in css
    assert "height:calc(100dvh - 24px)" in css
    assert ".run-lab-review-media{display:flex;flex:1 1 auto;min-height:0" in css
    assert ".run-lab-review-media video{display:block;width:100%;height:100%;max-height:100%" in css
    assert ".run-lab-review-dialog[open]{overflow-y:auto}" in css  # Short viewports can scroll.
    assert "max-height:min(53vh,550px)" not in css
    for control in ("review-media", "review-stars", "review-skip", "review-next", "review-close"):
        assert 'id="run-lab-' + control + '"' in review
