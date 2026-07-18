# Configuration File System

## Discovery and editor

- Config files are not mixed into the media list.
- The Train workspace lists TOML files grouped by training profile.
- Open a file to edit it in the central editor. The editor has **Save** and **Close**; Close saves then returns to Training Items.
- `/fs/list_config` lists the set's TOML files, `/fs/read_config` reads one, and `/fs/save_config` saves one in place.

## Templates and generated files

Canonical templates live in `tool/templates/`:

- `config.hi.toml` and `config.lo.toml` for Wan2.2 T2V
- `config.krea2.toml` for Krea2 Raw
- `config.wan21.toml` for Wan2.1 T2V 14B

Templates are not written on folder load. `Generate Configs`, command preview, and managed launch create missing files for the selected profile. Placeholder substitution resolves the training root, models root, and set path. Launch creation, not config generation, reserves the prefixed output group and writes its effective output directory into a launch-owned snapshot.

Generation never silently overwrites an existing TOML. The per-file **Reset** action is the explicit way to restore the resolved template.

Generated dataset TOML comes from `tool/server/dataset_config.py`, not static template files. See [training_profiles.md](training_profiles.md) for the file each profile uses.
