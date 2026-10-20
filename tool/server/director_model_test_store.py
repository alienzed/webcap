"""Retired Director Benchmark API.

Legacy assessment execution was replaced by the single /app/model-lab workflow.
Old calibration reports remain readable via director_model_calibration for
historical imports, not for launching additional tests.
"""


def register_routes(app):
    """Compatibility for the existing application import; registers no routes."""
    return None
