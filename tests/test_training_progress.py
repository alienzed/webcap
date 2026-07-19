from tool.server import training_progress


def test_runner_progress_estimates_stage_and_overall_from_epoch_logs(tmp_path):
    hi_path = tmp_path / "config.hi.toml"
    lo_path = tmp_path / "config.lo.toml"
    hi_path.write_text("epochs = 50\n", encoding="utf-8")
    lo_path.write_text("epochs = 90\n", encoding="utf-8")
    job = {
        "stage": "hi",
        "stages": "both",
        "snapshot": {"hi": str(hi_path), "lo": str(lo_path)},
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
        "overallPercent": 27.1,
        "estimated": False,
        "source": "epochs",
    }

    training_progress.sync_job_progress(job, "[INFO] [Rank 0] step=4170, skipped=0\n")

    assert job["progress"]["epoch"] == 38
    assert job["progress"]["step"] == 4170

def test_runner_progress_uses_generated_step_plan_without_an_epoch_marker(tmp_path):
    hi_path = tmp_path / "config.hi.toml"
    lo_path = tmp_path / "config.lo.toml"
    hi_path.write_text("epochs = 50\n", encoding="utf-8")
    lo_path.write_text("epochs = 90\n", encoding="utf-8")
    job = {
        "stage": "lo",
        "stages": "both",
        "snapshot": {"hi": str(hi_path), "lo": str(lo_path)},
        "progressPlan": {
            "hi": {"estimatedSteps": 5000},
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
        "overallPercent": 58.8,
        "estimated": True,
        "plannedSteps": 20000,
        "source": "steps",
        "estimatedTrainingSeconds": 29100,
        "etaSeconds": 30900,
        "etaScope": "completion",
    }

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
        "etaSeconds": 31770,
        "etaScope": "completion",
    }

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
