from tool.server import training_progress


def test_runner_progress_reports_single_stage_epoch_progress(tmp_path):
    hi_path = tmp_path / "config.hi.toml"
    hi_path.write_text("epochs = 50\n", encoding="utf-8")
    job = {
        "stage": "hi",
        "stages": "hi",
        "snapshot": {"hi": str(hi_path)},
    }

    training_progress.sync_job_progress(
        job,
        "Started new epoch: 38\n[INFO] [Rank 0] step=4160, skipped=0\n",
    )

    assert job["progress"] == {
        "stage": "hi",
        "epoch": 38,
        "epochs": 50,
        "step": 4160,
        "stagePercent": 76.0,
        "overallPercent": 76.0,
        "estimated": False,
        "source": "epochs",
    }

    training_progress.sync_job_progress(job, "[INFO] [Rank 0] step=4170, skipped=0\n")

    assert job["progress"]["epoch"] == 38
    assert job["progress"]["step"] == 4170

def test_runner_progress_uses_generated_step_plan_without_an_epoch_marker(tmp_path):
    lo_path = tmp_path / "config.lo.toml"
    lo_path.write_text("epochs = 90\n", encoding="utf-8")
    job = {
        "stage": "lo",
        "stages": "lo",
        "snapshot": {"lo": str(lo_path)},
        "progressPlan": {
            "lo": {"estimatedSteps": 20000},
        },
    }

    training_progress.sync_job_progress(job, "\n".join([
        "[INFO] [Rank 0] step=9698, skipped=0, iter time (s): 2.0",
        "[INFO] [Rank 0] step=9699, skipped=0, iter time (s): 3.0",
        "[INFO] [Rank 0] step=9700, skipped=0, iter time (s): 4.0",
    ]))

    assert job["progress"] == {
        "stage": "lo",
        "epoch": None,
        "epochs": 90,
        "step": 9700,
        "stagePercent": 48.5,
        "overallPercent": 48.5,
        "estimated": True,
        "plannedSteps": 20000,
        "source": "steps",
        "estimatedTrainingSeconds": 29100,
        "etaSeconds": 30900,
        "etaScope": "completion",
    }


def test_h3_progress_uses_the_single_stage_snapshot_and_plan(tmp_path):
    h3_path = tmp_path / "config.h3.toml"
    h3_path.write_text("epochs = 100\ncheckpoint_every_n_epochs = 5\n", encoding="utf-8")
    job = {
        "stage": "h3",
        "stages": "h3",
        "snapshot": {"h3": str(h3_path)},
        "progressPlan": {"h3": {"estimatedSteps": 9500}},
    }

    training_progress.sync_job_progress(
        job,
        "[webcap] stage=h3\n[INFO] [Rank 0] step=4750, skipped=0\n",
    )

    assert job["progress"]["stage"] == "h3"
    assert job["progress"]["stagePercent"] == 50.0
    assert job["progress"]["overallPercent"] == 50.0
    assert job["progress"]["plannedSteps"] == 9500

def test_runner_progress_uses_epoch_progress_and_a_rolling_step_eta(tmp_path):
    lo_path = tmp_path / "config.lo.toml"
    lo_path.write_text("epochs = 90\n", encoding="utf-8")
    job = {
        "stage": "lo",
        "stages": "lo",
        "snapshot": {"lo": str(lo_path)},
        "progressPlan": {"lo": {"estimatedSteps": 20000}},
    }

    training_progress.sync_job_progress(
        job,
        "\n".join([
            "Started new epoch: 85",
            "[INFO] [Rank 0] step=9408, skipped=0, iter time (s): 2.0",
            "[INFO] [Rank 0] step=9409, skipped=0, iter time (s): 3.0",
            "[INFO] [Rank 0] step=9410, skipped=0, iter time (s): 4.0",
        ]),
    )

    assert job["progress"] == {
        "stage": "lo",
        "epoch": 85,
        "epochs": 90,
        "step": 9410,
        "stagePercent": 94.4,
        "overallPercent": 94.4,
        "estimated": False,
        "source": "epochs",
        "estimatedTrainingSeconds": 28230,
        "etaSeconds": 1661,
        "etaScope": "completion",
    }


def test_runner_progress_uses_epoch_fraction_when_the_step_plan_is_too_small(tmp_path):
    hi_path = tmp_path / "config.hi.toml"
    hi_path.write_text("epochs = 50\n", encoding="utf-8")
    job = {
        "stage": "hi",
        "stages": "hi",
        "snapshot": {"hi": str(hi_path)},
        "progressPlan": {"hi": {"estimatedSteps": 6350}},
    }

    training_progress.sync_job_progress(
        job,
        "\n".join([
            "Started new epoch: 36",
            "[INFO] [Rank 0] step=5888, skipped=0, iter time (s): 5.0",
            "[INFO] [Rank 0] step=5889, skipped=0, iter time (s): 5.0",
            "[INFO] [Rank 0] step=5890, skipped=0, iter time (s): 5.0",
        ]),
    )

    assert job["progress"]["stagePercent"] == 72.0
    assert job["progress"]["estimatedTrainingSeconds"] == 29450
    assert job["progress"]["etaSeconds"] == 11453
    assert job["progress"]["etaScope"] == "completion"


def test_runner_progress_targets_the_end_of_the_current_checkpoint_epoch(tmp_path):
    lo_path = tmp_path / "config.lo.toml"
    lo_path.write_text("epochs = 10\ncheckpoint_every_n_epochs = 5\n", encoding="utf-8")
    job = {
        "stage": "lo",
        "stages": "lo",
        "snapshot": {"lo": str(lo_path)},
        "progressPlan": {"lo": {"estimatedSteps": 1000}},
    }

    training_progress.sync_job_progress(
        job,
        "\n".join([
            "Started new epoch: 5",
            "[INFO] [Rank 0] step=400, skipped=0, iter time (s): 2.0",
            "[INFO] [Rank 0] step=401, skipped=0, iter time (s): 2.0",
            "[INFO] [Rank 0] step=402, skipped=0, iter time (s): 2.0",
        ]),
    )

    assert job["progress"]["nextCheckpointEpoch"] == 5
    assert job["progress"]["checkpointEtaSeconds"] == 200

def test_completed_job_flags_a_result_far_below_the_step_estimate_without_epoch_progress():
    job = {
        "status": "completed",
        "progress": {"step": 1650, "plannedSteps": 20000},
    }

    training_progress.annotate_completed_job(job)

    assert "step 1,650" in job["completionNote"]
    assert "~20,000 planned steps" in job["completionNote"]

def test_completed_job_uses_logged_epochs_instead_of_a_stale_step_estimate():
    job = {
        "status": "completed",
        "completionNote": "Finished at step 10,080 of ~20,000 planned steps.",
        "progress": {"epoch": 90, "epochs": 90, "step": 10080, "plannedSteps": 20000, "source": "epochs"},
    }

    training_progress.annotate_completed_job(job)

    assert "completionNote" not in job
