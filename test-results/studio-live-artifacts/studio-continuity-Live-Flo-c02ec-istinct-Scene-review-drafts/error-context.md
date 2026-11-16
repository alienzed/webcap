# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: studio-continuity.spec.cjs >> Live Flow 6 — separate real authored replies retain distinct Scene review drafts
- Location: tests\live\studio-continuity.spec.cjs:29:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('#studio-dw-suggestions .studio-dw-suggestion-action')
Expected pattern: /Review authored Scene|Create Scene\(s\) · Review/i
Received string:  "Revise Scene(s) · Save"
Timeout: 1000ms

Call log:
  - Expect "toContainText" locator('#studio-dw-suggestions .studio-dw-suggestion-action') with timeout 1000ms
  - waiting for locator('#studio-dw-suggestions .studio-dw-suggestion-action')
    11 × locator resolved to <button type="button" data-guided-write="true" data-suggestion-kind="write" class="studio-dw-suggestion-action" title="Create a new Scene for review.">Revise Scene(s) · Save</button>
       - unexpected value "Revise Scene(s) · Save"

```

```yaml
- button "Revise Scene(s) · Save"
```

# Test source

```ts
  1   | 'use strict';
  2   | const {test,expect}=require('../browser/test.cjs');
  3   | const {waitForLiveJob,openLiveDirector,attachProject,sendLive,addEvidence,latestSceneReview,
  4   |        story,stories,seedProject,openProject,reopenDirectorIfClosed}=require('./helpers.cjs');
  5   | 
  6   | test('Live Flow 5 — Director Project attachment survives opening another Project',async({page},testInfo)=>{
  7   |   const a=await seedProject(page,'Director A '+Date.now(),{style:'Cool blue light.'});
  8   |   const b=await seedProject(page,'Director B '+Date.now(),{style:'Red neon light.'});
  9   |   const model=await openLiveDirector(page);
  10  |   await attachProject(page,a);
  11  |   await openProject(page,b.id);
  12  |   await expect(page.locator('#storyboard-story-title')).toHaveValue(b.title);
  13  |   await expect(page.locator('#director-chat-title')).toContainText(a.title);
  14  |   const instruction='Change only the attached Project visual atmosphere to soft silver moonlight; present the Project change for review.';
  15  |   await sendLive(page,instruction);
  16  |   const action=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  17  |   await expect(action).toContainText(/Revise Project|Review Project changes/i);
  18  |   await action.click();
  19  |   await expect(page.locator('#studio-brief-review')).toBeVisible();
  20  |   const updated=await page.locator('#studio-brief-style').inputValue();
  21  |   expect(updated.trim()).toBeTruthy();
  22  |   await page.locator('#studio-brief-apply').click();
  23  |   await expect.poll(async()=> (await story(page,a.id)).style).toBe(updated);
  24  |   expect((await story(page,b.id)).style).toBe(b.style);
  25  |   await addEvidence(testInfo,page,model,instruction,
  26  |     {attachedProjectId:a.id,openEditorProjectId:b.id,savedA:await story(page,a.id),savedB:await story(page,b.id)});
  27  | });
  28  | 
  29  | test('Live Flow 6 — separate real authored replies retain distinct Scene review drafts',async({page},testInfo)=>{
  30  |   const project=await seedProject(page,'Live Separate Drafts '+Date.now());
  31  |   const model=await openLiveDirector(page);
  32  |   await attachProject(page,project);
  33  |   const firstInstruction='Author one new Scene for review: a bookseller lights a blue lantern, lasting eight seconds. Supply one complete Scene prompt and title.';
  34  |   await sendLive(page,firstInstruction);
  35  |   const firstAction=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  36  |   await expect(firstAction).toBeVisible({timeout:10000});
> 37  |   await expect(firstAction).toContainText(/Review authored Scene|Create Scene\(s\) · Review/i,{timeout:1000});
      |                             ^ Error: expect(locator).toContainText(expected) failed
  38  |   await firstAction.click();
  39  |   await expect(page.locator('#studio-scenes-review')).toBeVisible();
  40  |   const row=page.locator('#studio-scenes-rows .studio-scenes-row').first();
  41  |   const firstPrompt=await row.locator('[data-field="prompt"]').inputValue();
  42  |   expect(firstPrompt.trim()).toBeTruthy();
  43  |   const modified=firstPrompt+' The lantern flickers.';
  44  |   await row.locator('[data-field="prompt"]').fill(modified);
  45  |   await page.locator('#studio-scenes-close').click();
  46  |   const secondInstruction='Author one DIFFERENT new Scene for review: a visitor unfolds a green map, lasting ten seconds. Do not replace the previous Scene proposal.';
  47  |   await sendLive(page,secondInstruction);
  48  |   const secondAction=page.locator('#studio-dw-suggestions .studio-dw-suggestion-action');
  49  |   await expect(secondAction).toBeVisible({timeout:10000});
  50  |   await expect(secondAction).toContainText(/Review authored Scene|Create Scene\(s\) · Review/i,{timeout:1000});
  51  |   await secondAction.click();
  52  |   await expect(page.locator('#studio-scenes-review')).toBeVisible();
  53  |   const secondPrompt=await row.locator('[data-field="prompt"]').inputValue();
  54  |   expect(secondPrompt.trim()).toBeTruthy();
  55  |   expect(secondPrompt).not.toBe(modified);
  56  |   await page.locator('#studio-scenes-close').click();
  57  |   const firstReplyAction=page.locator('#director-chat-messages .studio-dw-suggestion-action').first();
  58  |   await expect(firstReplyAction).toBeVisible();
  59  |   await firstReplyAction.click();
  60  |   await expect(page.locator('#studio-scenes-review')).toBeVisible();
  61  |   await expect(row.locator('[data-field="prompt"]')).toHaveValue(modified);
  62  |   expect((await story(page,project.id)).sceneOrder).toHaveLength(0);
  63  |   await addEvidence(testInfo,page,model,[firstInstruction,secondInstruction],
  64  |     {projectId:project.id,firstPrompt,secondPrompt,editedUnsaved:modified});
  65  | });
  66  | 
  67  | test('Live Flow 7 — recover an edited unsaved real Scene after leaving and returning',async({page},testInfo)=>{
  68  |   const project=await seedProject(page,'Live Resume '+Date.now());
  69  |   const other=await seedProject(page,'Live Other '+Date.now());
  70  |   const model=await openLiveDirector(page);
  71  |   await attachProject(page,project);
  72  |   const instruction='Author one new Scene for review with a complete prompt about opening a small bookshop on a snowy morning; use eight seconds.';
  73  |   await sendLive(page,instruction);
  74  |   const rows=await latestSceneReview(page);
  75  |   expect(await rows.count()).toBeGreaterThan(0);
  76  |   const prompt=rows.first().locator('[data-field="prompt"]');
  77  |   const text=await prompt.inputValue();
  78  |   expect(text.trim()).toBeTruthy();
  79  |   const edited=text+' The shop bell rings twice.';
  80  |   await prompt.fill(edited);
  81  |   await page.locator('#studio-scenes-close').click();
  82  |   expect((await story(page,project.id)).sceneOrder).toHaveLength(0);
  83  |   await openProject(page,other.id);
  84  |   await openProject(page,project.id);
  85  |   const review=page.locator('#director-chat-messages .studio-dw-suggestion-action').last();
  86  |   await expect(review).toBeVisible();
  87  |   await review.click();
  88  |   await expect(page.locator('#studio-scenes-review')).toBeVisible();
  89  |   await expect(page.locator('#studio-scenes-rows .studio-scenes-row').first()
  90  |     .locator('[data-field="prompt"]')).toHaveValue(edited);
  91  |   await page.locator('#studio-scenes-apply').click();
  92  |   await expect.poll(async()=> (await story(page,project.id)).sceneOrder.length).toBeGreaterThan(0);
  93  |   const saved=await story(page,project.id);
  94  |   expect(saved.scenes[saved.sceneOrder[0]].prompt).toBe(edited);
  95  |   expect((await story(page,other.id)).sceneOrder).toHaveLength(0);
  96  |   await page.reload();
  97  |   expect((await story(page,project.id)).scenes[saved.sceneOrder[0]].prompt).toBe(edited);
  98  |   await addEvidence(testInfo,page,model,instruction,{projectId:project.id,sceneId:saved.sceneOrder[0],edited});
  99  | });
  100 | 
  101 | test('Live Flow 8 — slash-inserted Studio Block reaches the real Director model as edited text',async({page},testInfo)=>{
  102 |   const before=(await stories(page)).map(x=>x.id);
  103 |   const model=await openLiveDirector(page);
  104 |   await expect(page.locator('#studio-blocks-open')).toBeVisible();
  105 |   await page.locator('#studio-blocks-open').click();
  106 |   await page.locator('#studio-blocks-new').click();
  107 |   const name='Acceptance Lamp Block '+Date.now();
  108 |   await page.locator('#studio-blocks-title').fill(name);
  109 |   await page.locator('#studio-blocks-content').fill('One amber lamp illuminates a stone doorway.');
  110 |   await page.locator('#studio-blocks-save').click();
  111 |   await expect(page.locator('#studio-blocks-status')).toHaveText('Saved.');
  112 |   await page.locator('#studio-blocks-close').click();
  113 |   await reopenDirectorIfClosed(page);
  114 |   const composer=page.locator('#director-chat-input');
  115 |   await composer.fill('Discuss: /Acceptance  and mention how to frame the shot.');
  116 |   await composer.evaluate(node=>{
  117 |     const pos=node.value.indexOf('  and mention');node.setSelectionRange(pos,pos);
  118 |     node.dispatchEvent(new Event('input',{bubbles:true}));
  119 |   });
  120 |   const option=page.locator('#studio-blocks-slash').getByRole('option',{name:/Acceptance Lamp Block/});
  121 |   await expect(option).toBeVisible();
  122 |   await option.click();
  123 |   const sent=await composer.inputValue();
  124 |   expect(sent).toContain('One amber lamp illuminates a stone doorway.');
  125 |   expect(sent).toContain('and mention how to frame the shot.');
  126 |   await waitForLiveJob(page,()=>page.locator('#director-chat-send').click());
  127 |   await expect.poll(async()=> (await page.locator('#director-chat-messages').innerText()).length,
  128 |     {timeout:180000}).toBeGreaterThan(sent.length);
  129 |   expect((await stories(page)).map(x=>x.id).sort()).toEqual(before.sort());
  130 |   await addEvidence(testInfo,page,model,sent,{block:name,noProjectMutation:true});
  131 | });
  132 | 
```