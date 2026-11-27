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
  const shape={group:'Shape',terms:['triangle'],exclusive:false,expected:false};
  const view={group:'Viewpoint',terms:['front'],exclusive:true,expected:false};
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
  await edit.getByRole('checkbox',{name:'rear',exact:true}).check();
  await edit.getByRole('checkbox',{name:'Expected on most media'}).check();
  const save=page.waitForResponse(response=>response.url().endsWith('/fs/folder_state/save')&&response.request().method()==='POST'&&response.request().postDataJSON()?.state?.set_variables?.some(variable=>variable.group==='Viewpoint'&&variable.terms.includes('rear')));
  await edit.getByRole('button',{name:'Apply',exact:true}).click();
  expect((await save).ok()).toBeTruthy();
  await expect(row).toContainText('2 selected');
  await expect(row).toContainText('Expected');
  const saved=JSON.parse(fs.readFileSync(path.join(root,'.webcap_state.json'),'utf8'));
  expect(saved.set_variables).toEqual([shape,{group:'Viewpoint',terms:['front','rear'],exclusive:true,expected:true}]);
  expect(saved.stats).not.toHaveProperty('phrases');
  for(const width of [1440,1100]) {
    await page.setViewportSize({width,height:1000});
    await expect(list).toBeVisible();
    const geometry=await definition.evaluate(node=>{
      const grid=node.querySelector('.set-dashboard-definition-grid');
      const list=node.querySelector('#set-dashboard-group-list');
      return {overflow:grid.scrollWidth-grid.clientWidth,listOverflow:list.scrollWidth-list.clientWidth,listHeight:getComputedStyle(list).maxHeight};
    });
    expect(geometry.overflow).toBeLessThanOrEqual(2);
    expect(geometry.listOverflow).toBeLessThanOrEqual(2);
    expect(geometry.listHeight).toBe('none');
    await page.screenshot({path:testInfo.outputPath('set-definition-'+width+'.png'),fullPage:true});
  }
  await page.reload();
  await page.waitForFunction(()=>state.dirStack&&state.dirStack.length&&state.folderStateWritable);
  await page.evaluate(folder=>{if(state.folder!==folder)setApplicationSetContext(folder);},folder);
  await page.waitForFunction(folder=>state.folder===folder&&state.folderStateWritable&&state.setVariables.some(variable=>variable.group==='Viewpoint'&&variable.terms.includes('rear')),folder);
  expect(await page.evaluate(()=>state.setVariables)).toEqual(saved.set_variables);
});
