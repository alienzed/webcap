const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Minimal DOM fixture: exercise the actual classic script and its async requests.
function fixture(hash = '#/media') {
  const nodes = {}, pending = [], errors = [], closed = [];
  let document;
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attrs = {};
      this.listeners = {}; this.value = ''; this.textContent = ''; this.open = false; this.paused = false;
      this.scrollTop = 0; this.clientHeight = 800; this.scrollHeight = 1200;
      const classes = new Set();
      this.classList = { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x),
        toggle: (x, force = !classes.has(x)) => { force ? classes.add(x) : classes.delete(x); return force; } };
      Object.defineProperty(this, 'className', {set: value => { classes.clear(); value.split(' ').filter(Boolean).forEach(x => classes.add(x)); }});
      this.style = {setProperty() {}, getPropertyValue() {return '';}};
      Object.defineProperty(this, 'options', {get: () => this.children});
      Object.defineProperty(this, 'selectedIndex', {get: () => this.children.findIndex(option => option.value === this.value)});
      Object.defineProperty(this, 'parentElement', {get: () => this.parent});
    }
    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k]; }
    addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn); }
    emit(k, event = {}) { for (const fn of this.listeners[k] || []) fn.call(this, {target:this, ...event}); }
    click(event = {}) { this.emit('click', event); if (this.onclick) this.onclick(event); }
    appendChild(node) { return this.insertBefore(node, null); }
    prepend(node) { return this.insertBefore(node, this.children[0] || null); }
    insertBefore(node, before) { node.remove(); node.parent = this; this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, node); return node; }
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
    replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); nodes.forEach(node => this.appendChild(node)); }
    matches(selector) { return selector.split(',').some(s => {
      s = s.trim();
      if (s.startsWith('.')) return this.classList.contains(s.slice(1));
      if (s.startsWith('#')) return this.id === s.slice(1);
      if (s.startsWith('option[value="') && s.endsWith('"]'))
        return this.tagName === 'OPTION' && this.value === s.slice('option[value="'.length, -2);
      return s.toUpperCase() === this.tagName;
    }); }
    closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    querySelectorAll(selector) { return this.children.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0]; }
    showModal() { this.open = true; }
    close() { this.open = false; this.emit('close'); }
    pause() { this.paused = true; }
    focus() { document.activeElement = this; }
    hasAttribute(k) { return Object.hasOwn(this.attrs, k); }
    getBoundingClientRect() { return {left: 0, right: 1600, width: 1600}; }
  }
  const html = fs.readFileSync('tool/tool.html', 'utf8');
  for (const [,id] of html.matchAll(/id="(media-explorer-[^"]+|app-frame)"/g)) {
    nodes[id] = new Element(); nodes[id].id = id;
  }
  for (const [,id,content] of html.matchAll(/<select[^>]*id="(media-explorer-[^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    for (const [,value,label] of content.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)) {
      const option = new Element('option'); option.value = value; option.textContent = label; nodes[id].appendChild(option);
    }
  }
  const buttons = [...html.matchAll(/class="media-explorer-source(?: active)?" data-media-(role|source)="([^"]*)"/g)].map(([,kind,value]) => {
    const button = new Element('button'); button.dataset[kind === 'role' ? 'mediaRole' : 'mediaSource'] = value; button.className = 'media-explorer-source'; return button;
  });
  const modeButtons = ['list', 'single', 'grid'].map(mode => {
    const button = new Element('button'); button.dataset.explorerMode = mode; return button;
  });
  const workspace = nodes['media-explorer-workspace'];
  const main = new Element('main'); main.className = 'media-explorer-main';
  const preview = new Element('section'); preview.className = 'media-explorer-preview';
  const sizeLabel = new Element('label'); sizeLabel.className = 'media-explorer-size-label';
  const fitControls = new Element('div'); fitControls.className = 'media-explorer-fit-controls';
  nodes['media-explorer-sort'].value = 'newest';
  nodes['media-explorer-inspector'].classList.add('hidden');
  workspace.appendChild(main);
  workspace.appendChild(sizeLabel); workspace.appendChild(fitControls);
  main.appendChild(nodes['media-explorer-gallery-area']);
  main.appendChild(preview);
  nodes['media-explorer-gallery-area'].appendChild(nodes['media-explorer-folder-rows']);
  nodes['media-explorer-gallery-area'].appendChild(nodes['media-explorer-side-list']);
  nodes['media-explorer-gallery-area'].appendChild(nodes['media-explorer-grid']);
  preview.appendChild(nodes['media-explorer-preview-stage']);
  workspace.appendChild(nodes['media-explorer-inspector']);
  nodes['media-explorer-inspector'].appendChild(nodes['media-explorer-inspector-body']);
  workspace.appendChild(nodes['media-explorer-loupe']); workspace.appendChild(nodes['media-explorer-compare-dialog']);
  nodes['media-explorer-compare-dialog'].appendChild(new Element('strong'));
  nodes['media-explorer-compare-dialog'].appendChild(nodes['media-explorer-compare-content']);
  document = { getElementById: id => nodes[id], createElement: tag => new Element(tag), listeners: {},
    querySelector: selector => selector === '.media-explorer-main' ? main : workspace.querySelector(selector),
    addEventListener(k, fn) { this.listeners[k] = fn; },
    querySelectorAll: selector => selector.includes('[data-explorer-mode]') ? modeButtons :
      selector.includes('[data-media-role]') ? buttons.filter(b => 'mediaRole' in b.dataset) :
      selector.includes('[data-media-source]') ? buttons.filter(b => 'mediaSource' in b.dataset) : buttons };
  const window = { location: {hash}, reportConsoleError: (source, error) => errors.push(error), syncApplicationShellContext() {}, syncShellLocationRoute() {} };
  for (const owner of ['Generate', 'TestBench', 'Storyboard', 'Storage']) window['close' + owner + 'Activity'] = () => closed.push(owner);
  vm.runInNewContext(fs.readFileSync('tool/js/media_explorer.js', 'utf8'), {
    document, window, console, URLSearchParams, AbortController, Set, Map, setTimeout, clearTimeout,
    getComputedStyle: () => ({gridTemplateColumns:'240px 240px'}),
    fetch: (url, options) => new Promise((resolve, reject) => pending.push({url, options, resolve, reject}))
  });
  const settle = async (request, items, ok = true, extra = {}) => {
    request.resolve({ok, status:ok ? 200 : 500, json:async () => ({ok, items, total:items.length, complete:true, error:ok ? undefined : 'owner discovery failed', ...extra})});
    await new Promise(resolve => setImmediate(resolve));
  };
  const key = (target, key, extra = {}) => document.listeners.keydown({target, key, preventDefault() {}, ...extra});
  return {nodes, buttons, modeButtons, pending, errors, closed, window, settle, key};
}
const media = (id, kind = 'image') => ({id, fileName:id + '.png', mediaKind:kind, mediaUrl:'/media/' + id, role:'generated', source:'generate', rating:null});

