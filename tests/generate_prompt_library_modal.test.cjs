'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const script = fs.readFileSync('tool/js/generate.js', 'utf8');
const html = fs.readFileSync('tool/tool.html', 'utf8');
const start = script.indexOf('  function promptLibraryItem(');
const end = script.indexOf('  function runGenerate(', start);
assert.ok(start >= 0 && end > start, 'Prompt Library functions remain identifiable');

function fixture(saved = []) {
  const attrs = {}, classes = new Set();
  const nodes = {};
  function node() {
    return {
      value:'', textContent:'', innerHTML:'', disabled:false,
      attrs:{}, focusCount:0,
      classList:{add(name){classes.add(name);},remove(name){classes.delete(name);},
        toggle(name,yes){if(yes)classes.add(name);else classes.delete(name);}},
      setAttribute(name,value){this.attrs[name]=value;},
      focus(){this.focusCount++;}
    };
  }
  for (const id of [
    'generate-prompt-library', 'generate-prompt-library-open',
    'generate-prompt-library-list','generate-prompt-library-preview-title',
    'generate-prompt-library-preview-content','generate-prompt-library-preview-use',
    'generate-prompt-library-search','generate-prompt','generate-prompt-editor'
  ]) nodes[id] = node();
  const dialog = nodes['generate-prompt-library'];
  dialog.open = false;
  dialog.showModal = function(){this.open = true;};
  dialog.close = function(){this.open = false;};
  const state = {
    promptLibrary:{items:[],open:false,activeId:'',selectedId:'',query:''},
    director:{previousPrompt:'keep'}
  };
  const list = nodes['generate-prompt-library-list'];
  list.querySelectorAll = () => state.promptLibrary.items.map(item => ({
    dataset:{generatePromptPreview:item.id},
    attrs:{},
    setAttribute(key,value){this.attrs[key]=value;},
    closest(){return {classList:{toggle(){}}};}
  }));
  let editorEditCount = 0, requestCount=0;
  let records = saved.slice();
  const context = {
    Promise, generateState:state, el:id=>nodes[id],
    text:(node,value)=>{node.textContent=String(value);},
    requestJson:async url=>{
      assert.equal(url,'/fs/generate/prompts'); requestCount++;
      return {prompts:records};
    },
    escapeHtml:value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
    syncPromptAssistantDependencies(){},
    reportError(err){throw err;},
    setDirectorStatus(){},
    noteGenerateEditorEdit(){editorEditCount++;return true;},
    postJson:async(url,data)=>{
      if(url==='/fs/generate/prompt/delete') records=records.filter(item=>item.id!==data.id);
      return {};
    },
    window:{prompt:()=>'',confirm:()=>true}
  };
  const body = script.slice(start,end);
  const api = vm.runInNewContext('(function(){'+body+
    ';return {setPromptLibraryOpen,selectPromptLibraryItem,renderPromptLibrary,'+
    'usePromptLibraryItem,deletePromptLibraryItem};})()',context);
  return {api,nodes,state,requestCount:()=>requestCount,edits:()=>editorEditCount};
}

test('Prompt Library opens as a dialog and only applies text on explicit Use Prompt',async()=>{
  assert.match(html,/<dialog id="generate-prompt-library"/);
  assert.match(html,/id="generate-prompt-library-preview-use"[^>]*disabled/);
  assert.doesNotMatch(script,/editor\.classList\.toggle\('hidden',\s*generateState\.promptLibrary\.open\)/);
  const content='Subject:\nThe city at night.\n\n[Shot 1] A slow pan.';
  const f=fixture([{id:'one',name:'City',prompt:content}]);
  f.nodes['generate-prompt'].value='Current unsaved work';
  await f.api.setPromptLibraryOpen(true);
  assert.equal(f.nodes['generate-prompt-library'].open,true);
  assert.equal(f.nodes['generate-prompt'].value,'Current unsaved work');
  assert.equal(f.nodes['generate-prompt-library-preview-use'].disabled,true);
  f.api.selectPromptLibraryItem('one');
  assert.equal(f.nodes['generate-prompt-library-preview-title'].textContent,'City');
  assert.equal(f.nodes['generate-prompt-library-preview-content'].textContent,content);
  assert.equal(f.nodes['generate-prompt'].value,'Current unsaved work');
  f.api.usePromptLibraryItem('one');
  assert.equal(f.nodes['generate-prompt'].value,content);
  assert.equal(f.nodes['generate-prompt-library'].open,false);
  assert.equal(f.state.promptLibrary.activeId,'one');
  assert.equal(f.edits(),1);
});

test('Searching previews is case-insensitive; no match clears selection without changing the editor',async()=>{
  const f=fixture([
    {id:'a',name:'Morning',prompt:'A warm sunrise over a mountain.'},
    {id:'b',name:'Noir',prompt:'Night streets under rain.'}
  ]);
  f.nodes['generate-prompt'].value='Draft';
  await f.api.setPromptLibraryOpen(true);
  f.api.selectPromptLibraryItem('a');
  f.state.promptLibrary.query='RAIN';
  f.api.renderPromptLibrary();
  assert.equal(f.state.promptLibrary.selectedId,'');
  assert.equal(f.nodes['generate-prompt-library-preview-use'].disabled,true);
  assert.match(f.nodes['generate-prompt-library-list'].innerHTML,/Noir/);
  assert.doesNotMatch(f.nodes['generate-prompt-library-list'].innerHTML,/Morning/);
  assert.equal(f.nodes['generate-prompt'].value,'Draft');
  await f.api.setPromptLibraryOpen(false);
  assert.equal(f.nodes['generate-prompt-library'].open,false);
  assert.equal(f.nodes['generate-prompt'].value,'Draft');
});
