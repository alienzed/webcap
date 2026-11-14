const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../tool/js/studio_blocks.js'), 'utf8');
function extract(start, end) {
  const i = source.indexOf(start), j = source.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i, 'Studio Blocks section not found');
  return source.slice(i, j);
}
const slashMatch = new Function(extract('  function slashMatch(text, caret) {', '  function setupSlash() {') +
  '\nreturn slashMatch;')();
test('slash matching is limited to the current token and caret', () => {
  assert.deepEqual(slashMatch('/al', 3), {start:0,end:3,query:'al'});
  assert.deepEqual(slashMatch('Look at /SUN', 12), {start:8,end:12,query:'sun'});
  assert.equal(slashMatch('https://example.com',19), null);
  assert.equal(slashMatch('a/b',3), null);
  assert.equal(slashMatch('hello /one two',14),null);
  assert.equal(slashMatch('/block and more',15),null);
});
function node() {
  const listeners = {};
  const n = {
    value:'', selectionStart:0, selectionEnd:0, children:[],attrs:{},
    className:'',classList:{
      items:new Set(['hidden']),
      remove(v){this.items.delete(v);},add(v){this.items.add(v);},
      contains(v){return this.items.has(v);}
    },
    setAttribute(k,v){this.attrs[k]=v;},
    append(...items){this.children.push(...items);},
    appendChild(item){this.children.push(item);return item;},
    replaceChildren(){this.children=[];},
    addEventListener(name,fn,capture){(listeners[name] ||= []).push({fn,capture:!!capture});},
    dispatchEvent(e){
      (listeners[e.type]||[]).slice().sort((a,b)=>Number(b.capture)-Number(a.capture)).forEach(l=>l.fn(e));
    },
    focus(){},
    setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;},
  };
  return n;
}
function setup(blocks, isStudio) {
  const input=node(), host=node(), calls=[];
  const nodes={'director-chat-input':input,'studio-blocks-slash':host};
  const ctx = new Function('el','api','document','window','Event','report',
    extract('  function slashMatch(text, caret) {', '  function bind() {')+'\nreturn setupSlash;')(
    id=>nodes[id],
    async ()=>{calls.push('load');return {blocks};},
    {createElement:()=>node()},
    {studioDirectorBridge:{isStudioMode:isStudio}},
    class Event{constructor(type){this.type=type;}},
    error=>{throw error;}
  );
  ctx();
  return {input,host,calls};
}
function tick(){return new Promise(resolve=>setImmediate(resolve));}
test('type / to search, Enter inserts exact Block text and retains surrounding draft', async()=>{
  const {input,host,calls}=setup([
    {title:'Early hook',type:'idea',content:'A striking opening moment.'},
    {title:'H3 rhythm',type:'guidance',content:'Each beat has a clear physical action.'}
  ],()=>true);
  input.value='Before /hook after';input.setSelectionRange(12,12);
  input.dispatchEvent({type:'input'});
  await tick();
  assert.deepEqual(calls,['load']);
  assert.equal(host.children.length,1);
  assert.equal(host.children[0].children[0].textContent,'Early hook');
  let stopped=false;
  input.dispatchEvent({type:'keydown',key:'Enter',preventDefault(){},stopImmediatePropagation(){stopped=true;}});
  assert.equal(stopped,true);
  assert.equal(input.value,'Before A striking opening moment. after');
  assert.equal(host.classList.contains('hidden'),true);
  assert.equal(input.attrs['aria-expanded'],'false');
});
test('slash never fetches Blocks in ordinary Chat mode',async()=>{
  const {input,calls}=setup([{title:'A',type:'idea',content:'Words'}],()=>false);
  input.value='/a';input.setSelectionRange(2,2);
  input.dispatchEvent({type:'input'});
  await tick();
  assert.deepEqual(calls,[]);
});

test('Blocks belongs to the Projects pane; Director belongs to Project actions', () => {
  const html = fs.readFileSync(path.join(__dirname, '../tool/tool.html'), 'utf8');
  const scenes = html.split('class="storyboard-scenes-heading-actions"')[1].split('</div>')[0];
  const footer = html.split('class="storyboard-library-footer"')[1].split('</footer>')[0];
  const project = html.split('class="storyboard-story-heading-actions"')[1].split('</div>')[0];
  assert.match(footer, /id="studio-blocks-open"/);
  assert.match(project, /id="storyboard-open-director"/);
  assert.doesNotMatch(scenes, /studio-blocks-open|storyboard-open-director/);
  assert.equal((html.match(/id="studio-blocks-open"/g) || []).length, 1);
  assert.match(html, /id="storyboard-director-tools-btn"[^>]*>Revise &amp; Generate/);
});

test('Project Overview independently scrolls on desktop, stacked layout stays shared', () => {
  const css = fs.readFileSync(path.join(__dirname, '../tool/css/storyboard.css'), 'utf8');
  const desktop = css.split('.storyboard-editor-scroll {\n  display: grid;')[1].split('}', 1)[0];
  assert.match(desktop, /grid-template-rows: minmax\(0, 1fr\)/);
  const overview = css.split('.storyboard-story-overview-surface {')[1].split('}', 1)[0];
  assert.match(overview, /min-height: 0/);
  assert.match(overview, /overflow-y: auto/);
  const stacked = css.split('@media (max-width: 1180px) {\n  .storyboard-editor-scroll,')[1].split('}', 1)[0];
  assert.match(stacked, /grid-template-rows: auto/);
  assert.match(stacked, /overflow: auto/);
});
