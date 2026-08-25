#!/usr/bin/env python3
"""Run a fixed MiniMax H3 shape envelope probe from a prepared WebCap seed."""

import argparse
import csv
import json
import os
import platform
import re
import shutil
import signal
import statistics
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path


WARMUP_STEPS = 2
TOTAL_STEPS = 6
SLOWDOWN_MULTIPLIER = 10.0
POLL_SECONDS = 1.0
OOM_PATTERN = re.compile(r"(?:cuda.*out of memory|outofmemoryerror|cublas.*alloc|cuda error: out of memory)", re.IGNORECASE)
ITER_TIME_PATTERN = re.compile(r"\biter time \(s\):\s*(\d+(?:\.\d+)?)", re.IGNORECASE)
STEP_PATTERN = re.compile(r"\bstep=(\d+)", re.IGNORECASE)
TOP_LEVEL_NUMBER_PATTERNS = {
    "epochs": re.compile(r"^(\s*epochs\s*=\s*)\d+(\s*(?:#.*)?)$", re.MULTILINE),
    "save_every_n_epochs": re.compile(r"^(\s*save_every_n_epochs\s*=\s*)\d+(\s*(?:#.*)?)$", re.MULTILINE),
    "checkpoint_every_n_epochs": re.compile(r"^(\s*checkpoint_every_n_epochs\s*=\s*)\d+(\s*(?:#.*)?)$", re.MULTILINE),
    "steps_per_print": re.compile(r"^(\s*steps_per_print\s*=\s*)\d+(\s*(?:#.*)?)$", re.MULTILINE),
}
DATASET_PATTERN = re.compile(r"^(\s*dataset\s*=\s*)[\"'][^\"']+[\"'](\s*(?:#.*)?)$", re.MULTILINE)
OUTPUT_PATTERN = re.compile(r"^(\s*output_dir\s*=\s*)[\"'][^\"']+[\"'](\s*(?:#.*)?)$", re.MULTILINE)


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def read_json(path):
    with Path(path).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path, payload):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, target)


def seed_path(seed_root, value):
    path = Path(str(value or ""))
    if not path.is_absolute():
        path = Path(seed_root) / path
    return path.resolve()


def load_seed(seed_path_value):
    seed_path_obj = Path(seed_path_value).resolve()
    seed = read_json(seed_path_obj)
    if not isinstance(seed, dict):
        raise ValueError("Probe seed must be a JSON object.")
    seed_root = seed_path_obj.parent
    source = seed.get("source") if isinstance(seed.get("source"), dict) else {}
    video = seed_path(seed_root, source.get("video"))
    caption = seed_path(seed_root, source.get("caption"))
    config = seed_path(seed_root, seed.get("baseConfig"))
    plan = seed_path(seed_root, seed.get("plan"))
    results = seed_path(seed_root, seed.get("results") or "results")
    for label, path in (("source video", video), ("source caption", caption), ("base config", config), ("probe plan", plan)):
        if not path.is_file():
            raise FileNotFoundError("Probe seed is missing " + label + ": " + str(path))
    return {
        "seedPath": seed_path_obj,
        "seed": seed,
        "video": video,
        "caption": caption,
        "config": config,
        "plan": plan,
        "results": results,
    }


def replace_required(text, pattern, value, label):
    updated, count = pattern.subn(lambda match: match.group(1) + str(value) + match.group(2), text, count=1)
    if count != 1:
        raise ValueError("Probe config is missing required " + label + ".")
    return updated


def replace_required_path(text, pattern, value, label):
    quoted = str(value).replace("\\", "/")
    updated, count = pattern.subn(lambda match: match.group(1) + '"' + quoted + '"' + match.group(2), text, count=1)
    if count != 1:
        raise ValueError("Probe config is missing required " + label + ".")
    return updated


