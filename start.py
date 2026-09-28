"""Start WebCap after ensuring its own Python requirements are installed."""

from pathlib import Path
import runpy
import subprocess
import sys


ROOT = Path(__file__).resolve().parent
REQUIREMENTS = ROOT / "requirements.txt"


def main():
    if not REQUIREMENTS.is_file():
        raise RuntimeError(f"WebCap requirements file is missing: {REQUIREMENTS}")

    print(f"[WebCap] Ensuring Python requirements in {sys.executable}")
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "-r",
            str(REQUIREMENTS),
        ],
        cwd=ROOT,
        check=True,
    )

    runpy.run_module("tool.server.app", run_name="__main__")


if __name__ == "__main__":
    main()
