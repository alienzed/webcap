"""Conservative VL option partial-credit contracts."""
from pathlib import Path

import pytest

from tool.server.epoch_test_bench import _test_vl_partial_credit


@pytest.mark.parametrize("expected,observed,credit", [
    ("triangle ring connectors", "micro triangle ring connectors", 0.75),
    ("micro triangle ring connectors", "triangle ring connectors", 0.75),
    ("gray-green", "green", 0.5),
    ("green", "gray-green", 0.5),
    ("triangle ring connectors", "square ring connectors", 0),
    ("black", "white", 0),
    ("ring connectors", "no ring connectors", 2 / 3),
    ("(absent)", "ring connectors", 0),
    ("red", "red", 0),
    ("micro triangle", "triangle micro", 0),
])
def test_test_vl_partial_credit(expected, observed, credit):
    assert _test_vl_partial_credit(expected, observed) == pytest.approx(credit)


def test_browser_and_server_score_same_type_of_mismatches():
    js = (Path(__file__).resolve().parents[1] / "tool/js/test_generations.js").read_text(encoding="utf-8")
    assert "function testVlPartialCredit(expected, observed)" in js
    assert "score.matches += partial;" in js
    assert "score.count += 1;" in js
    assert "return shorter.length / longer.length;" in js
