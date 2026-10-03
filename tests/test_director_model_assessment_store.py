import json

import pytest

from tool.server import director_model_assessment_store as assessment


@pytest.fixture
def assessment_root(monkeypatch, tmp_path):
    root = tmp_path / "app-data" / "cache"
    monkeypatch.setattr(assessment.app_config, "app_cache_root", lambda: root)
    return root / assessment.ROOT_NAME


def _model():
    return {
        "modelRef": "local::director.gguf",
        "runtimeId": "local",
        "runtimeName": "Local",
        "modelId": "director.gguf",
        "label": "Director",
        "sizeBytes": 1234,
    }


def test_assessment_keeps_full_probe_evidence_in_cache(assessment_root):
    started = assessment.start_assessment(_model(), advertised={"contextTokens": 8192})
    saved = assessment.update_assessment(
        started["id"],
        [{
            "kind": "prose",
            "target": 512,
            "status": "failed",
            "prompt": "FULL PROMPT",
            "text": "FULL MODEL OUTPUT",
            "finishReason": "stop",
            "failureKind": "looping",
            "promptTokens": 50,
            "completionTokens": 400,
        }],
        summary={"health": "warning"},
        final=True,
        status="complete",
    )

    assert saved["attempts"][0]["prompt"] == "FULL PROMPT"
    assert saved["attempts"][0]["text"] == "FULL MODEL OUTPUT"
    path = assessment_root / (started["id"] + ".json")
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["attempts"][0]["text"] == "FULL MODEL OUTPUT"

    rows = assessment.list_assessments()
    assert rows[0]["id"] == started["id"]
    assert rows[0]["attemptCount"] == 1
    assert "attempts" not in rows[0]
    assert rows[0]["bytes"] > 0


def test_deleting_raw_assessment_removes_only_evidence_file(assessment_root):
    started = assessment.start_assessment(_model())
    path = assessment_root / (started["id"] + ".json")
    assert path.is_file()

    assert assessment.delete_assessment(started["id"]) is True
    assert not path.exists()
    assert assessment.list_assessments() == []


def test_assessment_rejects_invalid_evidence_shape(assessment_root):
    started = assessment.start_assessment(_model())

    with pytest.raises(ValueError, match="attempt kind"):
        assessment.update_assessment(
            started["id"],
            [{"kind": "mystery", "target": 512, "status": "failed"}],
        )
