'use strict';

// Opt-in live contract acceptance: production JS request builders, real WebCap
// queue, configured LLM, and real Project/Scene persistence. No browser or mock
// model is involved. Run against a disposable/isolated WebCap installation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const model = String(process.env.WEBCAP_LIVE_MODEL || '').trim();
const origin = String(process.env.WEBCAP_LIVE_URL || 'http://127.0.0.1:4200').replace(/\/+$/, '');
const deadlineMs = Number(process.env.WEBCAP_LIVE_TIMEOUT_MS || 900000);
const chat = fs.readFileSync(path.join(__dirname, '../tool/js/director_chat.js'), 'utf8');
const workbench = fs.readFileSync(path.join(__dirname, '../tool/js/studio_director_workbench.js'), 'utf8');

function part(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Production source boundary changed: ' + start);
  return source.slice(a, b);
}

async function api(url, payload) {
  const response = await fetch(origin + url, payload === undefined ? undefined : {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
  });
  const body = await response.json();
  assert.ok(response.ok && body.ok, url + ': ' + (body.error || 'HTTP ' + response.status));
  return body;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function askModel(operation, messages, report) {
  assert.ok(Array.isArray(messages) && messages[0].role === 'system' &&
    messages[0].content.includes('CURRENT WEBCAP CAPABILITIES'),
  'The production Director guidance builder must supply the model prompt');
  const started = Date.now();
  const queued = await api('/fs/director/chat', {model, operation, messages});
  const jobId = queued.job && queued.job.jobId;
  assert.ok(jobId, operation + ' was not queued');
  report.push({operation, jobId, request:messages});
  for (;;) {
    const polled = (await api('/fs/director/job?job=' + encodeURIComponent(jobId))).job;
    if (polled.status === 'completed') {
      const raw = String(polled.result && polled.result.text || '');
      assert.ok(raw.trim(), operation + ' returned no content');
      report.at(-1).response = raw;
      report.at(-1).seconds = (Date.now()-started)/1000;
      return raw;
    }
    if (['failed','stopped','cancelled','interrupted'].includes(polled.status)) {
      throw new Error(operation + ' ' + polled.status + ': ' + String(polled.error || 'No job error'));
    }
    assert.ok(Date.now()-started < deadlineMs, operation + ' exceeded ' + deadlineMs + 'ms');
    await sleep(2500);
  }
}

function productionComposer(story, selectedSceneId='') {
  const navigation = {projectId:story.id,projectTitle:story.title,
    sceneId:selectedSceneId,sceneNumber:selectedSceneId ? story.sceneOrder.indexOf(selectedSceneId)+1 : 0,
    sceneOrder:story.sceneOrder.slice()};
  const scope = vm.createContext({
    state:{studioStoryAccess:{storyId:story.id},storyboardAttachments:{},
      studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{}}},
    window:{getStudioDirectorNavigation:()=>navigation,studioDirectorWorkbench:{}},
    requestJson: url => api(url),
    studioAttachedStoryId:()=>story.id,
    studioDirectorSelectedScene:()=>selectedSceneId ? {
      projectId:story.id,sceneId:selectedSceneId,
      sceneNumber:story.sceneOrder.indexOf(selectedSceneId)+1
    } : null,
    projectFields:['title','concept','style','invariants']
  });
  vm.runInContext(part(workbench,
    '  function readPayload(story, keys) {',
    '  function updateReadSelection() {'), scope);
  scope.window.studioDirectorWorkbench.sceneRead = (item, sceneId) => {
    const keys = ['title','concept','style','invariants'].map(field=>'project.'+field)
      .concat(['title','prompt','durationSeconds'].map(field=>'scene:'+sceneId+':'+field));
    return {payload:scope.readPayload(item,keys),keys};
  };
  vm.runInContext(part(chat,
    '  function studioDirectorRequestMessages(messages, includePromptContract, explicitWrite, navigationSnapshot) {',
    '  // Retain available conversational work across ordinary follow-up questions.'),scope);
  vm.runInContext(part(chat,
    '  function parseStudioProjectDraft(raw) {',
    '  function addStudioProjectInvariant('),scope);
  vm.runInContext(part(chat,
    '  function parseStudioChatResponse(raw) {',
    '  function studioActionFromExplicitRequest(request, selectedScene) {'),scope);
  vm.runInContext(part(chat,
    '  function studioRequestedDuration(instruction) {',
    '  window.studioDirectorBridge = {'),scope);
  return {scope,navigation};
}