def build_probe_config(base_text, dataset_path, output_path):
    """Change only probe-owned config values; leave model/runtime settings intact."""
    text = replace_required_path(base_text, DATASET_PATTERN, dataset_path, "dataset path")
    text = replace_required_path(text, OUTPUT_PATTERN, output_path, "output_dir")
    text = replace_required(text, TOP_LEVEL_NUMBER_PATTERNS["epochs"], TOTAL_STEPS, "epochs")
    text = replace_required(text, TOP_LEVEL_NUMBER_PATTERNS["save_every_n_epochs"], TOTAL_STEPS + 1, "save_every_n_epochs")
    text = replace_required(text, TOP_LEVEL_NUMBER_PATTERNS["checkpoint_every_n_epochs"], TOTAL_STEPS + 1, "checkpoint_every_n_epochs")
    return replace_required(text, TOP_LEVEL_NUMBER_PATTERNS["steps_per_print"], 1, "steps_per_print")


def write_probe_dataset(path, media_dir, width, height, frames):
    Path(path).write_text(
        "[[directory]]\n"
        + "path = \"" + str(Path(media_dir)).replace("\\", "/") + "\"\n"
        + "num_repeats = 1\n"
        + "group = \"videos\"\n"
        + "size_buckets = [[" + str(width) + ", " + str(height) + ", " + str(frames) + "]]\n",
        encoding="utf-8",
    )


def materialize_probe_media(source_video, source_caption, media_dir):
    media_dir = Path(media_dir)
    media_dir.mkdir(parents=True, exist_ok=True)
    video_target = media_dir / Path(source_video).name
    caption_target = media_dir / Path(source_caption).name
    try:
        os.link(source_video, video_target)
    except OSError:
        shutil.copy2(source_video, video_target)
    shutil.copy2(source_caption, caption_target)
    return video_target


def read_log(path):
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def iter_times(log_text):
    return [float(value) for value in ITER_TIME_PATTERN.findall(log_text) if float(value) > 0]


def latest_step(log_text):
    matches = STEP_PATTERN.findall(log_text)
    return int(matches[-1]) if matches else None


def log_has_oom(log_text):
    return bool(OOM_PATTERN.search(log_text or ""))


def read_meminfo():
    values = {}
    try:
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            key, raw = line.split(":", 1)
            values[key] = raw.strip().split()[0]
    except (OSError, ValueError, IndexError):
        pass
    return values


class TelemetrySampler:
    def __init__(self, path):
        self.path = Path(path)
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._run, name="h3-probe-telemetry", daemon=True)

    def start(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.thread.join(timeout=5)

    def _run(self):
        with self.path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(["captured_at", "gpu_memory_used_mib", "gpu_memory_total_mib", "gpu_utilization_percent", "mem_available_kib", "swap_free_kib"])
            while not self.stop_event.is_set():
                gpu_values = ["", "", ""]
                try:
                    result = subprocess.run(
                        ["nvidia-smi", "--query-gpu=memory.used,memory.total,utilization.gpu", "--format=csv,noheader,nounits"],
                        capture_output=True,
                        text=True,
                        timeout=5,
                        check=False,
                    )
                    first = (result.stdout or "").splitlines()[0]
                    gpu_values = [part.strip() for part in first.split(",")[:3]]
                except (OSError, subprocess.SubprocessError, IndexError):
                    pass
                meminfo = read_meminfo()
                writer.writerow([utc_now(), *gpu_values, meminfo.get("MemAvailable", ""), meminfo.get("SwapFree", "")])
                handle.flush()
                self.stop_event.wait(POLL_SECONDS)


def terminate_process_group(process):
    if process.poll() is not None:
        return
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGTERM)
        else:
            process.terminate()
        process.wait(timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        try:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
        except OSError:
            pass
        process.wait(timeout=15)


def run_command(args, cwd, log_path, post_warmup_timeout=None):
    log_path = Path(log_path)
    last_step = None
    last_step_at = time.monotonic()
    timed_out = False
    with log_path.open("w", encoding="utf-8") as log_handle:
        try:
            process = subprocess.Popen(
                args,
                cwd=str(cwd),
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                start_new_session=(os.name == "posix"),
            )
        except OSError as error:
            log_handle.write("[h3-probe] could not start command: " + str(error) + "\n")
            return {"exitCode": 127, "timedOut": False}
        try:
            while process.poll() is None:
                text = read_log(log_path)
                current_step = latest_step(text)
                if current_step is not None and current_step != last_step:
                    last_step = current_step
                    last_step_at = time.monotonic()
                if post_warmup_timeout and current_step is not None and current_step >= WARMUP_STEPS:
                    if time.monotonic() - last_step_at > post_warmup_timeout:
                        timed_out = True
                        terminate_process_group(process)
                        break
                time.sleep(POLL_SECONDS)
        except KeyboardInterrupt:
            terminate_process_group(process)
            raise
    return {"exitCode": process.returncode, "timedOut": timed_out}


def probe_command(config_path, cache_only=False):
    command = ["deepspeed", "--num_gpus=1", "train.py", "--deepspeed", "--config", str(config_path), "--trust_cache"]
    if cache_only:
        command.append("--cache_only")
    return command


def mfp(width, height, frames):
    return round((int(width) * int(height) * int(frames)) / 1_000_000.0, 4)


def append_summary(path, row):
    target = Path(path)
    exists = target.exists()
    with target.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["frames", "aspect", "width", "height", "mfp", "status", "baseline_seconds", "median_seconds", "cache_exit_code", "train_exit_code", "timed_out", "probe_dir"])
        if not exists:
            writer.writeheader()
        writer.writerow(row)


