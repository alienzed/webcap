# App Settings

Last reviewed against code: 2026-09-28

The app settings modal is the global configuration surface for values stored in `tool/config.json`. Its navigation is organized by user-facing ownership rather than implementation details.

## Current sections

- **Workspace → Storage**: media/dataset root, generated output root, and shared models root. The optional raw-config field `filesystem.app_data_root` overrides WebCap's conventional host-local app-data location; blank uses the platform default.
- **Workspace → Appearance**: browser-scoped theme.
- **Workspace → Caption Defaults**: app-wide fallback caption template.
- **Training → Runtime**: Diffusion Pipe/WSL runtime, Conda or activation script, and repeat-reference epochs.
- **Training → Models**: profiles available for new training runs.
- **Training → Testing**: per-stage LoRA destinations used by Copy to Test.
- **Training → Hardware Calibration**: MiniMax H3 bucket calibration.
- **Training → Advanced Training**: uncommon H3 troubleshooting behavior.
- **Director**: local llama.cpp plus zero or more enabled remote OpenAI-compatible endpoints. Healthy runtimes are discovered together; unavailable remotes are skipped. Director model selection is shared across Director-enabled workspaces.
- **Advanced → Environment & Diagnostics**: whole-app environment check, explicit **Install / Repair Python Requirements**, and debug logging. Requirements repair runs `python -m pip install -r requirements.txt` with the same Python executable that is running WebCap and reports command output/failures in the WebCap Console. With **Debug mode** enabled, Director LLM calls also log effective request metadata and response diagnostics such as model, message size, configured context/output settings, sampling/thinking flags, wall-clock response time, finish reason, usage, and backend timing fields when the runtime supplies them. This is observational only and does not change generation limits or request behavior.
- **Advanced → Optional Analysis**: Face Focus and MediaPipe analysis. Environment Check disables and unchecks an analyzer control when its required Python package or vendored MediaPipe task models are unavailable; saving Settings persists that disabled selection. After requirements are repaired and Environment Check is rerun, the control becomes available again but remains opt-in.
- **Advanced → Raw Configuration**: direct JSON editing.
- **Advanced → Reset App**: restore stock requirement terms.

## Information architecture

The four top-level tabs are **Workspace**, **Training**, **Director**, and **Advanced**.

Settings should stay under the feature or resource they actually affect. Whole-app resources such as Models Root do not belong to Training merely because Training consumes them. Likewise, the environment check belongs under Advanced because it reports Core, Training, Inference, Director, and Optional Analysis readiness.

Missing optional analysis dependencies do not make ordinary media metadata loading fail. WebCap skips the unavailable analyzer, keeps normal metadata usable, and reports the feature-specific problem to the global Console with the Settings repair path.

Specialist controls should prefer a local disclosure such as **Advanced Training** or **Runtime Overrides** over creating another top-level settings category.

## Director output limit

`storyboard.director.max_tokens` defaults to `16384` as a generous runaway-generation safety limit. The Director settings field remains user-editable: clear it to use Auto/unbounded runtime behavior, or enter another limit. Existing configurations that explicitly store `null` remain Auto rather than being silently changed.

## Repeat planning

`training.repeat_reference_epochs` defaults to 90. WebCap uses it only when solving generated dataset repeat counts. Changing a run's **Epochs** field does not cause repeats to be recalculated around that run length; Epochs changes the captured run configuration and its estimated total work.

## Copy to Test

`training.test_copy_roots` stores independent destination roots for H3, Krea2, Wan2.1, Wan2.2 High, and Wan2.2 Low. `training.test_copy_subfolder` is optional and must be a single directory name. These values control where saved candidate LoRAs are staged for testing; they do not move or rewrite the original training output.

## Training model visibility

All supported profiles are enabled by default. Clear a model checkbox to hide it from new training setup. At least one must remain enabled.

Each model row links to its Hugging Face file repository. Disabling a model never deletes persistent TOMLs, captured run bundles, history, or resume metadata.

Use **Save + Reboot** to apply runtime settings immediately.

## Caption template behavior

- `primer.template` is an app-wide fallback.
- A folder-specific template inside `.webcap_state.json` overrides it.
- A blank app template uses the built-in default.

## Implementation notes

- Frontend modal markup: `tool/tool.html`
- Frontend modal logic: `tool/js/app_settings.js`
- Frontend styling: `tool/css/modals.css`
- Backend validation and persistence: `tool/server/config.py`
- Available training profiles: `tool/server/training_profiles.py`


## Director runtimes and model identity

Director can discover the WebCap-managed local llama.cpp runtime and multiple named remote OpenAI-compatible endpoints at the same time. Each discovered model carries its runtime identity, so the same model name may safely exist on more than one machine.

The UI groups models by runtime and stores one global Director model preference. Selecting a model in Storyboard, Generate, Test Generations, or Assistant updates that shared preference.

Remote discovery is best-effort. An unavailable endpoint is logged and omitted from the current model list; it does not make other healthy runtimes unavailable. Endpoint IDs are stable configuration identities, while display names may be edited freely.
