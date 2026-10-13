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
    assert 'data-diagnostics-tab="models"' in html
    assert 'data-diagnostics-tab="benchmark"' in html
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


def test_director_assessment_activity_shows_probe_progress_without_rebuilding_card():
    script = (ROOT / 'tool' / 'js' / 'director_model_test.js').read_text(encoding='utf-8')

    assert 'currentProbeLabel' in script
    assert 'completedProbes = attempts.length' in script
    assert 'maximumProbes = (model.runtimeId' in script
    assert "' of up to '" in script
    assert 'directorModelTestStartActivityClock();' in script
    assert 'directorModelTestStopActivityClock();' in script
    assert "host.querySelector('.director-model-test-activity-card')" in script
    assert "card.querySelector('[data-diagnostic-stage]').textContent = stage" in script
    assert 'number / total * 100' in script  # Benchmark retains its own model-based progress.


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
    assert "ProgressCard.update(card, snapshot)" in diagnostics
    assert "isProgressChild(item)" in activity


def test_director_progress_stays_operation_scoped():
    script = (ROOT / 'tool' / 'js' / 'director_model_test.js').read_text(encoding='utf-8')
    assert "id: 'director-diagnostics-' + String(directorModelTestState.startedAt)" in script
    assert 'childJobId: directorModelTestState.currentJobId' in script
    assert 'totalIsUpperBound: true' in script
    assert 'completedProbes = attempts.length' in script
    assert 'directorModelTestStopActivityClock()' in script
