# Filesystem Backend Refactor Plan

## High-Level Requirements

1. **Single Root Directory**
   - All file operations are restricted to a single, hardcoded root directory specified in a config file (e.g., config.json or .toml).
   - No UI for picking or changing the root directory at runtime.

2. **Supported Operations**
   - List directory contents
   - Read file
   - Write file (for sidecar/caption files only)
   - Rename file or directory
   - No delete endpoint (deletion is out of scope)
   - Directory creation is out of scope unless proven necessary for originals logic

3. **Frontend Integration**
   - All file operations are performed via HTTP requests to backend endpoints.
   - No browser filesystem API usage.
   - No directory picker UI; all paths are relative to the configured root.

4. **Iterative, Safe Refactoring**
   - Refactor in small, testable steps (start with read/list, then write/rename).
   - Keep old code paths until new ones are proven stable, then remove deprecated code.
   - Test thoroughly after each step to avoid regressions.

5. **Scope Control**
   - Only implement endpoints and features that are strictly required for current app functionality.
   - Avoid adding features (e.g., delete, directory creation, advanced browsing) unless a real use case emerges.
   - Document any new requirements before expanding scope.

6. **Regression Prevention**
   - After each change, verify that all existing app features (caption/media handling, etc.) continue to work as expected.
   - Use feature flags or config switches if needed for gradual rollout.

## Specifics to Guide Implementation

- **Config File Example:**
  ```toml
  [filesystem]
  root = "/absolute/path/to/training/directory"
  ```
  or
  ```json
  {
    "filesystem": {
      "root": "/absolute/path/to/training/directory"
    }
  }
  ```

- **Backend Endpoints:**
  - `GET /fs/list?path=relative/path` → List contents of a directory
  - `GET /fs/read?path=relative/path/to/file` → Read file contents
  - `POST /fs/write` (body: `{ path, content }`) → Write file
  - `POST /fs/rename` (body: `{ old_path, new_path }`) → Rename file/dir

- **Frontend:**
  - All paths sent to backend are relative to the configured root.
  - No UI for picking/changing root directory.
  - Minimal UI for browsing/selecting files within the root (if needed).

- **Testing:**
  - Test on all target OSes (Linux, Windows, Mac) for path handling and permissions.
  - Validate that only intended files are modified.

- **Documentation:**
  - Clearly document the root directory config and the limited scope of file operations.
  - Warn users about the power of file operations if the root is set broadly.

---

This plan is designed to keep the implementation minimal, robust, and focused, while allowing for safe, iterative progress and easy rollback if regressions are found.