function productionProjectTask(instruction) {
  const builder = new Function('options','workingProject','discussion',
    part(chat, "    var input = {\n      task: 'Author ONE new Studio Project",
      "    studioDirectorRequestMessages([{ role: 'user', content: JSON.stringify(input) }]")
    + '\nreturn input;');
  return builder({instruction}, {}, [{role:'user',content:instruction}]);
}

function productionSceneRevisionTask(scope, sceneId, savedContext, instruction) {
  const text = part(chat,
    "        var instruction = JSON.stringify({\n          task:'Revise this one existing Scene",
    "        state.pending = false;\n        return window.studioDirectorBridge.makeProposal(");
  const fn = vm.runInContext(
    '(function(launch,sceneId,wantsTitle,wantsDuration,context,workingScene){' +
    text + '\nreturn instruction;})',scope);
  return fn({instruction,authorRequest:instruction},sceneId,false,true,savedContext,{});
}

test('Studio Director: live LLM with production guidance and saved effects', {
  skip: model ? false : 'Set WEBCAP_LIVE_MODEL to the configured WebCap model ID',
  timeout:Math.max(180000,deadlineMs*3+180000)
}, async t => {
  const report = [];
  const created = [];
  const label = 'Director Live ' + crypto.randomUUID().slice(0,8);
  try {
    const seeded = (await api('/fs/storyboard', {operation:'create_story',story:{
      title:label+' Rainy Bookshop',
      concept:'A bookseller is closing a tiny shop on a rainy evening.',
      style:'Amber lamplight, quiet and intimate.',
      invariants:[
        {kind:'character',title:'Bookseller clothing',text:'The bookseller always wears a burgundy cardigan.'},
        {kind:'location',title:'Front door',text:'The shop has a green front door.'}
      ]
    }})).story;
    created.push(seeded.id);
    const originalPrompt = 'Subject: A bookseller in a burgundy cardigan. ' +
      'Scene Overview: The bookseller closes a green front door in the rain. ' +
      'integrated_multimodal_description: [Shot 1] 0-4 seconds: the bookseller walks to the green door. ' +
      '[Shot 2] 4-8 seconds: the door shuts loudly and the bookseller steps back.';
    const seededScene = (await api('/fs/storyboard', {
      operation:'add_scene',storyId:seeded.id,scene:{
        title:'Closing time',prompt:originalPrompt,durationSeconds:8
      }
    })).scene;
    const project = (await api('/fs/storyboard?story='+encodeURIComponent(seeded.id))).story;
    const {scope,navigation} = productionComposer(project);

    await t.test('Read answers from fresh saved context, without any mutation',async()=>{
      const question = 'What is the current Project saved title, and what fixed clothing and door details does it establish? Answer briefly; make no changes.';
      const messages = await scope.studioDirectorChatRequestMessages(
        [{role:'user',content:question}],null,navigation,{});
      assert.match(messages[0].content,/CURRENT SAVED PROJECT OVERVIEW/);
      const before = (await api('/fs/storyboard?story='+encodeURIComponent(seeded.id))).story;
      const raw = await askModel('studio_chat',messages,report);
      const reply = scope.parseStudioChatResponse(raw).reply;
      assert.match(reply,/rainy bookshop/i,'Model lost the saved Project title');
      assert.match(reply,/burgundy/i,'Model lost the fixed clothing detail');
      assert.match(reply,/green/i,'Model lost the fixed door detail');
      const after = (await api('/fs/storyboard?story='+encodeURIComponent(seeded.id))).story;
      assert.deepEqual(after,before,'Read unexpectedly mutated the Project');
    });

    await t.test('Write Project authors real structured fields using the exact Project task',async()=>{
      const instruction='Create a new Project titled Moonlit Bakery. ' +
        'Its concept is a baker preparing bread before sunrise. ' +
        'Its visual atmosphere is cool blue dawn light. No Scenes yet.';
      const input = productionProjectTask(instruction);
      const messages = await scope.studioDirectorRequestMessages(
        [{role:'user',content:JSON.stringify(input)}],false,true,
        {projectId:'',projectTitle:'',sceneId:'',sceneNumber:0,sceneOrder:[]});
      const raw = await askModel('studio_project_draft',messages,report);
      let parsed;
      try {parsed=scope.parseStudioProjectDraft(raw);} catch (error) {
        assert.fail('Project draft failed the production parser: '+error.message.slice(0,500));
      }
      assert.ok(parsed && typeof parsed.concept==='string' && parsed.concept.trim(),'Missing authored Concept');
      assert.match(parsed.title,/moonlit bakery/i,'Project title did not match the author request');
      assert.ok(typeof parsed.style==='string' && parsed.style.trim(),'Missing authored atmosphere');
      assert.match(parsed.concept,/bak|bread/i,'Project Concept did not reflect the author request');
      assert.match(parsed.style,/blue|dawn|cool/i,'Project atmosphere did not reflect the author request');
      const proposal = {title:parsed.title,concept:parsed.concept,
        style:parsed.style,invariants:Array.isArray(parsed.invariants)?parsed.invariants:[]};
      const saved = (await api('/fs/studio/director/project-create',{proposal})).story;
      created.push(saved.id);
      const persisted = (await api('/fs/storyboard?story='+encodeURIComponent(saved.id))).story;
      assert.equal(persisted.concept,proposal.concept);
      assert.equal(persisted.style,proposal.style);
    });

    await t.test('Write Scene revises original Prompt and requested duration, then saves exact fields',async()=>{
      const fresh = (await api('/fs/storyboard?story='+encodeURIComponent(seeded.id))).story;
      const scene = fresh.scenes[seededScene.id];
      const {scope:sceneScope,navigation:sceneNav} = productionComposer(fresh,seededScene.id);
      const context = sceneScope.window.studioDirectorWorkbench.sceneRead(fresh,seededScene.id).payload;
      const instruction='Revise Scene 1: make the ending quiet instead of loud, retain the burgundy cardigan and green front door, and extend the Scene to twelve seconds.';
      const prompt = productionSceneRevisionTask(sceneScope,seededScene.id,context,instruction);
      const messages = await sceneScope.studioDirectorRequestMessages(
        [{role:'user',content:prompt}],true,true,sceneNav);
      assert.match(messages[0].content,/H3 PRODUCTION PROMPT REFERENCE/);
      const raw = await askModel('studio_scene_field_draft',messages,report);
      let draft;
      try {draft=JSON.parse(raw);} catch {assert.fail('Scene model output was not JSON: '+raw.slice(0,500));}
      assert.ok(draft && typeof draft.prompt==='string' && draft.prompt.trim(),'Missing usable replacement Prompt');
      assert.match(draft.prompt,/burgundy/i,'Scene lost invariant clothing');
      assert.match(draft.prompt,/green/i,'Scene lost invariant door');
      assert.match(draft.prompt,/quiet|silent|soft|hush|gentle|slow|calm/i,'Scene ending was not made quieter');
      assert.match(draft.prompt,/(?:12|twelve)\s*(?:seconds?|secs?|s)\b|\b\d+\s*[-–]\s*12\b/i,
        'Prompt timing did not reflect the requested twelve seconds');
      const saved = await api('/fs/studio/director/scene-fields',{
        storyId:fresh.id,sceneId:seededScene.id,
        expected:{prompt:scene.prompt,durationSeconds:scene.durationSeconds},
        changes:{prompt:draft.prompt,durationSeconds:12}
      });
      assert.equal(saved.scene.durationSeconds,12);
      const persisted = (await api('/fs/storyboard?story='+encodeURIComponent(fresh.id))).story;
      assert.equal(persisted.scenes[seededScene.id].prompt,draft.prompt);
      assert.equal(persisted.scenes[seededScene.id].durationSeconds,12);
      assert.equal(persisted.scenes[seededScene.id].title,scene.title,'Unrequested Scene title changed');
    });
  } finally {
    if (process.env.WEBCAP_LIVE_REPORT) {
      try {
        fs.writeFileSync(process.env.WEBCAP_LIVE_REPORT,
          JSON.stringify({model,origin,report},null,2)+'\n','utf8');
      } catch (error) {
        t.diagnostic('Could not write optional live report: '+error.message);
      }
    }
    for(const id of created.reverse()) {
      try {
        await api('/fs/storyboard',{operation:'delete_story',storyId:id});
      } catch(error) {
        t.diagnostic('Clean up test Project '+id+' manually: '+error.message);
      }
    }
  }
});
