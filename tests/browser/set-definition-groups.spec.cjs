'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {test,expect}=require('./test.cjs');

test('Set Definition renders group-only intent and persists a scoped change in the real app', async({page},testInfo)=>{
  const temp=fs.readFileSync(path.resolve(__dirname,'../../test-results/studio-temp-root.txt'),'utf8').trim();
  const folder='Set Variable Acceptance';
  const root=path.join(temp,'sets',folder);
  fs.mkdirSync(root,{recursive:true});
  fs.writeFileSync(path.join(root,'example.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAALUlEQVR4nGN0TKlloCVgoqnpoxaMWjBqwagFoxaMWjBqwagFoxaMWjBqARUBAErBAWK46tBKAAAAAElFTkSuQmCC','base64'));
  fs.writeFileSync(path.join(root,'example.txt'),'subject, front');
  const shape={group:'Shape',terms:['triangle'],exclusive:false};
  const view={group:'Viewpoint',terms:['front'],exclusive:true,expected:true};
  fs.writeFileSync(path.join(root,'.webcap_state.json'),JSON.stringify({
    set_training_focus:'Subject geometry',
    stats:{requiredPhrase:'subject',phrases:'legacy phrase'},
    set_variables:[shape,view,{group:'',terms:['legacy phrase'],exclusive:false,expected:false}],
    caption_requirements:['Viewpoint','Shape','Lighting'],
    caption_requirement_keywords:{Viewpoint:'front, rear',Shape:'triangle, round',Lighting:'bright, dim'}
  }));
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/');
  await page.waitForFunction(()=>state.dirStack&&state.dirStack.length&&state.folderStateWritable);
  await page.evaluate(folder=>setApplicationSetContext(folder),folder);
  await page.waitForFunction(folder=>state.folder===folder&&state.folderStateWritable&&state.items.length===1,folder);
  await page.evaluate(()=>window.openSetDashboard());
  const definition=page.locator('#set-dashboard-definition');
  await expect(definition).toBeVisible();
  if(!await definition.evaluate(node=>node.open)) await definition.locator(':scope > summary').click();
  const list=page.locator('#set-dashboard-group-list');
  await expect(list.locator('.checklist-row-block')).toHaveCount(3);
  await expect(list).not.toContainText('legacy phrase');
  await expect(page.locator('#set-dashboard-variable-editor')).toHaveCount(0);
  const row=list.locator('.checklist-row-block').filter({hasText:'Viewpoint'});
  await expect(row).toContainText('1 selected');
  await row.locator('.checklist-row-toggle-btn').click();
  const edit=row.locator('.checklist-definition-terms');
  await expect(edit).toBeVisible();
  await expect(edit.getByRole('checkbox',{name:'front',exact:true})).toBeChecked();
  await expect(edit.getByRole('button',{name:'Apply',exact:true})).toHaveCount(0);
  await expect(edit.getByRole('button',{name:'Reset',exact:true})).toBeVisible();
  await expect(edit.getByRole('button',{name:'Edit terms',exact:true})).toHaveCount(0);
  await expect(edit.getByRole('checkbox',{name:'Expected on most media'})).toHaveCount(0);
  const waitForVariableSave=predicate=>page.waitForResponse(response=>
    response.url().endsWith('/fs/folder_state/save')&&response.request().method()==='POST'&&
    predicate(response.request().postDataJSON()?.state?.set_variables||[]));
  const saveRear=waitForVariableSave(rows=>rows.some(variable=>variable.group==='Viewpoint'&&variable.terms.includes('rear')));
  await edit.getByRole('checkbox',{name:'rear',exact:true}).check();
  expect((await saveRear).ok()).toBeTruthy();
  await expect(row).toContainText('2 selected');
  // Opening another group preserves the immediate change.
  await list.locator('.checklist-row-block').filter({hasText:'Lighting'}).locator('.checklist-row-toggle-btn').click();
  await expect(edit.getByRole('checkbox',{name:'rear',exact:true})).toBeChecked();
  const reset=waitForVariableSave(rows=>!rows.some(variable=>variable.group==='Viewpoint'));
  await edit.getByRole('button',{name:'Reset',exact:true}).click();
  expect((await reset).ok()).toBeTruthy();
  await expect(row).toContainText('Vocabulary only');
  await expect(edit.getByRole('checkbox',{name:'front',exact:true})).not.toBeChecked();
  await expect(edit.getByRole('checkbox',{name:'rear',exact:true})).not.toBeChecked();
  expect(JSON.parse(fs.readFileSync(path.join(root,'.webcap_state.json'),'utf8')).set_variables).toEqual([shape]);
  const reselect=waitForVariableSave(rows=>rows.some(variable=>variable.group==='Viewpoint'&&variable.terms.includes('rear')));
  await edit.getByRole('checkbox',{name:'rear',exact:true}).check();
  expect((await reselect).ok()).toBeTruthy();
  const exclusive=waitForVariableSave(rows=>rows.some(variable=>variable.group==='Viewpoint'&&variable.exclusive));
  await edit.getByRole('checkbox',{name:'Mutually exclusive'}).check();
  expect((await exclusive).ok()).toBeTruthy();
  const saved=JSON.parse(fs.readFileSync(path.join(root,'.webcap_state.json'),'utf8'));
  expect(saved.set_variables).toEqual([shape,{group:'Viewpoint',terms:['rear'],exclusive:true}]);
  expect(saved.stats).not.toHaveProperty('phrases');
  const intelligence=page.locator('#set-scan-modal');
  const intelligencePanel=page.locator('.set-dashboard-intelligence-panel');
  const groupsPanel=page.locator('#set-dashboard-groups-panel');
  const template=page.locator('#set-dashboard-template-draft');
  await expect(template).toBeVisible();
  const savedTemplate=await template.inputValue();
  await template.fill('subject, {viewpoint}, ');
  await template.evaluate(node=>node.setSelectionRange(node.value.length,node.value.length));
  const placeholders=page.locator('#set-dashboard-template-placeholders');
  await expect(placeholders.getByRole('button',{name:'Viewpoint',exact:true})).toHaveCount(0);
  await placeholders.getByRole('button',{name:'Lighting',exact:true}).click();
  await expect(template).toHaveValue('subject, {viewpoint}, {lighting}');
  await expect(placeholders.getByRole('button',{name:'Lighting',exact:true})).toHaveCount(0);
  await expect(intelligencePanel.locator('#set-intelligence-primary-btn')).toBeVisible();
  await expect(intelligencePanel.locator('#set-dashboard-tags-guided')).toBeVisible();
  await expect(intelligencePanel.locator('#set-dashboard-tags-primary')).toBeVisible();
  await definition.locator(':scope > summary').click();
  await expect(groupsPanel).toBeHidden();
  await expect(intelligencePanel).toBeHidden();
  await expect(intelligence).toBeHidden();
  await expect(page.locator('#set-dashboard-balance-section')).toBeVisible();
  await definition.locator(':scope > summary').click();
  await expect(groupsPanel).toBeVisible();
  await expect(intelligence).toBeVisible();
  await expect(definition.locator('.set-dashboard-intelligence-panel')).toHaveCount(1);
  await expect(template).toHaveValue('subject, {viewpoint}, {lighting}');
  await page.locator('#set-dashboard-template-reset').click();
  await expect(template).toHaveValue(savedTemplate);
  for(const width of [1920,1440,1100]) {
    await page.setViewportSize({width,height:1000});
    await expect(list).toBeVisible();
    const geometry=await page.locator('#set-dashboard-analyze').evaluate(grid=>{
      const def=grid.querySelector('#set-dashboard-definition').getBoundingClientRect();
      const groups=grid.querySelector('#set-dashboard-groups-panel').getBoundingClientRect();
      const intel=grid.querySelector('.set-dashboard-intelligence-panel').getBoundingClientRect();
      const intent=grid.querySelector('.set-dashboard-intent-panel').getBoundingClientRect();
      const balance=grid.querySelector('#set-dashboard-balance-section').getBoundingClientRect();
      const list=grid.querySelector('#set-dashboard-group-list');
      const rect=grid.getBoundingClientRect();
      return {width:rect.width,overflow:grid.scrollWidth-grid.clientWidth,listOverflow:list.scrollWidth-list.clientWidth,listHeight:getComputedStyle(list).maxHeight,
        defX:def.x,defY:def.y,defRight:def.right,defBottom:def.bottom,defWidth:def.width,
        groupX:groups.x,groupY:groups.y,groupBottom:groups.bottom,groupWidth:groups.width,
        intelX:intel.x,intelY:intel.y,intelBottom:intel.bottom,intelWidth:intel.width,
        intentX:intent.x,intentBottom:intent.bottom,intentWidth:intent.width,
        balanceX:balance.x,balanceY:balance.y,balanceWidth:balance.width};
    });
    expect(geometry.overflow).toBeLessThanOrEqual(2);
    expect(geometry.listOverflow).toBeLessThanOrEqual(2);
    expect(geometry.listHeight).toBe('none');
    expect(Math.abs(geometry.intelX-geometry.intentX)).toBeLessThanOrEqual(2);
    expect(Math.abs(geometry.intelWidth-geometry.intentWidth)).toBeLessThanOrEqual(2);
    expect(geometry.intelY).toBeGreaterThanOrEqual(geometry.intentBottom);
    expect(geometry.intelBottom).toBeLessThanOrEqual(geometry.defBottom);
    expect(Math.abs(geometry.balanceWidth-geometry.width)).toBeLessThanOrEqual(2);
    expect(geometry.balanceY).toBeGreaterThanOrEqual(Math.max(geometry.groupBottom,geometry.defBottom));
    if(width>=1440 || geometry.width>=860) {
      expect(geometry.groupX).toBeGreaterThan(geometry.defRight);
      expect(Math.abs(geometry.groupY-geometry.defY)).toBeLessThanOrEqual(2);
      expect(Math.abs(geometry.groupWidth-geometry.defWidth)).toBeLessThanOrEqual(2);
    } else {
      expect(Math.abs(geometry.groupX-geometry.defX)).toBeLessThanOrEqual(2);
      expect(geometry.groupY).toBeGreaterThanOrEqual(geometry.defBottom);
    }
    await page.locator('#set-dashboard-modal').evaluate(node=>{node.scrollTop=0;});
    await page.screenshot({path:testInfo.outputPath('set-definition-'+width+'.png'),fullPage:true});
  }
  await page.reload();
  await page.waitForFunction(()=>state.dirStack&&state.dirStack.length&&state.folderStateWritable);
  await page.evaluate(folder=>{if(state.folder!==folder)setApplicationSetContext(folder);},folder);
  await page.waitForFunction(folder=>state.folder===folder&&state.folderStateWritable&&state.setVariables.some(variable=>variable.group==='Viewpoint'&&variable.terms.includes('rear')),folder);
  expect(await page.evaluate(()=>state.setVariables)).toEqual(saved.set_variables);
});

