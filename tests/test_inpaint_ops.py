import base64
from io import BytesIO

import pytest
from PIL import Image, ImageDraw

from tool.server.inpaint_ops import inpaint_image_in_place


def mask_data_url(size, box=None):
    image = Image.new("L", size, 0)
    if box:
        ImageDraw.Draw(image).rectangle(box, fill=255)
    output = BytesIO()
    image.save(output, format="PNG")
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii")


def test_inpaint_preserves_original_and_other_pixels(tmp_path):
    path = tmp_path / "sample.png"
    image = Image.new("RGB", (80, 60), (212, 178, 45))
    ImageDraw.Draw(image).rectangle((34, 22, 43, 32), fill=(0, 0, 0))
    image.save(path)
    original_bytes = path.read_bytes()
    result = inpaint_image_in_place(tmp_path, "sample.png", mask_data_url((80, 60), (32, 20, 45, 34)))
    assert result == {"width": 80, "height": 60}
    assert (tmp_path / "originals" / "sample.png").read_bytes() == original_bytes
    with Image.open(path) as edited:
        assert edited.size == (80, 60)
        assert edited.getpixel((38, 27)) != (0, 0, 0)
        assert edited.getpixel((5, 5)) == (212, 178, 45)
    inpaint_image_in_place(tmp_path, "sample.png", mask_data_url((80, 60), (32, 20, 45, 34)))
    assert (tmp_path / "originals" / "sample.png").read_bytes() == original_bytes


@pytest.mark.parametrize("mask", [mask_data_url((80, 60)), mask_data_url((40, 30)), "invalid"])
def test_invalid_mask_does_not_change_image(tmp_path, mask):
    path = tmp_path / "sample.png"
    Image.new("RGB", (80, 60), "yellow").save(path)
    before = path.read_bytes()
    with pytest.raises(ValueError):
        inpaint_image_in_place(tmp_path, "sample.png", mask)
    assert path.read_bytes() == before


def test_rejects_video(tmp_path):
    (tmp_path / "clip.mp4").write_bytes(b"not an image")
    with pytest.raises(ValueError, match="still images"):
        inpaint_image_in_place(tmp_path, "clip.mp4", mask_data_url((80, 60)))
