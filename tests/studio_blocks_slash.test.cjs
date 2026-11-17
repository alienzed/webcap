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
// Slash listens on document, including for dynamically added Invariant editors.
// The fixture models bubbled input and captured keydown rather than attaching
// listeners to the composer itself, as the old implementation did.
function node(bubble, invariant=false) {
  const n={
    id:'',value:'',selectionStart:0,selectionEnd:0,children:[],attrs:{},style:{},
    className:'',classList:{
      items:new Set(['hidden']),
      remove(v){this.items.delete(v);},add(v){this.items.add(v);},
      contains(v){return this.items.has(v);}
    },
    matches(selector){return invariant && selector==='[data-story-invariant-text]';},
    closest(){return null;},
    getBoundingClientRect(){return {left:20,top:24,right:420,bottom:60,width:400,height:36};},
    setAttribute(k,v){this.attrs[k]=v;},
    append(...items){this.children.push(...items);},
    appendChild(item){this.children.push(item);return item;},
    replaceChildren(){this.children=[];},
    focus(){},
    setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;},
    dispatchEvent(event){event.target ||= n;bubble(event);return true;}
  };
  return n;
}
function setup(blocks,isStudio,{invariants=[]}={}) {
  const listeners={},calls=[];
  function dispatch(event){
    (listeners[event.type]||[]).slice()
      .sort((a,b)=>Number(b.capture)-Number(a.capture))
      .forEach(item=>item.fn(event));
  }
  const input=node(dispatch),host=node(dispatch),invariantInput=node(dispatch,true);
  host.id='studio-blocks-slash';
  const elements={'director-chat-input':input,'studio-blocks-slash':host};
  const document={
    body:node(dispatch),
    createElement:()=>node(dispatch),
    addEventListener(type,fn,capture){
      (listeners[type] ||= []).push({fn,capture:!!capture});
    }
  };
  const window={
    studioDirectorBridge:{isStudioMode:isStudio},
    getStoryboardSlashInvariants:()=>invariants,
    addEventListener(){},
    innerWidth:1440,innerHeight:900
  };
  const setupSlash=new Function('el','api','document','window','Event','report',
    extract('  function slashMatch(text, caret) {', '  function bind() {')+
    '\nreturn setupSlash;')(
    id=>elements[id],
    async()=>{calls.push('load');return {blocks};},
    document,window,
    class Event{constructor(type,options={}){this.type=type;this.bubbles=options.bubbles;}},
    error=>{throw error;}
  );
  setupSlash();
  return {input,host,invariantInput,invariantHost:document.body.children[0],calls,invariants};
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


test('Studio chat slash also inserts an approved local Invariant as ordinary text',async()=>{
  const invariant={title:'North Window',kind:'location',text:'The north window glows blue.'};
  const {input,host,calls}=setup(
    [{title:'Unrelated Block',type:'idea',content:'No match here.'}],()=>true,
    {invariants:[invariant]});
  input.value='Keep /north';input.setSelectionRange(11,11);
  input.dispatchEvent({type:'input'});
  await tick();
  assert.deepEqual(calls,['load']);
  assert.equal(host.children.length,1);
  assert.equal(host.children[0].children[0].textContent,'North Window');
  let stopped=false;
  input.dispatchEvent({type:'keydown',key:'Tab',preventDefault(){},
    stopImmediatePropagation(){stopped=true;}});
  assert.equal(stopped,true);
  assert.equal(input.value,'Keep The north window glows blue. ');
  assert.equal(invariant.text,'The north window glows blue.',
    'slash insertion never edits the source Invariant');
});

test('Invariant textareas use the same Block picker without enabling Director chat',async()=>{
  const {invariantInput,invariantHost,calls}=setup(
    [{title:'Continuity',type:'guidance',content:'Keep the copper hairpin visible.'}],
    ()=>false);
  invariantInput.value='Rule: /cont';
  invariantInput.setSelectionRange(invariantInput.value.length,invariantInput.value.length);
  invariantInput.dispatchEvent({type:'input'});
  await tick();
  assert.deepEqual(calls,['load']);
  assert.equal(invariantHost.children.length,1);
  assert.equal(invariantHost.children[0].children[0].textContent,'Continuity');
  assert.equal(invariantInput.attrs['aria-controls'],'studio-blocks-invariant-slash');
  let stopped=false;
  invariantInput.dispatchEvent({type:'keydown',key:'Enter',preventDefault(){},
    stopImmediatePropagation(){stopped=true;}});
  assert.equal(stopped,true);
  assert.equal(invariantInput.value,'Rule: Keep the copper hairpin visible. ');
  assert.equal(invariantHost.classList.contains('hidden'),true);
});

test('Escape dismisses slash suggestions without changing the authored draft',async()=>{
  const {input,host}=setup([{title:'Opening',type:'idea',content:'A new opening.'}],()=>true);
  input.value='Keep /open';input.setSelectionRange(input.value.length,input.value.length);
  input.dispatchEvent({type:'input'});
  await tick();
  assert.equal(host.classList.contains('hidden'),false);
  let stopped=false;
  input.dispatchEvent({type:'keydown',key:'Escape',preventDefault(){},
    stopImmediatePropagation(){stopped=true;}});
  assert.equal(stopped,true);
  assert.equal(input.value,'Keep /open');
  assert.equal(host.classList.contains('hidden'),true);
  assert.equal(input.attrs['aria-expanded'],'false');
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
  assert.match(html, /id="storyboard-project-tool-bar"[^>]*role="group" aria-label="Project Tools"/);
  assert.match(html, /id="storyboard-director-tools-btn"[^>]*aria-label="Scene Revision"/);
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
