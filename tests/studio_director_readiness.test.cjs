const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const director = fs.readFileSync(path.join(__dirname, '..', 'tool/js/director_chat.js'), 'utf8');
const workbench = fs.readFileSync(path.join(__dirname, '..', 'tool/js/studio_director_workbench.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'tool/tool.html'), 'utf8');
function part(start, end) {
  const i = director.indexOf(start), j = director.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i, 'Missing Studio section ' + start);
  return director.slice(i, j);
}
const parse = new Function(part('  function parseStudioReadinessJson(raw) {',
  '  function storyboardRequestMessages(messages, includePrimer) {') +
  '\nreturn parseStudioReadinessJson;')();
const valid = {
  checks:[{name:'Concept',scope:'project',ready:true,content:'A scene with dialogue, and "quotation" marks'}],
  readHints:['project.concept'],writeHint:'project',sceneId:''
};
function processResponse(text, accept=true) {
  const state = {studioReadiness:{...valid, stale:true}};
  const statuses=[],failures=[];
  const window = {
    studioDirectorWorkbench: {
      updateReadiness: data => {
        if (!accept) return false;
        state.studioReadiness = {...data, stale:false};
        return true;
      },
      setReadinessFreshness: stale => statuses.push('freshness:'+stale),
      setStatus: msg => statuses.push(msg)
    },
    reportConsoleError: (label, err) => failures.push(label+': '+err.message)
  };
  const studioActionStatus = msg => statuses.push(msg);
  const code = part("        var assistantText = String(result.text || '');",
    "        messages.push({ role: 'assistant', content: assistantText });");
  const response = new Function('result','activeChatMode','state','window','studioActionStatus',
    'parseStudioReadinessJson',code + '\nreturn assistantText;');
  return {text:response({text},'storyboard',state,window,studioActionStatus,parse),
    state,statuses,failures};
}
test('accepts normal JSON and repairs fenced trailing commas without altering quoted commas',()=>{
  assert.deepEqual(parse(JSON.stringify(valid)),valid);
  const fence=String.fromCharCode(96).repeat(3);
  const text='Introductory conversation.\n[[WEBCAP_READINESS]]'+fence+'json\n'+
    JSON.stringify(valid).replace('}],"readHints"', '},],"readHints"')
      .replace('"sceneId":""}', '"sceneId":"",}') +
    '\n'+fence+'[[END_WEBCAP_READINESS]]';
  const processed=processResponse(text);
  assert.equal(processed.text,'Introductory conversation.');
  assert.equal(processed.state.studioReadiness.stale,false);
  assert.equal(processed.state.studioReadiness.checks[0].content,valid.checks[0].content);
  assert.deepEqual(processed.failures,[]);
});
test('normal JSON containing only readiness is not misdiagnosed as malformed',()=>{
  const response=processResponse('[[WEBCAP_READINESS]]'+JSON.stringify(valid)+'[[END_WEBCAP_READINESS]]');
  assert.equal(response.state.studioReadiness.stale,false);
  assert.match(response.text,/no conversational reply/);
  assert.ok(response.failures.some(x=>x.includes('conversation')));
  assert.ok(!response.failures.some(x=>x.includes('readiness JSON')));
});
test('unrepairable JSON retains the previous assessment and labels it outdated',()=>{
  const response=processResponse('Hello!\n[[WEBCAP_READINESS]]{"checks":[bad}[[END_WEBCAP_READINESS]]');
  assert.equal(response.text,'Hello!');
  assert.equal(response.state.studioReadiness.stale,true);
  assert.deepEqual(response.state.studioReadiness.checks,valid.checks);
  assert.ok(response.failures.some(x=>x.includes('Studio readiness JSON')));
  assert.ok(response.statuses.some(x=>x.includes('outdated')));
});
test('parseable but unsupported fields are rejected separately from JSON syntax',()=>{
  const response=processResponse('Hello!\n[[WEBCAP_READINESS]]'+JSON.stringify(valid)+'[[END_WEBCAP_READINESS]]',false);
  assert.equal(response.text,'Hello!');
  assert.equal(response.state.studioReadiness.stale,true);
  assert.ok(response.failures.some(x=>x.includes('Studio readiness fields')));
  assert.ok(!response.failures.some(x=>x.includes('Studio readiness JSON')));
});
test('missing or partial readiness stays outdated instead of erasing the last assessment',()=>{
  const omitted=processResponse('Here is a creative suggestion.');
  assert.equal(omitted.text,'Here is a creative suggestion.');
  assert.equal(omitted.state.studioReadiness.stale,true);
  assert.deepEqual(omitted.state.studioReadiness.checks,valid.checks);
  assert.ok(omitted.statuses.some(x=>x.includes('outdated')));
  const partial=processResponse('Thoughts.\n[[WEBCAP_READINESS]]{"checks":');
  assert.equal(partial.text,'Thoughts.');
  assert.ok(partial.failures.some(x=>x.includes('end delimiter')));
});
test('workbench exposes freshness and only accepted assessments are stored',()=>{
  assert.match(html,/id="studio-dw-readiness-freshness"/);
  assert.match(workbench,/setReadinessFreshness:setReadinessFreshness/);
  assert.match(workbench,/return false;/);
  assert.match(workbench,/stale:false/);
  assert.match(director,/markStudioReadinessOutdated\(\)/);
  assert.match(director,/state\.studioReadiness = Object\.assign\(\{\}, state\.studioReadiness, \{stale:true\}\)/);
});

test('capture is optional, bounded and remains editable authoring material, not an applied action', () => {
  const capture = {field:'concept', content:'A complete, original creative premise.', sceneId:''};
  const proposal = {...valid, capture};
  assert.deepEqual(parse(JSON.stringify(proposal)).capture, capture);
  const response = processResponse('A concise suggestion.\n[[WEBCAP_READINESS]]'+
    JSON.stringify(proposal)+'[[END_WEBCAP_READINESS]]');
  assert.equal(response.text, 'A concise suggestion.');
  assert.deepEqual(response.state.studioReadiness.capture, capture);
  assert.match(director, /reviewCapture: function \(capture, storyId\)/);
  assert.match(director, /showStudioBriefReview\(\)/);
  assert.match(workbench, /creativeCapture = capture/);
  assert.match(workbench, /'Review ' \+ fieldName \+ ' change'/);
  assert.match(workbench, /return showSceneReview\(story, sceneTarget/);
  assert.match(workbench, /setReadinessFreshness/);
});

test('Invariant capture uses explicit saved identity rather than treating renames as additions', () => {
  const capture = {
    field:'invariant',content:'Short dark hair and a red scarf.',sceneId:'',
    kind:'character',title:'Alicia',beforeKind:'character',beforeTitle:'Alice'
  };
  assert.deepEqual(parse(JSON.stringify({...valid,capture})).capture,capture);
  assert.match(director, /var redirect = \(proposal\.renames \|\| \[\]\)/);
  assert.match(director, /capture\.beforeKind && capture\.beforeTitle/);
  assert.match(director, /proposed\.invariants\[index\] = after/);
  assert.match(director, /Review and edit before saving/);
  assert.match(workbench, /isInvariant = capture\.field === 'invariant'/);
  assert.match(workbench, /creativeCapture = capture/);
});
