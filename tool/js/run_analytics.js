(function () {
  'use strict';
  var folder = '', runs = [], report = null, generation = 0, selection = new Set(), sessionFilter = '', directorJob = ''; 
  function el(id) { return document.getElementById('run-analytics-' + id); }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
  }); }
  function api(jobId) {
    return fetch('/fs/epoch_finder', {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({folder:folder,operation:'run_analytics',criteria:{jobId:jobId || ''}})})
      .then(function(response) {return response.json().then(function(payload) {
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Run Analytics failed.');
        return payload;
      });});
  }
  function error(exc) {
    el('error').textContent = String(exc.message || exc);
    el('error').classList.remove('hidden');
    window.reportConsoleError('Run Analytics', exc);
  }
  function clearError() {el('error').classList.add('hidden');el('error').textContent='';}
  function pct(value) {return value == null ? '—' : (Number(value)*100).toFixed(1)+'%';}
  function points() {return null;}
  function chosenCampaign() {return (report && report.campaigns || []).find(function(c) {return c.id === el('campaign').value;});}
  function chart(series, key, title, formatter, max) {
    var observed = series.filter(function(p) {return Number.isFinite(p[key]);});
    if (!observed.length) return '<p class="epoch-finder-muted">No recorded '+esc(title)+' points.</p>';
    var width=780,height=198,pad=35;
    var xs=observed.map(function(p) {return p.epoch;});
    var minX=Math.min.apply(null,xs),maxX=Math.max.apply(null,xs);
    var ys=observed.map(function(p) {return p[key];});
    var minY=max===1?0:Math.min.apply(null,ys);
    var maxY=max===1?1:Math.max.apply(null,ys);
    if(maxY===minY) maxY=minY+1;
    function x(v) {return pad+(v-minX)/(maxX-minX||1)*(width-2*pad);}
    function y(v) {return height-pad-(v-minY)/(maxY-minY)*(height-2*pad);}
    var ordered=observed.slice().sort(function(a,b){return a.epoch-b.epoch;});
    var segments=ordered.map(function(p,i) {return (i && p.epoch===ordered[i-1].epoch+1?'L':'M')+x(p.epoch).toFixed(1)+','+y(p[key]).toFixed(1);}).join(' ');
    var markers=ordered.map(function(p){return '<circle cx="'+x(p.epoch)+'" cy="'+y(p[key])+'" r="5"><title>Epoch '+p.epoch+' · '+formatter(p[key])+'</title></circle>';}).join('');
    return '<div class="run-analytics-chart"><strong>'+esc(title)+'</strong><svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+esc(title)+' by epoch">' +
      '<path d="M'+pad+' '+pad+'V'+(height-pad)+'H'+(width-pad)+'" class="run-analytics-axis"/>' +
      '<path d="'+segments+'" class="run-analytics-line"/>'+markers+'</svg><small>Epoch '+minX+' – '+maxX+' · '+observed.length+' measured points; no interpolation across missing epochs</small></div>';
  }
  function render() {
    if (!report || !report.reports) return;
    var campaigns=report.campaigns || [], old=el('campaign').value;
    el('campaign').innerHTML='<option value="">Choose one campaign…</option>'+campaigns.map(function(c) {
      return '<option value="'+esc(c.id)+'">'+esc(c.name+' · '+c.id.slice(0,6))+'</option>';
    }).join('');
    if(campaigns.some(function(c){return c.id===old;})) el('campaign').value=old;
    else el('campaign').value='';
    var previousSession=el('session').value;
    el('session').innerHTML='<option value="">All sessions (descriptive only)</option>'+(report.availableSessions||[]).map(function(name){return '<option value="'+esc(name)+'">'+esc(name)+'</option>';}).join('');
    if((report.availableSessions||[]).includes(previousSession))el('session').value=previousSession;
    var c={};
    (report.reports||[]).forEach(function(item){Object.keys(item.coverage||{}).forEach(function(key){c[key]=(c[key]||0)+Number(item.coverage[key]||0);});});
    var fields=[['Saved epochs',c.savedEpochs],['Evaluated epochs',c.observedEpochs],['Campaigns',c.campaigns],['Test sessions',c.testSessions],['Campaign VL renders',c.campaignVlRenders],['Manual ratings',c.manualRatings],['Test VL judgments',c.testVlJudgments]];
    el('coverage').innerHTML='<div class="run-analytics-stat-grid">'+fields.map(function(entry) {return '<div><strong>'+Number(entry[1]||0)+'</strong><span>'+esc(entry[0])+'</span></div>';}).join('')+'</div>';
    renderCampaign();
    el('director').disabled=false;
    var warnings=report.warnings || [];
    el('warnings').innerHTML=warnings.map(function(w){return '<p class="epoch-finder-error">'+esc(w)+'</p>';}).join('');
  }
  function renderCampaign() {
    if (!report || !report.reports) return;
    var campaignId=el('campaign').value;
    var campaign=chosenCampaign();
    var rows=[], views=[];
    (report.reports||[]).forEach(function(r) {
      var c=(r.campaigns||[]).find(function(item){return item.id===campaignId;});
      var tests=r.testPoints||[];
      views.push('<h4>'+esc(r.run.label)+'</h4>'+
        (c ? chart(c.points,'score','Campaign VL fidelity · '+r.run.label,pct,1):'')+
        chart(tests,'manual','Manual rating · '+r.run.label,function(v){return v.toFixed(2)+' / 5';},null)+
        chart(r.lossPoints||[],'loss','Training loss · '+r.run.label,function(v){return v.toFixed(4);},null));
      var indexed={};
      (r.epochs||[]).forEach(function(n){indexed[n]={epoch:n};});
      (c?c.points:[]).forEach(function(p){indexed[p.epoch].campaign=p;});
      tests.forEach(function(p){indexed[p.epoch].test=p;});
      (r.lossPoints||[]).forEach(function(p){indexed[p.epoch].loss=p.loss;});
      Object.keys(indexed).map(Number).sort(function(a,b){return a-b;}).forEach(function(epoch){
        var p=indexed[epoch], cp=p.campaign||{},t=p.test||{};
        rows.push('<tr><td>'+esc(r.run.label)+'</td><td>'+epoch+'</td><td>'+pct(cp.score)+'</td><td>'+
          (cp.observations==null?'—':Number(cp.observations).toFixed(1))+'</td><td>'+
          (t.manual==null?'—':Number(t.manual).toFixed(2))+'</td><td>'+(t.manualCount||0)+'</td><td>'+pct(t.testVl)+'</td><td>'+
          (p.loss==null?'—':Number(p.loss).toFixed(4))+'</td><td>'+
          (c&&cp.observations!=null?'<button type="button" data-inspect-campaign="'+esc(c.id)+'">Inspect campaign</button>':'')+'</td></tr>');
      });
    });
    el('chart-note').textContent=campaign?'Same-campaign comparison · '+campaign.name+' · '+campaign.visionModel:
      'Select a campaign to show comparable VL fidelity. Manual ratings and loss remain independent descriptive evidence.';
    el('chart').innerHTML=views.join('');
    el('table').innerHTML='<div class="run-analytics-table-wrap"><table><thead><tr><th>Run</th><th>Epoch</th><th>Campaign VL</th><th>Observations</th><th>Manual</th><th>Ratings</th><th>Test VL</th><th>Loss</th><th></th></tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
    el('findings').textContent=campaign?'Selected '+campaign.runs.length+' participating run(s) in the same campaign. Read values with their observation counts.':
      'Campaign filtering prevents accidental cross-protocol comparisons. Selecting multiple runs does not combine their scores.';
    el('director-result').textContent='';el('director-status').textContent='';
  }
  function load() {
    var ids=Array.from(selection), token=++generation, origin=folder;
    if(!ids.length){el('coverage').textContent='Select at least one run.';return;}
    clearError();el('analyze').disabled=true;el('analyze').textContent='Reading saved evidence…';
    fetch('/fs/epoch_finder',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({folder:folder,operation:'run_analytics_selected',criteria:{jobIds:ids,session:sessionFilter}})})
      .then(function(response){return response.json().then(function(data){if(!response.ok||!data.ok)throw new Error(data.error||'Analytics failed.');return data;});})
      .then(function(data){if(token===generation&&origin===folder){report=data;render();}})
      .catch(function(exc){if(token===generation)error(exc);})
      .finally(function(){if(token===generation){el('analyze').disabled=false;el('analyze').textContent='Analyze selected';}});
  }
  function discover() {
    var token=++generation, origin=folder;
    clearError();el('coverage').textContent='Finding recorded runs…';
    api('').then(function(data){
      if(token!==generation||origin!==folder)return;
      runs=data.runs||[];
      selection=new Set(Array.from(selection).filter(function(id){return runs.some(function(run){return run.jobId===id;});}));
      el('run-choices').innerHTML=runs.map(function(run){
        return '<label class="epoch-finder-run-choice"><input type="checkbox" data-analytics-run="'+esc(run.jobId)+'"'+
          (selection.has(run.jobId)?' checked':'')+'><span><strong>'+esc(run.label)+'</strong><small>'+
          esc((run.stage||run.source)+(run.archive?' · archived':''))+'</small></span></label>';
      }).join('')||'<p class="epoch-finder-muted">No recorded runs in this Set.</p>';
      el('coverage').textContent='Select runs and Analyze.';
    }).catch(function(exc){if(token===generation)error(exc);});
  }
  window.runAnalyticsPrepare=function(next){
    if(next===folder)return;folder=next;generation++;runs=[];selection=new Set();report=null;sessionFilter='';
    el('run-choices').innerHTML='';el('coverage').textContent='Choose a run to begin.';
    el('chart').innerHTML='';el('table').innerHTML='';el('findings').innerHTML='';el('warnings').innerHTML='';
    el('campaign').innerHTML='<option value="">No campaign</option>';el('session').innerHTML='<option value="">All sessions</option>';
    el('director').disabled=true;el('director-result').textContent='';el('director-status').textContent='';clearError();
  };
  window.runAnalyticsOpen=discover;
  el('run-choices').onchange=function(event){
    var cb=event.target.closest('[data-analytics-run]');if(!cb)return;
    if(cb.checked)selection.add(cb.dataset.analyticsRun);else selection.delete(cb.dataset.analyticsRun);
    if(selection.size>6){selection.delete(cb.dataset.analyticsRun);cb.checked=false;error(new Error('Select up to six runs.'));}
  };
  el('analyze').onclick=load;
  el('session').onchange=function(){sessionFilter=this.value;load();};
  el('campaign').onchange=renderCampaign;
  el('director').onclick=function(){if(!report)return;el('director-status').textContent='Director integration requires a verified backend contract.';};
  el('table').onclick=function(event){var btn=event.target.closest('[data-inspect-campaign]');if(btn)window.epochFinderInspectCampaign(btn.dataset.inspectCampaign);};
})();
