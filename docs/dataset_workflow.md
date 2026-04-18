
# Dataset Preparation Workflow for LoRA Training

This document outlines the step-by-step workflow from raw footage to LoRA training, with clear separation of manual/external steps and what this app can automate (without bloat). Folder management and file provenance are emphasized to minimize context switching and data loss.

---

## 1. Raw Footage Collection & Media Curation (Manual/External)

**a. Download relevant videos**

**b. Clip (duration) and crop (aspect ratio) using Avidemux**

**c. Name files with clear, informative nomenclature (retain view/concept info)**

**d. Copy curated files to the appropriate folder inside the training root on the training machine (via RDP)**

_All steps above are manual/external._

---

## 2. Captioning & Defacing (Manual/External, but app can assist)

- Captioning and defacing often happen in parallel as clips are reviewed.
- Defaced clips require special tokens in captions; typically, defacing is done before captioning, but not always.
- Defacing is performed externally (e.g., bash loop with `deface`), and anonymized files are renamed as needed.
- Only the final (kept) version—original or anonymized—should be present for captioning.
- In this app: _No guards are enforced, but captioning tools and metadata management can be provided._

---

## 3. Caption Review & Balancing (Manual/External, with app support)

- Review captions for accuracy and balance.
- May require iterating with step 2 or feeding forward to step 4.
- The app can provide tools for caption review, editing, and metadata display, but does not enforce workflow order.

---

## 4. FPS Normalization & Dataset Organization (Automatable by App)

- Convert all videos to target FPS (e.g., 16 fps for WAN2.2) using ffmpeg.
- Originals (original FPS) are moved to an `originals/` folder automatically by the app. All reversibility (prune, restore, reset) is handled by the presence of files in `originals/`—no trash or state file is used.
- Normalized copies are placed in the working set (e.g., `autodataset/`).
- FPS value should be configurable for future models.
- This step can be repeated as captions are finalized; the app should support re-running normalization without data loss.

---

## 5. Aspect Ratio (AR) Organization & Bucket Assignment (Automatable by App)

- Organize media into AR folders (e.g., square, 4:3, 16:9, 9:16) for bucket assignment.
- Assign clips/images to AR and frame count buckets for training.
- No cropping or AR normalization is performed by the app—only sorting/copying.
- The app can display AR/bucket stats and help balance buckets, but does not modify media content.

---

## 6. Metadata Extraction & Eval/Test Set Selection (Automatable by App)

- Extract and store metadata (resolution, frame count, duration, AR class, etc.) for each clip/image.
- Optionally, select a deterministic subset for evaluation.

---

## 7. Export/Packaging (Automatable by App)

- Organize processed data and metadata into a structure compatible with the training pipeline.

---

## 8. Training (Manual/External)

- Launch LoRA training using the prepared dataset.
- Training scripts/tools are run externally.

---

### Folder Structure Notes
- `originals/` — Untouched originals (original FPS, non-censored, etc.). All destructive actions are reversible by restoring from this folder; no `.caption_trash` or pruned.json is used.
- `auto_dataset/` — Working set, normalized to target FPS, AR-organized, captioned, etc.
- `defaced/` (optional) — Censored/defaced versions, with originals kept elsewhere.

---

### Future-Proofing & Automation Principles
- FPS normalization should be configurable.
- App should never overwrite or lose originals; always move to `originals/` or equivalent.
- Cropping/AR normalization is always manual/external.
- App should minimize context switching (Explorer <-> App) by automating safe, reversible file moves/copies.
- All automation should be explicit, linear, and reversible.

---


---

## How This App Changes the Default Workflow

- **Automated Originals Management:**
	- No need to manually create or manage an `originals/` folder; the app ensures all originals are safely backed up before any mutation (conversion, deface, etc.).
	- All destructive or lossy operations are atomic and reversible.

- **Asynchronous 16fps Conversion:**
	- Videos are automatically converted to 16fps in the background after import or on folder load, with originals preserved.
	- No manual batch conversion or risk of overwriting source files.

- **Asynchronous Deface Integration:**
	- Deface can be triggered per-file or per-folder from the UI, with originals always backed up.
	- No need to run bash loops or manually rename anonymized files; the app manages naming and restoration.

- **Metadata Extraction and Review:**
	- All relevant metadata (FPS, duration, frame count, AR, etc.) is extracted and cached asynchronously, available in the Review Report.
	- No need to run external tools or wait for metadata at review time.

- **Contextual Actions:**
	- All advanced actions (Deface, Convert to 16fps, Restore Original) are available via context menus, reducing the need to switch between Explorer and the app.

- **Safety and Simplicity:**
	- The app enforces safe, explicit, and minimal workflows, reducing manual steps and the risk of data loss or confusion.
	- All automation is transparent and reversible, with clear status and progress indicators.

---

_Edit this document as your workflow evolves._
