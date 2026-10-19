from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_diagnostics_is_a_secondary_utility_not_a_workspace():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "diagnostics.js").read_text(encoding="utf-8")
    settings = (ROOT / "tool" / "js" / "app_settings.js").read_text(encoding="utf-8")

    assert 'id="shell-diagnostics-btn"' in html
    assert 'id="diagnostics-modal"' in html
    assert 'data-diagnostics-tab="health"' in html
    assert 'data-diagnostics-tab="h3"' in html
    assert 'data-diagnostics-panel="models"' in html
    assert 'data-diagnostics-panel="benchmark"' in html
    assert html.index('id="shell-diagnostics-btn"') > html.index('class="activity-rail-spacer"')
    assert 'aria-controls="diagnostics-modal"' in html

    assert "function openDiagnosticsModal" in script
    assert "function runEnvironmentCheck" in script
    assert "function refreshH3CalibrationSettings" in script
    assert "function runH3Calibration" in script
    assert "function stopH3Calibration" in script
    assert "'/fs/h3_probe/start'" in script
    assert "'/fs/h3_probe/stop'" in script
    assert "'/app/environment'" in script
    assert "directorModelTestRefresh()" in script



def test_settings_keeps_persistent_advanced_controls_only():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")

    settings_start = html.index('id="app-settings-modal"')
    diagnostics_start = html.index('id="diagnostics-modal"')
    settings_markup = html[settings_start:diagnostics_start]

    assert '>Advanced</button>' in settings_markup
    assert '<summary>Optional Features</summary>' in settings_markup
    assert '<summary>Debug Logging</summary>' in settings_markup
    assert '<summary>Raw Configuration</summary>' in settings_markup
    assert '<summary>Danger Zone</summary>' in settings_markup


def test_director_diagnostics_has_live_activity_card_and_compact_model_controls():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "director_model_test.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "modals.css").read_text(encoding="utf-8")

    assert 'id="director-model-test-activity"' in html
    assert "function directorModelTestRenderActivity" in script
    assert "director-model-test-activity-card" in script
    assert ".director-model-test-model-actions" in css
    assert "flex-wrap: nowrap" in css

def test_llm_stop_uses_shared_reset_and_existing_diagnostics_stop_state():
    common = (ROOT / "tool" / "js" / "common.js").read_text(encoding="utf-8")
    diagnostics = (ROOT / "tool" / "js" / "director_model_test.js").read_text(encoding="utf-8")

    assert "function resetLlmExecution()" in common
    assert "JSON.stringify({ operation: 'reset' })" in common
    assert "llmResetEpoch" not in common
    assert "assertLlmWorkflowCurrent" not in common

    assert "directorModelTestState.stopRequested = true;" in diagnostics
    assert "status === 'cancelled' || status === 'stopped'" in diagnostics
    assert "resetLlmExecution().catch(function (error)" in diagnostics
    assert "currentLlmResetEpoch" not in diagnostics
    assert "assertLlmWorkflowCurrent" not in diagnostics
    assert "operation: 'stop_or_cancel'" not in diagnostics


def test_director_assessment_activity_uses_shared_renderer_and_model_progress():
    script = (ROOT / 'tool' / 'js' / 'director_model_test.js').read_text(encoding='utf-8')

    assert 'currentProbeLabel' in script
    assert 'one writing test, optional retry' in script
    assert 'completedModels' in script
    assert 'directorModelTestStartActivityClock();' in script
    assert 'directorModelTestStopActivityClock();' in script
    assert 'ProgressCard.create()' in script
    assert "ProgressCard.update(card, snapshot, { className: 'director-model-test-activity-card' })" in script
    assert 'number / total * 100' not in script



def test_shared_progress_card_is_loaded_before_consumers():
    html = (ROOT / 'tool' / 'tool.html').read_text(encoding='utf-8')
    activity = (ROOT / 'tool' / 'js' / 'activity_monitor.js').read_text(encoding='utf-8')
    diagnostics = (ROOT / 'tool' / 'js' / 'director_model_test.js').read_text(encoding='utf-8')
    card = (ROOT / 'tool' / 'js' / 'progress_card.js').read_text(encoding='utf-8')

    assert html.index('js/progress_card.js') < html.index('js/activity_monitor.js')
    assert 'window.ProgressCard = { create: create, update: update }' in card
    assert 'window.publishActivityProgress = publishProgress' in activity
    assert 'window.finishActivityProgress = finishProgress' in activity
    assert "window.publishActivityProgress(snapshot)" in diagnostics
    assert "ProgressCard.update(card, snapshot," in diagnostics
    assert "isProgressChild(item)" in activity


def test_director_progress_stays_operation_scoped():
    script = (ROOT / 'tool' / 'js' / 'director_model_test.js').read_text(encoding='utf-8')
    assert "id: 'director-diagnostics-' + String(directorModelTestState.startedAt)" in script
    assert 'childJobId: directorModelTestState.currentJobId' in script
    assert 'totalIsUpperBound: true' in script
    assert 'completedModels' in script
    assert 'directorModelTestStopActivityClock()' in script


