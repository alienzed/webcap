# App Settings

Settings navigation and locations reconciled with current markup: 2026-11-23; Director runtime limits last checked against configuration/runtime code: 2026-11-06.

The app settings modal is the global configuration surface for values stored in `tool/config.json`. Its navigation is organized by user-facing ownership rather than implementation details.

## Current sections

- **General → Application**: media/dataset root, generated output root, and theme. The optional raw-config field `filesystem.app_data_root` overrides WebCap's conventional host-local app-data location; blank uses the platform default.
- **Models → Model Storage**: shared models root.
- **Models → Training Models**: profiles available for new training runs.
- **Models → LoRA Library**: access to configured Test LoRA profiles.
- **Training**: Diffusion Pipe/WSL runtime and repeat-reference epochs; **Runtime Environment** and **Test Staging** disclosures contain advanced runtime and Copy-to-Test destination settings.
- **Director**: automatic Studio Action Advisor preference, Director runtime configuration, and context/output limits; a Caption Assist section currently also lives here (see IA notes below).
- **LLM Guidance**: editable Studio creative profiles, H3 creative and technical guidance, specialist instructions, and generation-model playbook notes; module overrides are saved with application settings.
- **Advanced**: textarea revision-history preferences, optional analysis, logging, raw configuration, and reset controls.
- **Director**: one local llama.cpp runtime plus zero or more named remote OpenAI-compatible runtimes. Each runtime is presented as a distinct configuration card; unavailable remotes are skipped during discovery. Director model selection is shared across Director-enabled workspaces.
- **Advanced → Debug Logging**: persistent debug logging. With **Debug mode** enabled, Director LLM calls log effective request metadata and response diagnostics such as model, message size, configured context/output settings, sampling/thinking flags, wall-clock response time, finish reason, usage, and backend timing fields when the runtime supplies them. This is observational only and does not change generation limits or request behavior.
- **Advanced → Optional Analysis**: persistent Face Focus and MediaPipe enablement. Diagnostics reports whether their dependencies are available; choosing whether WebCap uses them remains a Settings decision.
- **Advanced → Raw Configuration**: direct JSON editing.
- **Advanced → Reset App**: restore stock requirement terms.

The tab labels above are confirmed by `tool/tool.html` and the corresponding selection logic in `tool/js/app_settings.js`. The General tab hosts workspace-oriented settings rather than an additional top-level Workspace tab.

## Information architecture

The top-level tabs are **General**, **Models**, **Training**, **Director**, **LLM Guidance**, and **Advanced**.

Settings owns persistent configuration. Whole-app resources such as Models Root do not belong to Training merely because Training consumes them. One-off inspection, environment health, repair, calibration, and model benchmarking belong to the separate **Diagnostics** utility surface.

Missing optional analysis dependencies do not make ordinary media metadata loading fail. WebCap skips the unavailable analyzer, keeps normal metadata usable, and reports the feature-specific problem to the global Console with the Diagnostics repair path.

Specialist controls should prefer a local disclosure such as **Runtime Environment**, **Test Staging**, or **Limits** over creating another top-level settings category.

## Studio Director settings entry

The active Director model is selected in the **global application header**, not inside the drawer. Studio Director's header gear opens a small, Studio-only settings panel with the **creative profile** (Classic, Current, Imaginative, Render-focused). The selected profile uses the same existing browser-local `webcap.studioDirector.profile` preference as before.

The panel links to the existing global Settings surfaces, without inventing a second configuration store:
- **Edit profile instructions** opens **LLM Guidance** with the selected `studio.<profile>` module already chosen. This edits the actual profile guidance; experimental evaluation packages are not presented as available production presets.
- **Director runtime & options** opens the existing **Director** tab for model endpoints, limits and automatic Action Advisor settings.

Those deep links preserve the normal Settings modal, save behavior, profile selection and global Director model ownership. The local panel is dismissed on Escape, outside interaction, mode change or drawer closure.

## IA audit — November 23, 2026

The drawer's creative profile had become invisible because it was placed inside `.director-chat-model-tools`, a row deliberately hidden after global-header model selection was introduced. The Studio gear now presents it independently without resurrecting a second model selector. This is a confirmed discoverability defect corrected by the focused patch.

Current remaining information-architecture issues, **not part of this targeted fix**:

- **Caption Assist is miscategorized under Director.** Its Vision-model preference and default caption-template settings belong to caption workflows, not the Studio Director. Relocate them only after checking where other caption settings and entry points currently live, without changing the controls' IDs, persistence or ownership.
- **Director and LLM Guidance overlap conceptually.** Runtime configuration and Studio workflow preferences belong to Director; model-facing instructions are shared across Director and specialists. The new deep link makes the connection discoverable without duplicating a guidance editor or moving every specialist into the Director category.
- **The application Settings surface remains broad.** Six horizontal top-level tabs are functional but dense, particularly in narrow layouts. Consider regrouping after auditing all consumers; no broad tab or configuration migration should be bundled with this Director discoverability fix.

The current improvement intentionally avoids exposing experimental guidance variants, introducing an alternative profile store, or making rarely used controls permanently visible in Studio.

## Director output limit

`storyboard.director.max_tokens` defaults to `16384` as a generous runaway-generation safety limit. The Director settings field remains user-editable: clear it to use Auto/unbounded runtime behavior, or enter another limit. Existing configurations that explicitly store `null` remain Auto rather than being silently changed.

`storyboard.director.context_size` defaults to `null` (Auto). An explicit context override applies to WebCap-managed local llama.cpp; remote context capacity is configured at the remote server. Sending the full creative discussion does not guarantee it fits the selected model's context window. Runtime/context failures remain operational errors, not evidence that the model rejected a creative decision.

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
- Diagnostics utility: `tool/js/diagnostics.js` and `docs/diagnostics.md`
- Frontend styling: `tool/css/modals.css`
- Backend validation and persistence: `tool/server/config.py`
- Available training profiles: `tool/server/training_profiles.py`


## Director runtimes and model identity

Director can discover the WebCap-managed local llama.cpp runtime and multiple named remote OpenAI-compatible endpoints at the same time. Each discovered model carries its runtime identity, so the same model name may safely exist on more than one machine.

The UI groups models by runtime and stores one global Director model preference. Selecting a model in Storyboard, Generate, Test Generations, or Assistant updates that shared preference.

Remote discovery is best-effort. An unavailable endpoint is logged and omitted from the current model list; it does not make other healthy runtimes unavailable. Endpoint IDs are stable configuration identities, while display names may be edited freely.
