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
        self.log_lines = []
        self.console_expanded = False
        self.selected_media_id = None
        self.thumbnails = {}
        self.thumb_refs = {}
        self.setup_ui()
        self.refresh_all()

    def setup_ui(self):
        self.root.geometry('1100x700')
        self.root.minsize(900, 600)
        # Main layout: left nav, right content
        self.mainframe = tk.Frame(self.root)
        self.mainframe.pack(fill='both', expand=True)
        self.mainframe.grid_rowconfigure(0, weight=1)
        self.mainframe.grid_columnconfigure(1, weight=1)

        # LEFT NAVIGATION PANEL (full height)
        nav = tk.Frame(self.mainframe, width=120, bg='#222')
        nav.grid(row=0, column=0, sticky='ns')
        nav.grid_propagate(False)
        nav.grid_rowconfigure(5, weight=1)
        btn_style = {'font':('Segoe UI', 11), 'bg':'#222', 'fg':'#fff', 'activebackground':'#444', 'activeforeground':'#fff', 'bd':0, 'relief':'flat', 'highlightthickness':0, 'anchor':'w', 'padx':18, 'pady':8}
        self.nav_buttons = {}
        nav_modes = [('MEDIA','Media'),('PAGES','Pages'),('TAGS','Tags'),('EDIT','Edit'),('SETTINGS','Settings')]
        for i, (mode, label) in enumerate(nav_modes):
            b = tk.Button(nav, text=label, command=lambda m=mode: self.show_mode(m), **btn_style)
            b.grid(row=i, column=0, sticky='ew', pady=(0,2))
            self.nav_buttons[mode] = b
        # Console toggle at bottom left
        nav.grid_rowconfigure(10, weight=1)
        self.console_toggle_btn = tk.Button(nav, text='Toggle Console', command=self.toggle_console, **btn_style)
        self.console_toggle_btn.grid(row=20, column=0, sticky='ew', pady=(10,8))

        # RIGHT CONTENT AREA (stacked frames + console)
        self.right_pane = tk.Frame(self.mainframe)
        self.right_pane.grid(row=0, column=1, sticky='nsew')
        self.right_pane.grid_rowconfigure(0, weight=1)
        self.right_pane.grid_columnconfigure(0, weight=1)
        self.frames = {}
        for mode in ['MEDIA','PAGES','TAGS','EDIT','SETTINGS']:
            f = tk.Frame(self.right_pane)
            f.grid(row=0, column=0, sticky='nsew')
            self.frames[mode] = f

        # MEDIA MODE FRAME
        self.setup_media_frame(self.frames['MEDIA'])
        # PAGES MODE FRAME
        self.setup_pages_frame(self.frames['PAGES'])
        # TAGS MODE FRAME
        self.setup_tags_frame(self.frames['TAGS'])
        # EDIT MODE FRAME
        tk.Label(self.frames['EDIT'], text='Edit Mode', font=('Segoe UI', 16)).pack(expand=True)
        # SETTINGS MODE FRAME
        tk.Label(self.frames['SETTINGS'], text='Settings', font=('Segoe UI', 16)).pack(expand=True)

        # CONSOLE always at bottom of right pane
        self.console_frame = tk.Frame(self.right_pane, bg='#222')
        self.console_frame.grid(row=1, column=0, sticky='ew')
        self.console_label = tk.Label(self.console_frame, text='', anchor='w', bg='#222', fg='#fff', font=('Consolas', 10))
        self.console_label.pack(fill='x', padx=8, pady=2)
        self.console_text = tk.Text(self.console_frame, height=10, bg='#181818', fg='#fff', font=('Consolas', 10), wrap='word')
        self.console_text.config(state='disabled')
        self.console_text.pack_forget()

        self.current_mode = None
        self.show_mode('MEDIA')

    def setup_media_frame(self, frame):
        # Tag bar (shows tags for selected media, assign/remove)
        tagbar = tk.Frame(frame)
        tagbar.pack(fill='x', padx=12, pady=(10, 0))
        self.media_tag_label = tk.Label(tagbar, text='', anchor='w', font=('Segoe UI', 10))
        self.media_tag_label.pack(side='left', padx=(0, 8))
        ttk.Button(tagbar, text='Assign Tag', command=self.assign_tag_to_media).pack(side='left', padx=(0, 4))
        ttk.Button(tagbar, text='Remove Tag', command=self.remove_tag_from_media).pack(side='left', padx=(0, 4))
        # Header bar for controls
        header = tk.Frame(frame)
        header.pack(fill='x', padx=12, pady=(0, 0))
        ttk.Button(header, text='Add Media', command=self.add_media).pack(side='left', padx=(0, 6))
        ttk.Button(header, text='Delete Media', command=self.delete_media).pack(side='left', padx=(0, 6))
        # Tag filter dropdown
        self.tag_filter_var = tk.StringVar()
        self.tag_filter_combo = ttk.Combobox(header, textvariable=self.tag_filter_var, state='readonly', width=18)
        self.tag_filter_combo.pack(side='left', padx=(20, 0))
        self.tag_filter_combo.bind('<<ComboboxSelected>>', lambda e: self.refresh_media_grid())
        self.tag_filter_combo['values'] = ['All']
        self.tag_filter_combo.set('All')
        # Scrollable thumbnail grid
        grid_frame = tk.Frame(frame)
        grid_frame.pack(fill='both', expand=True, padx=8, pady=8)
        self.thumb_canvas = tk.Canvas(grid_frame, bg='#f8f8f8', highlightthickness=0)
        self.thumb_scrollbar = ttk.Scrollbar(grid_frame, orient='vertical', command=self.thumb_canvas.yview)
        self.thumb_canvas.configure(yscrollcommand=self.thumb_scrollbar.set)
        self.thumb_scrollbar.pack(side='right', fill='y')
        self.thumb_canvas.pack(side='left', fill='both', expand=True)
        self.thumb_frame = ttk.Frame(self.thumb_canvas)
        self.thumb_canvas.create_window((0,0), window=self.thumb_frame, anchor='nw')
        self.thumb_frame.bind('<Configure>', lambda e: self.thumb_canvas.configure(scrollregion=self.thumb_canvas.bbox('all')))
        self.thumb_canvas.bind_all('<MouseWheel>', self._on_mousewheel)

    def setup_pages_frame(self, frame):
        # Page list panel
        page_frame = tk.Frame(frame)
        page_frame.pack(fill='x', padx=8, pady=8)
        ttk.Label(page_frame, text='Pages:').pack(side='left')
        self.page_combo = ttk.Combobox(page_frame, state='readonly')
        self.page_combo.pack(side='left', padx=5)
        self.page_combo.bind('<<ComboboxSelected>>', lambda e: self.refresh_page_items())
        self.page_items_list = tk.Listbox(frame, width=40, height=6)
        self.page_items_list.pack(fill='x', padx=8, pady=(0,8))
        # Page controls
        btns = tk.Frame(frame)
        btns.pack(fill='x', padx=8, pady=(0,8))
        ttk.Button(btns, text='Create Page', command=self.create_page).pack(side='left', padx=2)
        ttk.Button(btns, text='Add Selected Media to Page', command=self.add_media_to_page).pack(side='left', padx=2)
        ttk.Button(btns, text='Export Selected Page', command=self.export_page).pack(side='left', padx=2)

    def setup_tags_frame(self, frame):
        # Tag list with count
        tag_frame = tk.Frame(frame)
        tag_frame.pack(fill='both', expand=True, padx=8, pady=8)
        self.tag_tree = ttk.Treeview(tag_frame, columns=('id', 'name', 'count'), show='headings', selectmode='browse', height=20)
        self.tag_tree.heading('id', text='ID')
        self.tag_tree.heading('name', text='Tag')
        self.tag_tree.heading('count', text='Media Count')
        self.tag_tree.column('id', width=40, anchor='center')
        self.tag_tree.column('name', width=120)
        self.tag_tree.column('count', width=90, anchor='center')
        self.tag_tree.pack(fill='y', expand=True, padx=5, pady=5, side='left')
        # Tag controls
        btns = tk.Frame(frame)
        btns.pack(fill='x', padx=8, pady=(0,8))
        ttk.Button(btns, text='Add Tag', command=self.add_tag).pack(side='left', padx=2)
        ttk.Button(btns, text='Delete Tag', command=self.delete_tag).pack(side='left', padx=2)

    def show_mode(self, mode):
        if self.current_mode == mode:
            return
        for m, f in self.frames.items():
            f.lower()
        self.frames[mode].tkraise()
        self.current_mode = mode
        for m, b in self.nav_buttons.items():
            b.config(bg='#222')
        self.nav_buttons[mode].config(bg='#444')
        if mode == 'MEDIA':
            self.refresh_media_grid()
        elif mode == 'PAGES':
            self.refresh_pages()
            self.refresh_page_items()
        elif mode == 'TAGS':
            self.refresh_tags()

    def toggle_console(self):
        self.console_expanded = not self.console_expanded
        if self.console_expanded:
            self.console_text.pack(fill='x', padx=8, pady=2)
        else:
            self.console_text.pack_forget()

    def log(self, msg):
        self.log_lines.append(msg)
        if len(self.log_lines) > 100:
            self.log_lines = self.log_lines[-100:]
        self.console_label.config(text=msg)
        if self.console_expanded:
            self.console_text.config(state='normal')
            self.console_text.delete('1.0', 'end')
            self.console_text.insert('end', '\n'.join(self.log_lines[-15:]))
            self.console_text.config(state='disabled')

    def refresh_all(self):
        self.refresh_media_grid()
        self.refresh_tags()
        self.refresh_pages()
        self.refresh_page_items()

    def refresh_media_grid(self):
        # Update tag filter dropdown
        c = self.conn.cursor()
        c.execute('SELECT name FROM tags ORDER BY name')
        tags = [r[0] for r in c.fetchall()]
        self.tag_filter_combo['values'] = ['All'] + tags
        if self.tag_filter_var.get() not in self.tag_filter_combo['values']:
            self.tag_filter_combo.set('All')

        # Query media, optionally filter by tag
        filter_tag = self.tag_filter_var.get()
        if filter_tag and filter_tag != 'All':
            c.execute('''SELECT m.id, m.filename FROM media m
                         JOIN media_tags mt ON m.id=mt.media_id
                         JOIN tags t ON mt.tag_id=t.id
                         WHERE t.name=? ORDER BY m.id DESC''', (filter_tag,))
            media = c.fetchall()
        else:
            c.execute('SELECT id, filename FROM media ORDER BY id DESC')
            media = c.fetchall()

        for widget in self.thumb_frame.winfo_children():
            widget.destroy()
        self.thumbnails.clear()
        self.thumb_refs.clear()
        width = self.thumb_canvas.winfo_width() or 800
        grid_cols = 5 if width > 1000 else 4
        thumb_size = 150
        padx = 18
        pady = 18
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
            cell = tk.Frame(self.thumb_frame, width=thumb_size+10, height=thumb_size+10, bg='#f8f8f8')
            cell.grid_propagate(False)
            # No border by default, only show border if selected
            if self.selected_media_id == mid:
                border = tk.Frame(cell, bd=2, relief='solid', bg='#3399ff')
            else:
                border = tk.Frame(cell, bd=0, relief='flat', bg='#f8f8f8')
            border.pack(expand=True, fill='both', padx=2, pady=2)
            label = tk.Label(border, image=thumb, bg='#fff')
            label.pack(expand=True)
            label.bind('<Button-1>', lambda e, m=mid: self.select_thumbnail_event(e, m))
            label.bind('<Double-Button-1>', lambda e, m=mid: self.open_preview(m))
            cell.grid(row=idx//grid_cols, column=idx%grid_cols, padx=padx, pady=pady)
            self.thumbnails[mid] = cell
        self.thumb_canvas.update_idletasks()
        self.thumb_canvas.configure(scrollregion=self.thumb_canvas.bbox('all'))
        self.update_media_tag_label()

    def update_media_tag_label(self):
        mid = self.selected_media_id
        if not mid:
            self.media_tag_label.config(text='')
            return
        c = self.conn.cursor()
        c.execute('''SELECT t.name FROM tags t JOIN media_tags mt ON t.id=mt.tag_id WHERE mt.media_id=? ORDER BY t.name''', (mid,))
        tags = [r[0] for r in c.fetchall()]
        if tags:
            self.media_tag_label.config(text='Tags: ' + ', '.join(tags))
        else:
            self.media_tag_label.config(text='Tags: (none)')

    def assign_tag_to_media(self):
        mid = self.selected_media_id
        if not mid:
            messagebox.showerror('Error', 'No media selected.')
            return
        c = self.conn.cursor()
        c.execute('SELECT id, name FROM tags ORDER BY name')
        tags = c.fetchall()
        if not tags:
            messagebox.showinfo('Info', 'No tags available. Add a tag first.')
            return
        tag_names = [t[1] for t in tags]
        tag = simpledialog.askstring('Assign Tag', 'Enter tag name:', initialvalue=tag_names[0])
        if not tag:
            return
        tag = tag.strip()
        tag_id = None
        for tid, tname in tags:
            if tname == tag:
                tag_id = tid
                break
        if not tag_id:
            messagebox.showerror('Error', 'Tag not found.')
            return
        c.execute('SELECT 1 FROM media_tags WHERE media_id=? AND tag_id=?', (mid, tag_id))
        if c.fetchone():
            messagebox.showinfo('Info', 'Tag already assigned to media.')
            return
        c.execute('INSERT INTO media_tags(media_id, tag_id) VALUES (?, ?)', (mid, tag_id))
        self.conn.commit()
        self.refresh_media_grid()

    def remove_tag_from_media(self):
        mid = self.selected_media_id
        if not mid:
            messagebox.showerror('Error', 'No media selected.')
            return
        c = self.conn.cursor()
        c.execute('''SELECT t.id, t.name FROM tags t JOIN media_tags mt ON t.id=mt.tag_id WHERE mt.media_id=? ORDER BY t.name''', (mid,))
        tags = c.fetchall()
        if not tags:
            messagebox.showinfo('Info', 'No tags assigned to this media.')
            return
        tag_names = [t[1] for t in tags]
        tag = simpledialog.askstring('Remove Tag', 'Enter tag name to remove:', initialvalue=tag_names[0])
        if not tag:
            return
        tag = tag.strip()
        tag_id = None
        for tid, tname in tags:
            if tname == tag:
                tag_id = tid
                break
        if not tag_id:
            messagebox.showerror('Error', 'Tag not found.')
            return
        c.execute('DELETE FROM media_tags WHERE media_id=? AND tag_id=?', (mid, tag_id))
        self.conn.commit()
        self.refresh_media_grid()

    def select_thumbnail_event(self, event, media_id):
        # Ctrl+Click to deselect
        if (event.state & 0x0004) and self.selected_media_id == media_id:
            self.selected_media_id = None
        else:
            self.selected_media_id = media_id
        self.refresh_media_grid()

    def _on_mousewheel(self, event):
        self.thumb_canvas.yview_scroll(int(-1*(event.delta/120)), 'units')

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

    # select_thumbnail is now handled by select_thumbnail_event

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
        c.execute('''SELECT t.id, t.name, COUNT(mt.media_id) FROM tags t LEFT JOIN media_tags mt ON t.id=mt.tag_id GROUP BY t.id, t.name ORDER BY t.name''')
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
            self.refresh_media_grid()
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
            tag = tag.strip()
            c = self.conn.cursor()
            c.execute('SELECT 1 FROM tags WHERE name=?', (tag,))
            if c.fetchone():
                messagebox.showerror('Error', 'Tag name already exists.')
                return
            c.execute('INSERT INTO tags(name) VALUES (?)', (tag,))
            self.conn.commit()
            self.refresh_tags()
        except Exception as e:
            messagebox.showerror('Error', str(e))

    def delete_tag(self):
        sel = self.tag_tree.selection()
        if not sel:
            messagebox.showerror('Error', 'No tag selected.')
            return
        tag_id = self.tag_tree.item(sel[0])['values'][0]
        tag_name = self.tag_tree.item(sel[0])['values'][1]
        if not messagebox.askyesno('Delete Tag', f'Delete tag "{tag_name}"?'):
            return
        c = self.conn.cursor()
        c.execute('DELETE FROM tags WHERE id=?', (tag_id,))
        c.execute('DELETE FROM media_tags WHERE tag_id=?', (tag_id,))
        self.conn.commit()
        self.refresh_tags()

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
