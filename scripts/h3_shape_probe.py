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
MIN_GPU_FREE_MIB = 680
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


def build_probe_config(base_text, dataset_path, output_path, epochs=TOTAL_STEPS):
    """Change only probe-owned config values; leave model/runtime settings intact."""
    text = replace_required_path(base_text, DATASET_PATTERN, dataset_path, "dataset path")
    text = replace_required_path(text, OUTPUT_PATTERN, output_path, "output_dir")
    text = replace_required(text, TOP_LEVEL_NUMBER_PATTERNS["epochs"], epochs, "epochs")
    text = replace_required(text, TOP_LEVEL_NUMBER_PATTERNS["save_every_n_epochs"], epochs + 1, "save_every_n_epochs")
    text = replace_required(text, TOP_LEVEL_NUMBER_PATTERNS["checkpoint_every_n_epochs"], epochs + 1, "checkpoint_every_n_epochs")
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
    used_values = [_telemetry_int(row, "gpu_memory_used_mib") for row in active_group]
    used_values = [value for value in used_values if value is not None]
    memory_pairs = []
    for row in active_group:
        used = _telemetry_int(row, "gpu_memory_used_mib")
        total = _telemetry_int(row, "gpu_memory_total_mib")
        if used is not None and total is not None and total >= used:
            memory_pairs.append((used, total))
    peak_memory = max(used_values, default=None)
    memory_totals = [total for _used, total in memory_pairs]
    minimum_free = min([total - used for used, total in memory_pairs], default=None)
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
        "gpuMemoryTotalMiB": memory_totals[0] if memory_totals else None,
        "minimumGpuFreeMiB": minimum_free,
        "minHostAvailableKiB": min_available,
        "minSwapFreeKiB": min_swap_free,
        "hostAvailableDropKiB": available_drop,
        "swapFreeDropKiB": swap_drop,
        "memoryPressureEvidence": bool((available_drop or 0) >= 2 * 1024 * 1024 or (swap_drop or 0) >= 1024 * 1024),
    }


def telemetry_minimum_free_mib(telemetry):
    """Return exact minimum free VRAM, including readable legacy telemetry."""
    if not isinstance(telemetry, dict):
        return None
    minimum = telemetry.get("minimumGpuFreeMiB")
    if minimum is not None:
        try:
            minimum = int(minimum)
        except (TypeError, ValueError):
            return None
        return minimum if minimum >= 0 else None
    try:
        peak = int(telemetry.get("peakGpuMemoryMiB"))
        total = int(telemetry.get("gpuMemoryTotalMiB"))
    except (TypeError, ValueError):
        return None
    free = total - peak
    return free if free >= 0 else None


def telemetry_has_required_vram_headroom(telemetry):
    minimum_free = telemetry_minimum_free_mib(telemetry)
    return minimum_free is not None and minimum_free >= MIN_GPU_FREE_MIB


def telemetry_is_below_required_vram_headroom(path):
    minimum_free = telemetry_minimum_free_mib(telemetry_summary(path))
    return minimum_free is not None and minimum_free < MIN_GPU_FREE_MIB


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


def run_command(args, cwd, log_path, post_warmup_timeout=None, stop_when=None, cancel_when=None):
    log_path = Path(log_path)
    last_step = None
    last_step_at = time.monotonic()
    timed_out = False
    stopped_for = ""
    if cancel_when is not None and cancel_when():
        raise KeyboardInterrupt
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
                if cancel_when is not None and cancel_when():
                    terminate_process_group(process)
                    raise KeyboardInterrupt
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
                if stop_when is not None and stop_when():
                    stopped_for = "unsafe_vram"
                    terminate_process_group(process)
                    break
                time.sleep(POLL_SECONDS)
        except KeyboardInterrupt:
            terminate_process_group(process)
            raise
    return {"exitCode": process.returncode, "timedOut": timed_out, "stoppedFor": stopped_for}


