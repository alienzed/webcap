# Repeat Targeting

When WebCap generates a dataset TOML, it computes a repeat scalar from the prepared sample count, the applicable config's epochs, and a target step budget.

- Wan2.2 high-noise: roughly 5,000 target steps.
- Wan2.2 low-noise: roughly 20,000 target steps.
- Krea2 Raw and Wan2.1 T2V 14B use the single-stage/low target budget of roughly 20,000 steps.

The calculation is per generated run. Wan2.2 HI and LO are separate models and separate jobs; the HI -> LO button only queues them in sequence.

The resulting `auto_dataset/training_plan.json` provides the run plan used for progress estimates. Generated repeats are defaults, not a hidden constraint: edit the dataset TOML or model config when an intentional custom setting is needed.