def write_result(path, **payload):
    payload["writtenAt"] = utc_now()
    write_json(path, payload)


def execute_probe(seed, ladder, width, height, baseline_seconds):
    frames = int(ladder["frames"])
    aspect = str(ladder["aspect"])
    shape_name = aspect + "-" + str(width) + "x" + str(height)
    probe_dir = seed["results"] / (str(frames) + "f") / shape_name
    media_dir = probe_dir / "media"
    output_dir = probe_dir / "output"
    config_path = probe_dir / "config.toml"
    dataset_path = probe_dir / "dataset.toml"
    cache_log = probe_dir / "cache.log"
    train_log = probe_dir / "train.log"
    telemetry_path = probe_dir / "telemetry.csv"
    result_path = probe_dir / "result.json"
    probe_dir.mkdir(parents=True, exist_ok=False)
    output_dir.mkdir(parents=True, exist_ok=True)
    materialize_probe_media(seed["video"], seed["caption"], media_dir)
    write_probe_dataset(dataset_path, media_dir, width, height, frames)
    config_text = seed["config"].read_text(encoding="utf-8")
    config_path.write_text(build_probe_config(config_text, dataset_path, output_dir), encoding="utf-8")
    request = {
        "frames": frames,
        "aspect": aspect,
        "shape": [width, height, frames],
        "mfp": mfp(width, height, frames),
        "cacheCommand": probe_command(config_path, cache_only=True),
        "trainCommand": probe_command(config_path),
    }
    write_json(probe_dir / "request.json", request)

    sampler = TelemetrySampler(telemetry_path)
    sampler.start()
    try:
        cache_result = run_command(probe_command(config_path, cache_only=True), Path.cwd(), cache_log)
        cache_text = read_log(cache_log)
        if cache_result["exitCode"] != 0:
            status = "oom" if log_has_oom(cache_text) else "cache_failed"
            result = {**request, "status": status, "cacheExitCode": cache_result["exitCode"], "trainExitCode": None, "timedOut": False, "measuredStepSeconds": []}
            write_result(result_path, **result)
            return result
        timeout = (float(baseline_seconds) * SLOWDOWN_MULTIPLIER) if baseline_seconds else None
        train_result = run_command(probe_command(config_path), Path.cwd(), train_log, post_warmup_timeout=timeout)
    finally:
        sampler.stop()
    train_text = read_log(train_log)
    measured = iter_times(train_text)[WARMUP_STEPS:TOTAL_STEPS]
    median_seconds = statistics.median(measured) if measured else None
    if train_result["timedOut"]:
        status = "timing_limit"
    elif train_result["exitCode"] != 0:
        status = "oom" if log_has_oom(train_text) else "trainer_failed"
    elif len(measured) < TOTAL_STEPS - WARMUP_STEPS:
        status = "trainer_failed"
    elif baseline_seconds and median_seconds >= float(baseline_seconds) * SLOWDOWN_MULTIPLIER:
        status = "timing_limit"
    else:
        status = "completed"
    result = {
        **request,
        "status": status,
        "cacheExitCode": cache_result["exitCode"],
        "trainExitCode": train_result["exitCode"],
        "timedOut": train_result["timedOut"],
        "measuredStepSeconds": measured,
        "medianStepSeconds": median_seconds,
        "baselineSeconds": baseline_seconds,
    }
    write_result(result_path, **result)
    return result