def probe_command(config_path, cache_only=False, trust_cache=False):
    command = ["deepspeed", "--num_gpus=1", "train.py", "--deepspeed", "--config", str(config_path)]
    if trust_cache:
        command.append("--trust_cache")
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
            "median_seconds", "slow_step_count", "train_exit_code", "timed_out", "terminal_reason",
            "active_gpu_index", "peak_gpu_memory_mib", "min_gpu_free_mib", "min_host_available_kib", "min_swap_free_kib", "spill_evidence", "probe_dir",
        ])
        if not exists:
            writer.writeheader()
        writer.writerow(row)


def write_result(path, **payload):
    payload["writtenAt"] = utc_now()
    write_json(path, payload)


def candidate_name(frames, aspect, width, height):
    return str(frames) + "f/" + str(aspect) + "-" + str(width) + "x" + str(height)


def prepare_candidate(seed, ladder, width, height, work_root):
    frames = int(ladder["frames"])
    aspect = str(ladder["aspect"])
    probe_dir = seed["results"] / candidate_name(frames, aspect, width, height)
    media_dir = Path(work_root) / "media" / candidate_name(frames, aspect, width, height)
    output_dir = Path(work_root) / "outputs" / candidate_name(frames, aspect, width, height)
    config_path = probe_dir / "config.toml"
    dataset_path = probe_dir / "dataset.toml"
    probe_dir.mkdir(parents=True, exist_ok=False)
    output_dir.mkdir(parents=True, exist_ok=True)
    materialize_probe_media(seed["video"], seed["caption"], media_dir)
    write_probe_dataset(dataset_path, media_dir, width, height, frames)
    config_text = seed["config"].read_text(encoding="utf-8")
    config_path.write_text(build_probe_config(config_text, dataset_path, output_dir), encoding="utf-8")
    candidate = {
        "frames": frames,
        "aspect": aspect,
        "shape": [width, height, frames],
        "mfp": mfp(width, height, frames),
        "probeDir": probe_dir,
        "mediaDir": media_dir,
        "configPath": config_path,
        "datasetPath": dataset_path,
        "trainLog": probe_dir / "train.log",
        "cacheLog": probe_dir / "cache.log",
        "telemetryPath": probe_dir / "telemetry.csv",
        "cacheTelemetryPath": probe_dir / "cache_telemetry.csv",
        "resultPath": probe_dir / "result.json",
    }
    write_json(probe_dir / "request.json", {
        "frames": frames,
        "aspect": aspect,
        "shape": candidate["shape"],
        "mfp": candidate["mfp"],
        "cacheCommand": probe_command(config_path, cache_only=True),
        "trainCommand": probe_command(config_path, trust_cache=True),
    })
    return candidate


