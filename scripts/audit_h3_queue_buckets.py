"""Print a read-only H3 captured-bucket audit for a queue.json file."""

import json
import sys
from pathlib import Path

from tool.server.training_bucket_audit import audit_h3_queue_jobs


def main(argv):
    if len(argv) != 2:
        raise SystemExit("Usage: python scripts/audit_h3_queue_buckets.py <queue.json>")
    payload = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    print(json.dumps(audit_h3_queue_jobs(payload.get("jobs") if isinstance(payload, dict) else []), indent=2))


if __name__ == "__main__":
    main(sys.argv)
