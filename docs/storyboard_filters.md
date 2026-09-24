# Storyboard Filtering North Star

## Goal

Storyboard should use the same filtering **mental model** as WebCap's existing media list rather than inventing a separate Story-specific search pattern.

The implementation should remain Storyboard-owned. Reuse the established semantics and interaction patterns, not the media list's DOM or state.

## Core principles

- Filtering is frontend-only over the already-loaded Story collection.
- One filtering language should feel consistent across WebCap.
- Storyboard owns its own filter state and UI.
- Filtering never changes or mutates Story data.
- Filtering applies across the complete Story collection, including archived Stories.
- Surviving results keep the existing library grouping:
  - Pinned
  - Stories
  - Archived
- Keep the common case compact. Advanced filters should remain optional and quiet.

## Text filter semantics

Match the existing media-list query grammar:

- plain text performs a case-insensitive text match
- comma-, semicolon-, or newline-separated positive terms use **AND** semantics
- prefix a term with `-` or `!` to exclude it
- duplicate terms are ignored

Example:

```text
hotel, storm, -comedy
```

A Story must match both `hotel` and `storm`, and must not match `comedy`.

### Story search surface

The intended Story text haystack is:

1. Story title
2. Story concept / overview
3. WebCap Story tags, once Storyboard is integrated with the real WebCap tag system

Do **not** search arbitrary generated Scene prompts by default. That would make Story-level filtering broad and unpredictable.

The provisional free-text Story `tags` field should remain absent. When Story tags return, they should use WebCap's existing tag concept rather than a standalone comma-separated Story field.

## UI direction

The compact default row should follow the media-list pattern:

```text
[ Filter Stories…                         ] [clear] [filters]
```

The exact chrome can adapt to the Story library width, but the behavior should remain familiar:

- always-visible text filter
- easy clear action
- compact advanced-filter disclosure
- visible filtered-result count when useful

Filtering should not require entering a separate mode or navigating into Archived first.

## Advanced filters

The first useful Story-specific advanced filters are likely:

- Status
  - Active
  - Complete
  - Archived
- Pinned
- Has Scenes
- No Scenes

These are deliberately smaller than the media list's advanced filter set. Storyboard should only expose filters that map to meaningful Story metadata.

Future tag filtering belongs here once Storyboard adopts the real WebCap tag model.

## Complete collection behavior

The Story library is one collection, visually grouped as:

```text
Pinned
Stories
Archived
```

The middle group is **Stories**, not **Recent**. It contains every non-pinned, non-archived Story; there is no recency cutoff.

A text query should search the whole collection first, then render matching Stories in their normal groups. For example, a matching archived Story remains visible under **Archived**.

## Recommended first slice

Implement only the foundation:

1. Storyboard-owned text filter.
2. Same query grammar as the media list:
   - multiple positive terms = AND
   - `-` / `!` terms = exclusion
3. Search Story title and concept.
4. Apply the query across Pinned, Stories, and Archived.
5. Keep the existing grouping after filtering.
6. Show a useful result count.
7. Structure the small filter row so a future advanced-filter button can be added without redesigning it.

Do not add speculative advanced filters yet.

## Implementation boundary

Follow WebCap's existing ownership rules:

- Storyboard owns its filter DOM, state, and rendering.
- Do not bind Storyboard controls directly to media-list controls.
- Do not make Storyboard depend on current Set/media filter state.
- Reuse the semantics of functions such as the media query parser where appropriate only if that can be done through a small, genuinely shared helper without creating cross-feature DOM coupling.
- Local duplication is preferable if sharing would make ownership less obvious.

## Future direction

Once real Story tags exist, Story filtering should expand naturally rather than be redesigned:

```text
Title
  +
Concept
  +
WebCap Story Tags
  +
Story-specific advanced metadata filters
```

The result should feel like the Storyboard version of WebCap filtering, not a second filtering system.
