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
FIXED_LADDERS = (
    (34, "169", "model_cap", ((736, 416), (800, 448), (864, 480), (896, 512), (960, 544), (1024, 576), (1088, 608), (1152, 640), (1184, 672), (1248, 704), (1312, 736), (1344, 768))),
    (34, "square", "model_cap", ((576, 576), (608, 608), (640, 640), (672, 672), (704, 704), (736, 736), (768, 768))),
    (34, "43", "model_cap", ((640, 480), (672, 512), (736, 544), (768, 576), (800, 608), (864, 640), (896, 672), (928, 704), (992, 736), (1024, 768))),
    (68, "169", "sentinel", ((512, 288), (576, 320), (640, 352), (672, 384), (736, 416), (800, 448), (864, 480), (896, 512))),
    (68, "square", "sentinel", ((384, 384), (416, 416), (448, 448), (480, 480), (512, 512), (544, 544), (576, 576), (608, 608), (640, 640), (672, 672))),
    (68, "43", "sentinel", ((416, 320), (480, 352), (512, 384), (544, 416), (608, 448), (640, 480), (672, 512), (736, 544), (768, 576))),
    (102, "169", "sentinel", ((384, 224), (448, 256), (512, 288), (576, 320), (640, 352), (672, 384), (736, 416))),
    (102, "square", "sentinel", ((320, 320), (352, 352), (384, 384), (416, 416), (448, 448), (480, 480), (512, 512), (544, 544))),
    (102, "43", "sentinel", ((352, 256), (384, 288), (416, 320), (480, 352), (512, 384), (544, 416), (608, 448), (640, 480))),
    (17, "169", "model_cap", ((1088, 608), (1152, 640), (1184, 672), (1248, 704), (1312, 736), (1344, 768))),
    (17, "square", "model_cap", ((736, 736), (768, 768))),
    (17, "43", "model_cap", ((928, 704), (992, 736), (1024, 768))),
)


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


