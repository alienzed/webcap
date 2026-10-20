"""Read-only compatibility tests for historical Director calibration records.

New inference/calibration execution belongs exclusively to Model Assessment.
"""
import pytest

from tool.server import director_model_calibration as legacy
from tool.server.storyboard_llm_runtime import _assessment_signal


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    monkeypatch.setattr(legacy, "_path", lambda: tmp_path / "legacy-reports.json")


def report(**extra):
    value = {
        "modelRef": "local::director.gguf",
        "runtimeId": "local",
        "runtimeName": "Local",
        "modelId": "director.gguf",
        "label": "Director",
        "contextMode": "runtime",
        "contextSize": 0,
        "maxTokens": 8192,
        "status": "complete",
        "attempts": [
            {"kind": "output", "target": 8192, "status": "passed"},
            {"kind": "prose", "target": 8192, "status": "passed"},
        ],
    }
    value.update(extra)
    return value


def test_existing_profiles_are_readable_without_a_legacy_calibration_runner():
    legacy._write_document({"version": legacy.PROFILE_VERSION,
                            "reports": {}, "profiles": {
                                "local::director.gguf": {
                                    "modelRef": "local::director.gguf",
                                    "contextMode": "calibrated", "contextSize": 16384,
                                    "maxTokens": 4096,
                                },
                            }})
    assert legacy.get_profile("local::director.gguf")["contextSize"] == 16384
    assert legacy.list_profiles()[0]["maxTokens"] == 4096


def test_historical_proven_range_and_warning_survive_current_assessment():
    value = report(attempts=[
        {"kind": "output", "target": 8192, "status": "passed"},
        {"kind": "prose", "target": 8192, "status": "passed"},
        {"kind": "prose", "target": 16384, "status": "failed",
         "failureKind": "looping"},
    ])
    saved = legacy.save_report(value)
    assert saved["abilities"]["coherentOutputTokens"] == 8192
    assert saved["health"] == "warning"
    signal = _assessment_signal("local::director.gguf", {
        "director_scene_plan_2048": {"status": "completed"},
    })
    assert signal["fullStoryCapable"] is True
    assert signal["seriousWarning"] is True
    assert signal["pathologies"] == ["looping"]


@pytest.mark.parametrize("failure_kind", ["garbled", "empty", "leakage", "looping"])
def test_actual_historical_output_pathologies_remain_visible(failure_kind):
    legacy.save_report(report(maxTokens=0, attempts=[
        {"kind": "output", "target": 512, "status": "failed",
         "failureKind": failure_kind},
    ]))
    signal = _assessment_signal("local::director.gguf")
    assert signal["seriousWarning"] is True
    assert failure_kind in signal["pathologies"]


def test_budget_or_runtime_miss_is_not_called_a_model_pathology():
    legacy.save_report(report(maxTokens=0, attempts=[
        {"kind": "output", "target": 512, "status": "failed",
         "failureKind": "capacity"},
        {"kind": "prose", "target": 1024, "status": "failed",
         "failureKind": "runtime"},
    ]))
    signal = _assessment_signal("local::director.gguf")
    assert signal["seriousWarning"] is False
    assert signal["pathologies"] == []


def test_historical_report_import_is_available_without_old_test_endpoints():
    normalized = legacy.normalize_report(report())
    assert legacy.import_reports([normalized]) == 1
    assert legacy.import_reports([normalized]) == 0
    loaded = legacy.get_report("local::director.gguf")
    assert loaded["abilities"]["coherentOutputTokens"] == 8192
