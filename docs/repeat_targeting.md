# Repeat Targeting

When WebCap creates or resets a managed dataset TOML, it computes repeat counts from the visible sample/role membership, a target step budget, and a **fixed reference epoch count**.

The reference epoch count comes from `training.repeat_reference_epochs` in `tool/config.json` and defaults to **90**. It is deliberately independent of the run's **Epochs** control.

Current target budgets are:

- Wan2.2 High: roughly 5,000 target steps.
- Wan2.2 Low: roughly 20,000 target steps.
- Krea2 Raw, Wan2.1 T2V 14B, and MiniMax H3: roughly 20,000 target steps.

The repeat scalar is solved approximately as:

```text
ceil(target_steps / (repeat_reference_epochs * weighted_samples))
```

Role weights then produce each generated stanza's `num_repeats`.

## Why Epochs is separate

The Training page's **Epochs** field controls the actual run length written to the captured training config. Changing it does **not** silently change dataset repeat counts.

This keeps dataset exposure density stable when comparing otherwise-similar runs at different epoch counts. WebCap still uses the selected run epochs when estimating total steps/exposures for progress and review.

## Persistence

Repeat counts are written into the persistent dataset TOML when that file is created or explicitly reset. They are not recalculated merely because a later run chooses a different Epochs value.

Calculated repeats are defaults, not a hidden constraint: edit the persistent dataset TOML directly when an intentional custom value is needed.

See [train.md](train.md) for run-capture behavior and [app_settings.md](app_settings.md) for the reference-epoch setting.