def write_probe_dataset(path, media_dir, width, height, frames, group="videos"):
    Path(path).write_text(
        "[[directory]]\n"
        + "path = \"" + str(Path(media_dir)).replace("\\", "/") + "\"\n"
        + "num_repeats = 1\n"
        + "group = \"" + str(group) + "\"\n"
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
            writer.writerow([
                "captured_at", "gpu_index", "gpu_uuid", "gpu_memory_used_mib", "gpu_memory_total_mib",
                "gpu_utilization_percent", "mem_available_kib", "swap_total_kib", "swap_free_kib",
            ])
            while not self.stop_event.is_set():
                gpu_rows = []
                try:
                    result = subprocess.run(
                        ["nvidia-smi", "--query-gpu=index,uuid,memory.used,memory.total,utilization.gpu", "--format=csv,noheader,nounits"],
                        capture_output=True,
                        text=True,
                        timeout=5,
                        check=False,
                    )
                    for raw in (result.stdout or "").splitlines():
                        values = [part.strip() for part in raw.split(",")]
                        if len(values) >= 5:
                            gpu_rows.append(values[:5])
                except (OSError, subprocess.SubprocessError):
                    pass
                meminfo = read_meminfo()
                captured_at = utc_now()
                if not gpu_rows:
                    gpu_rows = [["", "", "", "", ""]]
                for gpu_values in gpu_rows:
                    writer.writerow([
                        captured_at, *gpu_values, meminfo.get("MemAvailable", ""), meminfo.get("SwapTotal", ""), meminfo.get("SwapFree", ""),
                    ])
                handle.flush()
                self.stop_event.wait(POLL_SECONDS)


def _telemetry_int(row, field):
    try:
        return int(float(row.get(field) or ""))
    except (TypeError, ValueError):
        return None


def telemetry_summary(path):
    rows = []
    try:
        with Path(path).open("r", newline="", encoding="utf-8") as handle:
            rows = list(csv.DictReader(handle))
    except OSError:
        pass
    gpu_rows = [row for row in rows if _telemetry_int(row, "gpu_memory_used_mib") is not None]
    gpu_groups = {}
    for row in gpu_rows:
        gpu_groups.setdefault(row.get("gpu_index") or "", []).append(row)
    active = None
    for index, group in gpu_groups.items():
        values = [_telemetry_int(row, "gpu_memory_used_mib") for row in group]
        delta = max(values) - values[0]
        candidate = (delta, max(values), index, group)
        if active is None or candidate[:2] > active[:2]:
            active = candidate
    host_available = [_telemetry_int(row, "mem_available_kib") for row in rows]
    swap_free = [_telemetry_int(row, "swap_free_kib") for row in rows]
    host_available = [value for value in host_available if value is not None]
    swap_free = [value for value in swap_free if value is not None]
    active_group = active[3] if active else []
    peak_memory = max([_telemetry_int(row, "gpu_memory_used_mib") for row in active_group], default=None)
    first_available = host_available[0] if host_available else None
    first_swap_free = swap_free[0] if swap_free else None
    min_available = min(host_available) if host_available else None
    min_swap_free = min(swap_free) if swap_free else None
    available_drop = (first_available - min_available) if first_available is not None and min_available is not None else None
    swap_drop = (first_swap_free - min_swap_free) if first_swap_free is not None and min_swap_free is not None else None
    return {
        "activeGpuIndex": active[2] if active else "",
        "activeGpuUuid": active_group[0].get("gpu_uuid") if active_group else "",
        "peakGpuMemoryMiB": peak_memory,
        "minHostAvailableKiB": min_available,
        "minSwapFreeKiB": min_swap_free,
        "hostAvailableDropKiB": available_drop,
        "swapFreeDropKiB": swap_drop,
        "spillEvidence": bool((available_drop or 0) >= 2 * 1024 * 1024 or (swap_drop or 0) >= 1024 * 1024),
    }


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
        writer = csv.DictWriter(handle, fieldnames=[
            "frames", "aspect", "width", "height", "mfp", "status", "baseline_seconds", "slow_threshold_seconds",
            "median_seconds", "slow_step_count", "train_exit_code", "timed_out", "terminal_reason", "cache_wave",
            "active_gpu_index", "peak_gpu_memory_mib", "min_host_available_kib", "min_swap_free_kib", "spill_evidence", "probe_dir",
        ])
        if not exists:
            writer.writeheader()
        writer.writerow(row)


def write_result(path, **payload):
    payload["writtenAt"] = utc_now()
    write_json(path, payload)


def candidate_name(frames, aspect, width, height):
    return str(frames) + "f/" + str(aspect) + "-" + str(width) + "x" + str(height)


def candidate_group(frames, aspect, width, height):
    return "probe-" + str(frames) + "f-" + str(aspect) + "-" + str(width) + "x" + str(height)


def prepare_candidate(seed, ladder, width, height):
    frames = int(ladder["frames"])
    aspect = str(ladder["aspect"])
    probe_dir = seed["results"] / candidate_name(frames, aspect, width, height)
    media_dir = probe_dir / "media"
    output_dir = probe_dir / "output"
    config_path = probe_dir / "config.toml"
    dataset_path = probe_dir / "dataset.toml"
    group = candidate_group(frames, aspect, width, height)
    probe_dir.mkdir(parents=True, exist_ok=False)
    output_dir.mkdir(parents=True, exist_ok=True)
    materialize_probe_media(seed["video"], seed["caption"], media_dir)
    write_probe_dataset(dataset_path, media_dir, width, height, frames, group)
    config_text = seed["config"].read_text(encoding="utf-8")
    config_path.write_text(build_probe_config(config_text, dataset_path, output_dir), encoding="utf-8")
    candidate = {
        "frames": frames,
        "aspect": aspect,
        "shape": [width, height, frames],
        "mfp": mfp(width, height, frames),
        "group": group,
        "probeDir": probe_dir,
        "mediaDir": media_dir,
        "configPath": config_path,
        "datasetPath": dataset_path,
        "trainLog": probe_dir / "train.log",
        "telemetryPath": probe_dir / "telemetry.csv",
        "resultPath": probe_dir / "result.json",
    }
    write_json(probe_dir / "request.json", {
        "frames": frames,
        "aspect": aspect,
        "shape": candidate["shape"],
        "mfp": candidate["mfp"],
        "cacheWave": 1,
        "precache": "../../precache",
        "trainCommand": probe_command(config_path),
    })
    return candidate


def write_precache_dataset(path, candidates):
    lines = []
    for candidate in candidates:
        width, height, frames = candidate["shape"]
        lines.extend([
            "[[directory]]",
            "path = \"" + str(candidate["mediaDir"]).replace("\\", "/") + "\"",
            "num_repeats = 1",
            "group = \"" + candidate["group"] + "\"",
            "size_buckets = [[" + str(width) + ", " + str(height) + ", " + str(frames) + "]]",
            "",
        ])
    Path(path).write_text("\n".join(lines), encoding="utf-8")


def precache_candidates(seed, candidates):
    precache_dir = seed["results"] / "precache"
    precache_dir.mkdir(parents=True, exist_ok=False)
    output_dir = precache_dir / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    dataset_path = precache_dir / "dataset.toml"
    config_path = precache_dir / "config.toml"
    cache_log = precache_dir / "cache.log"
    telemetry_path = precache_dir / "telemetry.csv"
    result_path = precache_dir / "result.json"
    write_precache_dataset(dataset_path, candidates)
    config_text = seed["config"].read_text(encoding="utf-8")
    config_path.write_text(build_probe_config(config_text, dataset_path, output_dir), encoding="utf-8")
    command = probe_command(config_path, cache_only=True)
    write_json(precache_dir / "request.json", {
        "candidateCount": len(candidates),
        "cacheCommand": command,
        "candidates": [{"shape": candidate["shape"], "probeDir": str(candidate["probeDir"].relative_to(seed["results"]))} for candidate in candidates],
    })
    sampler = TelemetrySampler(telemetry_path)
    sampler.start()
    try:
        command_result = run_command(command, Path.cwd(), cache_log)
    finally:
        sampler.stop()
    cache_text = read_log(cache_log)
    status = "completed" if command_result["exitCode"] == 0 else "cache_oom" if log_has_oom(cache_text) else "cache_failed"
    result = {
        "status": status,
        "candidateCount": len(candidates),
        "cacheCommand": command,
        "cacheExitCode": command_result["exitCode"],
        "telemetry": telemetry_summary(telemetry_path),
    }
    write_result(result_path, **result)
    return result


def execute_probe(candidate, baseline_seconds):
    width, height, frames = candidate["shape"]
    train_command = probe_command(candidate["configPath"])
    sampler = TelemetrySampler(candidate["telemetryPath"])
    sampler.start()
    try:
        stall_timeout = max(120.0, float(baseline_seconds) * 20.0) if baseline_seconds else None
        train_result = run_command(train_command, Path.cwd(), candidate["trainLog"], post_warmup_timeout=stall_timeout)
    finally:
        sampler.stop()
    train_text = read_log(candidate["trainLog"])
    measured = iter_times(train_text)[WARMUP_STEPS:TOTAL_STEPS]
    median_seconds = statistics.median(measured) if measured else None
    slow_threshold = max(20.0, float(baseline_seconds) * 2.5) if baseline_seconds else None
    slow_step_count = sum(1 for value in measured if slow_threshold is not None and value >= slow_threshold)
    if train_result["timedOut"]:
        status = "unsafe_slow"
    elif train_result["exitCode"] != 0:
        status = "oom" if log_has_oom(train_text) else "trainer_failed"
    elif len(measured) < TOTAL_STEPS - WARMUP_STEPS:
        status = "trainer_failed"
    elif slow_threshold is not None and median_seconds >= slow_threshold and slow_step_count >= 3:
        status = "unsafe_slow"
    else:
        status = "completed"
    result = {
        "frames": candidate["frames"],
        "aspect": candidate["aspect"],
        "shape": [width, height, frames],
        "mfp": candidate["mfp"],
        "status": status,
        "trainCommand": train_command,
        "trainExitCode": train_result["exitCode"],
        "timedOut": train_result["timedOut"],
        "measuredStepSeconds": measured,
        "medianStepSeconds": median_seconds,
        "baselineSeconds": baseline_seconds,
        "slowThresholdSeconds": slow_threshold,
        "slowStepCount": slow_step_count,
        "telemetry": telemetry_summary(candidate["telemetryPath"]),
    }
    if status in ("oom", "unsafe_slow"):
        result["terminalReason"] = status
    write_result(candidate["resultPath"], **result)
    return result


def _validate_plan(plan):
    if not isinstance(plan, dict) or int(plan.get("version") or 0) != 2 or int(plan.get("rungStep") or 0) != 32:
        raise ValueError("H3 probe plan must be version 2.")
    if plan.get("modelCaps") != {"169": [1344, 768], "square": [768, 768], "43": [1024, 768]}:
        raise ValueError("H3 probe plan must retain the fixed H3 model caps.")
    ladders = plan.get("ladders")
    if not isinstance(ladders, list) or not ladders:
        raise ValueError("Probe plan must contain ordered ladders.")
    actual = []
    for ladder in ladders:
        frames = int(ladder.get("frames") or 0)
        aspect = str(ladder.get("aspect") or "")
        terminal = str(ladder.get("terminal") or "")
        shapes = ladder.get("shapes") if isinstance(ladder.get("shapes"), list) else []
        if frames <= 0 or aspect not in ("169", "square", "43") or terminal not in ("model_cap", "sentinel") or not shapes:
            raise ValueError("Probe plan contains an invalid ladder.")
        for shape in shapes:
            if not isinstance(shape, list) or len(shape) != 2 or int(shape[0]) <= 0 or int(shape[1]) <= 0:
                raise ValueError("Probe plan contains an invalid shape.")
            if int(shape[0]) % 32 or int(shape[1]) % 32:
                raise ValueError("Probe plan shapes must be divisible by 32.")
        actual.append((frames, aspect, terminal, tuple((int(shape[0]), int(shape[1])) for shape in shapes)))
    if tuple(actual) != FIXED_LADDERS:
        raise ValueError("H3 probe plan must match the fixed 90-shape campaign.")
    if sum(len(spec[3]) for spec in FIXED_LADDERS) != 90:
        raise ValueError("H3 probe plan must contain exactly 90 shapes.")
    return ladders


def _summary_row(candidate, result, terminal_reason=""):
    telemetry = result.get("telemetry") if isinstance(result.get("telemetry"), dict) else {}
    width, height, _frames = candidate["shape"]
    return {
        "frames": candidate["frames"],
        "aspect": candidate["aspect"],
        "width": width,
        "height": height,
        "mfp": candidate["mfp"],
        "status": result["status"],
        "baseline_seconds": result.get("baselineSeconds") or "",
        "slow_threshold_seconds": result.get("slowThresholdSeconds") or "",
        "median_seconds": result.get("medianStepSeconds") or "",
        "slow_step_count": result.get("slowStepCount") or "",
        "train_exit_code": result.get("trainExitCode") if result.get("trainExitCode") is not None else "",
        "timed_out": result.get("timedOut", False),
        "terminal_reason": terminal_reason,
        "cache_wave": 1,
        "active_gpu_index": telemetry.get("activeGpuIndex") or "",
        "peak_gpu_memory_mib": telemetry.get("peakGpuMemoryMiB") or "",
        "min_host_available_kib": telemetry.get("minHostAvailableKiB") or "",
        "min_swap_free_kib": telemetry.get("minSwapFreeKiB") or "",
        "spill_evidence": telemetry.get("spillEvidence", False),
        "probe_dir": str(candidate["probeDir"].relative_to(candidate["probeDir"].parents[1])),
    }


def run_campaign(seed):
    plan = read_json(seed["plan"])
    ladders = _validate_plan(plan)
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
    candidates_by_ladder = []
    candidates = []
    campaign_status = "completed"
    ceilings = []
    cache_result = None
    try:
        for ladder in ladders:
            ladder_candidates = []
            for shape in ladder["shapes"]:
                candidate = prepare_candidate(seed, ladder, int(shape[0]), int(shape[1]))
                ladder_candidates.append(candidate)
                candidates.append(candidate)
            candidates_by_ladder.append((ladder, ladder_candidates))
        cache_result = precache_candidates(seed, candidates)
        if cache_result["status"] != "completed":
            campaign_status = cache_result["status"]
            return campaign_status
        for ladder, ladder_candidates in candidates_by_ladder:
            baseline = None
            last_safe = None
            first_unsafe = None
            terminal_reason = ""
            for candidate_index, candidate in enumerate(ladder_candidates):
                width, height, _frames = candidate["shape"]
                print("[h3-probe] " + str(candidate["frames"]) + "f " + candidate["aspect"] + " " + str(width) + "x" + str(height), flush=True)
                result = execute_probe(candidate, baseline)
                if result["status"] == "completed":
                    last_safe = candidate["shape"]
                    if baseline is None:
                        baseline = result.get("medianStepSeconds")
                    if candidate_index == len(ladder_candidates) - 1:
                        terminal_reason = "ceiling_not_found" if ladder["terminal"] == "sentinel" else "model_cap"
                        result["terminalReason"] = terminal_reason
                        write_result(candidate["resultPath"], **result)
                        if terminal_reason == "ceiling_not_found":
                            campaign_status = "inconclusive"
                    append_summary(results_root / "summary.csv", _summary_row(candidate, result, terminal_reason))
                    continue
                if result["status"] in ("oom", "unsafe_slow"):
                    first_unsafe = candidate["shape"]
                    terminal_reason = result["status"]
                    append_summary(results_root / "summary.csv", _summary_row(candidate, result, terminal_reason))
                    print("[h3-probe] stopping ladder after " + terminal_reason, flush=True)
                    break
                append_summary(results_root / "summary.csv", _summary_row(candidate, result, "trainer_failed"))
                campaign_status = result["status"]
                return campaign_status
            if not terminal_reason:
                terminal_reason = str(ladder["terminal"])
                if terminal_reason == "sentinel":
                    terminal_reason = "ceiling_not_found"
                    campaign_status = "inconclusive"
            terminal_telemetry = result.get("telemetry") if isinstance(result.get("telemetry"), dict) else {}
            ceilings.append({
                "frames": int(ladder["frames"]),
                "aspect": str(ladder["aspect"]),
                "baselineSeconds": baseline,
                "lastSafeShape": last_safe,
                "firstUnsafeShape": first_unsafe,
                "firstUnsafeOrSentinelShape": first_unsafe or (last_safe if terminal_reason == "ceiling_not_found" else None),
                "reason": terminal_reason,
                "spillEvidence": terminal_telemetry.get("spillEvidence", False),
                "hostAvailableDropKiB": terminal_telemetry.get("hostAvailableDropKiB"),
                "swapFreeDropKiB": terminal_telemetry.get("swapFreeDropKiB"),
            })
    except KeyboardInterrupt:
        campaign_status = "canceled"
        raise
    except Exception:
        campaign_status = "trainer_failed"
        raise
    finally:
        write_json(results_root / "campaign_result.json", {
            "status": campaign_status,
            "completedAt": utc_now(),
            "precache": cache_result,
            "ceilings": ceilings,
        })
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
