from pathlib import Path

import tool.server.config as config_module


def test_fill_template_placeholders_normalizes_paths(monkeypatch):
    monkeypatch.setattr(
        config_module,
        "config",
        {
            "filesystem": {
                "root": "C:\\training\\",
                "models": "/mnt/w/models//",
            }
        },
    )

    template = (
        'dataset = "{TRAINING_ROOT}/{DATASET}/dataset.lo.toml"\n'
        'model = "{MODELS_ROOT}/Stable-diffusion"\n'
    )
    rendered = config_module.fill_template_placeholders(template, r"/set//nested\subject_a/")

    assert 'dataset = "C:/training/set/nested/subject_a/dataset.lo.toml"' in rendered
    assert 'model = "/mnt/w/models/Stable-diffusion"' in rendered
    assert "training//set" not in rendered
    assert "models//Stable-diffusion" not in rendered


def test_dataset_lo_template_uses_placeholders():
    template_path = Path(__file__).resolve().parents[1] / "tool" / "templates" / "dataset.lo.toml"
    text = template_path.read_text(encoding="utf-8")

    assert "/mnt/w/training/massage/v3/" not in text
    assert text.count('{TRAINING_ROOT}/{DATASET}/auto_dataset/square') >= 2
    assert text.count('{TRAINING_ROOT}/{DATASET}/auto_dataset/169') >= 2
