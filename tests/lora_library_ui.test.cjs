const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync('tool/tool.html','utf8'), source=fs.readFileSync('tool/js/lora_library_ui.js','utf8');
const start=html.indexOf('<div id="lora-library-modal"'), end=html.indexOf('<div id="app-settings-modal"',start);
assert.ok(start>0&&end>start);
const fixture=html.slice(start,end);
const clone=x=>JSON.parse(JSON.stringify(x));
const wait=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
  const dom=new JSDOM('<button id="opener">Settings</button><button id="generate-lora-library-open">Profiles</button>'+fixture,{url:'http://localhost/',runScripts:'outside-only'});
  const w=dom.window,d=w.document,errors=[],confirmations=[],calls=[];
  const rows=[
    {stage:'h3',path:'People/a.safetensors',name:'People/a.safetensors',enriched:true,enrichment:{description:'Portrait features',trainedWords:['face'],promptOptions:{View:['side']},guidance:''}},
    {stage:'h3',path:'People/b.safetensors',name:'People/b.safetensors',enriched:false,enrichment:null},
    {stage:'krea2',path:'Cloth/c.safetensors',name:'Cloth/c.safetensors',enriched:false,enrichment:null}
  ];
  const saved=new Map(rows.map(r=>[r.stage+'/'+r.path,clone(r.enrichment||{})]));
  let saveGate=null;
  const response=obj=>({ok:true,json:async()=>({ok:true,...clone(obj)})});
  w.reportConsoleError=(scope,message)=>errors.push(String(message));
  w.reportConsoleWarning=()=>{};
  w.confirm=message=>{confirmations.push(message);return true};
  w.fetch=async(url,options)=>{
    assert.equal(url,'/fs/lora_library');
    if(options.method==='GET')return response({items:rows,warnings:[]});
    const request=JSON.parse(options.body),key=request.stage+'/'+request.path;calls.push(request);
    if(!Object.hasOwn(request,'enrichment'))return response({modelProfile:{enrichment:saved.get(key)}});
    if(saveGate)await saveGate;
    saved.set(key,clone(request.enrichment));
    const item=rows.find(x=>x.stage+'/'+x.path===key);
    item.enriched=Object.keys(request.enrichment).length>0;
    item.enrichment=clone(request.enrichment);
    return response({modelProfile:{enrichment:request.enrichment}});
  };
  w.eval(source);
  const el=id=>d.getElementById('lora-library-'+id);
  return{w,d,el,errors,confirmations,calls,rows,saved,close:()=>dom.window.close(),
    open:async target=>{await w.openLoraLibrary(target);await wait()},
    click:async node=>{node.click();await wait()},gate:value=>{saveGate=value}};
}
test('real enrichment coverage and next unprofiled',async t=>{
  const h=setup();t.after(h.close);await h.open();
  assert.equal(h.el('progress-count').textContent,'1 / 3');
  assert.equal(h.el('progress-bar').value,1);
  await h.click(h.el('next'));
  assert.equal(h.el('profile-heading').textContent,'b');
  assert.equal(h.errors.length,0);
});
test('new blank group remains editable, and phrase saves through existing endpoint',async t=>{
  const h=setup();t.after(h.close);await h.open({stage:'h3',name:'People/a.safetensors'});
  await h.click(h.el('add-group'));
  const g=h.el('groups').lastElementChild, name=g.querySelector('.lora-library-group-name');
  assert.equal(h.el('save').disabled,true);
  name.value='Colour';name.dispatchEvent(new h.w.Event('input',{bubbles:true}));
  await h.click(g.querySelector('button'));
  const input=g.querySelector('.lora-library-phrase');
  input.value='bright blue';input.dispatchEvent(new h.w.Event('input',{bubbles:true}));
  assert.equal(h.el('save').disabled,false);
  await h.click(h.el('save'));
  assert.equal(h.calls.at(-1).enrichment.promptOptions.Colour[0],'bright blue');
  assert.equal(h.el('save-state').textContent,'Saved');
  assert.equal(h.errors.length,0);
});
test('confirmed refresh discards dirty editor and preserves keyed row',async t=>{
  const h=setup();t.after(h.close);await h.open({stage:'h3',name:'People/a.safetensors'});
  const row=h.d.querySelector('.lora-library-item.selected');
  h.el('description').value='UNSAVED';
  h.el('description').dispatchEvent(new h.w.Event('input',{bubbles:true}));
  await h.click(h.el('refresh'));
  assert.equal(h.el('description').value,'Portrait features');
  assert.equal(h.d.querySelector('.lora-library-item.selected'),row);
  assert.ok(h.confirmations.some(s=>s.includes('Discard')));
  assert.equal(h.errors.length,0);
});
test('direct link clears stale filters and reveals selected profile',async t=>{
  const h=setup();t.after(h.close);await h.open();
  h.el('search').value='no-such-model';
  h.el('search').dispatchEvent(new h.w.Event('input'));
  await h.open({stage:'h3',name:'People/b.safetensors'});
  assert.equal(h.el('search').value,'');
  assert.equal(h.el('profile-heading').textContent,'b');
  assert.equal(h.d.querySelectorAll('.lora-library-item.selected').length,1);
});
test('saving blocks navigation and close; progress updates from saved result',async t=>{
  const h=setup();t.after(h.close);await h.open({stage:'h3',name:'People/b.safetensors'});
  h.el('description').value='New portrait';
  h.el('description').dispatchEvent(new h.w.Event('input',{bubbles:true}));
  let release;const pending=new Promise(r=>release=r);h.gate(pending);
  h.el('save').click();await wait();
  h.d.querySelector('.lora-library-item').click();
  h.el('close').click();
  assert.equal(h.el('modal').classList.contains('hidden'),false);
  assert.equal(h.el('profile-heading').textContent,'b');
  release();await wait();await wait();
  assert.equal(h.el('progress-count').textContent,'2 / 2');
  assert.equal(h.el('save-state').textContent,'Saved');
  assert.equal(h.errors.length,0);
});
test('invalid advanced JSON is retained until user explicitly discards',async t=>{
  const h=setup();t.after(h.close);await h.open({stage:'h3',name:'People/a.safetensors'});
  h.el('json-edit').click();
  h.el('options').value='{bad';
  h.el('options').dispatchEvent(new h.w.Event('input',{bubbles:true}));
  assert.equal(h.el('save').disabled,true);
  await h.click(h.el('editor-close'));
  assert.equal(h.el('editor').classList.contains('hidden'),true);
  assert.ok(h.confirmations.length);
  assert.equal(h.errors.length,0);
});
test('closing restores focus and discarded editing does not reappear',async t=>{
  const h=setup();t.after(h.close);h.d.getElementById('opener').focus();
  await h.open({stage:'h3',name:'People/a.safetensors'});
  h.el('description').value='UNSAVED';
  h.el('description').dispatchEvent(new h.w.Event('input',{bubbles:true}));
  await h.click(h.el('close'));
  assert.equal(h.d.activeElement.id,'opener');
  await h.open({stage:'h3',name:'People/a.safetensors'});
  assert.equal(h.el('description').value,'Portrait features');
});
