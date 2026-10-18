# Epoch Finder — reference selection UX implementation plan

Grounded in `tool/js/epoch_finder.js`, `tool/tool.html`, `tool/css/epoch_finder.css`, and `AGENTS.md`.

1. **Workspace ownership (implemented).** Step 4 temporarily replaces the right-hand campaign dashboard with a reference workspace. Existing per-attribute navigation and selected reference data remain in the wizard sidebar; other wizard steps restore the dashboard.
2. **Visual selection (implemented).** Display larger, low-padding images in a responsive grid with its own scroll area. Keep Select and Preview actions separate: preview opens a native dialog without changing the reference selection. No new media endpoint or selection persistence.
3. **Validation before merge.** Browser-check New Campaign and follow-up wizard, step transitions, no candidate matches, next/previous through attributes, selection retention, dialog close/Escape, campaign switching, mobile width, and Launch payload. Ensure campaign status polling doesn't displace the step-four workspace. Server tests unaffected; UI smoke is required.

No backend, reference scoring, GPU coordination, or campaign JSON changes. Avoid new persistent state and custom modal infrastructure.
