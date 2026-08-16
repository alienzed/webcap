# Dataset Workflow

## 1. Curate source media

Keep intended training media in the set folder, caption it, and use WebCap's review, filtering, focus-set, and reversible mutation tools as needed.

## 2. Choose the training setup

Open **Train**, select a supported model and `POC`, `Normal`, or `Quality` mode. WebCap creates any missing persistent TOMLs for that setup and shows only those files.

Inspect or edit every relevant config and dataset TOML. Existing files are preserved. **Reset** is the explicit replacement action for one file.

Dataset TOMLs are calculated directly from visible-media metadata. This does not copy media or create a prepared dataset directory.

## 3. Select the dataset

The currently visible media rows are the dataset source of truth. Text filters, advanced filters, and focus sets therefore control what the next Train action captures.

## 4. Capture and train

Train saves the open TOML, captures the visible media and latest captions, copies the inspected TOMLs, and writes the run plan into an immutable bundle under the numbered output folder. Diffusion Pipe writes its cache inside that bundle.

Queued and running jobs no longer depend on source-set media, captions, TOMLs, or `auto_dataset`. Later edits affect only future Train actions.

## Folder semantics

- `originals/`: backups for reversible media mutations.
- `src_videos/`: optional source-media workspace.
- set-root profile/mode TOMLs: persistent editable setup.
- `<numbered-run>/.webcap/datasets/`: captured media, captions, TOMLs, plan, and caches owned by that Train action.
- legacy `auto_dataset/`: ignored by new training and safe to delete manually when no older external workflow needs it.
