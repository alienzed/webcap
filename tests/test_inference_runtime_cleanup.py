from tool.server import inference_runtime


@pytest.fixture(autouse=True)
def isolate_provider_state(monkeypatch, tmp_path):
    state_root = tmp_path / "app-data" / "state"
    monkeypatch.setattr(inference_runtime.app_config, "app_state_root", lambda: state_root)


def test_windows_curl_connection_failure_is_provider_unavailable(monkeypatch):
    monkeypatch.setattr(
        inference_runtime.subprocess,
        "run",
        lambda *_args, **_kwargs: inference_runtime.subprocess.CompletedProcess(
            args=[],
            returncode=7,
            stdout=b"",
            stderr=b"curl: (7) Failed to connect",
        ),
    )

    try:
        inference_runtime._windows_curl_request("curl.exe", "http://127.0.0.1:8188/system_stats")
    except ConnectionError:
        pass
    else:
        raise AssertionError("curl exit 7 must be classified as a connection failure")


def test_windows_curl_timeout_is_provider_unavailable(monkeypatch):
    monkeypatch.setattr(
        inference_runtime.subprocess,
        "run",
        lambda *_args, **_kwargs: inference_runtime.subprocess.CompletedProcess(
            args=[],
            returncode=28,
            stdout=b"",
            stderr=b"curl: (28) Operation timed out",
        ),
    )

    try:
        inference_runtime._windows_curl_request("curl.exe", "http://127.0.0.1:8188/system_stats")
    except TimeoutError:
        pass
    else:
        raise AssertionError("curl exit 28 must be classified as a timeout")


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
    state_path = tmp_path / "app-data" / "state" / "providers.json"
    assert state_path.is_file()
    payload = json.loads(state_path.read_text(encoding="utf-8"))
    assert payload["providers"]["comfyui"]["root"] == str(provider.resolve())
    assert not (fs_root / ".webcap_runtime" / "comfy_provider.json").exists()


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
    state_path = tmp_path / "app-data" / "state" / "providers.json"
    state_path.parent.mkdir(parents=True)
    state_path.write_text(
        json.dumps({
            "version": 1,
            "providers": {
                "comfyui": {
                    "root": str(provider_link),
                    "learnedAt": 1,
                }
            },
        }) + "\n",
        encoding="utf-8",
    )

    assert inference_runtime.known_provider_root() is None


def test_known_provider_root_rejects_symlinked_app_state_root(monkeypatch, tmp_path):
    provider = tmp_path / "ComfyUI"
    (provider / "output").mkdir(parents=True)
    outside = tmp_path / "outside-state"
    outside.mkdir()
    state_link = tmp_path / "linked-state"
    try:
        state_link.symlink_to(outside, target_is_directory=True)
    except OSError:
        return
    monkeypatch.setattr(inference_runtime.app_config, "app_state_root", lambda: state_link)
    state_path = outside / "providers.json"
    state_path.write_text(
        json.dumps({
            "version": 1,
            "providers": {
                "comfyui": {
                    "root": str(provider),
                    "learnedAt": 1,
                }
            },
        }) + "\n",
        encoding="utf-8",
    )

    assert inference_runtime.known_provider_root() is None
