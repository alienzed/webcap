# Dataset Workflow

## 1. Curate source media

Keep intended training media in the set folder, caption it, and use WebCap's review, filtering, focus-set, and reversible mutation tools as needed.

## 2. Choose the training setup

Open **Training** from the permanent activity rail and select the **Base Model** from the application header. WebCap creates any missing persistent TOMLs for that setup.

Set the normal run parameters—learning rate, rank, epochs, and dropout—in **Run setup**. These values begin from the model template and are applied only to the captured run config.

Review the bucket summary and use **Adjust buckets** when needed. Use **Advanced configuration** for raw config/dataset TOML edits. Existing files are preserved; **Reset** is the explicit replacement action for one file.

Dataset TOMLs are calculated directly from visible-media metadata. Repeat counts use the fixed `training.repeat_reference_epochs` planning horizon rather than the selected run Epochs value. This does not copy media or create a prepared dataset directory.

## 3. Select the dataset

The currently visible media rows are the dataset source of truth. Text filters, advanced filters, and focus sets therefore control what the next Train action captures.

## 4. Capture and train

Train saves the open TOML, captures the visible media and latest captions, copies the inspected TOMLs, applies the Run setup overrides to the captured config, and writes the run plan under the logical-run output tree. Diffusion Pipe writes its cache inside the captured action evidence.

Queued and running jobs no longer depend on source-set media, captions, TOMLs, or `auto_dataset`. Later edits affect only future Train actions.

## Folder semantics

- `originals/`: backups for reversible media mutations.
- `src_videos/`: optional source-media workspace.
- set-root model/stage TOMLs: persistent editable setup.
- `output/runs/<numbered-set-root>/<logical-run>/captures/`: captured media, captions, TOMLs, plan, and rebuildable cache owned by that Train action.
- `output/runs/<numbered-set-root>/<logical-run>/jobs/`: managed runner/log evidence.
- `output/runs/<numbered-set-root>/<logical-run>/output/`: Diffusion Pipe trainer output.
- legacy `auto_dataset/`: ignored by new training and safe to delete manually when no older external workflow needs it.
