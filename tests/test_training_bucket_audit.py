from pathlib import Path

from tool.server import config as app_config, h3_probe
from tool.server.training_bucket_audit import audit_h3_queue_jobs


def _set_h3_calibration(monkeypatch):
    hardware = {"total_ram_mib": 65536, "gpu_model": "Test GPU", "total_vram_mib": 32768}
    monkeypatch.setattr(h3_probe, "current_h3_hardware", lambda: hardware)
    monkeypatch.setattr(app_config, "config", {
        "training": {"h3_calibration": {
            "hardware": hardware, "results": {}, "safe_shapes": {"68": {"square": [448, 448]}},
        }},
    })


def _captured_dataset(path, buckets):
    path.mkdir(parents=True)
    path.joinpath("dataset.train.toml").write_text(
        '[[directory]]\npath = "videos"\ngroup = "videos"\nsize_buckets = ' + repr(buckets) + '\n',
        encoding="utf-8",
    )


def test_h3_queue_audit_is_read_only_and_classifies_current_policy(tmp_path, monkeypatch):
    _set_h3_calibration(monkeypatch)
    safe = tmp_path / "safe"
    off_ladder = tmp_path / "off-ladder"
    above = tmp_path / "above"
    unknown = tmp_path / "unknown"
    _captured_dataset(safe, [[448, 448, 68]])
    _captured_dataset(off_ladder, [[400, 400, 68]])
    _captured_dataset(above, [[512, 512, 68]])
    _captured_dataset(unknown, [[448, 448, 102]])
    before = {path: path.joinpath("dataset.train.toml").read_text(encoding="utf-8") for path in (safe, off_ladder, above, unknown)}

    findings = audit_h3_queue_jobs([
        {"id": "safe", "stages": "h3", "inputPath": str(safe)},
        {"id": "off", "stages": "h3", "inputPath": str(off_ladder)},
        {"id": "above", "stages": "h3", "inputPath": str(above)},
        {"id": "unknown", "stages": "h3", "inputPath": str(unknown)},
        {"id": "other", "stages": "wan21", "inputPath": str(safe)},
    ])

    assert [(item["jobId"], item["status"]) for item in findings] == [
        ("safe", "SAFE"), ("off", "OFF_LADDER"), ("above", "ABOVE_CEILING"), ("unknown", "RAW/UNKNOWN"),
    ]
    assert findings[0]["role"] == "temporal"
    assert findings[0]["ceiling"] == [448, 448]
    assert findings[0]["selectable"] is True
    assert all(path.joinpath("dataset.train.toml").read_text(encoding="utf-8") == text for path, text in before.items())


def test_h3_queue_audit_reports_unreadable_captured_dataset(tmp_path):
    findings = audit_h3_queue_jobs([{"id": "missing", "stages": "h3", "inputPath": str(tmp_path / "missing")}])
    assert findings == [{
        "jobId": "missing", "status": "RAW/UNKNOWN",
        "reason": "Captured H3 dataset TOML is unavailable or unreadable.",
    }]
