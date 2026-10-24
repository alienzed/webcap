'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('tool/js/diagnostics.js','utf8');
const start = source.indexOf('function diagnosticsAssessmentMeasurement(');
const end = source.indexOf('function diagnosticsAssessmentRefreshLiveMetrics(',start);
assert.ok(start>=0 && end>start);
const ctx=vm.createContext({});
vm.runInContext(source.slice(start,end),ctx);

test('Director and Vision speeds use separate measurements including failed probes',()=>{
  const runs=[{protocol:'webcap-model-assessment-structured-v2',models:{'local::both':{
    director_scene_plan_2048:{counts:{failed:1},generationSpeedSamples:[4]},
    director_thinking:{counts:{completed:1},generationSpeedSamples:[6]},
    vision_open:{counts:{failed:1},generationSpeedSamples:[42]},
    vision_group_aware:{counts:{completed:1},generationSpeedSamples:[38]}
  }}}];
  assert.equal(ctx.diagnosticsAssessmentMeasurement(runs,'local::both',false).rate,5);
  assert.equal(ctx.diagnosticsAssessmentMeasurement(runs,'local::both',true).rate,40);
  assert.equal(ctx.diagnosticsAssessmentMeasurement(runs,'local::both',true).native,true);
});
test('effective measurements are marked approximate, imported measurements are identified',()=>{
  const runs=[{models:{'local::both':{vision_open:{counts:{failed:1},throughputSamples:[12]}}}},
    {importedFrom:{host:'other'},models:{'local::both':{director_scene_plan_2048:{counts:{completed:1},generationSpeedSamples:[22]}}}}];
  const children={
    '[data-assessment-director-speed]':{textContent:'',title:''},
    '[data-assessment-vision-speed]':{textContent:'',title:''},
    '[data-assessment-output]':{textContent:'',title:''}
  };
  const row={dataset:{assessmentModel:'local::both',assessmentRole:'both'},
    assessmentSort:{},
    querySelector:s=>children[s]};
  ctx.diagnosticsAssessmentApplyMeasurements(row,runs);
  assert.equal(children['[data-assessment-director-speed]'].textContent,'22.0*');
  assert.match(children['[data-assessment-director-speed]'].title,/imported source hardware/);
  assert.equal(children['[data-assessment-vision-speed]'].textContent,'≈12.0');
  assert.equal(row.assessmentSort.directorSpeed,null,'imported speed should not rank local models');
  assert.equal(row.assessmentSort.visionSpeed,12);
  assert.equal(children['[data-assessment-output]'].textContent,'—');
});
