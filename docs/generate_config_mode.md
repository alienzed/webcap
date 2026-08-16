# Training Modes

The **Mode** selector in Training chooses how WebCap calculates supported dataset buckets:

- `POC`: lower-cost proof-of-concept targets.
- `Normal`: balanced default targets.
- `Quality`: higher-quality bucket preference when the visible media supports it.

The mode belongs to the selected model setup. Selecting it creates missing TOMLs but never silently rewrites an existing file.

For Wan2.2, high-noise and low-noise datasets are calculated independently. Krea2 Raw, Wan2.1 T2V 14B, and MiniMax H3 each use one mode-specific dataset TOML.

Bucket availability remains constrained by visible media metadata. Different modes may produce the same output when source resolution or aspect-ratio coverage leaves no useful alternative.
