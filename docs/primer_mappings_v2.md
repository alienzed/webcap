# Primer Mappings V2 (Structured, Modal-Based)

Last updated: 2026-05-29

## Goal
Replace legacy advanced textareas with structured modal editors so primer behavior is discoverable and safe.

Scope for this iteration:
1. Config `Mappings` editor (structured rows).
2. Review `Rules` editor (structured rows).
3. Remove legacy textareas from active UI.

No backend route changes.

## Data Model (`.webcap_state.json`)

Stored under existing top-level sections:

1. `primer`
- `template` (string)
- `mappings` (array of rows)

2. `stats`
- `requiredPhrase` (string)
- `phrases` (string; newline-joined balance phrases, existing behavior)
- `reviewRules` (array of rows)

### Mapping Row Shape
```json
{
  "scope": "file",
  "token": "fd",
  "key": "view",
  "value": "face down",
  "fallback": false,
  "enabled": true
}
```

Allowed `scope` values (v2):
1. `file`
2. `tag`

### Review Rule Row Shape
```json
{
  "scope": "file",
  "trigger": "fd",
  "required": "face down",
  "enabled": true
}
```

Allowed `scope` values:
1. `file`
2. `caption`

## Primer Evaluation Semantics

When auto-primer is generated for an empty caption:
1. Start with empty key-value map.
2. Iterate `primer.mappings` top-to-bottom.
3. Skip rows where `enabled` is false.
4. A row matches when:
- `scope=file`: normalized filename contains `token`.
- `scope=tag`: any assigned tag contains `token` (case-insensitive).
5. On match:
- If key is unset, set `key=value`.
- If key is already set, ignore later rows for that key.
6. Render `primer.template` using final key-value map.
7. Unresolved placeholders render as uppercase key text (for example `{view}` -> `VIEW`).

Collision policy:
1. First matching row per key wins (top-to-bottom order).
2. No explicit priority field or conflict UI.

## Review Rule Semantics

Review compute uses `stats.reviewRules` rows:
1. Skip rows where `enabled` is false.
2. `scope=file`: if filename contains `trigger`, caption must contain `required`.
3. `scope=caption`: if caption contains `trigger`, caption must contain `required`.
4. Violations are reported in existing Validation Failures section.

## UI Contract

### Config Tab
1. `Caption Template` remains direct textarea.
2. `Advanced` contains `Mappings` section with:
- `Edit Mappings` button (opens modal).
- summary line (row count).
3. `Set Notes` remains visible below `Advanced`.

### Review Tab
1. `Required key phrase` and `Balance phrases` remain.
2. `Advanced` contains `Rules` section with:
- `Edit Rules` button (opens modal).
- summary line (row count).

### Modal Editors
Rows support:
1. add
2. remove
3. inline edit of all columns
4. save/cancel

Save writes structured arrays into folder state.

## Backward Compatibility

No migration pass is required for this iteration.
If legacy text fields existed, new saves overwrite with structured state as source of truth.

## Guardrails

1. No backend route changes.
2. Keep behavior deterministic and simple.
3. Avoid introducing hidden precedence systems.
4. If UX-only changes require deep parser rewrites, stop and re-scope.

## Test Focus

1. Folder-state save/load preserves `primer.mappings` and `stats.reviewRules`.
2. Auto-primer generation applies mappings with fallback semantics.
3. Review compute consumes structured rules and returns expected failures.
4. Existing review/caption workflows remain functional without legacy textareas.
