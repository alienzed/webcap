import os
import shutil
import sqlite3
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, simpledialog
from send2trash import send2trash
from PIL import Image, ImageTk

DB_FILE = 'media.db'
MEDIA_DIR = 'media'
EXPORT_DIR = 'export'

# Ensure folders exist
def ensure_dirs():
    os.makedirs(MEDIA_DIR, exist_ok=True)
    os.makedirs(EXPORT_DIR, exist_ok=True)

# Initialize database and tables
def init_db():
    conn = sqlite3.connect(DB_FILE)
    conn.execute('PRAGMA foreign_keys = ON')
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS media(
        id INTEGER PRIMARY KEY, filename TEXT
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS tags(
        id INTEGER PRIMARY KEY, name TEXT
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS media_tags(
        media_id INTEGER, tag_id INTEGER,
        FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE CASCADE,
        FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS pages(
        id INTEGER PRIMARY KEY, name TEXT
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS page_items(
        page_id INTEGER, media_id INTEGER, position INTEGER,
        FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE,
        FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE CASCADE
    )''')
    conn.commit()
    conn.close()

class MediaTool:
    def __init__(self, root):
        self.root = root
        self.root.title('MediaTool')
        self.conn = sqlite3.connect(DB_FILE)
        self.conn.execute('PRAGMA foreign_keys = ON')
        self.setup_ui()
        self.refresh_all()

    def setup_ui(self):
        self.root.geometry('900x600')
        mainframe = ttk.Frame(self.root)
        mainframe.pack(fill='both', expand=True)
        # Panels
        left = ttk.Frame(mainframe)
        left.pack(side='left', fill='both', expand=True)
        right = ttk.Frame(mainframe)
        right.pack(side='right', fill='y')
        bottom = ttk.Frame(self.root)
        bottom.pack(side='bottom', fill='x')
        # Media thumbnail grid
        self.thumb_canvas = tk.Canvas(left, bg='#f8f8f8')
        self.thumb_scrollbar = ttk.Scrollbar(left, orient='vertical', command=self.thumb_canvas.yview)
        self.thumb_canvas.configure(yscrollcommand=self.thumb_scrollbar.set)
        self.thumb_scrollbar.pack(side='right', fill='y')
        self.thumb_canvas.pack(side='left', fill='both', expand=True)
        self.thumb_frame = ttk.Frame(self.thumb_canvas)
        self.thumb_canvas.create_window((0,0), window=self.thumb_frame, anchor='nw')
        self.thumb_frame.bind('<Configure>', lambda e: self.thumb_canvas.configure(scrollregion=self.thumb_canvas.bbox('all')))
        # Tag list
        self.tag_tree = ttk.Treeview(right, columns=('id', 'name'), show='headings', selectmode='browse', height=20)
        self.tag_tree.heading('id', text='ID')
        self.tag_tree.heading('name', text='Tag')
        self.tag_tree.column('id', width=40, anchor='center')
        self.tag_tree.column('name', width=120)
        self.tag_tree.pack(fill='y', expand=False, padx=5, pady=5)
        # Page controls
        page_frame = ttk.Frame(bottom)
        page_frame.pack(side='left', fill='x', expand=True, padx=5, pady=5)
        ttk.Label(page_frame, text='Pages:').pack(side='left')
        self.page_combo = ttk.Combobox(page_frame, state='readonly')
        self.page_combo.pack(side='left', padx=5)
        self.page_combo.bind('<<ComboboxSelected>>', lambda e: self.refresh_page_items())
        self.page_items_list = tk.Listbox(page_frame, width=40, height=3)
        self.page_items_list.pack(side='left', padx=5)
        # Buttons
        btn_frame = ttk.Frame(bottom)
        btn_frame.pack(side='right', fill='x', padx=5, pady=5)
        ttk.Button(btn_frame, text='Add Media', command=self.add_media).pack(side='left', padx=2)
        ttk.Button(btn_frame, text='Delete Media', command=self.delete_media).pack(side='left', padx=2)
        ttk.Button(btn_frame, text='Add Tag', command=self.add_tag).pack(side='left', padx=2)
        ttk.Button(btn_frame, text='Assign Tag to Media', command=self.assign_tag).pack(side='left', padx=2)
        ttk.Button(btn_frame, text='Create Page', command=self.create_page).pack(side='left', padx=2)
        ttk.Button(btn_frame, text='Add Selected Media to Page', command=self.add_media_to_page).pack(side='left', padx=2)
        ttk.Button(btn_frame, text='Export Selected Page', command=self.export_page).pack(side='left', padx=2)
        # Thumbnail state
        self.thumbnails = {}
        self.thumb_refs = {}
        self.selected_media_id = None

    def refresh_all(self):
        self.refresh_media_grid()
        self.refresh_tags()
        self.refresh_pages()
        self.refresh_page_items()

    def refresh_media_grid(self):
        for widget in self.thumb_frame.winfo_children():
            widget.destroy()
        self.thumbnails.clear()
        self.thumb_refs.clear()
        c = self.conn.cursor()
        c.execute('SELECT id, filename FROM media ORDER BY id DESC')
        media = c.fetchall()
        grid_cols = 5
        thumb_size = 150
        for idx, (mid, fname) in enumerate(media):
            ext = os.path.splitext(fname)[1].lower()
            fpath = os.path.join(MEDIA_DIR, fname)
            if ext in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'] and os.path.exists(fpath):
                try:
                    img = Image.open(fpath)
                    img.thumbnail((thumb_size, thumb_size), Image.LANCZOS)
                    thumb = ImageTk.PhotoImage(img)
                except Exception:
                    thumb = self.make_placeholder(thumb_size, thumb_size, 'ERROR')
            elif ext in ['.mp4', '.webm', '.mov', '.avi']:
                thumb = self.make_placeholder(thumb_size, thumb_size, 'VIDEO', fname)
            else:
                thumb = self.make_placeholder(thumb_size, thumb_size, 'FILE', fname)
            self.thumb_refs[mid] = thumb
            frame = tk.Frame(self.thumb_frame, bd=2, relief='solid', bg='#e0e0e0')
            if self.selected_media_id == mid:
                frame.config(bg='#3399ff')
            label = tk.Label(frame, image=thumb, bg='#e0e0e0')
            label.pack()
            label.bind('<Button-1>', lambda e, m=mid, f=frame: self.select_thumbnail(m, f))
            label.bind('<Double-Button-1>', lambda e, m=mid: self.open_preview(m))
            frame.grid(row=idx//grid_cols, column=idx%grid_cols, padx=8, pady=8)
            self.thumbnails[mid] = frame
        self.thumb_canvas.update_idletasks()
        self.thumb_canvas.configure(scrollregion=self.thumb_canvas.bbox('all'))

    def make_placeholder(self, w, h, text, fname=None):
        img = Image.new('RGB', (w, h), color='#cccccc')
        from PIL import ImageDraw, ImageFont
        draw = ImageDraw.Draw(img)
        msg = text if not fname else f'{text}\n{fname}'
        try:
            font = ImageFont.load_default()
        except Exception:
            font = None
        lines = msg.split('\n')
        y = h//2 - (10*len(lines))
        for line in lines:
            sz = draw.textsize(line, font=font)
            x = w//2 - sz[0]//2
            draw.text((x, y), line, fill='black', font=font)
            y += 15
        return ImageTk.PhotoImage(img)

    def select_thumbnail(self, media_id, frame):
        self.selected_media_id = media_id
        for mid, f in self.thumbnails.items():
            f.config(bg='#e0e0e0')
        frame.config(bg='#3399ff')

    def open_preview(self, media_id):
        c = self.conn.cursor()
        c.execute('SELECT filename FROM media WHERE id=?', (media_id,))
        row = c.fetchone()
        if not row:
            return
        fname = row[0]
        ext = os.path.splitext(fname)[1].lower()
        fpath = os.path.join(MEDIA_DIR, fname)
        win = tk.Toplevel(self.root)
        win.title(fname)
        if ext in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'] and os.path.exists(fpath):
            try:
                img = Image.open(fpath)
                img.thumbnail((600, 600), Image.LANCZOS)
                photo = ImageTk.PhotoImage(img)
                lbl = tk.Label(win, image=photo)
                lbl.image = photo
                lbl.pack()
            except Exception:
                tk.Label(win, text='Error loading image').pack()
        elif ext in ['.mp4', '.webm', '.mov', '.avi']:
            tk.Label(win, text='Open in system player to preview.').pack(padx=20, pady=20)
        else:
            tk.Label(win, text='File preview not supported.').pack(padx=20, pady=20)

    def refresh_tags(self):
        for i in self.tag_tree.get_children():
            self.tag_tree.delete(i)
        c = self.conn.cursor()
        c.execute('SELECT id, name FROM tags ORDER BY name')
        for row in c.fetchall():
            self.tag_tree.insert('', 'end', values=row)

    def refresh_pages(self):
        c = self.conn.cursor()
        c.execute('SELECT id, name FROM pages ORDER BY id')
        pages = c.fetchall()
        self.page_combo['values'] = [f"{pid}: {name}" for pid, name in pages]
        if pages:
            if not self.page_combo.get():
                self.page_combo.current(0)
        else:
            self.page_combo.set('')

    def refresh_page_items(self):
        self.page_items_list.delete(0, tk.END)
        page_id = self.get_selected_page_id()
        if not page_id:
            return
        c = self.conn.cursor()
        c.execute('''SELECT m.filename FROM page_items pi JOIN media m ON pi.media_id = m.id WHERE pi.page_id = ? ORDER BY pi.position''', (page_id,))
        for row in c.fetchall():
            self.page_items_list.insert(tk.END, row[0])

    def get_selected_media_id(self):
        return self.selected_media_id

    def get_selected_tag_id(self):
        sel = self.tag_tree.selection()
        if not sel:
            return None
        return self.tag_tree.item(sel[0])['values'][0]

    def get_selected_page_id(self):
        val = self.page_combo.get()
        if not val or ':' not in val:
            return None
        return int(val.split(':')[0])

    def add_media(self):
        try:
            file = filedialog.askopenfilename(title='Select Media File')
            if not file:
                return
            fname = os.path.basename(file)
            dest = os.path.join(MEDIA_DIR, fname)
            if os.path.exists(dest):
                messagebox.showerror('Error', 'File already exists in media folder.')
                return
            shutil.copy2(file, dest)
            c = self.conn.cursor()
            c.execute('INSERT INTO media(filename) VALUES (?)', (fname,))
            self.conn.commit()
            self.refresh_media()
        except Exception as e:
            messagebox.showerror('Error', str(e))

    def delete_media(self):
        try:
            media_id = self.get_selected_media_id()
            if not media_id:
                messagebox.showerror('Error', 'No media selected.')
                return
            c = self.conn.cursor()
            c.execute('SELECT filename FROM media WHERE id=?', (media_id,))
            row = c.fetchone()
            if not row:
                messagebox.showerror('Error', 'Media not found.')
                return
            fname = row[0]
            fpath = os.path.join(MEDIA_DIR, fname)
            if os.path.exists(fpath):
                send2trash(fpath)
            c.execute('DELETE FROM media WHERE id=?', (media_id,))
            c.execute('DELETE FROM media_tags WHERE media_id=?', (media_id,))
            c.execute('DELETE FROM page_items WHERE media_id=?', (media_id,))
            self.conn.commit()
            self.refresh_all()
        except Exception as e:
            messagebox.showerror('Error', str(e))

    def add_tag(self):
        try:
            tag = simpledialog.askstring('Add Tag', 'Enter tag name:')
            if not tag:
                return
            c = self.conn.cursor()
            c.execute('INSERT INTO tags(name) VALUES (?)', (tag.strip(),))
            self.conn.commit()
            self.refresh_tags()
        except Exception as e:
            messagebox.showerror('Error', str(e))

    def assign_tag(self):
        try:
            media_id = self.get_selected_media_id()
            tag_id = self.get_selected_tag_id()
            if not media_id or not tag_id:
                messagebox.showerror('Error', 'Select both media and tag.')
                return
            c = self.conn.cursor()
            c.execute('SELECT 1 FROM media_tags WHERE media_id=? AND tag_id=?', (media_id, tag_id))
            if c.fetchone():
                messagebox.showinfo('Info', 'Tag already assigned to media.')
                return
            c.execute('INSERT INTO media_tags(media_id, tag_id) VALUES (?, ?)', (media_id, tag_id))
            self.conn.commit()
        except Exception as e:
            messagebox.showerror('Error', str(e))

    def create_page(self):
        try:
            name = simpledialog.askstring('Create Page', 'Enter page name:')
            if not name:
                return
            c = self.conn.cursor()
            c.execute('INSERT INTO pages(name) VALUES (?)', (name.strip(),))
            self.conn.commit()
            self.refresh_pages()
        except Exception as e:
            messagebox.showerror('Error', str(e))

    def add_media_to_page(self):
        try:
            media_id = self.get_selected_media_id()
            page_id = self.get_selected_page_id()
            if not media_id or not page_id:
                messagebox.showerror('Error', 'Select both media and page.')
                return
            c = self.conn.cursor()
            c.execute('SELECT MAX(position) FROM page_items WHERE page_id=?', (page_id,))
            maxpos = c.fetchone()[0]
            pos = (maxpos + 1) if maxpos is not None else 1
            c.execute('INSERT INTO page_items(page_id, media_id, position) VALUES (?, ?, ?)', (page_id, media_id, pos))
            self.conn.commit()
            self.refresh_page_items()
        except Exception as e:
            messagebox.showerror('Error', str(e))

    def export_page(self):
        try:
            page_id = self.get_selected_page_id()
            if not page_id:
                messagebox.showerror('Error', 'No page selected.')
                return
            c = self.conn.cursor()
            c.execute('SELECT name FROM pages WHERE id=?', (page_id,))
            row = c.fetchone()
            if not row:
                messagebox.showerror('Error', 'Page not found.')
                return
            page_name = row[0]
            c.execute('''SELECT m.filename FROM page_items pi JOIN media m ON pi.media_id = m.id WHERE pi.page_id = ? ORDER BY pi.position''', (page_id,))
            media_files = [r[0] for r in c.fetchall()]
            html = self.generate_html(page_name, media_files)
            fname = f"{page_name.replace(' ', '_')}.html"
            fpath = os.path.join(EXPORT_DIR, fname)
            with open(fpath, 'w', encoding='utf-8') as f:
                f.write(html)
            messagebox.showinfo('Export', f'Exported to {fpath}')
        except Exception as e:
            messagebox.showerror('Error', str(e))

    def generate_html(self, page_name, media_files):
        head = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{page_name}</title>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body>
<div class="container mt-4">
<h2>{page_name}</h2>
<div class="row">'''
        body = ''
        for fname in media_files:
            ext = os.path.splitext(fname)[1].lower()
            if ext in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']:
                body += f'<div class="col-md-4 mb-3"><img src="../media/{fname}" class="img-fluid rounded"></div>'
            elif ext in ['.mp4', '.webm', '.mov', '.avi']:
                body += f'<div class="col-md-4 mb-3"><video src="../media/{fname}" controls class="w-100"></video></div>'
            else:
                body += f'<div class="col-md-4 mb-3">{fname}</div>'
        tail = '</div>\n</div>\n</body>\n</html>'
        return head + body + tail

if __name__ == '__main__':
    ensure_dirs()
    init_db()
    root = tk.Tk()
    app = MediaTool(root)
    root.mainloop()
