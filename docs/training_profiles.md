# Training profiles

WebCap keeps a small app-owned registry of supported Diffusion Pipe profiles. A profile defines its persistent TOML files, available runs, captured media types, and launch behavior. App Settings can hide a profile from new-run selection without deleting existing files or runs.

| Profile | Captured media | Persistent files | Run options |
| --- | --- | --- | --- |
| Wan2.2 T2V | Images and videos | `config.hi.toml`, `config.lo.toml`, matching dataset files | Wan2.2 High, Wan2.2 Low |
| Krea2 Raw | Images only | `config.krea2.toml`, matching dataset file | Train |
| Wan2.1 T2V 14B | Images and videos | `config.wan21.toml`, matching dataset file | Train |
| MiniMax H3 | Images and videos | `config.h3.toml`, matching dataset file | Train |

Krea2 excludes video. Dataset roles are explicit: Wan uses 37f temporal plus 13f detail; H3 uses 34f balanced, 68f temporal, and 17f detail. The default H3 exposure mix is `1.0 : 0.5 : 0.25` balanced/temporal/detail; Detail uses an explicit bundle subset.

## Launch output identity

Persistent set TOMLs remain editable baselines. Managed output is grouped by a stable numbered set root and then by logical run:

```text
<filesystem.root>/output/runs/<global-sequence>-<set-slug>--<set-path-hash>/<sequence>-<model>--<optional-name>/
```

Each logical run owns:

```text
captures/  captured media, captions, manifest, TOMLs, plan, and cache
jobs/      runner scripts, logs, PID/action/result evidence
output/    Diffusion Pipe trainer runs
```

Managed Resume stays in the selected logical run; a fresh or custom-Resume action allocates a new one. Only app-owned runtime paths and explicit Run setup overrides are rewritten in captured config copies. Persistent set TOMLs remain unchanged unless the user edits or explicitly resets them.

## Dataset calculation and progress

Selecting a profile creates missing TOMLs. Dataset creation and Reset calculate from the current visible media without copying it. Train captures the visible media and captions once into the bundle.

Run setup exposes learning rate, rank, epochs, and dropout as per-run values populated from the model template. These settings are applied to the captured config only. Resume also writes the selected LR as `force_constant_lr`.

- Wan2.2 writes separate HI and LO datasets. Krea2, Wan2.1, and H3 each write one dataset.
- Current capture materializes source media byte-for-byte. It does not normalize video FPS.
- Generated stanzas carry one exact bucket. Direct image and temporal stanzas use captured AR folders; only marked detail video stanzas become `media/video_detail/...` subsets.
- Current bucket policy uses actual role membership. Generated repeat counts use the fixed `training.repeat_reference_epochs` planning horizon (90 by default), while the run's actual epochs are used for estimated total work.
- H3 envelope probing remains experimental tooling and does not alter the active profile’s role table. Saved safe shapes replace the conservative ceiling for the exact matching frame/aspect entry, expanding or contracting newly generated/reset H3 video datasets within the app-owned model/probe envelope. Missing entries remain conservative.

## Future: optional model-native video FPS normalization

This is a proposed advanced training option, initially **Off**. It belongs at the run capture/materialization boundary, never in import, Clip, crop, editing, or the reusable set folder. A set can serve several models, so making source media model-specific would contaminate that shared working set; only the isolated run/capture media may receive a model-specific transform.

When enabled, the materializer would use the selected model's native training FPS: Wan at 16 fps and MiniMax H3 at 24 fps. Diffusion Pipe already resamples internally, so this is not needed for correctness. Its value is dataset hygiene and transparency: the captured training files more closely match what the model receives.

- Preserve duration and playback speed, retain audio, and use a high-quality/visually lossless training-input conversion.
- If a video already matches the target FPS, retain the normal cheap materialization path instead of transcoding it.
- Make the extra preparation cost explicit: large sets, especially hundreds of videos, may take substantially longer to materialize.
- Do not add derivative caching or reuse yet; revisit only if conversion cost proves to be a real workflow problem.

## Future: LoRA-type-aware overrides

The selected model profile and its default TOMLs remain the canonical baseline. A future LoRA type—such as identity, clothing/object, style, motion/action, or general concept—may apply a small explicit override map only where that type has a deliberate, reviewed difference.

- Do not fork complete TOMLs or duplicate whole profile configurations.
- Preserve every baseline value unless a named override is justified for that LoRA type.
- Keep the override set visible in the captured run evidence.
- Scanner and dataset expectations may use the same declared type only for narrow, evidence-based rules.

The type is not a generic optimizer or dataset-tuning surface.