def test_experimental_model_assessment_preserves_existing_diagnostics():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "diagnostics.js").read_text(encoding="utf-8")
    assert 'data-diagnostics-tab="assessment"' in html
    assert 'id="diagnostics-assessment-results"' in html
    assert 'data-diagnostics-panel="models"' in html
    assert 'data-diagnostics-panel="benchmark"' in html
    assert 'data-diagnostics-panel="model-lab"' in html
    assert "function refreshUnifiedModelAssessment()" in script
    assert 'id="diagnostics-assessment-deep"' in html
    assert 'id="diagnostics-assessment-selection"' in html
    assert "diagnosticsAssessmentSelected = { director: new Set(), vision: new Set() }" in script
    assert "refreshSelectionSummary()" in script
    assert "setDiagnosticsTab('model-lab', true)" in script


def test_experimental_suite_launch_uses_existing_execution_owners():
    html = (ROOT / 'tool' / 'tool.html').read_text(encoding='utf-8')
    diagnostics = (ROOT / 'tool' / 'js' / 'diagnostics.js').read_text(encoding='utf-8')
    director = (ROOT / 'tool' / 'js' / 'director_model_test.js').read_text(encoding='utf-8')
    assert 'id="diagnostics-assessment-run"' in html
    assert 'function runUnifiedModelAssessment()' in diagnostics
    assert "action: 'start'" in diagnostics
    assert 'modelLabPost({' in diagnostics
    assert 'function directorModelTestStartCalibrationForModels(selectedModels)' in director
    assert "depth: deep ? 'deep' : 'quick'" in diagnostics


def test_unified_model_assessment_uses_compact_rows_and_toolbar():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    js = (ROOT / "tool" / "js" / "diagnostics.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "modals.css").read_text(encoding="utf-8")
    assert 'class="model-assessment-toolbar"' in html
    assert 'class="model-assessment-tools"' in html
    assert '<summary>More</summary>' in html
    assert "position: absolute; top: calc(100% + 4px); right: 0;" in css
    assert "row.className = 'model-assessment-row';" not in js
    assert "model-assessment-table" in js
    assert "diagnosticsAssessmentSortAndFilter" in js
    assert ".model-assessment-table" in css


def test_unified_assessment_bulk_selection_is_wired():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "diagnostics.js").read_text(encoding="utf-8")
    assert 'id="diagnostics-assessment-all"' not in html
    assert 'id="diagnostics-assessment-none"' not in html
    assert "selectAll.id = 'diagnostics-assessment-select-all'" in script
    assert "function selectUnifiedAssessmentModels(select)" in script
    assert "selectUnifiedAssessmentModels(selectAll.checked)" in script


def test_assessment_launch_shows_synchronous_errors_and_active_run():
    script = (ROOT / "tool" / "js" / "diagnostics.js").read_text(encoding="utf-8")
    assert "try {\n      Promise.resolve(runUnifiedModelAssessment())" in script
    assert "Cannot start assessment:" in script
    assert "var activeRun = labRuns.find" in script
    assert "modelLabProgressSnapshot(run)" in script



def test_unified_assessment_compact_comparison_uses_real_evidence():
    script = (ROOT / "tool" / "js" / "diagnostics.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "modals.css").read_text(encoding="utf-8")
    assert "diagnosticsAssessmentCounts" in script
    assert "tokensPerSecond" in script
    assert "coherentOutputTokens" in script
    assert "Context limit: not established" in script
    assert "Probe completion is not a semantic quality grade" in script
    assert ".model-assessment-table" in css


def test_specialist_model_tools_are_preserved_without_duplicate_top_level_tabs():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "diagnostics.js").read_text(encoding="utf-8")
    assert 'id="diagnostics-tab-models"' not in html
    assert 'id="diagnostics-tab-benchmark"' not in html
    assert 'id="diagnostics-panel-models"' in html
    assert 'id="diagnostics-panel-benchmark"' in html
    assert "setDiagnosticsTab('models', true)" in script
    assert "setDiagnosticsTab('benchmark', true)" in script

def test_assessment_table_preserves_selection_and_evidence_contract():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "diagnostics.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "modals.css").read_text(encoding="utf-8")
    assert 'id="diagnostics-assessment-filter"' in html
    assert 'diagnosticsAssessmentExpanded = new Set()' in script
    assert 'tbody[data-assessment-model]' in script
    assert 'data-assessment-select' in script
    assert 'row.assessmentSort' in script
    assert 'diagnosticsAssessmentCounts(row, tests)' in script
    assert 'table.appendChild(body)' in script
    assert '.diagnostics-assessment-wide .diagnostics-dialog' in css

def test_workflow_qualification_judge_and_advanced_limits():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "diagnostics.js").read_text(encoding="utf-8")
    backend = (ROOT / "tool" / "server" / "model_lab.py").read_text(encoding="utf-8")
    assert 'id="diagnostics-assessment-judge-model"' in html
    assert '16K probes' in html
    assert "diagnosticsAssessmentJudge" in script
    assert "diagnosticsAssessmentSize" in script
    assert "qualityReviews" in backend
    assert "action == \"judge\"" in backend
    assert "(4096, 8192, 16384)" in backend
