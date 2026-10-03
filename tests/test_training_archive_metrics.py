import pytest

from tool.server.training_archive import _archive_metrics_from_events


def test_archive_metrics_describe_selected_epoch_without_scoring_quality():
    epoch_events = [
        {"axis": 1, "loss": 1.00, "wallTime": 100.0, "order": 0},
        {"axis": 2, "loss": 0.80, "wallTime": 160.0, "order": 1},
        {"axis": 3, "loss": 0.65, "wallTime": 220.0, "order": 2},
        {"axis": 4, "loss": 0.55, "wallTime": 280.0, "order": 3},
        {"axis": 5, "loss": 0.48, "wallTime": 340.0, "order": 4},
        {"axis": 6, "loss": 0.40, "wallTime": 400.0, "order": 5},
    ]
    detailed_events = [
        {"axis": 1, "loss": 1.10, "wallTime": 70.0, "order": 0},
        {"axis": 10, "loss": 0.90, "wallTime": 90.0, "order": 1},
        {"axis": 11, "loss": 0.85, "wallTime": 120.0, "order": 2},
        {"axis": 20, "loss": 0.75, "wallTime": 150.0, "order": 3},
        {"axis": 21, "loss": 0.70, "wallTime": 180.0, "order": 4},
        {"axis": 30, "loss": 0.60, "wallTime": 210.0, "order": 5},
        {"axis": 31, "loss": 0.60, "wallTime": 240.0, "order": 6},
        {"axis": 40, "loss": 0.50, "wallTime": 270.0, "order": 7},
        {"axis": 41, "loss": 0.52, "wallTime": 300.0, "order": 8},
        {"axis": 50, "loss": 0.44, "wallTime": 330.0, "order": 9},
        {"axis": 51, "loss": 0.42, "wallTime": 360.0, "order": 10},
        {"axis": 60, "loss": 0.38, "wallTime": 390.0, "order": 11},
    ]

    metrics = _archive_metrics_from_events(detailed_events, epoch_events, 6, [3, 5])

    assert metrics["selectedEpoch"] == 6
    assert metrics["step"] == 60
    assert metrics["stepStart"] == 51
    assert metrics["stepEnd"] == 60
    assert metrics["epochLoss"] == pytest.approx(0.40)
    assert metrics["smoothedLoss"] is not None
    assert metrics["startingEpoch"] == 1
    assert metrics["startingLoss"] == pytest.approx(1.00)
    assert metrics["lossReductionPercent"] == pytest.approx(60.0)
    assert metrics["recentComparisonEpoch"] == 1
    assert metrics["recentWindowEpochs"] == 5
    assert metrics["recentLossChangePercent"] == pytest.approx(-60.0)
    assert metrics["trainingSecondsToSelected"] == pytest.approx(330.0)
    assert metrics["selectedEpochSeconds"] == pytest.approx(60.0)
    assert metrics["savedEpochs"] == [3, 5, 6]
    assert len(metrics["epochLossPoints"]) == 6