def execute_probe(candidate, baseline_seconds, on_train_start=None, cancel_when=None):
    width, height, frames = candidate["shape"]
    cache_command = probe_command(candidate["configPath"], cache_only=True)
    cache_sampler = TelemetrySampler(candidate["cacheTelemetryPath"])
    cache_sampler.start()
    try:
        cache_result = run_command(cache_command, Path.cwd(), candidate["cacheLog"], cancel_when=cancel_when)
    finally:
        cache_sampler.stop()
    cache_text = read_log(candidate["cacheLog"])
    cache_telemetry = telemetry_summary(candidate["cacheTelemetryPath"])
    if cache_result["exitCode"] != 0:
        status = "oom" if log_has_oom(cache_text) else "cache_failed"
        result = {
            "frames": candidate["frames"],
            "aspect": candidate["aspect"],
            "shape": [width, height, frames],
            "mfp": candidate["mfp"],
            "status": status,
            "terminalReason": "cache_oom" if status == "oom" else "cache_failed",
            "cacheCommand": cache_command,
            "cacheExitCode": cache_result["exitCode"],
            "cacheTelemetry": cache_telemetry,
            "trainCommand": None,
            "trainExitCode": None,
            "timedOut": False,
            "measuredStepSeconds": [],
            "medianStepSeconds": None,
            "baselineSeconds": baseline_seconds,
            "slowThresholdSeconds": None,
            "slowStepCount": 0,
            "telemetry": {},
        }
        write_result(candidate["resultPath"], **result)
        return result

    train_command = probe_command(candidate["configPath"], trust_cache=True)
    if cancel_when is not None and cancel_when():
        raise KeyboardInterrupt
    if on_train_start is not None:
        on_train_start()
    sampler = TelemetrySampler(candidate["telemetryPath"])
    sampler.start()
    try:
        stall_timeout = max(120.0, float(baseline_seconds) * 20.0) if baseline_seconds else None
        train_result = run_command(
            train_command,
            Path.cwd(),
            candidate["trainLog"],
            post_warmup_timeout=stall_timeout,
            stop_when=lambda: telemetry_is_below_required_vram_headroom(candidate["telemetryPath"]),
            cancel_when=cancel_when,
        )
    finally:
        sampler.stop()
    train_text = read_log(candidate["trainLog"])
    measured = iter_times(train_text)[WARMUP_STEPS:TOTAL_STEPS]
    median_seconds = statistics.median(measured) if measured else None
    slow_threshold = max(20.0, float(baseline_seconds) * 2.5) if baseline_seconds else None
    slow_step_count = sum(1 for value in measured if slow_threshold is not None and value >= slow_threshold)
    telemetry = telemetry_summary(candidate["telemetryPath"])
    if train_result.get("stoppedFor") == "unsafe_vram":
        status = "unsafe_vram"
    elif train_result["timedOut"]:
        status = "unsafe_slow"
    elif train_result["exitCode"] != 0:
        status = "oom" if log_has_oom(train_text) else "trainer_failed"
    elif len(measured) < TOTAL_STEPS - WARMUP_STEPS:
        status = "trainer_failed"
    elif telemetry_minimum_free_mib(telemetry) is None:
        status = "telemetry_failed"
    elif not telemetry_has_required_vram_headroom(telemetry):
        status = "unsafe_vram"
    elif slow_threshold is not None and median_seconds >= slow_threshold:
        status = "unsafe_slow"
    else:
        status = "completed"
    telemetry["spillEvidence"] = bool(status == "unsafe_slow" and telemetry.get("memoryPressureEvidence"))
    result = {
        "frames": candidate["frames"],
        "aspect": candidate["aspect"],
        "shape": [width, height, frames],
        "mfp": candidate["mfp"],
        "status": status,
        "cacheCommand": cache_command,
        "cacheExitCode": cache_result["exitCode"],
        "cacheTelemetry": cache_telemetry,
        "trainCommand": train_command,
        "trainExitCode": train_result["exitCode"],
        "timedOut": train_result["timedOut"],
        "measuredStepSeconds": measured,
        "medianStepSeconds": median_seconds,
        "baselineSeconds": baseline_seconds,
        "slowThresholdSeconds": slow_threshold,
        "slowStepCount": slow_step_count,
        "telemetry": telemetry,
    }
    if status in ("oom", "unsafe_slow", "unsafe_vram", "telemetry_failed"):
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
        "active_gpu_index": telemetry.get("activeGpuIndex") or "",
        "peak_gpu_memory_mib": telemetry.get("peakGpuMemoryMiB") or "",
        "min_gpu_free_mib": telemetry_minimum_free_mib(telemetry) or "",
        "min_host_available_kib": telemetry.get("minHostAvailableKiB") or "",
        "min_swap_free_kib": telemetry.get("minSwapFreeKiB") or "",
        "spill_evidence": telemetry.get("spillEvidence", False),
        "probe_dir": str(candidate["probeDir"].relative_to(candidate["probeDir"].parents[1])),
    }


CONCLUSIVE_STATUSES = {"completed", "oom", "unsafe_slow", "unsafe_vram"}