test('unavailable previews keep their card and expose decoder details in the Console', async () => {
  const f = fixture(); f.window.openMediaExplorerActivity();
  await f.settle(f.pending[0], [media('missing'), media('broken', 'video')]);
  f.modeButtons.find(button => button.dataset.explorerMode === 'grid').click();
  const [imageCard, videoCard] = f.nodes['media-explorer-grid'].children;
  imageCard.querySelector('img').emit('error');
  const video = videoCard.querySelector('video');
  video.error = {message: 'Unsupported video codec', code: 4};
  video.emit('error'); video.emit('error');
  assert.equal(f.nodes['media-explorer-grid'].children.length, 2);
  assert.match(imageCard.querySelector('.media-explorer-card-error').textContent, /Preview unavailable/);
  assert.equal(videoCard.querySelectorAll('.media-explorer-card-error').length, 1);
  assert.match(f.errors[0], /missing.png.*\/media\/missing/);
  assert.match(f.errors[1], /Unsupported video codec.*code 4/);
});

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
  f.buttons.find(b => b.dataset.mediaSource === 'test').click();
  assert.match(f.pending[2].url, /source=test/);
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
  f.nodes['media-explorer-compare'].click();
  assert.equal(f.nodes['media-explorer-compare-dialog'].open, true);
  assert.match(f.nodes['media-explorer-compare-dialog'].querySelector('strong').textContent, /2 selected/);
  f.nodes['media-explorer-compare-close'].click();
  f.key(f.nodes['app-frame'], 'a', {ctrlKey:true});
  assert.match(f.nodes['media-explorer-selected-count'].textContent, /^2 selected/, 'outside keyboard focus is untouched');
  f.key(a, 'a', {ctrlKey:true});
  assert.match(f.nodes['media-explorer-selected-count'].textContent, /^3 selected/);
  f.key(a, 'Escape');
  assert.equal(f.nodes['media-explorer-selection'].classList.contains('hidden'), true);
  f.key(a, 'ArrowRight'); assert.equal(b.classList.contains('active'), true);
  f.key(b, 'Enter'); assert.equal(f.nodes['media-explorer-loupe'].open, true);
  f.nodes['media-explorer-close-loupe'].click();
  c.click(); const video = f.nodes['media-explorer-preview-stage'].querySelector('video');
  f.window.closeMediaExplorerActivity(); assert.equal(video.paused, true);
});

