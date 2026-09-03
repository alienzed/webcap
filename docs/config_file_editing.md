# Config File Editing

Configuration TOML is edited from the Train workspace, separate from media browsing and caption work.

1. Select a file in **Configuration Files**.
2. Its contents open in the central text editor and the current media selection is cleared.
3. Save explicitly or use **Close**, which saves and returns to Training Items.
4. Use the file's **Reset** control only to intentionally replace that one file. Training configs restore from the appropriate template source; dataset TOMLs are recalculated from currently visible media.

Config files use dedicated read/save routes, so configuration edits do not use caption persistence. Selecting a model creates only its missing files and preserves existing TOML, including manual edits. Train saves the open file before capturing the setup into the run bundle.