def current_hardware():
    meminfo = read_meminfo()
    try:
        total_ram_mib = int(meminfo["MemTotal"]) // 1024
    except (KeyError, TypeError, ValueError) as error:
        raise RuntimeError("Could not read total RAM for H3 calibration compatibility.") from error
    try:
        output = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=8, check=True,
        ).stdout.strip().splitlines()
        name, vram = [value.strip() for value in output[0].split(",", 1)]
        total_vram_mib = int(vram)
    except (IndexError, OSError, ValueError, subprocess.SubprocessError) as error:
        raise RuntimeError("Could not read GPU model and total VRAM for H3 calibration compatibility.") from error
    if total_ram_mib <= 0 or total_vram_mib <= 0 or not name:
        raise RuntimeError("H3 calibration hardware identity is invalid.")
    return {"total_ram_mib": total_ram_mib, "gpu_model": name, "total_vram_mib": total_vram_mib}


def load_persistent_calibration(config_path, hardware):
    config = read_json(config_path)
    training = config.get("training") if isinstance(config.get("training"), dict) else {}
    calibration = training.get("h3_calibration")
    if calibration is None:
        return config, {"hardware": hardware, "results": {}}
    if not isinstance(calibration, dict) or calibration.get("hardware") != hardware or not isinstance(calibration.get("results"), dict):
        raise ValueError("H3 calibration hardware differs from Settings; Reset calibration before running on this hardware.")
    return config, calibration


def compact_persistent_result(result):
    status = result.get("status")
    if status not in CONCLUSIVE_STATUSES:
        return None
    compact = {"status": status}
    if status == "completed":
        median = result.get("medianStepSeconds")
        if median is None or float(median) <= 0:
            raise ValueError("Completed H3 probe result is missing a valid median step time.")
        compact["median_step_seconds"] = float(median)
    telemetry = result.get("telemetry") if isinstance(result.get("telemetry"), dict) else {}
    minimum = telemetry_minimum_free_mib(telemetry)
    if minimum is not None:
        compact["minimum_gpu_free_mib"] = int(minimum)
    peak = telemetry.get("peakGpuMemoryMiB")
    if peak is not None:
        compact["peak_gpu_memory_mib"] = int(peak)
    if status == "unsafe_slow" and "spillEvidence" in telemetry:
        compact["spill_evidence"] = bool(telemetry["spillEvidence"])
    return compact


def persist_calibration(config_path, calibration):
    config = read_json(config_path)
    if not isinstance(config, dict):
        raise ValueError("WebCap config must be a JSON object.")
    training = config.get("training")
    if training is None:
        training = {}
        config["training"] = training
    if not isinstance(training, dict):
        raise ValueError("WebCap config training section must be an object.")
    training["h3_calibration"] = calibration
    write_json(config_path, config)


def derived_safe_shapes(ladders, results):
    safe_shapes = {}
    settled = 0
    for ladder in ladders:
        frames, aspect = int(ladder["frames"]), str(ladder["aspect"])
        last_safe = None
        settled_reason = None
        for index, shape in enumerate(ladder["shapes"]):
            key = candidate_name(frames, aspect, int(shape[0]), int(shape[1]))
            saved = results.get(key)
            if saved is None:
                break
            status = saved["status"]
            if status == "completed":
                if index == len(ladder["shapes"]) - 1 and ladder["terminal"] == "sentinel":
                    settled_reason = "ceiling_not_found" if ladder["terminal"] == "sentinel" else "model_cap"
                else:
                    last_safe = [int(shape[0]), int(shape[1])]
                    if index == len(ladder["shapes"]) - 1:
                        settled_reason = "model_cap"
                continue
            settled_reason = status
            break
        if settled_reason:
            settled += 1
        if frames in (17, 34, 68):
            if not settled_reason or last_safe is None:
                return settled, None
            safe_shapes.setdefault(str(frames), {})[aspect] = last_safe
    return settled, safe_shapes if settled == len(ladders) else None


