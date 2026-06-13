# Annotation Term Affixes

## Purpose
Keep annotation terms simple while allowing small wording fixes like `on sand` or `on the floor` without adding new groups or a separate modifiers panel.

## UX
- Left-click on an annotate chip keeps the existing behavior: toggle the tag on the current item.
- Right-click on an annotate chip opens a small modal with:
  - `Prefix`
  - `Suffix`
- Saving applies the affix rule to that term for the current set.

## Behavior
- Affixes are term-level, per-set metadata.
- Tag insertion uses the rendered text:
  - term `floor` with prefix `on the` inserts `on the floor`
  - term `sand` with prefix `on` inserts `on sand`
- Primer/template generation uses the rendered text for tag-scope mappings.
- Raw tag storage does not change. Tags remain the plain term so filtering, review, and matching stay stable.

## Storage
- Persist in `.webcap_state.json` as `caption_term_affixes`.
- Shape:

```json
{
  "caption_term_affixes": {
    "floor": { "prefix": "on the", "suffix": "" },
    "sand": { "prefix": "on", "suffix": "" }
  }
}
```

## Guardrails
- This is intentionally small and local.
- No new requirement groups.
- No new backend schema beyond carrying the state key through set-copy/materialize flows.
- Prefer explicit UI wiring over a larger modifiers system, per `docs/copilot_rules.md`.
