(function () {
  'use strict';
  var folder = '', runs = [], report = null, generation = 0;
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
  function points() {return (report && report.campaigns || []).find(function(c) {return c.id===el('campaign').value;});}
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
    if (!report || !report.jobId) return;
    var campaigns=report.campaigns || [], old=el('campaign').value;
    el('campaign').innerHTML='<option value="">Choose one campaign…</option>'+campaigns.map(function(c) {
      return '<option value="'+esc(c.id)+'">'+esc(c.name+' · '+c.id.slice(0,6))+'</option>';
    }).join('');
    if(campaigns.some(function(c){return c.id===old;})) el('campaign').value=old;
    else if(campaigns.length) el('campaign').value=campaigns[0].id;
    var c=report.coverage || {};
    var fields=[['Saved epochs',c.savedEpochs],['Evaluated epochs',c.observedEpochs],['Campaigns',c.campaigns],['Test sessions',c.testSessions],['Campaign VL renders',c.campaignVlRenders],['Manual ratings',c.manualRatings],['Test VL judgments',c.testVlJudgments]];
    el('coverage').innerHTML='<div class="run-analytics-stat-grid">'+fields.map(function(entry) {return '<div><strong>'+Number(entry[1]||0)+'</strong><span>'+esc(entry[0])+'</span></div>';}).join('')+'</div>';
    renderCampaign();
    var warnings=report.warnings || [];
    el('warnings').innerHTML=warnings.map(function(w){return '<p class="epoch-finder-error">'+esc(w)+'</p>';}).join('');
  }
  function renderCampaign() {
    if(!report) return;
    var c=points(), pointsForCampaign=c?c.points:[], test=report.testPoints||[];
    el('chart-note').textContent=c?'Original VL fidelity · '+c.name+' · '+c.visionModel+' · '+c.status+'. Other evaluation protocols are excluded from this line.':'Select an Epoch Finder campaign to chart its original VL fidelity.';
    el('chart').innerHTML=(c?chart(pointsForCampaign,'score','Campaign VL fidelity',pct,1):'')+
      chart(test,'manual','Test manual rating (1–5)',function(x){return x.toFixed(2)+' / 5';},null)+
      chart(report.lossPoints||[],'loss','Archived training epoch loss',function(x){return x.toFixed(4);},null);
    var index={};
    (report.epochs||[]).forEach(function(epoch){index[epoch]={epoch:epoch};});
    pointsForCampaign.forEach(function(p){index[p.epoch].campaign=p;});
    test.forEach(function(p){index[p.epoch].test=p;});
    (report.lossPoints||[]).forEach(function(p){index[p.epoch].loss=p.loss;});
    var rows=Object.keys(index).map(Number).sort(function(a,b){return a-b;}).map(function(epoch){
      var p=index[epoch],cp=p.campaign||{},t=p.test||{};
      return '<tr><td>'+epoch+'</td><td>'+pct(cp.score)+'</td><td>'+(cp.observations==null?'—':Number(cp.observations).toFixed(1))+'</td><td>'+
        (t.manual==null?'—':Number(t.manual).toFixed(2)+' / 5')+'</td><td>'+ (t.manualCount||0)+'</td><td>'+pct(t.testVl)+'</td><td>'+(t.testVlCount||0)+'</td><td>'+
        (p.loss==null?'—':Number(p.loss).toFixed(4))+'</td><td>'+(c&&cp.observations!=null?'<button type="button" data-inspect-campaign="'+esc(c.id)+'">Inspect</button>':'')+'</td></tr>';
    }).join('');
    el('table').innerHTML=rows?'<div class="run-analytics-table-wrap"><table><thead><tr><th>Epoch</th><th>Campaign VL</th><th>Weighted observations</th><th>Manual</th><th>Ratings</th><th>Test VL</th><th>Judgments</th><th>Loss</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<p class="epoch-finder-muted">No saved checkpoint measurements.</p>';
    var measurable=pointsForCampaign.filter(function(p){return p.score!=null;});
    measurable.sort(function(a,b){return b.score-a.score || b.observations-a.observations || a.epoch-b.epoch;});
    el('findings').innerHTML=measurable.length?'<p>Highest measured fidelity within <strong>'+esc(c.name)+'</strong>: epoch '+measurable[0].epoch+' ('+pct(measurable[0].score)+', '+measurable[0].observations+' weighted observations). This is not a confirmed best checkpoint.</p>':
      '<p class="epoch-finder-muted">No scoreable campaign observations. Measurements in other columns remain separate.</p>';
  }
  function load() {
    var jobId=el('run').value, token=++generation, source=folder;
    if (!jobId) {report=null;el('coverage').textContent='Select a training run first.';return;}
    clearError();el('analyze').disabled=true;el('analyze').textContent='Analyzing saved evidence…';
    api(jobId).then(function(payload){if(token!==generation||source!==folder)return;report=payload;render();})
      .catch(function(exc){if(token===generation)error(exc);})
      .finally(function(){if(token===generation){el('analyze').disabled=false;el('analyze').textContent='Analyze';}});
  }
  function discover() {
    var token=++generation, source=folder, previous=el('run').value;
    clearError();el('coverage').textContent='Discovering existing run evidence…';
    api('').then(function(payload){
      if(token!==generation||source!==folder)return;
      runs=payload.runs||[];
      el('run').innerHTML='<option value="">Choose training run…</option>'+runs.map(function(run){
        return '<option value="'+esc(run.jobId)+'">'+esc(run.label+' · '+(run.stage||run.source)+(run.archive?' · archived':''))+'</option>';
      }).join('');
      if(runs.some(function(run){return run.jobId===previous;}))el('run').value=previous;
      if(el('run').value)load();
      else el('coverage').textContent=runs.length?'Select a run and Analyze.':'No saved runs or campaign evidence for this Set.';
    }).catch(function(exc){if(token===generation)error(exc);});
  }
  window.runAnalyticsPrepare=function(next){if(next===folder)return;folder=next;report=null;runs=[];generation++;
    el('run').innerHTML='<option value="">Choose training run…</option>';el('coverage').textContent='Choose a training run to begin.';
    el('chart').innerHTML='';el('table').innerHTML='';el('findings').innerHTML='';el('warnings').innerHTML='';clearError();};
  window.runAnalyticsOpen=discover;
  el('run').onchange=function(){report=null;el('chart').innerHTML='';el('table').innerHTML='';el('findings').innerHTML='';el('coverage').textContent='Select Analyze to read evidence.';};
  el('analyze').onclick=load;
  el('campaign').onchange=renderCampaign;
  el('table').onclick=function(event){var btn=event.target.closest('[data-inspect-campaign]');if(btn)window.epochFinderInspectCampaign(btn.dataset.inspectCampaign);};
})();