def run_campaign(seed, config_path=None):
    plan = read_json(seed["plan"])
    ladders = _validate_plan(plan)
    results_root = seed["results"]
    work_root = results_root.parent / "work"
    results_root.mkdir(parents=True, exist_ok=False)
    work_root.mkdir(parents=True, exist_ok=False)
    write_json(results_root / "environment.json", {
        "createdAt": utc_now(),
        "python": sys.version,
        "platform": platform.platform(),
        "seed": str(seed["seedPath"]),
        "sourceVideo": str(seed["video"]),
        "baseConfig": str(seed["config"]),
        "plan": plan,
    })
    if not config_path:
        raise ValueError("H3 calibration requires the WebCap config path for persistent results.")
    hardware = current_hardware()
    _config, calibration = load_persistent_calibration(config_path, hardware)
    persist_calibration(config_path, calibration)
    campaign_status = "completed"
    ceilings = []
    provisional_safe_shapes = None
    cancel_path = Path(seed["seedPath"]).parent / "cancel.request"
    cancel_requested = lambda: cancel_path.exists()
    try:
        for ladder in ladders:
            baseline = None
            last_safe = None
            first_unsafe = None
            terminal_reason = ""
            result = None
            for candidate_index, shape in enumerate(ladder["shapes"]):
                if cancel_requested():
                    raise KeyboardInterrupt
                width, height = int(shape[0]), int(shape[1])
                key = candidate_name(int(ladder["frames"]), str(ladder["aspect"]), width, height)
                saved = calibration["results"].get(key)
                if saved is not None:
                    result = {"status": saved["status"], "medianStepSeconds": saved.get("median_step_seconds"), "telemetry": {
                        "minimumGpuFreeMiB": saved.get("minimum_gpu_free_mib"), "peakGpuMemoryMiB": saved.get("peak_gpu_memory_mib"), "spillEvidence": saved.get("spill_evidence", False),
                    }}
                    print("[h3-probe] " + str(ladder["frames"]) + "f " + str(ladder["aspect"]) + " " + str(width) + "x" + str(height) + " reuse " + result["status"], flush=True)
                    if result["status"] == "completed":
                        if candidate_index < len(ladder["shapes"]) - 1 or ladder["terminal"] == "model_cap":
                            last_safe = [width, height, int(ladder["frames"])]
                        if baseline is None:
                            baseline = result["medianStepSeconds"]
                        if candidate_index == len(ladder["shapes"]) - 1:
                            terminal_reason = "ceiling_not_found" if ladder["terminal"] == "sentinel" else "model_cap"
                        continue
                    first_unsafe = [width, height, int(ladder["frames"])]
                    terminal_reason = result["status"]
                    break
                candidate = prepare_candidate(seed, ladder, width, height, work_root)
                width, height, _frames = candidate["shape"]
                label = str(candidate["frames"]) + "f " + candidate["aspect"] + " " + str(width) + "x" + str(height)
                print("[h3-probe] " + label + " cache", flush=True)
                result = execute_probe(candidate, baseline, on_train_start=lambda: print("[h3-probe] " + label + " train", flush=True), cancel_when=cancel_requested)
                peak_mib = (result.get("telemetry") or {}).get("peakGpuMemoryMiB")
                median_seconds = result.get("medianStepSeconds")
                details = []
                if median_seconds is not None:
                    details.append("median=" + format(float(median_seconds), ".3f") + "s")
                if peak_mib is not None:
                    details.append("peak_vram=" + format(float(peak_mib) / 1024.0, ".1f") + "GiB")
                print("[h3-probe] " + label + " " + result["status"] + (" · " + " · ".join(details) if details else ""), flush=True)
                compact = compact_persistent_result(result)
                if compact is not None:
                    calibration["results"][key] = compact
                    persist_calibration(config_path, calibration)
                if result["status"] == "completed":
                    if candidate_index < len(ladder["shapes"]) - 1 or ladder["terminal"] == "model_cap":
                        last_safe = candidate["shape"]
                    if baseline is None:
                        baseline = result.get("medianStepSeconds")
                    if candidate_index == len(ladder["shapes"]) - 1:
                        terminal_reason = "ceiling_not_found" if ladder["terminal"] == "sentinel" else "model_cap"
                        result["terminalReason"] = terminal_reason
                        write_result(candidate["resultPath"], **result)
                    append_summary(results_root / "summary.csv", _summary_row(candidate, result, terminal_reason))
                    continue
                if result["status"] in ("oom", "unsafe_slow", "unsafe_vram"):
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
            terminal_telemetry = result.get("telemetry") if isinstance(result.get("telemetry"), dict) else {}
            ceilings.append({
                "frames": int(ladder["frames"]),
                "aspect": str(ladder["aspect"]),
                "baselineSeconds": baseline,
                "lastSafeShape": last_safe,
                "firstUnsafeShape": first_unsafe,
                "firstUnsafeOrSentinelShape": first_unsafe or (last_safe if terminal_reason == "ceiling_not_found" else None),
                "reason": terminal_reason,
                "minimumGpuFreeMiB": telemetry_minimum_free_mib(terminal_telemetry),
                "spillEvidence": terminal_telemetry.get("spillEvidence", False),
                "hostAvailableDropKiB": terminal_telemetry.get("hostAvailableDropKiB"),
                "swapFreeDropKiB": terminal_telemetry.get("swapFreeDropKiB"),
            })
        _settled, provisional_safe_shapes = derived_safe_shapes(ladders, calibration["results"])
        if provisional_safe_shapes is None:
            raise ValueError("H3 calibration did not settle every publishable ladder.")
        calibration["safe_shapes"] = provisional_safe_shapes
        persist_calibration(config_path, calibration)
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
            "minimumGpuFreeMiB": MIN_GPU_FREE_MIB,
            "ceilings": ceilings,
            "provisionalSafeShapes": provisional_safe_shapes,
        })
    return campaign_status


