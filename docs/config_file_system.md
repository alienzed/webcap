# Configuration File System Overview

## **Config File Handling in Media List**

### **Integration with Media List**
- Configuration files (`configlo.toml`, `confighi.toml`, `dataset.lo.toml`, `dataset.hi.toml`) are treated as valid entries alongside media files.
- These files are identified by their names and added to the `items` array with the `kind` property set to `'config'`.

### **Sorting and Rendering**
- The `items` array, which includes both media and configuration files, is sorted alphabetically by label.
- The `renderFileList` function displays the items, ensuring configuration files appear in the list.

### **Event Handling**
- Clicking a row sets the current item.
- Double-clicking a folder navigates into it.

---

## **Automatic Config File Creation**

### **Logic Overview**
- The `maybeCreateConfigFiles` function ensures the presence of specific configuration files in the current directory.
- It checks for the existence of each file and creates it if missing.

### **Template Usage**
- Templates for the configuration files are fetched from `/templates/default/`.
- For `configlo.toml` and `confighi.toml`, the `dataset` path is dynamically substituted into the template content.

### **Error Handling**
- The function gracefully handles errors during file checks, template fetching, and file writing, ensuring the process continues for other files.

---

## **Key Functions and Methods**

### **`renderFileList`**
- Responsible for rendering the list of media and configuration files in the UI.
- Filters items based on user input and displays them in a structured format.

### **`getFileHandle`**
- Used to check for the existence of files and create them if necessary.
- Handles errors gracefully to ensure smooth operation.

---

## **Conclusion**
The configuration file system is well-integrated with the media list and ensures that necessary configuration files are always available. The logic is robust, with proper error handling and dynamic template substitution to adapt to different contexts.