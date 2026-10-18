const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Minimal DOM fixture: exercise the actual classic script and its async requests.
function fixture() {
  const nodes = {}, pending = [], errors = [], closed = [];
  let document;
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attrs = {};
      this.listeners = {}; this.value = ''; this.textContent = ''; this.open = false; this.paused = false;
      const classes = new Set();
      this.classList = { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x),
        toggle: (x, force = !classes.has(x)) => { force ? classes.add(x) : classes.delete(x); return force; } };
      Object.defineProperty(this, 'className', {set: value => { classes.clear(); value.split(' ').filter(Boolean).forEach(x => classes.add(x)); }});
      this.style = {setProperty() {}};
    }
    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k]; }
    addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn); }
    emit(k, event = {}) { for (const fn of this.listeners[k] || []) fn.call(this, {target:this, ...event}); }
    click(event) { this.emit('click', event); }
    appendChild(node) { return this.insertBefore(node, null); }
    insertBefore(node, before) { node.remove(); node.parent = this; this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, node); return node; }
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
    replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); nodes.forEach(node => this.appendChild(node)); }
    matches(selector) { return selector.split(',').some(s => { s = s.trim(); return s.startsWith('.') ? this.classList.contains(s.slice(1)) : s.toUpperCase() === this.tagName; }); }
    closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
    querySelectorAll(selector) { return this.children.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0]; }
    showModal() { this.open = true; }
    close() { this.open = false; this.emit('close'); }
    pause() { this.paused = true; }
    focus() { document.activeElement = this; }
  }
  const html = fs.readFileSync('tool/tool.html', 'utf8');
  for (const [,id] of html.matchAll(/id="(media-explorer-[^"]+|app-frame)"/g)) nodes[id] = new Element();
  const buttons = [...html.matchAll(/class="media-explorer-source(?: active)?" data-media-(role|source)="([^"]*)"/g)].map(([,kind,value]) => {
    const button = new Element('button'); button.dataset[kind === 'role' ? 'mediaRole' : 'mediaSource'] = value; button.className = 'media-explorer-source'; return button;
  });
  nodes['media-explorer-sort'].value = 'newest';
  nodes['media-explorer-inspector'].classList.add('hidden');
  nodes['media-explorer-workspace'].appendChild(nodes['media-explorer-inspector-body']);
  document = { getElementById: id => nodes[id], createElement: tag => new Element(tag), listeners: {},
    addEventListener(k, fn) { this.listeners[k] = fn; },
    querySelectorAll: selector => selector.includes('[data-media-role]') ? buttons.filter(b => 'mediaRole' in b.dataset) : selector.includes('[data-media-source]') ? buttons.filter(b => 'mediaSource' in b.dataset) : buttons };
  const window = { location: {hash:'#/media'}, reportConsoleError: (source, error) => errors.push(error), syncApplicationShellContext() {}, syncShellLocationRoute() {} };
  for (const owner of ['Generate', 'TestBench', 'Storyboard', 'Storage']) window['close' + owner + 'Activity'] = () => closed.push(owner);
  vm.runInNewContext(fs.readFileSync('tool/js/media_explorer.js', 'utf8'), {
    document, window, console, URLSearchParams, AbortController, Set, Map, setTimeout, clearTimeout,
    getComputedStyle: () => ({gridTemplateColumns:'240px 240px'}),
    fetch: (url, options) => new Promise((resolve, reject) => pending.push({url, options, resolve, reject}))
  });
  const settle = async (request, items, ok = true) => {
    request.resolve({ok, status:ok ? 200 : 500, json:async () => ({ok, items, total:items.length, complete:true, error:ok ? undefined : 'owner discovery failed'})});
    await new Promise(resolve => setImmediate(resolve));
  };
  const key = (target, key, extra = {}) => document.listeners.keydown({target, key, preventDefault() {}, ...extra});
  return {nodes, buttons, pending, errors, closed, window, settle, key};
}
const media = (id, kind = 'image') => ({id, fileName:id + '.png', mediaKind:kind, mediaUrl:'/media/' + id, role:'source', source:'set', rating:null});

test('Explorer replaces activities, retains keyed media on refresh/reorder and ignores stale requests', async () => {
  const f = fixture(); f.window.openMediaExplorerActivity();
  assert.deepEqual(f.closed, ['Generate', 'TestBench', 'Storyboard', 'Storage']);
  await f.settle(f.pending[0], [media('a'), media('b')]);
  const first = f.nodes['media-explorer-grid'].children[0];
  f.nodes['media-explorer-refresh'].click();
  assert.equal(f.nodes['media-explorer-grid'].children[0], first, 'keep gallery while loading');
  await f.settle(f.pending[1], [media('b'), media('a')]);
  assert.equal(f.nodes['media-explorer-grid'].children[1], first, 'reorder without replacing media');
  first.click();
  assert.equal(f.nodes['media-explorer-inspector-body'].dataset.id, 'a', 'binding follows current keyed index');
  f.nodes['media-explorer-refresh'].click();
  f.nodes['media-explorer-refresh'].click();
  assert.equal(f.pending[2].options.signal.aborted, true);
  await f.settle(f.pending[3], [media('new')]);
  await f.settle(f.pending[2], [media('stale')]);
  assert.equal(f.nodes['media-explorer-grid'].children[0].dataset.id, 'new');
});

test('failed refresh retains cards and aborted filter refresh resumes on reentry', async () => {
  const f = fixture(); f.window.openMediaExplorerActivity();
  await f.settle(f.pending[0], [media('a')]);
  const card = f.nodes['media-explorer-grid'].children[0];
  f.nodes['media-explorer-refresh'].click();
  await f.settle(f.pending[1], [], false);
  assert.equal(f.nodes['media-explorer-grid'].children[0], card);
  assert.deepEqual(f.errors, ['owner discovery failed']);
  f.buttons.find(b => b.dataset.mediaSource === 'set').click();
  assert.match(f.pending[2].url, /source=set&full=1/);
  f.window.closeMediaExplorerActivity();
  assert.equal(f.pending[2].options.signal.aborted, true);
  f.window.openMediaExplorerActivity();
  assert.equal(f.pending.length, 4);
  await f.settle(f.pending[3], [media('b')]);
  f.window.closeMediaExplorerActivity(); f.window.openMediaExplorerActivity();
  assert.equal(f.pending.length, 4, 'successful gallery survives activity switches');
});

test('selection, grid keys, loupe return and native video cleanup', async () => {
  const f = fixture(); f.window.openMediaExplorerActivity();
  await f.settle(f.pending[0], [media('a'), media('b'), media('c', 'video')]);
  const [a,b,c] = f.nodes['media-explorer-grid'].children;
  a.click({ctrlKey:true}); b.click({shiftKey:true});
  assert.match(f.nodes['media-explorer-selected-count'].textContent, /^2 selected/);
  assert.equal(f.nodes['media-explorer-compare'].disabled, false);
  f.key(a, 'a', {ctrlKey:true});
  assert.match(f.nodes['media-explorer-selected-count'].textContent, /^3 selected/);
  f.key(a, 'Escape');
  assert.equal(f.nodes['media-explorer-selection'].classList.contains('hidden'), true);
  f.key(a, 'ArrowRight'); assert.equal(b.classList.contains('active'), true);
  f.key(b, 'Enter'); assert.equal(f.nodes['media-explorer-loupe'].open, true);
  f.nodes['media-explorer-close-loupe'].click();
  c.click(); const video = f.nodes['media-explorer-inspector-body'].children[0];
  f.window.closeMediaExplorerActivity(); assert.equal(video.paused, true);
});
