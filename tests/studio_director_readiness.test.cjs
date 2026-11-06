const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const director = fs.readFileSync(path.join(__dirname, '..', 'tool/js/director_chat.js'), 'utf8');
const workbench = fs.readFileSync(path.join(__dirname, '..', 'tool/js/studio_director_workbench.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'tool/tool.html'), 'utf8');
function part(start, end) {
  const i = director.indexOf(start), j = director.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i, 'Missing Studio section ' + start);
  return director.slice(i, j);
}
const parse = new Function(part('  function parseStudioChatResponse(raw) {',
  '  function storyboardRequestMessages(messages, includePrimer) {') +
  '\nreturn parseStudioChatResponse;')();
const valid = {
  checks:[{name:'Concept',scope:'project',ready:true,content:'A scene with dialogue, and "quotation" marks'}],
  readHints:['project.concept'],writeHint:'project',writeFields:['concept'],sceneId:''
};
const envelope=(readiness=valid,reply='A concise suggestion.')=>JSON.stringify({reply,readiness});
function processResponse(text,accept=true,pendingReadAck=null,mode='storyboard') {
  const state={studioReadiness:{...valid,stale:true},pendingReadAck};
  const statuses=[],failures=[];
  const window={studioDirectorWorkbench:{
    updateReadiness:data=>{
      if(!accept||!data||!Array.isArray(data.checks))return false;
      state.studioReadiness={...data,stale:false};
      return true;
    },
    setReadinessFreshness:stale=>statuses.push('freshness:'+stale),
    setStatus:msg=>statuses.push(msg)
  },reportConsoleError:(label,err)=>failures.push(label+': '+err.message)};
  const code=part("        var studioResponse = activeChatMode === 'storyboard' ? parseStudioChatResponse(result.text) : null;",
    "        messages.push({ role: 'assistant', content: assistantText });");
  const run=new Function('result','activeChatMode','state','window','studioActionStatus','parseStudioChatResponse',
    'var requestError=null;'+code+'\nreturn {text:assistantText,error:requestError};');
  return {...run({text},mode,state,window,msg=>statuses.push(msg),parse),state,statuses,failures};
}

test('one structured response supplies the exact reply and readiness separately',()=>{
  const reply='A creative reply with "quotes".\n\n[[WEBCAP_READINESS]] is literal authored text here.';
  const response=processResponse(envelope(valid,reply));
  assert.equal(response.text,reply);
  assert.equal(response.state.studioReadiness.stale,false);
  assert.deepEqual(response.state.studioReadiness.checks,valid.checks);
  assert.deepEqual(response.failures,[]);
});

test('assessment without a reply fails loudly instead of inventing conversation',()=>{
  assert.throws(()=>parse(JSON.stringify({readiness:valid})),/requires a conversational reply/);
  assert.throws(()=>parse(envelope(valid,' ')),/requires a conversational reply/);
});

test('malformed JSON exposes the exact response without repair or delimiter fallback',()=>{
  const fence=String.fromCharCode(96).repeat(3);
  for(const raw of ['{"reply":"unfinished',fence+'json\n'+envelope()+'\n'+fence,
    '{"reply":"Hi",}','Hi\n[[WEBCAP_READINESS]]{}[[END_WEBCAP_READINESS]]'])
    assert.throws(()=>parse(raw),error=>error.message.includes('Raw Director response:\n'+raw));
});

test('unsupported readiness preserves the reply and marks the exchange failed',()=>{
  const raw=envelope({writeHint:'project, style',writeFields:{project:['style']}},'Hello!');
  const response=processResponse(raw,false);
  assert.equal(response.text,'Hello!');
  assert.equal(response.state.studioReadiness.stale,true);
  assert.ok(response.error);
  assert.ok(response.failures.some(message=>message.includes('Raw structured response:\n'+raw)));
  assert.ok(response.statuses.some(message=>message.includes('assessment failed')));
});

test('missing readiness preserves the last assessment without pretending it succeeded',()=>{
  const response=processResponse(JSON.stringify({reply:'A useful suggestion.'}));
  assert.equal(response.text,'A useful suggestion.');
  assert.deepEqual(response.state.studioReadiness.checks,valid.checks);
  assert.equal(response.state.studioReadiness.stale,true);
  assert.ok(response.error);
});

test('Read acknowledgment is checked against the reply field rather than raw JSON',()=>{
  const response=processResponse(envelope(valid,'RECEIVED: project.concept\n\nA strong visual premise.'),true,['project.concept']);
  assert.equal(response.state.pendingReadAck,null);
  assert.ok(response.statuses.includes('Director acknowledged 1 selected fields.'));
  assert.deepEqual(response.failures,[]);
});

test('General Chat keeps free-form responses',()=>{
  const response=processResponse('A plain answer.',true,null,'chat');
  assert.equal(response.text,'A plain answer.');
  assert.deepEqual(response.failures,[]);
});

test('workbench exposes freshness and only accepted assessments are stored',()=>{
  assert.match(html,/id="studio-dw-readiness-freshness"/);
  assert.match(workbench,/setReadinessFreshness:setReadinessFreshness/);
  assert.match(workbench,/return false;/);
  assert.match(workbench,/stale:false/);
  assert.match(director,/markStudioReadinessOutdated\(\)/);
  assert.match(director,/state\.studioReadiness = Object\.assign\(\{\}, state\.studioReadiness, \{stale:true\}\)/);
});

test('the first accepted assessment is current immediately, rather than labelled not assessed',()=>{
  const start=workbench.indexOf('    updateReadiness:function (result, restoring) {');
  const end=workbench.indexOf('\n  };\n\n  function bind()',start);
  assert.ok(start>=0 && end>start);
  const scope=vm.createContext({readiness:[],projectFields:['title','concept','style','invariants'],
    sceneFields:['title','summary','prompt'],status:message=>assert.fail(message),
    renderReadiness:list=>assert.equal(list.length,1),
    setReadinessFreshness:stale=>{
      assert.equal(stale,false);
      assert.equal(scope.readiness.length,1,'freshness must see the newly accepted checks');
    },window:{studioDirectorBridge:{updateReadiness(){}}}});
  const receiver=vm.runInContext('({'+workbench.slice(start,end)+'})',scope);
  assert.equal(receiver.updateReadiness(valid),true);
});

test('capture is optional, bounded and remains editable authoring material, not an applied action', () => {
  const capture = {field:'concept', content:'A complete, original creative premise.', sceneId:''};
  const proposal = {...valid, capture};
  assert.deepEqual(parse(envelope(proposal)).readiness.capture, capture);
  const response = processResponse(envelope(proposal));
  assert.equal(response.text, 'A concise suggestion.');
  assert.deepEqual(response.state.studioReadiness.capture, capture);
  assert.match(director, /reviewCapture: function \(capture, storyId\)/);
  assert.match(director, /showStudioBriefReview\(\)/);
  assert.match(workbench, /creativeCapture = capture/);
  assert.ok(workbench.includes('function captureActionLabel(capture)'));
  assert.match(workbench, /return showSceneReview\(story, sceneTarget/);
  assert.match(workbench, /setReadinessFreshness/);
});

test('Invariant capture uses explicit saved identity rather than treating renames as additions', () => {
  const capture = {
    field:'invariant',content:'Short dark hair and a red scarf.',sceneId:'',
    kind:'character',title:'Alicia',beforeKind:'character',beforeTitle:'Alice'
  };
  assert.deepEqual(parse(envelope({...valid,capture})).readiness.capture,capture);
  assert.match(director, /var redirect = \(proposal\.renames \|\| \[\]\)/);
  assert.match(director, /capture\.beforeKind && capture\.beforeTitle/);
  assert.match(director, /proposed\.invariants\[index\] = after/);
  assert.match(director, /Review and edit before saving/);
  assert.match(workbench, /isInvariant = capture\.field === 'invariant'/);
  assert.match(workbench, /creativeCapture = capture/);
});

test('a complete Scene Intent can open existing placement review with no duplicate LLM call', () => {
  const capture = {field:'scene',title:'Opening chase',content:'The actor reaches the gate.',sceneId:''};
  assert.deepEqual(parse(envelope({...valid,capture})).readiness.capture,capture);
  assert.match(director, /reviewSceneCapture: function \(capture, storyId\)/);
  const review = director.split('    reviewSceneCapture: function (capture, storyId) {')[1]
    .split('    updateReadiness: function (value) {')[0];
  assert.match(review, /showStudioSceneDraftReview\(\)/);
  assert.match(review, /expectedUpdatedAt:story.updatedAt/);
  assert.doesNotMatch(review, /studioDirectorRequestMessages|makeProposal|\/fs\/director\/chat/);
  assert.match(workbench, /reviewSceneCapture\(capture,id\)/);
});

test('Scene suggestions route to one focused Write Scenes workflow', () => {
  assert.match(workbench, /function openRecommendedWrite\(\)/);
  assert.match(workbench, /operation = \['scene', 'scenes', 'scene-edit', 'scenes-batch'\]/);
  assert.match(workbench, /'scene-write'/);
  assert.match(workbench, /run:openRecommendedWrite/);
  assert.match(workbench, /writeOperationChosen = true/);
  assert.match(director, /canReview: function \(\)/);
  assert.match(director, /this\.canReview\(\)/);
});

test('Director guidance presents at most two field actions and keeps assessment details secondary', () => {
  assert.ok(workbench.includes('function captureActionLabel(capture)'));
  assert.match(workbench, /function writeActionLabel\(\)/);
  assert.match(workbench, /available\.slice\(0,2\)\.forEach/);
  assert.match(workbench, /button\.dataset\.suggestionKind = action\.kind/);
  assert.match(workbench, /dataset\.captureAction = 'true'/);
  assert.match(workbench, /dataset\.guidedWrite = 'true'/);
  assert.match(workbench, /studio-dw-suggestions/);
  assert.match(workbench, /reviewCreativeCapture\(creativeCapture\)/);
  assert.match(workbench, /openRecommendedWrite/);
  assert.match(html, /id="studio-dw-suggestions"/);
  assert.match(html, /<details class="studio-dw-assessment-details">/);
  assert.match(html, /<summary>Creative assessment details<\/summary>/);
  assert.match(workbench, /return 'Write Scenes'/);
});

test('Scene revisions select saved Scenes, leaving changed fields to Director', () => {
  assert.match(workbench, /id === \(recommendations\.sceneId \|\| activeTarget\(\)\.sceneId\)/);
  assert.match(workbench, /whichever fields need changing: title, summary/);
  assert.match(workbench, /validateSceneRevisionDraft\(result, ids, selected, raw\)/);
  assert.doesNotMatch(workbench, /applySuggestedWriteFields/);
  assert.doesNotMatch(html, /id="studio-dw-batch-fields"/);
});
test('Project Write hints narrow reviewed field defaults without auto-applying',()=>{
  assert.match(workbench,/bridge\.prepareWrite\(operation, id, item && storyName\(item\),\s*Array\.isArray\(writeFields\) \? writeFields : recommendedWriteFields\(operation\)\)/);
  assert.match(director,/if \(kind === 'project'\) return prepareStudioBrief\(writeFields\)/);
  assert.match(director,/checkbox\.checked = checkbox\.checked && writeFields\.indexOf\(field\) !== -1/);
});
