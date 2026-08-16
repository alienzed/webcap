# Visible Selection Training

The media grid is the dataset source of truth.

- Train captures only currently visible media rows.
- Text filters, advanced filters, and focus sets implicitly control membership.
- Zero visible items fails visibly.
- Captions are captured from the latest saved caption text, with the existing primer fallback behavior.
- Every Train action receives its own immutable run bundle.
- Later changes to filters, captions, source files, or set TOMLs cannot affect an already captured job.

WebCap deliberately does not track stale dataset state, hashes, revisions, or preparation status. To train a changed selection, inspect the desired TOMLs and start another Train action.
