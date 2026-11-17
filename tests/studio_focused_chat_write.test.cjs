'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const chat=fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'../tool/server/app.py'),'utf8');
const guidance=fs.readFileSync(path.join(__dirname,'../tool/server/studio_director.py'),'utf8');
const workbench=fs.readFileSync(path.join(__dirname,'../tool/js/studio_director_workbench.js'),'utf8');

function segment(source,begin,end){
  const a=source.indexOf(begin), b=source.indexOf(end,a+begin.length);
  assert.ok(a>=0&&b>a,'Missing code boundary: '+begin);
  return source.slice(a,b);
}

const composeSource=segment(chat,'  function studioConversationMessages(messages) {',
  '  function studioApprovedReadSources() {');
const makeComposer=new Function('requestJson',composeSource+
  'return {studioConversationMessages,studioDirectorRequestMessages};');
const make=()=>makeComposer(async()=>({
  system:'Focused project/scene authoring guidance',
  chatSystem:'Discuss creative options in natural language.',
  promptContract:'Production-specific H3 formatting'
}));

test('ordinary Studio Chat has prose guidance and no authoring response schema',()=>{
  const route=segment(app,'@app.route("/fs/director/chat", methods=["POST"])',
    '@app.route("/fs/storyboard/director",');
  assert.doesNotMatch(route,/if operation == "studio_chat":\s*contract\["response_schema"\]/);
  assert.match(guidance,/def chat_guidance\(\):/);
  assert.match(guidance,/"chatSystem": chat_guidance\(\)/);
  const conversational=segment(chat,'  function studioDirectorChatRequestMessages(',
    '  // Retain available conversational work');
  assert.match(conversational,/studioDirectorRequestMessages\(messages, false, false,/);
  assert.doesNotMatch(conversational,/STUDIO CONVERSATION DELIVERY|RECENT UNSAVED MATERIAL AUTHORED/);
  const response=segment(chat,"        var assistantText = String(result.text || '').trim();",
    '        var assistantIndex = messages.length - 1;\n        elapsedMap');
  assert.doesNotMatch(response,/studioAuthoredWriteActions\(|presentAction\(/);
  assert.match(response,/Director returned structured data to a conversational request/);
});

test('whole conversation including previous assistant responses is supplied unchanged',async()=>{
  const composer=make();
  const discussion=Array.from({length:24},(_,i)=>({
    role:i%2?'assistant':'user',content:'turn '+i+' '+('x'.repeat(3100))
  }));
  const system=await composer.studioDirectorRequestMessages(discussion,false,false);
  assert.equal(system.length,25);
  assert.equal(system[0].content,'Discuss creative options in natural language.');
  assert.deepEqual(system.slice(1),discussion);
  assert.doesNotMatch(system[0].content,/H3 PROMPT AUTHORING REFERENCE/);
});

test('backend receipts are excluded by role/provenance, not interpreted from conversation meaning',()=>{
  const composer=make();
  const actual=[
    {role:'user',content:'A lighthouse at dusk'},
    {role:'assistant',content:'The keeper sees a glow offshore.'},
    {role:'user',content:'Saved Project\n[WEBCAP APPLIED FIELD VALUES]\n{"id":"p1"}'},
    {role:'user',content:'Could it be farther away?'},
    {role:'assistant',content:'Yes, that increases tension.'}
  ];
  assert.deepEqual(composer.studioConversationMessages(actual).map(x=>x.content),[
    actual[0].content,actual[1].content,actual[3].content,actual[4].content
  ]);
});

test('Write receives a separate authoring contract and full discussion',async()=>{
  const composer=make();
  const discussion=Array.from({length:18},(_,i)=>({
    role:i%2?'assistant':'user',content:'creative turn '+i
  }));
  const messages=await composer.studioDirectorRequestMessages(discussion,true,true);
  assert.equal(messages.length,discussion.length+1);
  assert.match(messages[0].content,/Focused project\/scene authoring guidance/);
  assert.match(messages[0].content,/H3 PROMPT AUTHORING REFERENCE/);
  assert.match(messages[0].content,/Production-specific H3 formatting/);
  assert.deepEqual(messages.slice(1),discussion);
  assert.doesNotMatch(chat,/\.slice\(-8\)|Earlier long message abbreviated/);
});

test('explicit Write reuses direct Project/Scene save routes, preserving old data compatibility',()=>{
  assert.match(chat,/function commitFocusedStudioProject\(/);
  assert.match(chat,/return commitFocusedStudioProject\(state\.studioProjectProposal\)/);
  assert.match(chat,/function commitFocusedStudioBrief\(/);
  assert.match(chat,/return commitFocusedStudioBrief\(storyId,expected,changes,requestedFields\)/);
  assert.match(workbench,/forceAuthor:true, directSave:true/);
  assert.match(chat,/discussion:studioConversationMessages\(state\.modeMessages\.storyboard\)/);
  assert.match(chat,/function parseStudioChatResponse\(raw\)/,
    'legacy stored chat responses remain readable');
  assert.match(chat,/function showStudioProjectReview\(/,
    'older saved proposals remain compatible, not destroyed by migration');
});
