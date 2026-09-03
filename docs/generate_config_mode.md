# Training dataset configuration

Training has no POC, Normal, or Quality mode selector. Selecting a model creates
only its current missing TOMLs and never silently rewrites an existing file.

Wan2.2 high-noise and low-noise datasets are calculated independently. Krea2
Raw, Wan2.1 T2V 14B, and MiniMax H3 each use one dataset TOML. Bucket
availability remains constrained by visible media metadata and the current
model bucket policy.