test('Caption Template discusses and authors a working draft, then writes only on explicit action',async({page,request})=>{
  const fsRoot=fs.readFileSync(path.resolve(__dirname,'../../test-results/studio-temp-root.txt'),'utf8').trim();
  const folder='Caption Template Acceptance';
  const root=path.join(fsRoot,'sets',folder);
  fs.mkdirSync(root,{recursive:true});
  fs.writeFileSync(path.join(root,'example.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAALUlEQVR4nGN0TKlloCVgoqnpoxaMWjBqwagFoxaMWjBqARUBAErBAWK46tBKAAAAAElFTkSuQmCC','base64'));
  fs.writeFileSync(path.join(root,'example.txt'),'bright lighting, front view');
  const statePath=path.join(root,'.webcap_state.json');
  const original='{viewpoint}, {lighting}';
  const revised='{lighting, }{viewpoint}';
  fs.writeFileSync(statePath,JSON.stringify({
    primer:{template:original},
    set_training_focus:'Viewpoint',
    set_variables:[{group:'Viewpoint',terms:['front','rear'],exclusive:true}],
    caption_requirements:['Viewpoint','Lighting'],
    caption_requirement_keywords:{Viewpoint:'front, rear',Lighting:'bright, dim'},
    caption_group_tags_by_media:{'example.png':{Viewpoint:['front'],Lighting:['bright']}}
  }));
  const modelUrl='http://127.0.0.1:4211';
  expect((await request.post(modelUrl+'/__acceptance/reset')).ok()).toBeTruthy();
  expect((await request.post(modelUrl+'/__acceptance/queue',{data:{value:'Use compact phrases with lighting before viewpoint.'}})).ok()).toBeTruthy();
  expect((await request.post(modelUrl+'/__acceptance/queue',{data:{value:revised}})).ok()).toBeTruthy();
  await page.goto('/');
  await page.waitForFunction(()=>state.dirStack&&state.dirStack.length&&state.folderStateWritable);
  await page.evaluate(folder=>setApplicationSetContext(folder),folder);
  await page.waitForFunction(folder=>state.folder===folder&&state.folderStateWritable&&state.items.length===1,folder);
  await page.evaluate(()=>window.openSetDashboard());
  const definition=page.locator('#set-dashboard-definition');
  if(!await definition.evaluate(node=>node.open)) await definition.locator(':scope > summary').click();
  await page.locator('#set-dashboard-template-design').click();
  const modal=page.locator('#task-conversation-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('#director-chat-title')).toHaveText('Caption Template');
  const model=page.locator('#director-chat-model');
  await expect(model.locator('option[value="acceptance::acceptance-model"]')).toHaveCount(1);
  await model.selectOption('acceptance::acceptance-model');
  await modal.locator('#primer-task-reference-select').selectOption({index:1});
  await modal.locator('#primer-task-reference-add').click();
  await expect(modal.locator('#primer-task-references')).toContainText('bright lighting, front view');
  await modal.locator('#director-chat-input').fill('Use lighting before viewpoint with compact phrases.');
  await modal.locator('#director-chat-send').click();
  await expect(modal.locator('#director-chat-messages')).toContainText('Use compact phrases with lighting before viewpoint.');
  await expect(modal.locator('#primer-task-draft')).toHaveValue(original);
  await modal.locator('#primer-task-generate').click();
  await expect(modal.locator('#primer-task-draft')).toHaveValue(revised);
  await expect(modal.locator('#primer-task-examples')).toContainText('bright');
  expect(JSON.parse(fs.readFileSync(statePath,'utf8')).primer.template).toBe(original);
  const calls=await request.get(modelUrl+'/__acceptance/calls').then(r=>r.json());
  expect(calls.calls).toHaveLength(2);
  expect(calls.calls[1].messages.some(item=>String(item.content).includes('Use lighting before viewpoint'))).toBeTruthy();
  expect(calls.calls[1].messages.some(item=>String(item.content).includes('bright lighting, front view'))).toBeTruthy();
  await modal.locator('#primer-task-write').click();
  await expect(modal).toBeHidden();
  const saved=JSON.parse(fs.readFileSync(statePath,'utf8')).primer;
  expect(saved.template).toBe(revised);
  expect(saved.referenceCaptions).toEqual([{fileName:'example.png',caption:'bright lighting, front view'}]);
  await expect(page.locator('#set-dashboard-template-draft')).toHaveValue(revised);
});
