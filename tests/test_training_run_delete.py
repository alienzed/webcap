"""Safety checks for explicit Training History deletion."""
import json
from pathlib import Path

import pytest

from tool.server import training_run_delete as deletion


def test_deletion_target_must_be_strict_child(tmp_path):
    root = tmp_path / "runs"
    root.mkdir()
    with pytest.raises(ValueError):
        deletion._under(root, root)
    with pytest.raises(ValueError):
        deletion._under(tmp_path / "other", root)
    assert deletion._under(root / "child", root) == root / "child"


def test_symlink_target_never_removed(tmp_path):
    target = tmp_path / "actual"
    target.mkdir()
    shortcut = tmp_path / "link"
    shortcut.symlink_to(target, target_is_directory=True)
    with pytest.raises(ValueError):
        deletion._existing_or_absent(shortcut)
    assert target.is_dir()


def test_missing_target_is_idempotent(tmp_path):
    target = tmp_path / "already-deleted"
    assert deletion._existing_or_absent(target) == target


def test_resolved_child_cannot_escape_via_symlink(tmp_path):
    root = tmp_path / "runs"
    root.mkdir()
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    (root / "linked").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        deletion._under(root / "linked" / "victim", root)


def test_nested_normal_child_is_allowed(tmp_path):
    root = tmp_path / "runs"
    root.mkdir()
    child = root / "action" / "output"
    child.mkdir(parents=True)
    assert deletion._under(child, root) == child