def run_campaign(seed):
    plan = read_json(seed["plan"])
    ladders = plan.get("ladders") if isinstance(plan, dict) else None
    if not isinstance(ladders, list) or not ladders:
        raise ValueError("Probe plan must contain ordered ladders.")
    results_root = seed["results"]
    results_root.mkdir(parents=True, exist_ok=False)
    write_json(results_root / "environment.json", {
        "createdAt": utc_now(),
        "python": sys.version,
        "platform": platform.platform(),
        "seed": str(seed["seedPath"]),
        "sourceVideo": str(seed["video"]),
        "baseConfig": str(seed["config"]),
        "plan": plan,
    })
    campaign_status = "completed"
    try:
        for ladder in ladders:
            frames = int(ladder["frames"])
            aspect = str(ladder["aspect"])
            shapes = ladder.get("shapes") if isinstance(ladder.get("shapes"), list) else []
            baseline = None
            for index, shape in enumerate(shapes):
                width, height = int(shape[0]), int(shape[1])
                print("[h3-probe] " + str(frames) + "f " + aspect + " " + str(width) + "x" + str(height), flush=True)
                result = execute_probe(seed, ladder, width, height, baseline)
                append_summary(results_root / "summary.csv", {
                    "frames": frames,
                    "aspect": aspect,
                    "width": width,
                    "height": height,
                    "mfp": result["mfp"],
                    "status": result["status"],
                    "baseline_seconds": result.get("baselineSeconds") or "",
                    "median_seconds": result.get("medianStepSeconds") or "",
                    "cache_exit_code": result.get("cacheExitCode"),
                    "train_exit_code": result.get("trainExitCode") if result.get("trainExitCode") is not None else "",
                    "timed_out": result.get("timedOut", False),
                    "probe_dir": str((results_root / (str(frames) + "f") / (aspect + "-" + str(width) + "x" + str(height))).relative_to(results_root)),
                })
                if result["status"] == "completed" and index == 0:
                    baseline = result.get("medianStepSeconds")
                    continue
                if result["status"] == "completed":
                    continue
                if result["status"] in ("oom", "timing_limit"):
                    print("[h3-probe] stopping ladder after " + result["status"], flush=True)
                    break
                campaign_status = result["status"]
                return campaign_status
    except KeyboardInterrupt:
        campaign_status = "canceled"
        raise
    except Exception:
        campaign_status = "trainer_failed"
        raise
    finally:
        write_json(results_root / "campaign_result.json", {"status": campaign_status, "completedAt": utc_now()})
    return campaign_status


def main(argv=None):
    parser = argparse.ArgumentParser(description="Run a prepared MiniMax H3 envelope probe.")
    parser.add_argument("--seed", required=True, help="Path to the WebCap-generated seed.json")
    args = parser.parse_args(argv)
    seed = load_seed(args.seed)
    status = run_campaign(seed)
    return 0 if status == "completed" else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
