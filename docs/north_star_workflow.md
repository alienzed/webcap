# WebCap North Star Workflow

This document defines the intended workflow and product boundaries at a high level. It is intentionally not constrained by legacy implementation details.

## Starting assumption

From WebCap's perspective, the workflow starts when a set folder exists and contains working media. Initial sourcing can happen outside the app.

## End-to-end workflow

1. Open a set folder.
2. Curate media with explicit, reversible operations.
3. Caption and review items while filtering or building focus sets.
4. Open Training and select a model and `POC`, `Normal`, or `Quality` mode.
5. Inspect or edit the setup's persistent config and dataset TOMLs.
6. Leave exactly the desired media visible, then Train, queue, or generate a manual command.
7. Monitor managed work or run the self-contained command externally, then iterate from the source set as needed.

Each Train action captures visible media, latest captions, exact saved TOMLs, and a run plan into an immutable bundle under its numbered output folder. Later source-set changes affect only future actions.

## What WebCap owns

- Fast curation and caption review.
- Safe and reversible media operations.
- Persistent model/mode setup TOMLs.
- Visible-media run capture.
- Concrete Diffusion Pipe command construction.
- A disposable managed queue, logs, history, progress, Resume, diagnostics, GPU status, and optional TensorBoard controls.

## What WebCap does not own

- Downloading or choosing model weights automatically.
- Protecting manually deleted or moved model/run files.
- Hidden dataset preparation state, stale-state tracking, revisions, or hashes.
- Arbitrary user-defined launch commands.

## Product principles

- Opening a folder is primarily read-oriented.
- Mutations and Train actions are explicit.
- The media grid is the training-selection source of truth.
- Inspected TOMLs are the configuration interface.
- A queued or running job owns everything it needs in its captured bundle.
- Required failures remain visible rather than being converted into defensive workflow gates.
