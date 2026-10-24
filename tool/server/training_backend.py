"""Small external-trainer boundary for WebCap's existing training runner.

WebCap owns capture, queue, process identity, logs, and history. The trainer owns
its command, configuration format, resume/checkpoint format, and save/quit protocol.

Only Diffusion Pipe is implemented. Do not silently launch it when another
trainer is requested. Legacy jobs without trainerId belong to Diffusion Pipe.
"""

from pathlib import Path

from .training_commands import build_h3_command_plan, build_training_command_plan
from .training_runtime import build_training_launcher


DEFAULT_TRAINER_ID = "diffusion_pipe"


class DiffusionPipeBackend:
    """Trainer-specific operations used by the shared WebCap runner."""

    id = DEFAULT_TRAINER_ID
    label = "Diffusion Pipe"

    def command_plan(self, hi_config, lo_config, settings, resume_path="", resume_stage="", reset_dataloader=False):
        return build_training_command_plan(
            hi_config,
            lo_config,
            build_training_launcher(settings),
            resume_path,
            resume_stage,
            reset_dataloader=reset_dataloader,
        )

    def h3_command_plan(self, config, settings, resume_path="", reset_dataloader=False):
        return build_h3_command_plan(
            config,
            build_training_launcher(settings),
            resume_path,
            reset_dataloader=reset_dataloader,
        )

    def request_checkpoint_save(self, run_dir):
        """Ask Diffusion Pipe to save state after the current step and exit."""
        (Path(run_dir) / "save_quit").touch(exist_ok=True)



class FizgigBackend:
    """Trainer-specific H3 preparation; activation waits for real runner/lifecycle."""

    id = "fizgig"
    label = "Fizgig"

    @staticmethod
    def plan_h3(*args, **kwargs):
        from .training_fizgig import plan_h3
        return plan_h3(*args, **kwargs)

    @staticmethod
    def saved_artifacts(output_dir, output_name, filenames):
        from .training_fizgig import saved_artifacts
        return saved_artifacts(output_dir, output_name, filenames)

    @staticmethod
    def request_checkpoint_save(run_dir):
        """Fizgig watches this sentinel until its next epoch boundary."""
        (Path(run_dir) / ".pause_requested").touch(exist_ok=True)


_DIFFUSION_PIPE = DiffusionPipeBackend()


def backend_for_job(job):
    """Resolve the run's recorded trainer; old jobs are Diffusion Pipe.

    This is deliberately explicit, not a configurable plugin registry. A new
    backend must implement its real launch/resume/stop/artifact behavior before
    it can become selectable or runnable.
    """
    trainer_id = job.get("trainerId", DEFAULT_TRAINER_ID)
    if trainer_id == DEFAULT_TRAINER_ID:
        return _DIFFUSION_PIPE
    raise ValueError("Unsupported training backend: " + str(trainer_id))
