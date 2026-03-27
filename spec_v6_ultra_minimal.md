# Minimal Local Page Tool — Spec v6 (Ultra Minimal, Sequenced)

## 1. Purpose
A simple local tool to:
- create pages
- edit raw HTML
- insert video markup (with file copy)
- preview output

No abstractions. Files are the source of truth.

---

## 2. Core Rules
- One page = one folder
- One page = one index.html
- Media is local to page (/media/)
- JS is simple and linear
- No async/await, no promises
- Only one sequencing case: save → then load

---

## 3. File Structure

/project
  /pages/
    /{page}/
      index.html
      /media/
  /templates/
    /default/
      index.html
  /tool/
    tool.html
    /js/
      main.js
      editor.js
      pages.js
      media.js
    /server/
      app.py
      file_ops.py
      page_ops.py
      media_ops.py
    bootstrap.min.css

---

## 4. UI Layout

Left:
- Create page (input + button)
- Page list (click to load)
- Video drop zone

Middle:
- Raw HTML textarea (only editable state)

Right:
- Preview (iframe)

No extra UI elements.

---

## 5. Page Creation

Input: page name

Process:
1. Normalize name (lowercase, hyphens)
2. Ensure unique folder
3. Copy /templates/default → /pages/{name}/
4. Replace <h1> with page name (string replace)

---

## 6. Page Load

GET /load?page=name

Result:
- Load index.html into textarea
- Update preview

---

## 7. Page Save

POST /save

- Save full HTML to index.html
- No partial updates
- Triggered:
  - after typing pause (debounce)
  - before switching page

---

## 8. Sequencing Rule (ONLY THIS)

When switching page:

savePage(function() {
  loadPage(newPage);
});

No other sequencing logic exists.

---

## 9. Video Upload

Drop video file:

POST /upload

Backend:
- ensure /media/ exists
- save file
- auto-rename if needed (video_1.mp4, etc.)

Response:
{ filename: "video.mp4" }

---

## 10. Video HTML

Append to textarea:

<div class="row">
  <div class="col-12">
    <video controls style="width:100%;">
      <source src="media/{filename}">
    </video>
  </div>
</div>

No DOM parsing.

---

## 11. Page List

GET /pages

Returns:
["page1", "page2"]

JS:
- displays list
- loads on click

---

## 12. Search (Simple)

- JS only
- filter by:
  - page name
  - <h1>
  - <meta name="tags">

Tags are read from HTML only.

---

## 13. Preview

- iframe
- wraps HTML in full document
- includes local bootstrap.css

---

## 14. Backend Responsibilities

- list pages
- load page HTML
- save page HTML
- upload media

No logic beyond filesystem.

---

## 15. Non-Features

- no database
- no metadata files
- no gallery
- no WYSIWYG
- no layout system
- no tag editor
- no UI state tracking

---

## 16. Coding Rules

JS:
- XMLHttpRequest only
- no async/await
- no promises
- one request per action
- simple callbacks only

Python:
- simple Flask routes
- file operations only

---

## 17. Success Criteria

- Create page in seconds
- Edit HTML directly
- Drop video → usable HTML generated
- No data loss on page switch
- No need to redesign system

---

END
