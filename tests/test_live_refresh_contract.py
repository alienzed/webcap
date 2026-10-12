"""Regression contracts for stable live polling surfaces.

These checks protect DOM-preserving update paths without involving GPU work.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_inference_queue_reuses_rows_and_actions():
    script = (ROOT / "tool" / "js" / "inference_queue.js").read_text(encoding="utf-8")
    assert "var previousRows = new Map();" in script
    assert "previousRows.get(String(job.jobId || '')) || createRow(job)" in script
    assert "function reconcileQueueChildren(host, wanted)" in script
    assert "if (host.children[index] !== node) host.insertBefore(node" in script
    assert "var preserveActions = row.dataset.inferenceQueueStatus === status;" in script
    assert "if (actions && !preserveActions)" in script
    assert "if (actions && preserveActions && status === 'queued')" in script
    assert "reconcileQueueChildren(host, wanted);" in script
    assert "host.innerHTML = '';" not in script


def test_storage_scan_events_keep_inventory_dom():
    script = (ROOT / "tool" / "js" / "storage_manager.js").read_text(encoding="utf-8")
    scan = script.split("function refreshScanStatus()", 1)[1].split("function confirmDelete(item)", 1)[0]
    assert "syncScanButton();" in scan
    assert "status.textContent = scanStatusText();" in scan
    assert "if (wasActive) return refresh();" in scan
    assert "render();" not in scan
