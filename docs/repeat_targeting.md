# Repeat Targeting

When WebCap creates or resets a dataset TOML, it computes a repeat scalar from the visible sample count, the applicable config's epochs, and a target step budget.

- Wan2.2 high-noise: roughly 5,000 target steps.
- Wan2.2 low-noise: roughly 20,000 target steps.
- Krea2 Raw, Wan2.1 T2V 14B, and MiniMax H3 use the single-stage/low target budget of roughly 20,000 steps.

The calculation is per model/mode setup. Wan2.2 HI and LO are separate stages and separate jobs; the HI → LO action queues them in sequence while sharing one captured bundle.

Train writes the resulting plan into the captured run bundle. Calculated repeats are defaults, not a hidden constraint: edit the persistent dataset TOML when an intentional custom setting is needed.
