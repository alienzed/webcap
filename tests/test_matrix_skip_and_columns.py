"""Regression checks for Prompt Tests Matrix checkpoint cancellation and columns."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = (ROOT / "tool/server/epoch_test_bench.py").read_text(encoding="utf-8")
FRONTEND = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
CSS = (ROOT / "tool/css/styles.css").read_text(encoding="utf-8")


def test_matrix_skip_only_cancels_queued_checkpoint_jobs():
    assert 'if operation == "test_skip_candidate":' in BACKEND
    skip = BACKEND.split("def skip_candidate(", 1)[1].split("\ndef stop(", 1)[0]
    assert 'if target not in available:' in skip
    assert '_job_candidate_row(job, sweep) != target' in skip
    assert 'not in {"backlog", "queued"}' in skip
    assert '_cancel_shared_pending_job(job_id, session_directory=session_directory, reduce_total=True)' in skip
    assert 'stored["skippedCandidates"] = skipped' in skip
    assert "execution_request_stop(" not in skip


def test_recovered_failures_retain_variation_and_checkpoint_identity():
    sync = BACKEND.split("def _sync_inference_session(", 1)[1].split("\ndef _record_skipped_inference(", 1)[0]
    assert '"kind": metadata.get("candidateKind")' in sync
    assert '"variationIndex": metadata.get("variationIndex")' in sync
    assert '"candidateFile": candidate_file' in sync


def test_matrix_uses_identical_grid_definition_for_headers_and_cells():
    shared_grid = CSS.split(".test-generations-matrix-labels,\n.test-generations-matrix-cases {", 1)[1].split("}", 1)[0]
    assert "grid-template-columns: repeat(var(--matrix-columns), var(--matrix-card-width));" in shared_grid
    assert "gap: 12px;" in shared_grid
    assert "var index = result.variationIndex == null ? (variations.length ? -1 : 0)" in FRONTEND
    assert "index >= 0 && index < columns && Number.isInteger(index)" in FRONTEND


def test_matrix_skip_does_not_change_future_run_selection():
    matrix = FRONTEND.split("function renderMatrix(status)", 1)[1].split("\n  function setResultsView(", 1)[0]
    assert "request('test_skip_candidate'" in matrix
    assert "matrixSkipPending.add(key)" in matrix
    assert "skipButton.classList.toggle('hidden', !pending || skipped)" in matrix
    assert "Epoch skipped" in matrix
    assert "selectedCandidates.delete(" not in matrix


def test_matrix_header_and_board_padding_do_not_force_extra_scroll():
    board = CSS.split(".test-generations-matrix-board {", 1)[1].split("}", 1)[0]
    head = CSS.split(".test-generations-matrix-row-head {", 1)[1].split("}", 1)[0]
    assert "box-sizing: border-box;" in board
    assert "min-width: 100%;" in board
    assert "padding: 8px;" in board
    assert "width: calc(100cqw - 16px);" in head
    assert "box-sizing: border-box;" in head
