"""Read-only audit for captured H3 video buckets in persisted queue jobs."""

import tomllib
from pathlib import Path

from .dataset_config import AR_TOL, ASPECT_RATIOS, video_bucket_ladder, video_roles_for_profile
from .training_profiles import MINIMAX_H3_PROFILE_ID


def _aspect(width, height):
    if width <= 0 or height <= 0:
        return ""
    ratio = width / float(height)
    matches = [name for name, expected in ASPECT_RATIOS.items() if abs(ratio - expected) <= AR_TOL]
    return matches[0] if len(matches) == 1 else ""


def audit_h3_queue_jobs(jobs):
    """Report current-policy status for captured H3 video stanzas without mutation."""
    roles = {frames: name for name, frames, _weight in video_roles_for_profile(MINIMAX_H3_PROFILE_ID)}
    findings = []
    for job in jobs or []:
        if not isinstance(job, dict) or str(job.get("stages") or "") != "h3":
            continue
        job_id = str(job.get("id") or "")
        dataset = Path(str(job.get("inputPath") or "")) / "dataset.train.toml"
        try:
            directories = tomllib.loads(dataset.read_text(encoding="utf-8")).get("directory", [])
        except (OSError, UnicodeError, tomllib.TOMLDecodeError):
            findings.append({"jobId": job_id, "status": "RAW/UNKNOWN", "reason": "Captured H3 dataset TOML is unavailable or unreadable."})
            continue
        for directory in directories if isinstance(directories, list) else []:
            if not isinstance(directory, dict) or str(directory.get("group") or "") != "videos":
                continue
            for bucket in directory.get("size_buckets") or []:
                if not isinstance(bucket, list) or len(bucket) != 3 or not all(isinstance(value, int) for value in bucket):
                    findings.append({"jobId": job_id, "status": "RAW/UNKNOWN", "reason": "Video bucket is not a three-integer value."})
                    continue
                width, height, frames = bucket
                role, aspect = roles.get(frames, ""), _aspect(width, height)
                item = {"jobId": job_id, "role": role, "frames": frames, "aspect": aspect, "bucket": [width, height]}
                if not role or not aspect:
                    findings.append({**item, "status": "RAW/UNKNOWN", "reason": "Bucket does not map to a current managed H3 role/aspect."})
                    continue
                policy = video_bucket_ladder(MINIMAX_H3_PROFILE_ID, aspect, role, frames)
                item["ceiling"] = list(policy["ceiling"])
                item["selectable"] = [width, height] in [list(shape) for shape in policy["selectable"]]
                item["status"] = "SAFE" if item["selectable"] else (
                    "ABOVE_CEILING" if width > policy["ceiling"][0] or height > policy["ceiling"][1] else "OFF_LADDER"
                )
                findings.append(item)
    return findings
