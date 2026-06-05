# Primer Mappings V2 (Structured, Modal-Based)

Last updated: 2026-05-31

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
  "scope": "tag",
  "token": "fd",
  "key": "view",
  "value": "face down",
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
2. Build effective mapping rows by appending requirement-derived defaults after custom rows:
- Custom rows: `primer.mappings` (top-to-bottom).
- Requirement defaults: generated from requirement keyword config (`caption_requirements` + `caption_requirement_keywords`), with key aliases such as `Key Phrase -> subject` and `Viewpoint -> view`. Default scope for these rows is `tag`.
3. Iterate effective mapping rows top-to-bottom.
4. Skip rows where `enabled` is false.
5. A row matches when:
- `scope=file`: normalized filename contains `token`.
- `scope=tag`: any assigned tag exactly matches `token` after trimming and whitespace normalization.
6. On match:
- If key is unset, set `key=value`.
- If `value` is blank, `token` is used as the value.
- If key is already set, append additional matched values in row order.
- Per-key values are deduplicated case-insensitively before rendering.
7. Render `primer.template` using final key-value map.
8. Unresolved placeholders are removed (empty output).
9. Placeholder punctuation can be conditional by including non-key characters inside braces:
- `{view,}` -> emits trailing comma only if `view` resolves.
- `{,view}` -> emits leading comma only if `view` resolves.
- `{ (view) }` -> emits surrounding punctuation only if `view` resolves.
10. Conditional phrase wrappers are supported:
- `{view| against }` -> emits `value + " against "` only if `view` resolves.
- `{ in |location| setting}` -> emits `" in " + value + " setting"` only if `location` resolves.

Collision policy:
1. Matching rows for the same key append values in top-to-bottom order.
2. Custom mappings always win over requirement defaults because defaults are appended after custom rows.
3. No explicit priority field or conflict UI.

## Review Rule Semantics

Review compute uses `stats.reviewRules` rows:
1. Skip rows where `enabled` is false.
2. `scope=file`: if filename contains `trigger`, caption must contain `required`.
3. `scope=caption`: if caption contains `trigger`, caption must contain `required`.
4. Violations are reported in existing Validation Failures section.

## UI Contract

### Config Tab
1. `Caption Template` remains direct textarea.
2. `Mappings` section is always visible under template and includes:
- `Edit Mappings` button (opens modal).
- summary line (row count).
3. `Set Notes` remains visible below mappings.

### Review Tab
1. `Required key phrase` and `Balance Phrases` remain.
2. `Balance Phrases` includes an `i` help button that opens plain-language usage guidance in preview.
3. `Rules` section is always visible (no Advanced accordion):
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
2. Auto-primer generation applies mappings with custom-first precedence and blank-value token passthrough.
3. Auto-primer generation appends multiple matched values per key (deduped, ordered).
4. Placeholder rendering removes unresolved keys and honors conditional punctuation/phrase wrappers.
5. Review compute consumes structured rules and returns expected failures.
6. Existing review/caption workflows remain functional without legacy textareas.
