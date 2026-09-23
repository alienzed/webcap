from tool.server import inference_runtime


def test_cleanup_saved_output_removes_generate_input_job_tree(monkeypatch, tmp_path):
    monkeypatch.setattr(inference_runtime.app_config, "FS_ROOT", tmp_path / "fs")
    comfy = tmp_path / "ComfyUI"
    output = comfy / "output" / "webcap-generate" / "job-1"
    input_job = comfy / "input" / "webcap-generate" / "job-1"
    output.mkdir(parents=True)
    (input_job / "references").mkdir(parents=True)
    saved = output / "render_00001.mp4"
    saved.write_bytes(b"video")
    (input_job / "references" / "frame.png").write_bytes(b"image")

    removed = inference_runtime.cleanup_saved_output({
        "type": "output",
        "fullpath": str(saved),
        "filename": saved.name,
    })

    assert removed is True
    assert not saved.exists()
    assert not input_job.exists()
    assert not output.exists()


def test_cleanup_saved_output_removes_storyboard_input_job_tree_only(monkeypatch, tmp_path):
    monkeypatch.setattr(inference_runtime.app_config, "FS_ROOT", tmp_path / "fs")
    comfy = tmp_path / "ComfyUI"
    output = comfy / "output" / "webcap-storyboard" / "story-1" / "scene-1" / "job-1"
    input_job = comfy / "input" / "webcap-storyboard" / "story-1" / "scene-1" / "job-1"
    sibling = comfy / "input" / "webcap-storyboard" / "story-1" / "scene-1" / "job-2"
    output.mkdir(parents=True)
    (input_job / "references").mkdir(parents=True)
    sibling.mkdir(parents=True)
    saved = output / "render_00001.mp4"
    saved.write_bytes(b"video")
    (input_job / "references" / "frame.png").write_bytes(b"image")
    (sibling / "keep.png").write_bytes(b"keep")

    inference_runtime.cleanup_saved_output({
        "type": "output",
        "fullpath": str(saved),
        "filename": saved.name,
    })

    assert not input_job.exists()
    assert sibling.is_dir()
    assert (sibling / "keep.png").is_file()


def test_cleanup_saved_output_does_not_recursive_delete_unknown_provider_tree(monkeypatch, tmp_path):
    monkeypatch.setattr(inference_runtime.app_config, "FS_ROOT", tmp_path / "fs")
    comfy = tmp_path / "ComfyUI"
    output = comfy / "output" / "someone-else" / "job-1"
    input_job = comfy / "input" / "someone-else" / "job-1"
    output.mkdir(parents=True)
    input_job.mkdir(parents=True)
    saved = output / "render.png"
    saved.write_bytes(b"image")
    (input_job / "keep.png").write_bytes(b"keep")

    inference_runtime.cleanup_saved_output({
        "type": "output",
        "fullpath": str(saved),
        "filename": saved.name,
    })

    assert not saved.exists()
    assert input_job.is_dir()
    assert (input_job / "keep.png").is_file()
    assert inference_runtime.known_provider_root() is None


def test_local_saved_output_path_remembers_proven_provider_root(monkeypatch, tmp_path):
    fs_root = tmp_path / "fs"
    monkeypatch.setattr(inference_runtime.app_config, "FS_ROOT", fs_root)
    provider = tmp_path / "ComfyUI"
    output = provider / "output" / "webcap-generate" / "job-1"
    output.mkdir(parents=True)
    saved = output / "render.mp4"
    saved.write_bytes(b"video")

    assert inference_runtime.local_saved_output_path({
        "type": "output",
        "fullpath": str(saved),
        "filename": saved.name,
    }) == saved

    assert inference_runtime.known_provider_root() == provider.resolve()
    state_path = fs_root / ".webcap_runtime" / "comfy_provider.json"
    assert state_path.is_file()


def test_known_provider_root_rejects_symlinked_provider(monkeypatch, tmp_path):
    fs_root = tmp_path / "fs"
    monkeypatch.setattr(inference_runtime.app_config, "FS_ROOT", fs_root)
    real_provider = tmp_path / "real-comfy"
    (real_provider / "output").mkdir(parents=True)
    provider_link = tmp_path / "linked-comfy"
    try:
        provider_link.symlink_to(real_provider, target_is_directory=True)
    except OSError:
        return
    state_path = fs_root / ".webcap_runtime" / "comfy_provider.json"
    state_path.parent.mkdir(parents=True)
    state_path.write_text(
        '{"version": 1, "root": "' + str(provider_link).replace("\\", "\\\\") + '", "learnedAt": 1}\n',
        encoding="utf-8",
    )

    assert inference_runtime.known_provider_root() is None


def test_known_provider_root_rejects_symlinked_runtime_state_root(monkeypatch, tmp_path):
    fs_root = tmp_path / "fs"
    fs_root.mkdir()
    monkeypatch.setattr(inference_runtime.app_config, "FS_ROOT", fs_root)
    provider = tmp_path / "ComfyUI"
    (provider / "output").mkdir(parents=True)
    outside = tmp_path / "outside-runtime"
    outside.mkdir()
    runtime_link = fs_root / ".webcap_runtime"
    try:
        runtime_link.symlink_to(outside, target_is_directory=True)
    except OSError:
        return
    state_path = outside / "comfy_provider.json"
    state_path.write_text(
        '{"version": 1, "root": "' + str(provider).replace("\\", "\\\\") + '", "learnedAt": 1}\n',
        encoding="utf-8",
    )

    assert inference_runtime.known_provider_root() is None
