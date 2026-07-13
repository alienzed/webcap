import pytest

from tool.server import training_tensorboard


def test_tensorboard_port_defaults_and_rejects_invalid_values():
    assert training_tensorboard._port({}) == 6006
    assert training_tensorboard._port({"tensorboard_port": "6010"}) == 6010
    with pytest.raises(ValueError):
        training_tensorboard._port({"tensorboard_port": 80})