test('Explorer filters restore from and serialize into the shell route', async () => {
  const f = fixture('#/media?source=generate&kind=image&q=bird&sort=name&full=1');
  f.window.openMediaExplorerActivity();
  const query = new URL(f.pending[0].url, 'http://localhost').searchParams;
  assert.equal(query.get('source'), 'generate'); assert.equal(query.get('kind'), 'image');
  assert.equal(query.get('search'), 'bird'); assert.equal(query.get('sort'), 'name');
  const route = new URLSearchParams(); f.window.appendMediaExplorerRouteParams(route);
  assert.equal(route.get('q'), 'bird'); assert.equal(route.get('full'), '1');
  await f.settle(f.pending[0], []);
});

test('Prep mutation shortcuts cannot act on hidden working media in Explorer', () => {
  const main = fs.readFileSync('tool/js/main.js', 'utf8');
  const begin = main.indexOf("  document.addEventListener('keydown'", main.indexOf('handleEditorInputAutosave'));
  const end = main.indexOf('  if (ui.advancedFilterToggleBtn', begin);
  const handlers = []; let activity = 'media', renames = 0;
  const context = {
    document: {addEventListener: (key, fn) => handlers.push(fn), activeElement:{}},
    deriveShellNavigationState: () => ({activity}), ui: {editorEl:{}},
    state: {folder:'set', currentItem:{fileName:'working.png'}},
    promptRenameMedia: () => renames++,
    undoLastOperation: () => { throw new Error('must not undo hidden work'); },
    moveSelectedMediaByOffset: () => { throw new Error('must not move hidden selection'); },
    pruneMedia: () => { throw new Error('must not remove hidden media'); }
  };
  vm.runInNewContext(main.slice(begin, end), context);
  assert.equal(handlers.length, 5);
  for (const key of ['F2', 'Delete', 'ArrowDown', 'd', 'r', 'z']) {
    for (const handler of handlers) handler({key, ctrlKey:key === 'z', preventDefault() {}});
  }
  assert.equal(renames, 0);
  activity = 'prep'; handlers[1]({key:'F2', preventDefault() {}});
  assert.equal(renames, 1, 'Prep retains its rename shortcut');
});

test('Generate capability refresh retains the current model draft and settings', () => {
  const source = fs.readFileSync('tool/js/generate.js', 'utf8');
  const controls = Object.fromEntries(['model','prompt','aspect','dimensions','megapixels','duration','seed'].map(id => ['generate-' + id, {value:'draft-' + id}]));
  controls['generate-model'].value = 'model-a';
  const context = {
    el: id => controls[id],
    generateState: {models:[{id:'model-a',label:'A'}], modelId:'model-a'},
    getGenerateModelPreference: () => 'model-a', setGenerateModelPreference() {}, escapeHtml: value => value,
    renderModelForm: () => Object.entries(controls).filter(([id]) => id !== 'generate-model').forEach(([,node]) => node.value = 'default')
  };
  vm.runInNewContext(source.slice(source.indexOf('  function populateModelSelector()'), source.indexOf('  function fieldVisible(')), context);
  context.populateModelSelector();
  assert.equal(controls['generate-prompt'].value, 'draft-prompt');
  assert.equal(controls['generate-seed'].value, 'draft-seed');
  context.generateState.models = [{id:'model-b',label:'B'}];
  context.populateModelSelector();
  assert.equal(controls['generate-prompt'].value, 'default', 'an explicit model change applies that model defaults');
});

