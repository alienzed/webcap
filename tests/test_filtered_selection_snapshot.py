import json
from pathlib import Path

import pytest
from PIL import Image

import tool.server.dataset_config as dataset_config_module
import tool.server.dataset_prep as dataset_prep_module


def write_text(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def write_image(path: Path, size):
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", size, color=(25, 100, 200))
    image.save(path)


def test_prepare_dataset_uses_selected_subset_and_records_selection(tmp_path, monkeypatch):
    set_folder = tmp_path / "set"
    set_folder.mkdir(parents=True)
    write_image(set_folder / "a.png", (512, 512))
    write_image(set_folder / "b.png", (512, 512))
    write_text(set_folder / "a.txt", "alpha caption")
    write_text(set_folder / "b.txt", "beta caption")

    monkeypatch.setattr(
        dataset_prep_module,
        "update_media_metadata",
        lambda _folder: {
            "a.png": {"resolution": "512x512"},
            "b.png": {"resolution": "512x512"},
        },
    )

    dataset_prep_module.prepare_dataset(
        set_folder,
        selected_media=["a.png"],
        selection_criteria={"filter_text": "alpha"},
        total_media_count=2,
    )

    manifest_path = set_folder / "auto_dataset" / "prep_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    selection = manifest["selection"]
    assert selection["mode"] == "visible_subset"
    assert selection["selected_count"] == 1
    assert selection["total_count"] == 2
    assert selection["selected_files"] == ["a.png"]
    assert (set_folder / "auto_dataset" / "square_img" / "a.png").exists()
    assert not (set_folder / "auto_dataset" / "square_img" / "b.png").exists()


def test_prepare_dataset_fails_loudly_on_missing_caption(tmp_path, monkeypatch):
    set_folder = tmp_path / "set"
    set_folder.mkdir(parents=True)
    write_image(set_folder / "a.png", (512, 512))

    monkeypatch.setattr(
        dataset_prep_module,
        "update_media_metadata",
        lambda _folder: {
            "a.png": {"resolution": "512x512"},
        },
    )

    with pytest.raises(RuntimeError, match="Missing caption file"):
        dataset_prep_module.prepare_dataset(
            set_folder,
            selected_media=["a.png"],
            selection_criteria={},
            total_media_count=1,
        )


def test_generate_dataset_configs_omits_selection_snapshot_comments_by_default(tmp_path):
    set_folder = tmp_path / "set"
    auto_dataset = set_folder / "auto_dataset"
    img_43 = auto_dataset / "43_img"
    img_916 = auto_dataset / "916_img"
    img_43.mkdir(parents=True)
    img_916.mkdir(parents=True)

    write_image(img_43 / "aa.png", (896, 672))
    write_image(img_916 / "zz.png", (576, 1024))
    write_text(img_43 / "aa.txt", "key phrase #one\nmissing token")
    write_text(img_916 / "zz.txt", "another caption")

    manifest = {
        "version": 1,
        "target_fps": 16,
        "videos": [],
        "images": [
            {
                "file": "aa.png",
                "ar": "43",
                "width": 896,
                "height": 672,
                "prepared_path": "43_img/aa.png",
                "caption": True,
            },
            {
                "file": "zz.png",
                "ar": "916",
                "width": 576,
                "height": 1024,
                "prepared_path": "916_img/zz.png",
                "caption": True,
            },
        ],
        "skipped": [],
        "selection": {
            "mode": "visible_subset",
            "selected_files": ["aa.png", "zz.png"],
            "selected_count": 2,
            "total_count": 5,
            "criteria": {
                "source_folder": "char/james",
                "filter_text": "stars>1",
                "reviewed_only": True,
            },
        },
    }
    write_text(auto_dataset / "prep_manifest.json", json.dumps(manifest))

    dataset_config_module.generate_dataset_configs(set_folder)

    lo_text = (set_folder / "dataset.lo.toml").read_text(encoding="utf-8")
    assert "# --- webcap selection snapshot v1 ---" not in lo_text
    assert "# snapshot.prepared_mode: visible_subset" not in lo_text
    assert "# snapshot.selected_count: 2" not in lo_text
    assert "# snapshot.total_count: 5" not in lo_text
    assert "# criteria.source_folder: char/james" not in lo_text
    assert "# criteria.filter_text: stars>1" not in lo_text
    assert "# criteria.reviewed_only: True" not in lo_text
    assert "# bucket: 43_img" not in lo_text
    assert "# bucket: 916_img" not in lo_text
    assert "# file: aa.png" not in lo_text
    assert "# file: zz.png" not in lo_text
    assert "# snapshot.selection_hash: sha256:" not in lo_text
    assert "enable_ar_bucket = true" in lo_text
