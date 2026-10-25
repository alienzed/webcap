'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  const vocab = {
    Background: ['plain background'],
    Clothing: ['bikini', 'jacket'],
    Position: ['standing', 'kneeling'],
    Jewelry: ['ring', 'necklace'],
    'BT Shape': ['triangle', 'teardrop'],
    'BT Back': ['ring connectors', 'chain-link connectors'],
    Viewpoint: ['side', 'rear'],
    Lighting: ['soft lighting'],
    Surface: ['bench'],
    Setting: ['bedroom']
  };
  const sandbox = {
    window: {},
    getMetadataForMedia: () => ({}),
    getRequirementGroupAlias: () => '',
    getChecklistKeywordTermsForRequirement: group => vocab[group] || [],
    getChecklistRequirementsForTag: term => Object.keys(vocab).filter(group =>
      vocab[group].includes(term))
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('tool/js/sight_group_suggestions.js', 'utf8'), sandbox);
  return { get: sandbox.window.getSightGroupSuggestionRows,
    split: sandbox.window.splitSightDescription };
}
function media(description, inventory) {
  return {fileName:'one.jpg',metadata:{vision_sight:{description,inventory}}};
}

test('background observations stay distinct and no valid candidate count is truncated', () => {
  const f=fixture();
  const values=Array.from({length:12},(_,i)=>'detail '+(i+1));
  const rows=f.get(media('Wall, curtains and window', {
    background: values, setting:['bedroom']}),'Background');
  assert.equal(rows.length,12);
  assert.equal(rows[11].term,'detail 12');
  assert.ok(rows.every(row=>row.group==='Background'&&row.kind==='phrase'));
});

test('Sight uses explicit category for broad Groups without vocabulary contamination', () => {
  const f=fixture();
  const item=media('A bedroom with soft lighting, a wooden bench', {
    lighting:['soft lighting'],surface:['wooden bench'],setting:['bedroom'],
    background:['curtains']});
  assert.equal(f.get(item,'Lighting')[0].kind,'tag');
  assert.equal(f.get(item,'Surface')[0].term,'wooden bench');
  assert.equal(f.get(item,'Setting')[0].kind,'tag');
  assert.ok(!f.get(item,'Clothing').some(x=>x.term==='wooden bench'));
});

test('novel phrases can map to custom groups via distinct vocabulary anchors', () => {
  const f=fixture();
  const item=media('A triangle bikini top, thin straps', {
    things:[{name:'triangle bikini top',qualities:['yellow']}],
    details:['triangle bikini top'],background:['white wall']});
  const shape=f.get(item,'BT Shape');
  assert.ok(shape.some(row=>row.term==='triangle bikini top'&&row.kind==='phrase'));
  assert.ok(!f.get(item,'BT Back').some(row=>row.term==='triangle bikini top'));
  assert.ok(!f.get(item,'Background').some(row=>row.term==='triangle bikini top'));
});

test('common and ambiguous words are not enough to classify unrelated objects', () => {
  const f=fixture();
  const item=media('A standing lamp with ring connectors in side view', {
    details:['standing lamp','ring connectors','side table']});
  assert.equal(f.get(item,'Position').length,0);
  assert.equal(f.get(item,'Jewelry').length,0);
  assert.equal(f.get(item,'Viewpoint').length,0);
});

test('description splitting retains coordinate color phrases and short verbatim context',()=>{
  const f=fixture();
  const chunks=Array.from(f.split('black and white striped wall, wooden dresser and open window'));
  assert.deepEqual(chunks,['black and white striped wall','wooden dresser','open window']);
  const item=media('White tiled wall with a window, wooden dresser', {
    background:['white tiled wall']});
  assert.ok(f.get(item,'Background').some(row=>
    row.term==='White tiled wall with a window'&&row.source==='description'));
});

test('partial item metadata still reads the existing metadata cache',()=>{
  const f=fixture();
  const cached=media('A red wall', {background:['red wall']}).metadata;
  // The item carries partial metadata, but its saved Sight is in the Set cache.
  const sandbox={window:{},getMetadataForMedia:()=>cached,
    getRequirementGroupAlias:()=>'',getChecklistKeywordTermsForRequirement:()=>[],
    getChecklistRequirementsForTag:()=>[]};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('tool/js/sight_group_suggestions.js','utf8'),sandbox);
  assert.equal(sandbox.window.getSightGroupSuggestionRows(
    {fileName:'one.jpg',metadata:{}},'Background')[0].term,'red wall');
});

test('empty and missing evidence is a normal no-suggestion result',()=>{
  const f=fixture();
  assert.equal(f.get({fileName:'no.jpg',metadata:{}},'Background').length,0);
  assert.equal(f.get(media('Nothing',{}),'Background').length,0);
});

test('Focus Annotate insertion updates only the editor through existing autosave',()=>{
  const source=fs.readFileSync('tool/js/focused_annotation.js','utf8');
  const begin=source.indexOf('function insertFocusedAnnotationSightPhrase(phrase) {');
  const end=source.indexOf('function addFocusedAnnotationSightTag(',begin);
  assert.ok(begin>0&&end>begin);
  const input={value:'A woman posing',selectionStart:3,selectionEnd:3,
    focus(){this.focused=true;},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}};
  let saved=0;
  const sandbox={
    ui:{editorEl:input},state:{currentItem:{key:'one'}},
    document:{activeElement:null},setStatus(){},
    applyEditorTextAndTriggerInput(text){input.value=text;saved++;}
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(begin,end)+'this.insert=insertFocusedAnnotationSightPhrase;',sandbox);
  assert.equal(sandbox.insert('white wall'),true);
  assert.equal(input.value,'A woman posing, white wall');
  assert.equal(saved,1);
  assert.equal(sandbox.insert('white wall'),false);
  assert.equal(saved,1);
});
