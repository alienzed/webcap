# Training Action Identity

Each fresh Train click is one action. Its optional **Run name** is trimmed to 80 characters for display and stored in `action.json`, queue state, and Recent Runs. A safe 48-character filesystem suffix is appended to the visible action directory; an unnamed action uses only its sequence and set slug.

Managed checkpoint Resume stays inside the original action: it reuses that action's captured `record/` and `input/` and adds another job record. WebCap accepts only an opaque action/output selection for managed Resume, never a user-supplied checkpoint path. The manual-command diagnostic field remains available for an external or legacy checkpoint and records that as an external-output exception.

The action directory, not Recent Runs, is the durable local explanation of a launch. Recent Runs can be cleared at any time without altering action files.
