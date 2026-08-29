# Image bucket policy

WebCap uses one image bucket for each populated canonical aspect-ratio folder and training stage. It does not split images into resolution classes or make bundle-local image subsets.

Supported aspect ratios are `1:1`, `4:3`, `3:4`, `16:9`, and `9:16`, using the normal WebCap aspect-ratio tolerance. Every accepted image in an aspect-ratio folder trains from that folder's direct stanza.

## Selection

WebCap begins with the mode target, aligned to 32 pixels, and walks down the existing ladder until every image is within a 15% per-axis resize allowance. The selected stanza always contains exactly one `size_bucket`.

Wan2.2 HI keeps its target one 32-pixel ladder step below LO. This changes the selected bucket ceiling, not image membership: HI and LO see the same source files.

If the lowest valid bucket still requires more than 15% upscale for an image, WebCap keeps the image and emits a prominent warning with the limiting filename. The generated TOML remains runnable so the user can make the final dataset decision.

## Audit trail

`auto_dataset/training_plan.json` version 2 records every generated stanza: its kind, AR, role, bucket, files, native/upscaled counts, limiting files, eligibility count, and repeat count. `dataset_manifest.json` remains the exact source-selection record.

Saved TOML is authoritative. If a user edits image dimensions or adds another direct stanza, bundle capture preserves those values and only rewrites runtime paths. It reports potential upscales rather than rewriting or rejecting the edit.
