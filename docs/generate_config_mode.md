# Dataset Target Modes

The **Dataset target** selector in Training chooses how WebCap generates supported dataset buckets:

- `POC`: lower-cost proof-of-concept targets.
- `Normal`: balanced default targets.
- `Quality`: higher-quality bucket preference when the prepared media supports it.

The target is supplied to the selected profile's dataset generation. It does not select a model, change a profile's run options, or silently rewrite existing configuration TOML.

For Wan2.2, the high-noise and low-noise datasets are generated independently. For Krea2 Raw and Wan2.1 T2V 14B, the generated single-stage dataset is `dataset.train.toml`.

Bucket availability remains constrained by the prepared media. Different targets may produce the same output when the source resolution or aspect-ratio coverage leaves no useful alternative.
