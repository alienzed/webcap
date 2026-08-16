# Configuration File System

## Discovery and editor

- Config files are not mixed into the media list.
- The Train workspace lists TOML files grouped by training profile.
- Open a file to edit it in the central editor. The editor has **Save** and **Close**; Close saves then returns to Training Items.
- `/fs/list_config` lists the set's TOML files, `/fs/read_config` reads one, and `/fs/save_config` saves one in place.

## Templates and setup files

Canonical templates live in `tool/templates/`:

- `config.wan22.{poc|normal|quality}.{hi|lo}.toml` for Wan2.2 T2V
- `config.krea2.{poc|normal|quality}.toml` for Krea2 Raw
- `config.wan21.{poc|normal|quality}.toml` for Wan2.1 T2V 14B
- `config.h3.{poc|normal|quality}.toml` for MiniMax H3

Selecting a profile and mode creates only its missing set-owned config and dataset TOMLs. Placeholder substitution resolves the training root, models root, and set path. Existing TOMLs are preserved. Normal initially inherits a matching legacy config when one exists; otherwise it uses its mode template. POC and Quality use their own templates.

The per-file **Reset** action is the explicit way to restore that mode's training template. Dataset Reset recalculates only the selected dataset TOML from the currently visible media.

Train saves the open TOML, then captures the selected setup TOMLs and currently visible media in a run-owned bundle. Dataset TOML content is calculated by `tool/server/dataset_config.py`, not copied from static templates. See [training_profiles.md](training_profiles.md) for the files each profile uses.
