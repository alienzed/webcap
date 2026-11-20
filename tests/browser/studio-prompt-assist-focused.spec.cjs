'use strict';
const {test,expect}=require('./test.cjs');
const {resetModel,queueModel,observedModels,openDirector,seedProject,seedScene,openProject,story}=require('./helpers.cjs');

const source=[
  'At 00:00, two participants spread fresh yoga mats directly over mats already lying on the studio floor.',
  'At 00:04, the camera frames their faces and hides their hands during a precise hand-balance movement.',
  'At 00:08, the women stand and the scene returns to the arrangement of mats from the first cut.'
].join('\n');

const suggestions=[
  {
    location:'00:00–00:04',
    problem:'Additional mats overlap mats already placed on the floor, suggesting duplicate equipment.',
    suggestedFix:'Specify that each person uses an already laid-out mat and does not add a second mat.',
    targetText:'two participants spread fresh yoga mats directly over mats already lying on the studio floor',
    replacementText:'two participants step onto their own yoga mats already arranged on the studio floor'
  },
  {
    location:'00:04–00:08',
    problem:'The intended hand placement is invisible while the frame stays on the faces.',
    suggestedFix:'Keep hands and support surfaces readable during the movement.',
    targetText:'the camera frames their faces and hides their hands during a precise hand-balance movement',
    replacementText:'the camera frames their hands and shoulders while they perform a precise hand-balance movement'
  },
  {
    location:'00:08–00:12',
    problem:'The final cut returns to an outdated mat arrangement.',
    suggestedFix:'Retain the positions established in the prior cut.',
    targetText:'the scene returns to the arrangement of mats from the first cut',
    replacementText:'the scene preserves the exact mat positions established at the end of the preceding cut'
  }
];

async function setup(page,request,modelResponse) {
  await resetModel(request);
  const project=await seedProject(page,'Focused Prompt Assist '+Date.now(),{
    concept:'An intimate yoga session.',style:'Natural morning light.'
  });
  const scene=await seedScene(page,project.id,{title:'Arriving and Balancing',
    prompt:source,durationSeconds:12});
  await openDirector(page);
  await openProject(page,project.id);
  await page.locator('#director-chat-close').click();
  await queueModel(request,modelResponse);
  await page.locator('.storyboard-scene[data-scene-id="'+scene.id+'"] [data-prompt-assist-open]').click();
  await expect(page.locator('#storyboard-prompt-assist-modal')).toBeVisible({timeout:60000});
  return {project,scene};
}

