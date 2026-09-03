import math
from pathlib import Path

import pytest
from PIL import Image

from tool.server import config as app_config
from tool.server import app as app_module
from tool.server import training_review
from tool.server import h3_probe
from tool.server.dataset_config import build_video_blocks
from tool.server.training_profiles import MINIMAX_H3_PROFILE_ID, WAN22_PROFILE_ID


def _configure_root(monkeypatch, root):
    monkeypatch.setattr(app_config, "FS_ROOT", root)


def _set(root):
    folder = root / "sets" / "subject"
    folder.mkdir(parents=True)
    images = {
        "square-small.png": (480, 480),
        "square-large.png": (768, 768),
        "landscape.png": (896, 672),
        "portrait.png": (672, 896),
    }
    for name, size in images.items():
        Image.new("RGB", size, color=(20, 30, 40)).save(folder / name)
        (folder / Path(name).with_suffix(".txt").name).write_text("subject", encoding="utf-8")
    return folder, list(images)


def _review(folder, names):
    return training_review.prepare_training_review(
        folder, MINIMAX_H3_PROFILE_ID, "train", names, total_media_count=len(names),
    )


def test_review_distribution_assigns_each_image_once_and_uses_short_edge(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    folder, names = _set(tmp_path)

    payload = _review(folder, names)

    assert payload["ok"] is True
    for group in payload["distribution"]["images"].values():
        assigned = [row for row in group["native"] if row["assignedTarget"]]
        assert len(assigned) == len(group["native"])
        assert sum(item["assignedCount"] for item in group["targets"]) == len(assigned)
        for row in assigned:
            assert row["file"] in names
            expected = min(row["assignedTarget"]) / row["nativeShortEdge"]
            assert math.isclose(row["scaleRatio"], expected)
            assert row["impactBand"] in {"down20", "down", "near", "up", "up20"}


def test_review_update_limits_targets_and_reset_replaces_custom_dataset(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    folder, names = _set(tmp_path)
    payload = _review(folder, names)
    ladder = payload["ladders"]["images"]["square"]
    assert len(ladder) >= 4

    plan = payload["plan"]
    plan["stages"]["h3"]["imageBuckets"]["square"] = ladder[:3]
    updated = training_review.update_training_review(folder, MINIMAX_H3_PROFILE_ID, {
        "runId": "train", "selected_media": names, "total_media_count": len(names), "plan": plan,
    })
    assert len(updated["plan"]["stages"]["h3"]["imageBuckets"]["square"]) == 3

    plan = updated["plan"]
    plan["stages"]["h3"]["imageBuckets"]["square"] = ladder[:4]
    with pytest.raises(ValueError, match="more than three"):
        training_review.update_training_review(folder, MINIMAX_H3_PROFILE_ID, {
            "runId": "train", "selected_media": names, "total_media_count": len(names), "plan": plan,
        })

    dataset = folder / "dataset.train.toml"
    dataset.write_text('[[directory]]\npath = "custom"\nnum_repeats = 1\ngroup = "images"\nsize_buckets = [[512, 512, 1]]\nextra = true\n', encoding="utf-8")
    custom = _review(folder, names)
    assert custom["customDataset"]
    reset = training_review.update_training_review(folder, MINIMAX_H3_PROFILE_ID, {
        "runId": "train", "selected_media": names, "total_media_count": len(names), "reset": "buckets",
    })
    assert reset["customDataset"] is False
    assert dataset.read_text(encoding="utf-8").startswith("# webcap_training_review = 1")


def test_wan22_lo_review_only_edits_the_lo_stage(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    folder, names = _set(tmp_path)

    payload = training_review.prepare_training_review(
        folder, WAN22_PROFILE_ID, "lo", names, total_media_count=len(names),
    )

    assert set(payload["plan"]["stages"]) == {"lo"}
    ladder = payload["ladders"]["images"]["square"]
    payload["plan"]["stages"]["lo"]["imageBuckets"]["square"] = [ladder[0]]
    updated = training_review.update_training_review(folder, WAN22_PROFILE_ID, {
        "runId": "lo", "selected_media": names, "total_media_count": len(names), "plan": payload["plan"],
    })

    assert updated["plan"]["stages"]["lo"]["imageBuckets"]["square"] == [ladder[0]]


def test_off_ladder_image_bucket_stays_connected_to_review(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    folder, names = _set(tmp_path)
    _review(folder, names)
    (folder / "dataset.train.toml").write_text(
        'enable_ar_bucket = true\n\n[[directory]]\npath = "square"\nnum_repeats = 1\ngroup = "images"\nsize_buckets = [[510, 510, 1]]\n',
        encoding="utf-8",
    )

    payload = _review(folder, names)

    assert payload["customDataset"] is False
    assert payload["plan"]["stages"]["h3"]["imageBuckets"]["square"] == [[510, 510]]
    updated = training_review.update_training_review(folder, MINIMAX_H3_PROFILE_ID, {
        "runId": "train", "selected_media": names, "total_media_count": len(names), "plan": payload["plan"],
    })
    assert updated["plan"]["stages"]["h3"]["imageBuckets"]["square"] == [[510, 510]]


def test_off_ladder_video_bucket_stays_connected_to_review(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    folder, names = _set(tmp_path)
    _review(folder, names)
    (folder / "dataset.train.toml").write_text(
        'enable_ar_bucket = true\n\n[[directory]]\npath = "square"\nnum_repeats = 1\ngroup = "videos"\nsize_buckets = [[370, 370, 68]]\n',
        encoding="utf-8",
    )

    payload = _review(folder, names)

    assert payload["customDataset"] is False
    temporal = next(role for role in payload["plan"]["videoRoles"] if role["id"] == "temporal")
    assert temporal["buckets"]["square"] == [[370, 370]]
    updated = training_review.update_training_review(folder, MINIMAX_H3_PROFILE_ID, {
        "runId": "train", "selected_media": names, "total_media_count": len(names), "plan": payload["plan"],
    })
    temporal = next(role for role in updated["plan"]["videoRoles"] if role["id"] == "temporal")
    assert temporal["buckets"]["square"] == [[370, 370]]


def test_video_distribution_keeps_h3_roles_independent():
    plan = {
        "profileId": MINIMAX_H3_PROFILE_ID,
        "stages": {"h3": {"imageBuckets": {}}},
        "videoRoles": [
            {"id": "balanced", "enabled": True, "frames": 34, "weight": 1.0, "buckets": {"square": [[576, 576]]}},
            {"id": "temporal", "enabled": True, "frames": 68, "weight": 0.5, "buckets": {"square": [[512, 512], [672, 672]]}},
            {"id": "detail", "enabled": True, "frames": 17, "weight": 0.25, "buckets": {"square": [[672, 672]]}},
        ],
    }
    manifest = {"images": [], "videos": [{"ar": "square", "width": 640, "height": 640, "frames": 80}]}

    distribution = training_review._distribution_payload(manifest, plan)

    temporal = distribution["videos"]["temporal"]["square"]
    balanced = distribution["videos"]["balanced"]["square"]
    detail = distribution["videos"]["detail"]["square"]
    assert (balanced["frames"], temporal["frames"], detail["frames"]) == (34, 68, 17)
    assert balanced["eligibleCount"] == temporal["eligibleCount"] == detail["eligibleCount"] == 1
    assert balanced["native"][0]["assignedTarget"] == [576, 576]
    assert temporal["native"][0]["assignedTarget"] == [512, 512]
    assert detail["native"][0]["assignedTarget"] == [672, 672]
    assert distribution["impact"]["videos"]["temporal"] != distribution["impact"]["videos"]["detail"]


def test_h3_default_roles_enable_balanced_temporal_and_detail():
    roles = {role["id"]: role for role in training_review._normal_roles(MINIMAX_H3_PROFILE_ID)}

    assert {name: (role["frames"], role["weight"], role["enabled"]) for name, role in roles.items()} == {
        "balanced": (34, 1.0, True),
        "temporal": (68, 0.5, True),
        "detail": (17, 0.25, True),
    }


def test_h3_review_uses_video_limits_and_rejects_managed_targets_above_them(monkeypatch):
    hardware = {"total_ram_mib": 65536, "gpu_model": "Test GPU", "total_vram_mib": 32768}
    monkeypatch.setattr(h3_probe, "current_h3_hardware", lambda: hardware)
    monkeypatch.setattr(app_config, "config", {
        "training": {
            "h3_calibration": {
                "hardware": hardware,
                "results": {},
                "safe_shapes": {"17": {"169": [1184, 672]}},
            },
        },
    })
    wide = training_review._candidate_video_buckets("169", MINIMAX_H3_PROFILE_ID, "detail", 17)
    assert wide[0] == (1184, 672)
    square = training_review._candidate_video_buckets("square", MINIMAX_H3_PROFILE_ID, "detail", 17)
    assert square[0] == (736, 736)
    assert (768, 768) not in square

    limits = training_review._video_limits(
        MINIMAX_H3_PROFILE_ID,
        {"videoRoles": [{"id": "detail", "frames": 17}]},
        {"videos": [{"ar": "169"}, {"ar": "square"}]},
    )
    assert limits["detail"]["169"] == {
        "effectiveCeiling": [1184, 672],
        "automaticDefaultCeiling": [1088, 608],
        "source": "calibration",
        "campaign": "",
    }
    assert limits["detail"]["square"]["source"] == "baseline"
    assert limits["detail"]["square"]["automaticDefaultCeiling"] == [704, 704]



def test_h3_generation_and_review_reset_share_the_automatic_default_ladder(monkeypatch, tmp_path):
    hardware = {"total_ram_mib": 65536, "gpu_model": "Test GPU", "total_vram_mib": 32768}
    monkeypatch.setattr(h3_probe, "current_h3_hardware", lambda: hardware)
    monkeypatch.setattr(app_config, "config", {
        "training": {
            "h3_calibration": {
                "hardware": hardware,
                "results": {},
                "safe_shapes": {"68": {"square": [448, 448]}},
            },
        },
    })
    videos = [{
        "file": "clip.mp4", "ar": "square", "width": 1024, "height": 1024,
        "prepared_path": "square/clip.mp4", "frames": 136,
    }]
    entries = build_video_blocks(tmp_path, videos, [], mode="normal", profile_id=MINIMAX_H3_PROFILE_ID, require_files=False)
    temporal = next(item for item in entries if item["role"] == "temporal")
    reset_defaults = training_review._clustered_buckets(
        {"videos": videos}, MINIMAX_H3_PROFILE_ID, "temporal", 68,
    )

    assert temporal["bucket"] == (384, 384, 68)
    assert reset_defaults["square"] == [[384, 384]]


def test_video_role_metadata_round_trips_without_a_trainable_directory():
    profile_plan = {
        "version": 1,
        "stages": {"h3": {"targetSteps": 20000, "imageBuckets": {}}},
        "videoRoles": [
            {"id": "balanced", "enabled": True, "frames": 34, "weight": 1.0, "buckets": {"square": [[544, 544]]}},
            {"id": "temporal", "enabled": True, "frames": 68, "weight": 0.5, "buckets": {"square": [[352, 352]]}},
            {"id": "detail", "enabled": False, "frames": 17, "weight": 0.25, "buckets": {"square": [[672, 672]]}},
        ],
    }

    text = training_review._render_stage_dataset({"datasetEntries": []}, profile_plan, MINIMAX_H3_PROFILE_ID)
    imported = training_review._import_representable_dataset(text, MINIMAX_H3_PROFILE_ID, "h3", profile_plan)
    roles = {role["id"]: role for role in imported["videoRoles"]}

    assert '# webcap_video_role = ' in text
    assert roles["balanced"]["buckets"] == {"square": [[544, 544]]}
    assert roles["temporal"]["buckets"] == {"square": [[352, 352]]}
    assert roles["detail"]["enabled"] is False


def test_h3_legacy_managed_dataset_keeps_new_balanced_role_disabled():
    roles = training_review._normal_roles(MINIMAX_H3_PROFILE_ID)
    next(role for role in roles if role["id"] == "balanced")["buckets"] = {"square": [[544, 544]]}
    profile_plan = {
        "version": 1,
        "stages": {"h3": {"targetSteps": 20000, "imageBuckets": {}}},
        "videoRoles": roles,
    }
    text = "\n".join([
        '# webcap_video_role = {"id":"temporal","enabled":true,"frames":68,"weight":1.0,"buckets":{"square":[[352,352]]}}',
        '# webcap_video_role = {"id":"detail","enabled":true,"frames":17,"weight":0.25,"buckets":{"square":[[704,704]]}}',
    ])

    imported = training_review._import_representable_dataset(text, MINIMAX_H3_PROFILE_ID, "h3", profile_plan)
    roles = {role["id"]: role for role in imported["videoRoles"]}

    assert roles["balanced"]["enabled"] is False
    assert roles["balanced"]["buckets"]
    assert roles["temporal"]["enabled"] is True
    assert roles["detail"]["enabled"] is True


def test_structured_dataset_render_keeps_image_frame_count_and_review_comments():
    profile_plan = {"videoRoles": []}
    stage_plan = {"datasetEntries": [{
        "kind": "image", "role": "image", "ar": "square", "bucket": [512, 512], "sourceDir": "square_img",
        "eligibleCount": 3, "nativeCount": 2, "upscaledCount": 1, "numRepeats": 10,
    }]}

    text = training_review._render_stage_dataset(stage_plan, profile_plan, MINIMAX_H3_PROFILE_ID)

    assert "enable_ar_bucket = true" in text
    assert "[512, 512, 1]" in text
    assert "# bucket: 512 × 512 × 1 frame" in text
    assert "# assigned: 3 items · 2 near/native · 1 resized" in text
    assert "# adjacent supported targets:" in text


def test_video_distribution_reports_when_a_role_has_no_eligible_clips():
    plan = {
        "profileId": MINIMAX_H3_PROFILE_ID,
        "stages": {"h3": {"imageBuckets": {}}},
        "videoRoles": [{"id": "temporal", "enabled": True, "frames": 68, "weight": 1.0, "buckets": {"square": [[352, 352]]}}],
    }
    manifest = {"images": [], "videos": [{"file": "short.mp4", "ar": "square", "width": 640, "height": 640, "frames": 20}]}

    group = training_review._distribution_payload(manifest, plan)["videos"]["temporal"]["square"]

    assert group["count"] == 1
    assert group["eligibleCount"] == 0
    assert group["missingFrameCount"] == 0
    assert group["shortFrameCount"] == 1
    assert group["native"][0]["assignedTarget"] == []


def test_video_distribution_keeps_a_visible_video_when_frame_metadata_is_missing():
    plan = {
        "profileId": MINIMAX_H3_PROFILE_ID,
        "stages": {"h3": {"imageBuckets": {}}},
        "videoRoles": [{"id": "temporal", "enabled": True, "frames": 68, "weight": 1.0, "buckets": {"square": [[352, 352]]}}],
    }
    manifest = {"images": [], "videos": [{"file": "unknown.mp4", "ar": "square", "width": 640, "height": 640, "frames": None}]}

    group = training_review._distribution_payload(manifest, plan)["videos"]["temporal"]["square"]

    assert group["count"] == 1
    assert group["eligibleCount"] == 0
    assert group["missingFrameCount"] == 1
    assert group["native"][0]["eligibilityReason"] == "Frame count unavailable."


def test_review_warnings_flag_substantial_upscale_but_not_downscale():
    distribution = {"images": {"square": {"native": [
        {"eligible": True, "target": [512, 512], "impactBand": "down20"},
        {"eligible": True, "target": [512, 512], "impactBand": "up20"},
    ], "targets": []}}, "videos": {}}

    warnings = training_review._distribution_warnings(distribution, {"skipped": []})

    resize_warnings = [warning for warning in warnings if warning["code"] == "substantial_upscale"]
    assert len(resize_warnings) == 1
    assert resize_warnings[0]["message"].startswith("1 of 2 image item(s)")


def test_review_route_returns_recomputed_payload_and_invalid_toml_is_loud(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    folder, names = _set(tmp_path)
    client = app_module.app.test_client()
    request = {"folder": "sets/subject", "profileId": MINIMAX_H3_PROFILE_ID, "runId": "train", "selected_media": names, "total_media_count": len(names)}

    response = client.post("/fs/training_review", json=request)

    assert response.status_code == 200
    payload = response.get_json()
    assert "distribution" in payload and "impact" in payload["distribution"]
    request["plan"] = payload["plan"]
    update = client.post("/fs/training_review/update", json=request)
    assert update.status_code == 200 and "distribution" in update.get_json()

    (folder / "dataset.train.toml").write_text("not = [valid", encoding="utf-8")
    invalid = client.post("/fs/training_review", json=request)
    assert invalid.status_code == 400


def test_bucket_modal_markup_and_script_keep_the_editor_focused():
    root = Path(__file__).parents[1]
    html = (root / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (root / "tool" / "js" / "training_review.js").read_text(encoding="utf-8")
    main_script = (root / "tool" / "js" / "main.js").read_text(encoding="utf-8")

    assert 'id="training-review-modal"' in html
    assert 'id="training-review-modal-done"' in html
    assert "data-review-view" in script
    assert "data-review-aspect" in script
    assert "data-review-step" in script
    assert 'disabled title="No current video meets' not in script
    assert "training-review-impact-cells" in script
    assert "Smaller target" in script and "Larger target" in script
    assert "training-review-bucket-check" not in script
    assert "Training intent" not in script
    assert "return getFilteredMediaItems(false)" in main_script
    assert "querySelectorAll('.media-item[data-type=\"media\"]')" not in main_script


def test_switching_sets_resets_only_ephemeral_launch_inputs():
    root = Path(__file__).parents[1]
    script = (root / "tool" / "js" / "training_workspace.js").read_text(encoding="utf-8")
    start = script.index("function resetTrainingRunSetupForFolder")
    end = script.index("function refreshTrainingWorkspace", start)
    reset = script[start:end]

    for field in (
        "training-run-name-input",
        "training-run-starting-point-select",
        "training-run-checkpoint-select",
        "training-run-resume-input",
    ):
        assert field in reset
    assert "resetTrainingReviewBuckets" not in reset
    assert "ensureSelectedTrainingSetup" not in reset


def test_custom_resume_is_a_first_class_mutually_exclusive_resume_choice():
    root = Path(__file__).parents[1]
    html = (root / "tool" / "tool.html").read_text(encoding="utf-8")
    runner = (root / "tool" / "js" / "training_runner_ui.js").read_text(encoding="utf-8")
    workspace = (root / "tool" / "js" / "training_workspace.js").read_text(encoding="utf-8")
    resume_fields = html[html.index('id="training-run-resume-fields"'):html.index('id="training-run-initializer-fields"')]
    diagnostics = html[html.index("Manual command &amp; diagnostics"):]
    assert 'id="training-run-resume-input"' in resume_fields
    assert 'id="training-run-resume-input"' not in diagnostics
    assert "customResumePath" in runner and "if (checkpointSelect.value && resumeInput) resumeInput.value = ''" in workspace
    assert "historyRunsLoading" in (root / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    assert "Loading current-set checkpoints" in (root / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    assert "resumeActionId: options && options.resumeActionId" in (root / "tool" / "js" / "main.js").read_text(encoding="utf-8")