def classify_saved_result(result, baseline_seconds):
    """Re-evaluate saved evidence with the current safety rule.

    This deliberately does not trust a prior ``completed`` label: older probes
    required several slow post-warmup samples and could miss a clear CPU spill.
    """
    if not isinstance(result, dict):
        return "trainer_failed", None
    if result.get("timedOut"):
        return "unsafe_slow", None
    status = str(result.get("status") or "")
    if status == "unsafe_vram":
        return "unsafe_vram", None
    if status == "oom" or int(result.get("cacheExitCode") or 0) != 0 or int(result.get("trainExitCode") or 0) != 0:
        return ("oom" if status == "oom" else "trainer_failed"), None
    measured = result.get("measuredStepSeconds") if isinstance(result.get("measuredStepSeconds"), list) else []
    measured = [float(value) for value in measured if float(value) > 0]
    if len(measured) < TOTAL_STEPS - WARMUP_STEPS:
        return "trainer_failed", None
    median_seconds = statistics.median(measured)
    telemetry = result.get("telemetry") if isinstance(result.get("telemetry"), dict) else {}
    if telemetry_minimum_free_mib(telemetry) is None:
        return "telemetry_failed", median_seconds
    if not telemetry_has_required_vram_headroom(telemetry):
        return "unsafe_vram", median_seconds
    threshold = max(20.0, float(baseline_seconds) * 2.5) if baseline_seconds else None
    if threshold is not None and median_seconds >= threshold:
        return "unsafe_slow", median_seconds
    return "completed", median_seconds


def main(argv=None):
    parser = argparse.ArgumentParser(description="Run a prepared MiniMax H3 envelope probe.")
    parser.add_argument("--seed", required=True, help="Path to the WebCap-generated seed.json")
    parser.add_argument("--summarize-results", action="store_true", help="Print a ready-to-paste H3 calibration settings block from saved results.")
    parser.add_argument("--publish-config", help="Atomically publish the completed calibration into this WebCap config.json path.")
    args = parser.parse_args(argv)
    seed = load_seed(args.seed)
    if args.summarize_results:
        raise ValueError("H3 calibration summaries now come from persistent Settings results.")
    if not args.publish_config:
        raise ValueError("H3 calibration requires --publish-config for persistent Settings results.")
    status = run_campaign(seed, args.publish_config)
    if status == "completed":
        print("[h3-probe] published H3 calibration results to " + str(args.publish_config), flush=True)
    return 0 if status == "completed" else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
