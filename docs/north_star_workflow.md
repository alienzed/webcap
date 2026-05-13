# WebCap North Star Workflow

This document defines the intended workflow and product boundaries at a high level.
It is intentionally not constrained by legacy implementation details.

## Starting Assumption

From WebCap's perspective, the workflow starts when a set folder already exists and already contains curated media.
Initial media sourcing/clipping/prep can happen outside the app.

## End-to-End Workflow

1. Open a set folder with media.
2. Curate set contents (rename, prune, restore, reset, crop/deface where needed).
3. Caption items and iterate quickly while browsing media.
4. Review caption quality and distribution coverage.
5. Run preparation steps for training assets (autoset and related dataset prep tasks).
6. Generate training config artifacts from the current set state.
7. Validate config wiring and preview concrete train commands.
8. Execute training externally (terminal/runner), then iterate back in WebCap as needed.

## What WebCap Should Own

- Fast curation and caption-review loop.
- Safe/reversible file operations.
- Explicit preparation/generation actions for training artifacts.
- Reliable command generation (paths/config references resolved correctly).

## What WebCap Should Not Own by Default

- Long-running training runtime/process lifecycle.
- Monitoring daemon lifecycle (e.g., TensorBoard) as a required workflow.

WebCap can assist with command generation for these tools without becoming responsible for owning those processes.

## Product Principles

- Opening a folder should be primarily read-oriented.
- Artifact creation and mutations should happen via explicit user actions.
- Safety and reversibility come first for media operations.
- Keep orchestration simple and inspectable (show concrete outputs/commands before execution).
