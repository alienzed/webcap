"""Compare baseline and feature regression failures; fail only for new regressions."""
import re
import sys
from pathlib import Path

def failures(path):
    text=Path(path).read_text(encoding="utf-8")
    found=set()
    for line in text.splitlines():
        match=re.match(r"^(?:FAILED|ERROR)\s+([^\s]+)",line.strip())
        if match: found.add(match.group(1))
    return found

if __name__=="__main__":
    baseline, feature=map(failures,sys.argv[1:3])
    introduced=feature-baseline
    print(f"Baseline failures: {len(baseline)}")
    print(f"Feature failures: {len(feature)}")
    print(f"Introduced failures: {len(introduced)}")
    for item in sorted(introduced):
        print("NEW REGRESSION:", item)
    if introduced: sys.exit(1)
    print("No new failures relative to main. Existing stale tests still require reconciliation.")
