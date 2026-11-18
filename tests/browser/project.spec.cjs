'use strict';
const {test,expect}=require('./test.cjs');
const {openDirector,say,runWrite,resetModel,queueModel,observedModels,stories,story}=require('./helpers.cjs');

test('Flow 1 — explicit Write creates a Project directly and persists its actual fields',async({page,request})=>{
  await resetModel(request);
  const name='Acceptance Bookshop '+Date.now();
  const concept='A bookseller welcomes a visitor into an old bookshop.';
  const style='Amber windows, blue rain outside.';
  await openDirector(page);
  await queueModel(request,'The red-scarfed bookseller would be a memorable anchor.');
  await say(page,'Develop a rainy bookshop with a red-scarfed bookseller.');
  await expect.poll(async()=> (await observedModels(request)).calls.length).toBe(1);
  await queueModel(request,{title:name,concept,style,
    invariants:[{kind:'character',title:'Bookseller',text:'The bookseller wears a red scarf.'}]});
  await runWrite(page,{operation:'new-project',instruction:'Create the rainy bookshop Project.'});
  await expect.poll(async()=> (await stories(page)).some(item=>item.title===name)).toBeTruthy();
  const saved=(await stories(page)).find(item=>item.title===name);
  const actual=await story(page,saved.id);
  expect(actual.title).toBe(name);
  expect(actual.concept).toBe(concept);
  expect(actual.style).toBe(style);
  expect(actual.invariants).toEqual(expect.arrayContaining([
    expect.objectContaining({kind:'character',title:'Bookseller',text:'The bookseller wears a red scarf.'})
  ]));
  expect(actual.sceneOrder).toHaveLength(0);
  const calls=(await observedModels(request)).calls;
  expect(calls).toHaveLength(2);
  expect(JSON.stringify(calls[1].messages)).toContain('Develop a rainy bookshop');
  expect(JSON.stringify(calls[1].messages)).not.toContain('H3 PROMPT AUTHORING REFERENCE');
  await expect(page.locator('#studio-project-review')).not.toBeVisible();
  await page.reload();
  expect((await story(page,saved.id)).concept).toBe(concept);
});

test('Flow 1 — chat with Project-like fields is inert until explicit Project Write',async({page,request})=>{
  await resetModel(request);
  const name='Explicit only '+Date.now();
  await openDirector(page);
  await queueModel(request,{changes:{project:{
    title:name,concept:'A swaying lantern.',style:'Violet moonlight.'
  }}});
  await say(page,'Imagine a lantern Project without saving it.');
  await expect.poll(async()=> (await observedModels(request)).calls.length).toBe(1);
  expect((await stories(page)).some(item=>item.title===name)).toBe(false);
  await expect(page.locator('#studio-dw-suggestions .studio-dw-suggestion-action')).toHaveCount(0);
  await queueModel(request,{title:name,concept:'A lantern sways outside the bookshop.',
    style:'Soft violet moonlight.',invariants:[]});
  await runWrite(page,{operation:'new-project'});
  await expect.poll(async()=> (await stories(page)).some(item=>item.title===name)).toBe(true);
  const saved=(await stories(page)).find(item=>item.title===name);
  expect((await story(page,saved.id)).concept).toBe('A lantern sways outside the bookshop.');
  expect((await observedModels(request)).calls).toHaveLength(2);
});


test('Flow 1 partial Create — Concept can be empty when useful Style and Invariants are returned',async({page,request})=>{
  await resetModel(request);
  const prior=(await stories(page)).map(item=>item.id);
  await openDirector(page);
  await queueModel(request,{concept:'',style:'A storm of blue light.',invariants:[
    {kind:'sound',title:'',text:'Low distant thunder'},
    {text:'The bird has a copper beak.'}
  ]});
  await runWrite(page,{operation:'new-project',instruction:'Create the atmosphere-first Project.'});
  await expect.poll(async()=>{
    const current=await stories(page);
    return current.filter(item=>!prior.includes(item.id)).length;
  }).toBe(1);
  const created=(await stories(page)).find(item=>!prior.includes(item.id));
  const saved=await story(page,created.id);
  expect(saved.concept).toBe('');
  expect(saved.style).toBe('A storm of blue light.');
  expect(saved.invariants).toEqual([
    {kind:'sound',title:'',text:'Low distant thunder'},
    {kind:'custom',title:'',text:'The bird has a copper beak.'}
  ]);
  expect(saved.sceneOrder).toHaveLength(0);
  expect((await observedModels(request)).calls).toHaveLength(1);
  await expect(page.locator('#studio-project-review')).not.toBeVisible();
});
