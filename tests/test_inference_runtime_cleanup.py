from tool.server import inference_runtime


def test_cleanup_saved_output_removes_generate_input_job_tree(tmp_path):
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


def test_cleanup_saved_output_removes_storyboard_input_job_tree_only(tmp_path):
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


def test_cleanup_saved_output_does_not_recursive_delete_unknown_provider_tree(tmp_path):
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
