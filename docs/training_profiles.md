# Training profiles

WebCap keeps a small app-owned registry of supported Diffusion Pipe profiles. A profile defines its persistent TOML files, available runs, captured media types, FPS normalization, and launch behavior. App Settings can hide a profile from new-run selection without deleting existing files or runs.

| Profile | Captured media | Persistent files | Run options |
| --- | --- | --- | --- |
| Wan2.2 T2V | Images and videos | `config.hi.toml`, `config.lo.toml`, matching dataset files | HI → LO, HI only, LO only |
| Krea2 Raw | Images only | `config.krea2.toml`, matching dataset file | Train |
| Wan2.1 T2V 14B | Images and videos | `config.wan21.toml`, matching dataset file | Train |
| MiniMax H3 | Images and videos | `config.h3.toml`, matching dataset file | Train |

Krea2 excludes video. Wan profiles normalize bundle videos to 16 fps; H3 normalizes them to 24 fps. Dataset roles are shared and explicit: Wan POC uses 33f temporal; Wan Normal/Quality uses 37f temporal plus 13f detail; H3 POC uses 34f temporal; H3 Normal/Quality uses 68f temporal plus 17f detail. Detail uses an explicit bundle subset and a `1.0 : 0.25` temporal/detail exposure weight.

## Launch output identity

Persistent set TOML remains editable and uses the neutral template output path. A launch reserves a global three-character base-36 group under:

```text
<filesystem.root>/output/runs/<prefix>-<set-name>/
```

For example, `001-Estel`. Stage output slugs are `wan22-hi`, `wan22-lo`, `krea2-raw`, `wan21-t2v`, and `minimax-h3`. A Wan2.2 HI → LO action shares one launch group for its two independent jobs; every other launch gets its own group.

Managed and manual launches create one visible action directory. Its `input/` holds captured media, captions, manifest, and cache; its `record/` holds immutable inspected TOMLs and the plan. Only runtime paths are rewritten in copied TOMLs; user-authored dimensions, frame counts, and unmarked direct stanzas remain authoritative and receive visible warnings when unsafe.

## Dataset calculation and progress

Selecting a profile/mode creates missing TOMLs. Dataset creation and Reset calculate from the current visible media without copying it. Train captures the visible media and captions once into the bundle.

- Wan2.2 writes separate HI and LO datasets. Krea2, Wan2.1, and H3 write a mode-specific dataset.
- Saved video at the target FPS is copied. Other video is converted inside the fresh bundle to constant 16 fps for Wan or 24 fps for H3; a failed conversion warns and falls back to the source copy.
- Generated stanzas carry one exact bucket. Direct image and temporal stanzas use captured AR folders; only marked detail video stanzas become `media/video_detail/...` subsets.
- POC, Normal, and Quality affect calculated buckets and template learning rates. Repeat targeting uses configured epochs and actual role membership.
- H3 envelope probing remains experimental tooling and does not alter the active profile’s role table. Saved safe shapes replace the conservative ceiling for the exact matching frame/aspect entry, expanding or contracting newly generated/reset H3 video datasets within the app-owned model/probe envelope. Missing entries remain conservative.
