import json

import pytest

from tool.server import config as app_config


def test_load_config_creates_missing_config_from_example(tmp_path, monkeypatch):
    config_path = tmp_path / "config.json"
    example_path = tmp_path / "config.example.json"
    example_path.write_text(
        json.dumps({
            "filesystem": {
                "root": "C:/sets",
                "output_root": "",
                "app_data_root": "",
                "models": "",
            },
            "theme": "dark",
            "training": {},
        }),
        encoding="utf-8",
    )
    monkeypatch.setattr(app_config, "CONFIG_PATH", config_path)
    monkeypatch.setattr(app_config, "CONFIG_EXAMPLE_PATH", example_path)

    loaded = app_config.load_config_from_disk()

    assert config_path.is_file()
    assert loaded["filesystem"]["root"] == "C:/sets"
    assert loaded["theme"] == "dark"
    assert json.loads(config_path.read_text(encoding="utf-8")) == loaded


def test_load_config_does_not_replace_invalid_existing_config(tmp_path, monkeypatch):
    config_path = tmp_path / "config.json"
    example_path = tmp_path / "config.example.json"
    config_path.write_text("not json\n", encoding="utf-8")
    example_path.write_text(
        json.dumps({"filesystem": {"root": "C:/sets"}, "training": {}}),
        encoding="utf-8",
    )
    monkeypatch.setattr(app_config, "CONFIG_PATH", config_path)
    monkeypatch.setattr(app_config, "CONFIG_EXAMPLE_PATH", example_path)

    with pytest.raises(json.JSONDecodeError):
        app_config.load_config_from_disk()

    assert config_path.read_text(encoding="utf-8") == "not json\n"
