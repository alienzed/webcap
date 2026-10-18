# Durable Test candidate assessments

Per `AGENTS.md`, assessments remain beside their owning Test candidate. The
candidate's existing `.webcap.json` provenance sidecar owns **retired aggregate**
scores. No database, separate ledger, or session-level audit trail is introduced.

## Rules

- While Test sessions exist, their `.webcap_state.json` files are authoritative
  for manual ratings and VL comparisons.
- On **Delete Session** or **Clear Sessions**, WebCap sums each departing
  session's manual ratings and VL comparison statistics into the appropriate
  staged candidate's `assessments` field *before* deleting its files.
- Candidate score displays combine retired sidecar aggregates with assessments
  still present in live sessions. Thus deleting a session doesn't erase its
  completed scores.
- Store minimal sufficient counts/sums: manual `sum` and `count`; VL
  `matches`, `count`, and `previews`. Existing provenance is unchanged.
- **Reset scores** on a staged candidate clears only its saved/retired aggregates.
  Ratings of sessions that still exist remain visible and are not edited.
- Removing a staged Test candidate removes its sidecar, including assessments.
- Session deletion fails visibly if assessments cannot be persisted; it must
  not delete generated files in that case.
- No individual result histories, times, or evaluation archives are stored
  in the sidecar. Ratings in a session may be edited/rechecked normally until
  its deletion.

This uses the two aggregate types currently calculated for Test candidates
(manual ratings and Ask VL group comparisons). Future independent assessment
types must explicitly define sufficient aggregate statistics before they can
be retained at session cleanup.