test('Prompt Assist reviews one complete correction at a time and preserves edits while browsing',async({page,request})=>{
  const {project,scene}=await setup(page,request,{findings:suggestions});
  const cards=page.locator('#storyboard-prompt-assist-findings .storyboard-assist-finding');
  const position=page.locator('#storyboard-prompt-assist-position');
  const progress=page.locator('#storyboard-prompt-assist-count');
  const prev=page.locator('#storyboard-prompt-assist-prev');
  const next=page.locator('#storyboard-prompt-assist-next');

  await expect(cards).toHaveCount(1);
  await expect(position).toHaveText('Finding 1 of 3');
  await expect(progress).toHaveText('0 of 3 applied');
  await expect(prev).toBeDisabled();
  await expect(next).toBeEnabled();
  await expect(cards.first()).toContainText(suggestions[0].problem);
  await expect(cards.first()).toContainText(suggestions[0].suggestedFix);
  await expect(cards.first()).not.toContainText(suggestions[1].problem);
  const sizes=await cards.first().evaluate(node=>({
    body:parseFloat(getComputedStyle(node.querySelector('.storyboard-assist-finding-main p')).fontSize),
    label:parseFloat(getComputedStyle(node.querySelector('.storyboard-assist-patch label')).fontSize),
    editor:parseFloat(getComputedStyle(node.querySelector('[data-assist-replacement]')).fontSize),
    heading:parseFloat(getComputedStyle(node.querySelector('.storyboard-assist-location')).fontSize)
  }));
  expect(sizes.body).toBeGreaterThanOrEqual(16);
  expect(sizes.label).toBeGreaterThanOrEqual(18);
  expect(sizes.editor).toBeGreaterThanOrEqual(16);
  expect(sizes.heading).toBeGreaterThanOrEqual(20);

  const fullPrompt=page.locator('#storyboard-prompt-assist-source-details');
  await expect(page.locator('#storyboard-prompt-assist-source')).toHaveText(source);
  await expect(fullPrompt).not.toHaveAttribute('open','');
  await fullPrompt.locator('summary').click();
  await expect(page.locator('#storyboard-prompt-assist-source')).toBeVisible();
  await fullPrompt.locator('summary').click();

  await next.click();
  await expect(position).toHaveText('Finding 2 of 3');
  await expect(cards).toHaveCount(1);
  const custom=suggestions[1].replacementText+' The supporting wrist remains visible.';
  await cards.locator('[data-assist-replacement]').fill(custom);
  await next.click();
  await expect(position).toHaveText('Finding 3 of 3');
  await expect(next).toBeDisabled();
  await prev.click();
  await expect(cards.locator('[data-assist-replacement]')).toHaveValue(custom);
  expect((await story(page,project.id)).scenes[scene.id].prompt).toBe(source);

  await prev.click();
  await cards.getByRole('button',{name:'Apply correction'}).click();
  await expect(progress).toHaveText('1 of 3 applied',{timeout:30000});
  await expect(position).toHaveText('Finding 2 of 3');
  await expect(cards).toHaveCount(1);
  await expect(cards.locator('[data-assist-replacement]')).toHaveValue(custom);
  let saved=await story(page,project.id);
  expect(saved.scenes[scene.id].prompt).toContain(suggestions[0].replacementText);
  expect(saved.scenes[scene.id].prompt).toContain(suggestions[1].targetText);

  await cards.getByRole('button',{name:'Apply correction'}).click();
  await expect(progress).toHaveText('2 of 3 applied',{timeout:30000});
  await expect(position).toHaveText('Finding 3 of 3');
  saved=await story(page,project.id);
  expect(saved.scenes[scene.id].prompt).toContain(custom);

  await cards.getByRole('button',{name:'Apply correction'}).click();
  await expect(progress).toHaveText('3 of 3 applied',{timeout:30000});
  await expect(page.locator('#storyboard-prompt-assist-status')).toContainText('All suggested corrections applied');
  await expect(cards.getByRole('button',{name:'Applied'})).toBeDisabled();
  await prev.click();
  await expect(cards.getByRole('button',{name:'Applied'})).toBeDisabled();
  await expect(cards.locator('[data-assist-replacement]')).not.toBeEditable();
  const final=await story(page,project.id);
  const revisions=await page.locator('.storyboard-scene[data-scene-id="'+scene.id+'"] [data-scene-field="prompt"]').evaluate(editor=>{
    const api=window.webcapTextareaRevisions;
    const history=api.history(api.identity(editor));
    return history && history.versions.slice();
  });
  expect(revisions).toHaveLength(4);
  expect(revisions[0]).toBe(source);
  expect(revisions[3]).toBe(final.scenes[scene.id].prompt);
  expect(final.scenes[scene.id].prompt).toContain(suggestions[0].replacementText);
  expect(final.scenes[scene.id].prompt).toContain(custom);
  expect(final.scenes[scene.id].prompt).toContain(suggestions[2].replacementText);
  expect(final.scenes[scene.id].previousPrompt).toBeTruthy();
  expect((await observedModels(request)).calls).toHaveLength(1);
});

test('Prompt Assist shows an honest empty state without an unnecessary navigator',async({page,request})=>{
  await setup(page,request,{findings:[]});
  await expect(page.locator('#storyboard-prompt-assist-findings')).toContainText('no meaningful text corrections');
  await expect(page.locator('#storyboard-prompt-assist-navigator')).toBeHidden();
  await expect(page.locator('#storyboard-prompt-assist-count')).toHaveText('No corrections suggested');
  expect((await observedModels(request)).calls).toHaveLength(1);
});