test('Set filter routing is separate from the active working Set and framing is explicit', async () => {
  const f = fixture('#/media?folder=working-set&mediaSet=reference-set&kind=image');
  f.window.openMediaExplorerActivity();
  assert.equal(new URL(f.pending[0].url,'http://localhost').searchParams.get('folder'),'reference-set');
  const route = new URLSearchParams({folder:'working-set'});
  f.window.appendMediaExplorerRouteParams(route);
  assert.equal(route.get('folder'),'working-set');
  assert.equal(route.get('mediaSet'),'reference-set');
  await f.settle(f.pending[0],[media('a')]);
  f.nodes['media-explorer-fill'].click();
  assert.equal(f.nodes['media-explorer-grid'].classList.contains('fill'),true);
  f.nodes['media-explorer-fit'].click();
  assert.equal(f.nodes['media-explorer-grid'].classList.contains('fill'),false);
});

test('direct checkboxes, Space, range keys and mixed comparison work without touching active work', async () => {
  const f = fixture(); f.window.openMediaExplorerActivity();
  await f.settle(f.pending[0],[media('a'),media('b','video'),media('c')]);
  const [a,b,c] = f.nodes['media-explorer-grid'].children;
  a.querySelector('.media-explorer-card-check').click({stopPropagation() {}});
  assert.equal(a.querySelector('.media-explorer-card-check').checked,true);
  f.key(b,' ');
  assert.equal(f.nodes['media-explorer-compare'].disabled,false,'mixed images and videos use independent playback');
  f.key(b,'ArrowRight',{shiftKey:true});
  assert.match(f.nodes['media-explorer-selected-count'].textContent,/^3 selected/);
  f.nodes['media-explorer-compare'].click();
  assert.equal(f.nodes['media-explorer-compare-content'].classList.contains('survey'),true);
  assert.match(f.nodes['media-explorer-compare-dialog'].querySelector('strong').textContent,/Survey · 3 selected/);
});

test('historical Generate source navigation is read only and rejects late source responses', async () => {
  const source = fs.readFileSync('tool/js/generate.js','utf8');
  const requests=[]; let shown='';
  const node={classList:{add() {},remove() {}}};
  const context={
    window:{closeMediaExplorerActivity() {},syncApplicationShellContext() {},syncShellLocationRoute() {}},
    generateState:{open:false,navigationVersion:0,director:{},viewMode:'create'},
    el:()=>node,getDirectorModelPreference:()=>'',trackGenerateJob() {},setGenerateViewMode() {},setTakesCollapsed() {},syncCancelQueuedButton() {},
    refreshCapabilities:()=>Promise.resolve(),refreshDirector:()=>Promise.resolve(),refreshTrackedGenerateJobs:()=>Promise.resolve(),refreshResults:()=>Promise.resolve(),
    requestJson:url=>new Promise(resolve=>requests.push({url,resolve})),
    renderActiveResult:result=>shown=result.storageId,
    restoreResultConfiguration:()=>assert.fail('historical navigation must never replace the working draft'),
    reportError:error=>assert.fail(String(error))
  };
  vm.runInNewContext(source.slice(source.indexOf('  function openGenerateActivity('),source.indexOf('  function bindUi()')),context);
  const first=context.openGenerateActivity({storageId:'day/a'});
  await new Promise(resolve=>setImmediate(resolve));
  const second=context.openGenerateActivity({storageId:'day/b'});
  await new Promise(resolve=>setImmediate(resolve));
  requests[1].resolve({result:{storageId:'day/b'}}); await second;
  requests[0].resolve({result:{storageId:'day/a'}}); await first;
  assert.equal(shown,'day/b');
  const third=context.openGenerateActivity({storageId:'day/c'});
  await new Promise(resolve=>setImmediate(resolve));
  context.closeGenerateActivity();
  requests[2].resolve({result:{storageId:'day/c'}}); await third;
  assert.equal(shown,'day/b','leaving the activity cancels late preview navigation');
});

test('source-to-Explorer navigation opens the exact artifact without a filename search', async () => {
  const f=fixture();
  f.window.openMediaExplorerActivity(); await f.settle(f.pending[0],[media('unrelated')]);
  const id='generate:generations/day/old/result.jpg';
  f.window.openMediaExplorerActivity({source:'generate',id});
  const query=new URL(f.pending[1].url,'http://localhost').searchParams;
  assert.equal(query.get('artifact'),id); assert.equal(query.get('full'),'1');
  await f.settle(f.pending[1],[{...media(id),source:'generate',role:'reference',storageId:'day/old'}]);
  assert.equal(f.nodes['media-explorer-inspector-body'].dataset.id,id);
  assert.equal(f.nodes['media-explorer-inspector'].classList.contains('hidden'),false);
  f.nodes['media-explorer-filter-chips'].children[0].click();
  assert.equal(new URL(f.pending[2].url,'http://localhost').searchParams.get('artifact'),'');
});


test('Explorer deletion targets only owner-backed generated artifacts', () => {
  const source = fs.readFileSync('tool/js/media_explorer.js', 'utf8');
  assert.match(source, /item\.source === 'generate' && item\.role === 'generated'/);
  assert.match(source, /operation: 'test_delete_session'/);
  assert.match(source, /operation: 'delete'/);
  assert.match(source, /window\.confirm\(/);
  assert.doesNotMatch(source, /source === 'set'.*Delete/);
});


test('Storyboard provenance preserves exact take identity for owner handoff', () => {
  const backend = fs.readFileSync('tool/server/media_explorer.py', 'utf8');
  const explorer = fs.readFileSync('tool/js/media_explorer.js', 'utf8');
  const storyboard = fs.readFileSync('tool/js/storyboard.js', 'utf8');
  assert.match(backend, /use\["takeId"\] = label/);
  assert.match(explorer, /takeId: use\.takeId \|\| ''/);
  assert.match(storyboard, /Storyboard Take no longer exists in scene/);
  assert.match(storyboard, /\.storyboard-take\[data-take-id\]/);
});


test('External browsing is folder-first, keeps media list in Grid and never auto-writes metadata', async () => {
  const f = fixture(); f.window.openMediaExplorerActivity();
  await f.settle(f.pending[0], []);
  f.buttons.find(b => b.dataset.mediaSource === 'external').click();
  f.nodes['media-explorer-external-path'].value = '/tmp/other-drive';
  f.nodes['media-explorer-open-path'].click();
  const request = f.pending.at(-1);
  const params = new URL(request.url, 'http://localhost').searchParams;
  assert.equal(params.get('directory'), '');
  assert.equal(params.get('recursive'), '0');
  const files = [
    {...media('a'), id:'external:a', fileName:'a.jpg', source:'external', relativePath:'a.jpg'},
    {...media('b'), id:'external:b', fileName:'b.jpg', source:'external', relativePath:'b.jpg'}
  ];
  await f.settle(request, files, true, {folders:['child']});
  assert.equal(f.nodes['media-explorer-folder-rows'].children.length, 1);
  assert.equal(f.nodes['media-explorer-grid'].children.length, 2);
  assert.equal(f.pending.filter(entry => entry.url.includes('/external/metadata')).length, 0,
    'Browsing must not start a writing metadata operation');
  f.modeButtons.find(b => b.dataset.explorerMode === 'grid').click();
  assert.equal(f.nodes['media-explorer-side-list'].children.length, 2,
    'Grid mode retains the selectable left media list');
  assert.equal(f.nodes['media-explorer-grid'].parent, f.nodes['media-explorer-preview-stage'],
    'Grid belongs in the large central pane');
  const row = f.nodes['media-explorer-side-list'].children[1];
  row.querySelector('button').click();
  assert.equal(f.nodes['media-explorer-inspector-body'].dataset.id, 'external:b');
  f.nodes['media-explorer-folder-rows'].children[0].click();
  const folderRequest = f.pending.at(-1);
  assert.equal(new URL(folderRequest.url,'http://localhost').searchParams.get('directory'), 'child');
  await f.settle(folderRequest, [], true, {folders:[]});
  assert.equal(f.nodes['media-explorer-side-list'].children.length, 0);
});

test('External subfolder checkbox broadens scope only when selected', async () => {
  const f = fixture(); f.window.openMediaExplorerActivity();
  await f.settle(f.pending[0], []);
  f.buttons.find(b => b.dataset.mediaSource === 'external').click();
  f.nodes['media-explorer-external-path'].value = '/tmp/other-drive';
  f.nodes['media-explorer-open-path'].click();
  await f.settle(f.pending.at(-1), [], true, {folders:['child']});
  f.nodes['media-explorer-recursive'].checked = true;
  f.nodes['media-explorer-recursive'].emit('change');
  assert.equal(new URL(f.pending.at(-1).url,'http://localhost').searchParams.get('recursive'), '1');
});
