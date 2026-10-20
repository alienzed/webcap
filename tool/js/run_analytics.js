(function () {
  'use strict';
  var folder = '', runs = [], report = null, generation = 0, previewGeneration = 0, resultEpochGeneration = 0, selection = new Set(), sessionFilter = '', directorJob = '', directorContext = '', selectedCohort = '', previewFacts = null, previewKey = ''; 
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
  function updateScopeUi() {
    el('selection-count').textContent = selection.size + ' / 6 runs selected';
    el('analyze').disabled = !selection.size;
    ['campaign','session','cohort'].forEach(function (name) { el(name).disabled = !report; });
    el('director').disabled = !report || !!directorJob;
  }
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
    var segments=ordered.map(function(p,i) {return (i?'L':'M')+x(p.epoch).toFixed(1)+','+y(p[key]).toFixed(1);}).join(' ');
    var markers=ordered.map(function(p){return '<circle cx="'+x(p.epoch)+'" cy="'+y(p[key])+'" r="5"><title>Epoch '+p.epoch+' · '+formatter(p[key])+'</title></circle>';}).join('');
    return '<div class="run-analytics-chart"><strong>'+esc(title)+'</strong><svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+esc(title)+' by epoch">' +
      '<path d="M'+pad+' '+pad+'V'+(height-pad)+'H'+(width-pad)+'" class="run-analytics-axis"/>' +
      '<path d="'+segments+'" class="run-analytics-line"/>'+markers+'</svg><small>Epoch '+minX+' – '+maxX+' · '+observed.length+' observed checkpoints. Line connects only recorded measurements.</small></div>';
  }
  function render() {
    if (!report || !report.reports) return;
    var campaigns=report.campaigns || [], old=el('campaign').value;
    el('campaign').innerHTML='<option value="">Choose one campaign…</option>'+campaigns.map(function(c) {
      return '<option value="'+esc(c.id)+'">'+esc(c.name+' · '+c.id.slice(0,6))+'</option>';
    }).join('');
    if(campaigns.some(function(c){return c.id===old;})) el('campaign').value=old;
    else el('campaign').value=campaigns.length===1?campaigns[0].id:'';
    var previousSession=el('session').value;
    el('session').innerHTML='<option value="">All sessions (descriptive only)</option>'+(report.availableSessions||[]).map(function(name){return '<option value="'+esc(name)+'">'+esc(name)+'</option>';}).join('');
    if((report.availableSessions||[]).includes(previousSession))el('session').value=previousSession;
    var cohorts=[].concat.apply([],report.reports.map(function(r){return r.testCohorts||[];}));
    var oldCohort=selectedCohort;
    el('cohort').innerHTML='<option value="">Automatic (only if comparable)</option>'+cohorts.map(function(c){return '<option value="'+esc(c.id)+'">'+esc((c.modelId||'Test')+' · strength '+(c.strength==null?'default':c.strength)+' · '+(c.vlModelId||'manual')+' · '+c.id.slice(0,6))+'</option>';}).join('');
    el('cohort').value=cohorts.some(function(c){return c.id===oldCohort;})?oldCohort:'';selectedCohort=el('cohort').value;
    var c=Object.assign({},report.coverage||{});
    (report.reports||[]).forEach(function(item){Object.keys(item.coverage||{}).forEach(function(key){if(key!=='campaigns'&&key!=='testSessions')c[key]=(c[key]||0)+Number(item.coverage[key]||0);});});
    var fields=[['Saved epochs',c.savedEpochs],['Evaluated epochs',c.observedEpochs],['Campaigns',c.campaigns],['Test sessions',c.testSessions],['Campaign VL renders',c.campaignVlRenders],['Manual ratings',c.manualRatings],['Test VL judgments',c.testVlJudgments]];
    el('coverage').innerHTML='<div class="run-analytics-stat-grid">'+fields.map(function(entry) {return '<div><strong>'+Number(entry[1]||0)+'</strong><span>'+esc(entry[0])+'</span></div>';}).join('')+'</div>';
    renderCampaign();
    updateScopeUi();
    var warnings=report.warnings || [];
    el('warnings').innerHTML=warnings.map(function(w){return '<p class="epoch-finder-error">'+esc(w)+'</p>';}).join('');
  }
  function refreshDirectorPreview() {
    if(!report)return;
    var token=++previewGeneration, source=folder;
    var key=JSON.stringify([report.jobIds,report.sessionFilter,el('campaign').value]);
    previewFacts=null;previewKey='';
    el('director-preview').textContent='Preparing selected evidence preview…';
    fetch('/fs/run_analytics/interpret',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder:source,jobIds:report.jobIds,session:report.sessionFilter,campaignId:el('campaign').value,previewOnly:true})})
      .then(function(r){return r.json().then(function(data){if(!r.ok||!data.ok)throw new Error(data.error||'Preview unavailable');return data;});})
      .then(function(data){if(source===folder&&token===previewGeneration){previewFacts=data.facts;previewKey=key;el('director-preview').textContent=JSON.stringify(data.facts,null,2);}})
      .catch(function(exc){if(token===previewGeneration)error(exc);});
  }
  function renderCampaign() {
    if (!report || !report.reports) return;
    var campaignId=el('campaign').value;
    var campaign=chosenCampaign();
    var rows=[], views=[], findings=(report.findings||[]).slice();
    (report.reports||[]).forEach(function(r) {
      var c=(r.campaigns||[]).find(function(item){return item.id===campaignId;});
      var cohorts=r.testCohorts||[];
      var activeCohort=cohorts.find(function(group){return group.id===selectedCohort;});
      var tests=activeCohort?activeCohort.points:(cohorts.length===1?cohorts[0].points:[]);
      if(cohorts.length>1)findings.push(r.run.label+': '+cohorts.length+' independent Test cohorts; select one session for a controlled view.');
      var trajectory=(r.roundPoints||[]).filter(function(p){return p.campaignId===campaignId;});
      views.push('<h4>'+esc(r.run.label)+'</h4>'+
        (c ? chart(c.points,'score','Campaign VL fidelity · '+r.run.label,pct,1):'')+
        chart(tests,'manual','Manual rating · '+r.run.label,function(v){return v.toFixed(2)+' / 5';},null)+
        (cohorts.length>1?'<p class="epoch-finder-muted">Multiple Test cohorts excluded from pooled chart; select one session to narrow scope.</p>':'')+
        chart(r.lossPoints||[],'loss','Training loss · '+r.run.label,function(v){return v.toFixed(4);},null)+
        (trajectory.length?'<details><summary>Round-by-round progression · '+trajectory.length+' observations</summary>'+trajectory.map(function(p){return '<p>Round '+p.round+' · epoch '+p.epoch+': '+pct(p.score)+' ('+p.observations+' weighted observations)</p>';}).join('')+'</details>':''));
      var indexed={};
      (r.epochs||[]).forEach(function(n){indexed[n]={epoch:n};});
      (c?c.points:[]).forEach(function(p){indexed[p.epoch].campaign=p;});
      tests.forEach(function(p){indexed[p.epoch].test=p;});
      (r.lossPoints||[]).forEach(function(p){indexed[p.epoch].loss=p.loss;});
      var ranks=(c?c.points:[]).filter(function(p){return p.score!=null;}).sort(function(a,b){return b.score-a.score;});
      if(ranks.length){findings.push(r.run.label+': leading measured epoch '+ranks[0].epoch+' at '+pct(ranks[0].score)+' ('+ranks[0].observations+' weighted observations).');if(ranks[0].observations<6)findings.push('Limited evidence: leading checkpoint has fewer than six weighted observations.');}
      Object.keys(indexed).map(Number).sort(function(a,b){return a-b;}).forEach(function(epoch){
        var p=indexed[epoch], cp=p.campaign||{},t=p.test||{};
        rows.push('<tr><td>'+esc(r.run.label)+'</td><td>'+epoch+'</td><td>'+pct(cp.score)+'</td><td>'+
          (cp.observations==null?'—':Number(cp.observations).toFixed(1))+'</td><td>'+
          (t.manual==null?'—':Number(t.manual).toFixed(2))+'</td><td>'+(t.manualCount||0)+'</td><td>'+pct(t.testVl)+'</td><td>'+
          (p.loss==null?'—':Number(p.loss).toFixed(4))+'</td><td>'+
          '<button type="button" data-epoch-media-job="'+esc(r.jobId)+'" data-epoch-media-epoch="'+epoch+'">View media</button>'+(c&&cp.observations!=null?'<button type="button" data-inspect-campaign="'+esc(c.id)+'" data-epoch="'+epoch+'" data-job-id="'+esc(r.jobId)+'">Inspect epoch</button>':'')+(t.sessions&&t.sessions.length?'<button type="button" data-open-session="'+esc(t.sessions[0])+'">Test session</button>':'')+'</td></tr>');
      });
    });
    el('chart-note').textContent=campaign?'Same-campaign comparison · '+campaign.name+' · '+campaign.visionModel:
      'Select a campaign to show comparable VL fidelity. Manual ratings and loss remain independent descriptive evidence.';
    el('chart').innerHTML=views.join('');
    el('table').innerHTML=rows.length ? '<div class="run-analytics-table-wrap"><table><thead><tr><th>Run</th><th>Epoch</th><th>Campaign VL</th><th>Observations</th><th>Manual</th><th>Ratings</th><th>Test VL</th><th>Loss</th><th></th></tr></thead><tbody>'+rows.join('')+'</tbody></table></div>' : '<p class="epoch-finder-muted">No checkpoint observations match the current evidence filters. Choose a campaign or Test cohort, or check evidence coverage.</p>';
    el('findings').innerHTML=findings.length?findings.map(function(text){return '<p>'+esc(text)+'</p>';}).join(''):
      '<p class="epoch-finder-muted">No comparable scored campaign evidence in this selection. Missing observations remain missing.</p>';
    el('director-result').textContent='';el('director-status').textContent='';
    previewGeneration++;previewFacts=null;previewKey='';el('director-preview').textContent='Expand to load and review the numerical facts before interpreting.';
  }
  function load() {
    el('director-result').textContent='';el('director').disabled=true;
    report=null;previewGeneration++;previewFacts=null;previewKey='';
    var ids=Array.from(selection), token=++generation, origin=folder;
    if(!ids.length){el('coverage').textContent='Select at least one run.';updateScopeUi();return;}
    clearError();el('analyze').disabled=true;el('analyze').textContent='Reading saved evidence…';
    fetch('/fs/epoch_finder',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({folder:folder,operation:'run_analytics_selected',criteria:{jobIds:ids,session:sessionFilter}})})
      .then(function(response){return response.json().then(function(data){if(!response.ok||!data.ok)throw new Error(data.error||'Analytics failed.');return data;});})
      .then(function(data){if(token===generation&&origin===folder){report=data;render();el('report-surface').classList.remove('hidden');}})
      .catch(function(exc){if(token===generation)error(exc);})
      .finally(function(){if(token===generation){el('analyze').textContent='Analyze selected';updateScopeUi();}});
  }
  function discoverResultEpochs() {
    var token=++resultEpochGeneration, origin=folder;
    el('result-epochs').textContent='Finding saved generated results…';
    fetch('/fs/epoch_finder',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({folder:origin,operation:'workspace_gallery',criteria:{
        limit:1,includeEpochIndex:true
      }})}).then(function(response){return response.json().then(function(data){
        if(!response.ok||!data.ok)throw new Error(data.error||'Result discovery failed.');
        return data;
      });}).then(function(data){
        if(token!==resultEpochGeneration||origin!==folder)return;
        var index=data.resultEpochs||[], groups=new Map();
        index.forEach(function(entry){
          if(!entry.jobId||!Number.isInteger(entry.epoch)||!entry.count)return;
          if(!groups.has(entry.jobId))groups.set(entry.jobId,[]);
          groups.get(entry.jobId).push(entry);
        });
        var names=new Map((runs||[]).map(function(run){return [run.jobId,run.label||''];}));
        if(!groups.size) {
          el('result-epochs').textContent='No epochs with recorded generated results in this Set.';
          return;
        }
        var html=[];
        groups.forEach(function(entries,id){
          entries.sort(function(a,b){return a.epoch-b.epoch;});
          var run=runs.find(function(item){return item.jobId===id;});
          var label=(run && run.runSequence!=null ? 'Run '+run.runSequence : '') ||
            names.get(id) || entries[0].runName || 'Run '+id.slice(-8);
          html.push('<div class="run-analytics-result-run"><strong>'+esc(label)+'</strong><small>ID '+esc(id.slice(-8))+'</small><div class="run-analytics-result-epochs">'+
            entries.map(function(entry){
              var types=[entry.testCount?entry.testCount+' Test':'',entry.campaignCount?entry.campaignCount+' Campaign':''].filter(Boolean).join(' · ');
              return '<button type="button" data-result-epoch-job="'+esc(entry.jobId)+'" data-result-epoch="'+entry.epoch+'"><span>Epoch '+entry.epoch+'</span><small>'+entry.count+' results'+(types?' · '+esc(types):'')+'</small></button>';
            }).join('')+'</div></div>');
        });
        el('result-epochs').innerHTML=html.join('');
        if(data.warnings&&data.warnings.length)el('result-epochs-note').textContent=data.warnings.join(' · ');
        else el('result-epochs-note').textContent='';
      }).catch(function(exc){
        if(token!==resultEpochGeneration||origin!==folder)return;
        el('result-epochs').textContent='Could not discover saved results.';
        error(exc);
      });
  }
  function discover() {
    discoverResultEpochs();
    var token=++generation, origin=folder;
    clearError();el('coverage').textContent='Finding recorded runs…';
    api('').then(function(data){
      if(token!==generation||origin!==folder)return;
      runs=data.runs||[];
      selection=new Set(Array.from(selection).filter(function(id){return runs.some(function(run){return run.jobId===id;});}));
      el('run-choices').innerHTML=runs.map(function(run){
        var sequence = run.runSequence != null && String(run.runSequence).trim() ? 'Run ' + run.runSequence : '';
        var label = String(run.label || '').trim();
        var identity = [sequence, label && label.toLowerCase() !== 'run train' && label !== sequence ? label : ''].filter(Boolean).join(' · ');
        if (!identity) identity = label || 'Training run';
        var shortId = String(run.jobId || '').slice(-8);
        var details = [run.stage || run.modelId || run.source, (run.savedEpochs || []).length + ' checkpoints',
          run.archive ? 'archived' : '', shortId ? 'ID ' + shortId : ''].filter(Boolean);
        return '<label class="epoch-finder-run-choice run-analytics-run-choice"><input type="checkbox" data-analytics-run="'+esc(run.jobId)+'"'+
          (selection.has(run.jobId)?' checked':'')+'><span><strong>'+esc(identity)+'</strong><small>'+
          esc(details.join(' · '))+'</small></span></label>';
      }).join('')||'<p class="epoch-finder-muted">No recorded runs in this Set.</p>';
      el('coverage').textContent='Select runs and Analyze to read saved evidence.';
      updateScopeUi();
    }).catch(function(exc){if(token===generation)error(exc);});
  }
  window.runAnalyticsPrepare=function(next){
    if(next===folder)return;folder=next;generation++;resultEpochGeneration++;runs=[];selection=new Set();report=null;sessionFilter='';
    labRequest++;labSnapshot=null;labInventory=null;labDiscovered=false;lab('status').textContent='Open Insights to read saved evidence.';el('report-surface').classList.add('hidden');
    el('run-choices').innerHTML='';el('result-epochs').textContent='Open Analytics to discover results.';el('result-epochs-note').textContent='';el('coverage').textContent='Choose a run to begin.';
    el('chart').innerHTML='';el('table').innerHTML='';el('findings').innerHTML='';el('warnings').innerHTML='';
    el('campaign').innerHTML='<option value="">No campaign</option>';el('session').innerHTML='<option value="">All sessions</option>';
    el('director').disabled=true;updateScopeUi();previewGeneration++;previewFacts=null;previewKey='';el('director-result').textContent='';el('director-status').textContent='';clearError();
  };
  window.runAnalyticsOpen=function(){labLoad();};
  window.runAnalyticsFolder=function(){return folder;};
  el('result-epochs').onclick=function(event){
    var button=event.target.closest('[data-result-epoch-job]');
    if(!button)return;
    window.runAnalyticsViewEpoch(button.dataset.resultEpochJob,Number(button.dataset.resultEpoch));
  };
  el('run-choices').onchange=function(event){
    var cb=event.target.closest('[data-analytics-run]');if(!cb)return;
    if(cb.checked)selection.add(cb.dataset.analyticsRun);else selection.delete(cb.dataset.analyticsRun);
    generation++;report=null;previewGeneration++;previewFacts=null;previewKey='';el('director').disabled=true;el('analyze').disabled=false;el('analyze').textContent='Analyze selected';el('coverage').textContent='Selection changed — Analyze selected to refresh.';el('report-surface').classList.add('hidden');el('chart').innerHTML='';el('table').innerHTML='';el('findings').innerHTML='';
    if(selection.size>6){selection.delete(cb.dataset.analyticsRun);cb.checked=false;error(new Error('Select up to six runs.'));}
    updateScopeUi();
  };
  el('analyze').onclick=load;
  updateScopeUi();
  el('session').onchange=function(){sessionFilter=this.value;load();};
  el('cohort').onchange=function(){selectedCohort=this.value;renderCampaign();};
  el('campaign').onchange=function(){renderCampaign();};
  el('director-preview').closest('details').addEventListener('toggle',function(){if(this.open&&report)refreshDirectorPreview();});
  el('director').onclick=function(){
    if(!report || directorJob)return;
    var model=getDirectorModelPreference('webcap.director.model');
    if(!model){error(new Error('Select a Director model in the app header.'));return;}
    var ids=report.jobIds.slice(),session=report.sessionFilter,campaign=el('campaign').value;
    if(!previewFacts||previewKey!==JSON.stringify([ids,session,campaign])){error(new Error('Open the evidence preview before sending it to Director.'));return;}
    var reviewed=JSON.stringify(previewFacts);
    var source=folder,token=generation, context=JSON.stringify([folder,ids,session,campaign]);
    directorContext=context;
    el('director-result').textContent='';el('director-status').textContent='Preparing numerical evidence…';
    el('director').disabled=true;el('director-stop').classList.remove('hidden');
    fetch('/fs/run_analytics/interpret',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({folder:source,jobIds:ids,session:session,campaignId:campaign,directorModel:model,reviewedFacts:reviewed})})
      .then(function(response){return response.json().then(function(data){if(!response.ok||!data.ok)throw new Error(data.error||'Director request failed.');return data.job;});})
      .then(function(job){
        if(!job||!job.jobId)throw new Error('Director did not return a job.');
        directorJob=job.jobId;trackTransientLlmJob(job);
        function poll(){
          return fetch('/fs/director/job?job='+encodeURIComponent(job.jobId)+'&consume=1')
            .then(function(response){return response.json();}).then(function(body){
              var value=body.job||{};
              if(value.status==='completed')return value.result;
              if(['failed','interrupted','stopped','cancelled'].includes(value.status))throw new Error(value.error||'Director '+value.status);
              if(source===folder&&token===generation)el('director-status').textContent=
                value.status==='queued'?'Queued in Director lane…':'Analyzing evidence…';
              return new Promise(function(resolve){setTimeout(resolve,1500);}).then(poll);
            });
        }
        return poll();
      }).then(function(result){
        if(source!==folder||token!==generation||context!==JSON.stringify([folder,report&&report.jobIds,report&&report.sessionFilter,el('campaign').value]))return;
        var analysis=result&&result.analysis;
        if(!analysis)throw new Error('Director produced no structured analysis.');
        el('director-status').textContent='Interpretation complete · model-derived, not a verified score.';
        el('director-result').innerHTML=['observed','hypotheses','tryNext','limits'].map(function(key){
          var names={observed:'Observed',hypotheses:'Hypotheses',tryNext:'Try next',limits:'Limits'};
          return '<h4>'+names[key]+'</h4><p>'+esc(analysis[key]||'')+'</p>';
        }).join('');
      }).catch(function(exc){if(source===folder&&token===generation){el('director-status').textContent='Director failed.';error(exc);}})
        .finally(function(){directorJob='';el('director-stop').classList.add('hidden');el('director').disabled=!report;});
  };
  el('director-stop').onclick=function(){
    if(!directorJob)return;
    cancelCaptionAssistJob(directorJob).catch(error);
    el('director-status').textContent='Stop requested…';
  };
  var epochMediaScope=null, epochMediaSerial=0, epochMediaOffset=0, epochMediaTotal=0, epochMediaLoading=false, epochMediaReturnMode='analytics';
  function epochMediaClose() {
    var back=epochMediaReturnMode;
    epochMediaSerial++;
    epochMediaScope=null;
    epochMediaLoading=false;
    el('epoch-media-dialog').close();
    el('epoch-media-grid').replaceChildren();
    el('epoch-media-more').classList.add('hidden');
    if(back==='finder'||back==='tests')window.epochFinderShowMode(back);
  }
  function epochMediaLoad(more) {
    if (!epochMediaScope || epochMediaLoading) return;
    var scope=epochMediaScope, serial=epochMediaSerial;
    epochMediaLoading=true;
    el('epoch-media-status').textContent=more?'Loading more recorded results…':'Loading recorded checkpoint results…';
    fetch('/fs/epoch_finder',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({folder:folder,operation:'checkpoint_workspace',criteria:{
        jobId:scope.jobId,epoch:scope.epoch,limit:8,offset:more?epochMediaOffset:0
      }})}).then(function(response){return response.json().then(function(data){
        if(!response.ok||!data.ok)throw new Error(data.error||'Checkpoint results unavailable');
        return data;
      });}).then(function(data){
        if(serial!==epochMediaSerial || scope!==epochMediaScope)return;
        if(!more) {el('epoch-media-grid').replaceChildren();epochMediaOffset=0;}
        (data.media||[]).forEach(function(item) {
          var card=document.createElement('article');card.className='run-analytics-epoch-media-card';
          var url=item.source==='campaign'
            ? '/fs/epoch_finder/frame?folder='+encodeURIComponent(folder)+'&campaign='+encodeURIComponent(item.campaignId)+'&frame='+encodeURIComponent(item.frame||'')
            : '/fs/test_generations/media?folder='+encodeURIComponent(folder)+'&session='+encodeURIComponent(item.session)+'&media='+encodeURIComponent(item.mediaFile||'');
          var playable=item.source==='test' && (/\\.(mp4|webm|mov|mkv)$/i.test(item.mediaFile||'') || item.mediaKind==='video');
          if((item.source==='campaign'&&!item.frame)||item.framePruned||item.mediaAvailable===false) {
            var empty=document.createElement('p');empty.textContent=item.error||'Media pruned or unavailable';card.appendChild(empty);
          } else {
            var media=document.createElement(playable?'video':'img');
            media.src=url;
            if(playable){media.controls=true;media.preload='none';media.playsInline=true;}
            else {media.loading='lazy';media.alt='Generated checkpoint result';}
            card.appendChild(media);
            var link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open original ↗';card.appendChild(link);
          }
          var meta=document.createElement('p');
          meta.textContent=(item.source==='campaign'?'Campaign':'Test session')+' · '+(item.candidate||item.runName||'Epoch '+item.epoch);
          card.appendChild(meta);
          if(item.source==='test'){
            var savedRating=document.createElement('strong');
            savedRating.className='run-analytics-epoch-rating';
            savedRating.textContent=item.rating==null?'Unrated':'Rated '+item.rating+'/5';
            card.appendChild(savedRating);
          }
          var source=document.createElement('button');source.type='button';source.textContent='Open '+(item.source==='campaign'?'campaign':'session');
          source.addEventListener('click',function(){
            epochMediaClose();
            if(item.source==='campaign')window.epochFinderInspectCampaign(item.campaignId,item.epoch,item.jobId);
            else window.openTestBenchAnalyticsSession(item.session);
          });card.appendChild(source);
          el('epoch-media-grid').appendChild(card);
        });
        epochMediaOffset += (data.media||[]).length;
        epochMediaTotal=Number(data.total||0);
        el('epoch-media-status').textContent=epochMediaTotal?epochMediaOffset+' of '+epochMediaTotal+' recorded results':'No recorded media for this checkpoint.';
        if (!epochMediaTotal && !more) {
          var empty=document.createElement('p');
          empty.className='epoch-finder-muted';
          empty.textContent='No test sessions or campaign frames were recorded for this checkpoint. Try another epoch or return to Analytics.';
          el('epoch-media-grid').appendChild(empty);
        }
        el('epoch-media-more').classList.toggle('hidden',epochMediaOffset>=epochMediaTotal);
      }).catch(function(err){
        if(serial!==epochMediaSerial)return;
        el('epoch-media-status').textContent='Could not load results: '+String(err.message||err);
        error(err);
      }).finally(function(){if(serial===epochMediaSerial)epochMediaLoading=false;});
  }
  window.runAnalyticsViewEpoch=function(jobId,epoch,returnMode) {
    var id=String(jobId||'');
    var num=Number(epoch);
    if(!id||!Number.isInteger(num))throw new Error('Choose a valid saved checkpoint.');
    epochMediaReturnMode=returnMode==='finder'||returnMode==='tests'?returnMode:'analytics';
    el('epoch-media-close').textContent=epochMediaReturnMode==='finder'?'← Back to Campaign':epochMediaReturnMode==='tests'?'← Back to Test results':'← Back to Analytics';
    window.epochFinderShowMode('analytics');
    epochMediaSerial++;
    epochMediaLoading=false;
    epochMediaScope={jobId:id,epoch:num};
    epochMediaOffset=0;
    el('epoch-media-grid').replaceChildren();
    el('epoch-media-more').classList.add('hidden');
    el('epoch-media-title').textContent='Epoch '+num+' · combined generated results';
    el('epoch-media-dialog').showModal();
    epochMediaLoad(false);
  };
  el('epoch-media-close').onclick=epochMediaClose;
  el('epoch-media-more').onclick=function(){epochMediaLoad(true);};
  el('epoch-media-dialog').addEventListener('close',function(){
    if(!epochMediaScope)return;
    epochMediaSerial++;
    epochMediaScope=null;
    epochMediaLoading=false;
    el('epoch-media-grid').replaceChildren();
    el('epoch-media-more').classList.add('hidden');
    if(epochMediaReturnMode==='finder'||epochMediaReturnMode==='tests')window.epochFinderShowMode(epochMediaReturnMode);
  });
  el('table').onclick=function(event){
    var media=event.target.closest('[data-epoch-media-job]');
    if(media){
      window.runAnalyticsViewEpoch(media.dataset.epochMediaJob,Number(media.dataset.epochMediaEpoch));
      return;
    }
    var btn=event.target.closest('[data-inspect-campaign]');
    if(btn){window.epochFinderInspectCampaign(btn.dataset.inspectCampaign,Number(btn.dataset.epoch),btn.dataset.jobId);return;}
    var session=event.target.closest('[data-open-session]');
    if(session)window.openTestBenchAnalyticsSession(session.dataset.openSession);
  };

  var labSnapshot=null,labInventory=null,labRequest=0,labDiscovered=false,labShowAll=false;
  function labEnsureDetailIndex(){if(!labDiscovered){labDiscovered=true;discover();}}
  function lab(id){return document.getElementById('run-lab-'+id);}
  function labGroup(){return (labSnapshot&&labSnapshot.cohorts||[]).find(function(g){return g.id===lab('cohort').value;});}
  function labPoints(){
    var id=lab('run').value;
    return (labSnapshot&&labSnapshot.epochs||[]).filter(function(p){return !id||p.jobId===id;});
  }
  function labEmpty(message){return '<p class="run-lab-empty">'+esc(message)+'</p>';}
  function labRanked(){
    var byCount=lab('sort').value==='count';
    return labPoints().filter(function(p){return p.ratedCount>0&&p.allManualAverage!=null;}).sort(function(a,b){
      var primary=byCount?b.ratedCount-a.ratedCount:b.allManualAverage-a.allManualAverage;
      var secondary=byCount?b.allManualAverage-a.allManualAverage:b.ratedCount-a.ratedCount;
      return primary||secondary||a.jobId.localeCompare(b.jobId)||a.epoch-b.epoch;
    });
  }
  function labDetail(){labEnsureDetailIndex();var scope=document.querySelector('#run-analytics-screen .epoch-finder-sidebar .epoch-finder-panel:nth-of-type(2) details');if(scope){scope.open=true;scope.scrollIntoView({behavior:'smooth',block:'start'});}lab('status').textContent='Select 1–6 runs and click Analyze selected to inspect detailed evidence.';}
  function labRunRender(){
    var old=lab('run').value;
    var names=new Map((labSnapshot.epochs||[]).filter(function(p){return p.ratedCount>0;}).map(function(p){
      return [p.jobId,p.runName||'Run '+p.jobId.slice(-8)];
    }));
    lab('run').innerHTML='<option value="">All runs</option>'+Array.from(names).map(function(pair){
      return '<option value="'+esc(pair[0])+'">'+esc(pair[1])+'</option>';
    }).join('');
    if(names.has(old))lab('run').value=old;
    labShowAll=false;
    labResults();
  }
  function labFeatured(ranked){
    var best=ranked.slice().sort(function(a,b){
      return b.allManualAverage-a.allManualAverage||b.ratedCount-a.ratedCount;
    })[0];
    var backed=ranked.slice().sort(function(a,b){
      return b.allManualAverage-a.allManualAverage||b.ratedCount-a.ratedCount;
    }).find(function(p){return !best||p.jobId!==best.jobId||p.epoch!==best.epoch;});
    var picks=[{point:best,label:'Highest rated',note:'An average based on '+(best?best.ratedCount:0)+' saved ratings'},
               {point:backed,label:'Runner-up',note:'Compare its saved ratings and coverage with the leader'}];
    lab('featured').innerHTML=picks.map(function(item){
      var p=item.point;
      if(!p)return '<div class="run-lab-feature"><small>'+esc(item.label)+'</small><p>Rate more saved renders to reveal another contender.</p></div>';
      return '<div class="run-lab-feature"><small>'+esc(item.label)+'</small><h3>'+esc(p.runName||'Run '+p.jobId.slice(-8))+' · Epoch '+p.epoch+'</h3><strong>'+p.allManualAverage.toFixed(2)+'/5</strong><p>'+p.ratedCount+' of '+p.testCount+' Test renders rated · '+p.sessions.length+' sessions</p><small>'+esc(item.note)+'</small><div class="run-lab-feature-actions"><button type="button" data-lab-feature="inspect" data-lab-job="'+esc(p.jobId)+'" data-lab-epoch="'+p.epoch+'">Inspect renders</button><button type="button" data-lab-feature="test" data-lab-job="'+esc(p.jobId)+'" data-lab-epoch="'+p.epoch+'">Prepare 10 tests</button></div></div>';
    }).join('');
  }
  function labHistory(){
    var host=lab('history');
    if(!labInventory){host.textContent='Finding current and archived run metadata…';return;}
    var records=labInventory.runs||[],archive=records.filter(function(p){return !!p.archive;});
    var ratedRuns=new Set((labSnapshot&&labSnapshot.epochs||[]).filter(function(p){return p.ratedCount>0;}).map(function(p){return p.jobId;}));
    var missing=records.filter(function(p){return !ratedRuns.has(p.jobId);});
    var values=function(summary){
      var parts=[];
      if(summary.rank!=null)parts.push('Rank '+summary.rank);
      if(summary.lr!=null)parts.push('LR '+summary.lr);
      if(summary.capturedItems!=null)parts.push(summary.capturedItems+' items');
      return parts.join(' · ');
    };
    host.innerHTML='<div class="run-lab-history-summary"><strong>'+records.length+' runs found</strong><span>'+archive.length+' archives · '+ratedRuns.size+' runs with rated Test evidence · '+missing.length+' runs without surviving ratings</span></div>'+
      (archive.length?'<details><summary>Archived training configurations ('+archive.length+')</summary>'+
      archive.map(function(p){
        var sum=values(p.runSummary||{});
        return '<div class="run-lab-history-row"><div><strong>'+esc(p.label)+'</strong><small>Selected epoch '+(p.selectedEpoch==null?'unknown':p.selectedEpoch)+' · '+esc(sum||'No compact configuration saved')+'</small></div><small>'+ (ratedRuns.has(p.jobId)?'Rated Test evidence':'No surviving rated Test evidence')+'</small></div>';
      }).join('')+'</details>':'<p class="run-lab-footnote">No archived runs were found for this Set.</p>')+
      '<p class="run-lab-footnote">Archived selection is not a measured quality result. Detailed loss and timing are read only when you request AI Insights.</p>';
    if(labInventory.warnings&&labInventory.warnings.length){
      host.insertAdjacentHTML('beforeend','<p class="run-lab-footnote">'+esc(labInventory.warnings.join(' · '))+'</p>');
    }
  }
  function labDiscoveries(){
    var group=labGroup(),hidden=new Set(labSnapshot.hiddenVlGroups||[]);
    var attributes=(group&&group.attributes||[]).slice().sort(function(a,b){
      return Number(hidden.has(a.id||a.label))-Number(hidden.has(b.id||b.label));
    });
    lab('discoveries').innerHTML=attributes.length?attributes.map(function(a){
      var key=a.id||a.label,checked=!hidden.has(key);
      return '<div class="run-lab-insight'+(checked?'':' is-muted')+'"><div><label class="run-lab-insight-choice"><input type="checkbox" data-insights-group="'+esc(key)+'"'+(checked?' checked':'')+'><strong>'+esc(a.label)+'</strong></label><span>'+(100*a.matched).toFixed(0)+'% · '+a.judgments+' judgments</span></div><div class="run-lab-meter"><i style="width:'+(100*a.matched)+'%"></i></div></div>';
    }).join('')+'<p class="run-lab-footnote">Uncheck irrelevant attributes for this Set. Historical VL evidence is unchanged; rankings still use manual ratings.</p>':
      labEmpty('No VL judgments in this evaluation group.');
  }
  function labResults(){
    var points=labPoints(),ranked=labRanked(),visible=labShowAll?ranked:ranked.slice(0,12);
    labFeatured(ranked);
    lab('contenders').innerHTML=ranked.length?visible.map(function(p,i){
      return '<div class="run-lab-contender"><b class="run-lab-position">'+(i+1)+'</b><div><strong>'+esc(p.runName||'Run '+p.jobId.slice(-8))+' · Epoch '+p.epoch+'</strong><small>'+p.ratedCount+' of '+p.testCount+' Test renders rated · '+p.sessions.length+' sessions</small></div><div class="run-lab-score"><b>'+p.allManualAverage.toFixed(2)+'/5</b><small>'+p.ratedCount+' ratings</small></div><button data-lab-job="'+esc(p.jobId)+'" data-lab-epoch="'+p.epoch+'">Inspect</button></div>';
    }).join('')+(ranked.length>12&&!labShowAll?'<button class="run-lab-more" type="button" data-lab-show-all>Show all '+ranked.length+' rated epochs</button>':''):
      labEmpty('No rated Test renders yet. Rate generated previews in Test sessions to identify contenders.');
    var total=points.reduce(function(n,p){return n+p.testCount;},0);
    var rated=points.reduce(function(n,p){return n+p.ratedCount;},0);
    var reviewed=points.reduce(function(n,p){return n+p.vlReviewedCount;},0);
    lab('coverage').innerHTML=total?[['Manually rated',rated],['VL-reviewed',reviewed]].map(function(row){
      return '<div class="run-lab-progress"><div><b>'+row[0]+'</b><span>'+row[1]+' / '+total+' Test renders</span></div><div class="run-lab-meter"><i style="width:'+(100*row[1]/total)+'%"></i></div></div>';
    }).join('')+'<p class="run-lab-footnote">Linked Test renders only; each render can have both a rating and a VL review.</p>':
      labEmpty('No generated Test renders linked to a training epoch.');
    var tooManyUnrated=total>0&&rated<total/2;
    if(tooManyUnrated||!ranked.length&&total>rated){
      lab('challenge-title').textContent='Improve your evidence: '+(total-rated)+' unrated renders';
      lab('challenge-description').textContent='Rate a short blind batch from saved Test results before generating more. '+rated+' of '+total+' linked renders are rated.';
      lab('challenge-actions').innerHTML='<button type="button" data-lab-action="review">Blind-rate five</button><button type="button" data-lab-action="inspect">Inspect a contender</button>';
    }else if(ranked.length>=2){
      lab('challenge-title').textContent='Compare your two strongest rated contenders';
      lab('challenge-description').textContent='Leader '+ranked[0].allManualAverage.toFixed(2)+'/5 ('+ranked[0].ratedCount+' ratings) versus runner-up '+ranked[1].allManualAverage.toFixed(2)+'/5 ('+ranked[1].ratedCount+' ratings). Sample size matters.';
      lab('challenge-actions').innerHTML='<button type="button" data-lab-action="inspect">Inspect leader</button><button type="button" data-lab-action="challenger">Inspect runner-up</button>'+(total>rated?'<button type="button" data-lab-action="review">Blind-rate five</button>':'');
    }else{
      lab('challenge-title').textContent=total>rated?'Review the remaining unrated Test renders':'Explore what your training history reveals';
      lab('challenge-description').textContent=total>rated?'Review existing evidence before scheduling another Test.':'Ask Director to compare saved active and archived run details.';
      lab('challenge-actions').innerHTML=(total>rated?'<button type="button" data-lab-action="review">Blind-rate five</button>':'')+'<button type="button" data-lab-action="ai">AI Insights</button><button type="button" data-lab-action="detail">Detailed evidence</button>';
    }
    lab('status').textContent=rated+' rated of '+total+' linked Test renders · '+ranked.length+' rated epochs across '+new Set(points.filter(function(p){return p.ratedCount>0;}).map(function(p){return p.jobId;})).size+' runs. Manual averages combine saved ratings from every Test session.';
    labChart();
  }
  function labChart(){
    var points=labPoints().filter(function(p){return p.ratedCount>0&&p.allManualAverage!=null;});
    if(!points.length){lab('chart').innerHTML=labEmpty('No rated epochs to plot.');return;}
    var lo=Math.min.apply(null,points.map(function(p){return p.epoch;})),hi=Math.max.apply(null,points.map(function(p){return p.epoch;}));
    var runs=new Map();
    points.forEach(function(p){if(!runs.has(p.jobId))runs.set(p.jobId,[]);runs.get(p.jobId).push(p);});
    var selected=!!lab('run').value,palette=['#f3b657','#83c6e9','#8bd6a7','#c4acef'];
    var paths=Array.from(runs.values()).map(function(series,i){
      series.sort(function(a,b){return a.epoch-b.epoch;});
      var xy=function(p){return [36+(p.epoch-lo)/(hi-lo||1)*600,175-(p.allManualAverage/5)*148];};
      var path=selected?'<path d="'+series.map(function(p,j){var a=xy(p);return (j?'L':'M')+a[0].toFixed(1)+','+a[1].toFixed(1);}).join(' ')+'" fill="none" stroke="'+palette[i%palette.length]+'" stroke-width="2.5"/>':'';
      return path+series.map(function(p){var a=xy(p);return '<circle cx="'+a[0]+'" cy="'+a[1]+'" r="4" fill="'+palette[i%palette.length]+'"><title>'+esc(p.runName||p.jobId)+' · Epoch '+p.epoch+': '+p.allManualAverage.toFixed(2)+'/5 ('+p.ratedCount+' ratings)</title></circle>';}).join('');
    });
    lab('chart').innerHTML='<svg viewBox="0 0 680 195" role="img" aria-label="Saved manual ratings by epoch and run"><path d="M36 15V175H645" stroke="currentColor" stroke-opacity=".25" fill="none"/>'+paths.join('')+'</svg><p class="run-lab-footnote">'+(selected?'Measured epochs for the selected run.':'All rated epochs · select a run to follow its trajectory.')+'</p>';
  }
  function labRender(){
    var totals=labSnapshot.coverage||{},groups=labSnapshot.cohorts||[];
    lab('summary').innerHTML=[['Test sessions',totals.sessions],['Generated results',totals.generatedPreviews],['Rated previews',totals.ratedPreviews],['VL-reviewed previews',totals.vlReviewedPreviews]].map(function(pair){
      return '<div class="run-lab-stat"><small>'+pair[0]+'</small><strong>'+Number(pair[1]||0).toLocaleString()+'</strong></div>';
    }).join('');
    var old=lab('cohort').value;
    lab('cohort').innerHTML=groups.length?groups.map(function(g){
      return '<option value="'+esc(g.id)+'">'+esc((g.vlModelId||'VL')+' · '+(g.vlQuestionPreview||g.promptPreview||'Evaluation').slice(0,34)+' · '+g.vlJudgments+' checks · '+g.id.slice(0,6))+'</option>';
    }).join(''):'<option value="">No VL groups</option>';
    if(groups.some(function(g){return g.id===old;}))lab('cohort').value=old;
    labDiscoveries();
    labRunRender();
    lab('explorer').innerHTML=(labSnapshot.epochs||[]).length?labSnapshot.epochs.slice().sort(function(a,b){
      return b.ratedCount-a.ratedCount||b.testCount-a.testCount||a.jobId.localeCompare(b.jobId)||a.epoch-b.epoch;
    }).slice(0,15).map(function(p){
      return '<div class="run-lab-explorer-row"><div><strong>'+esc(p.runName||'Run '+p.jobId.slice(-8))+' · Epoch '+p.epoch+'</strong><small>'+p.ratedCount+' rated · '+p.testCount+' Test · '+p.campaignCount+' Campaign results</small></div><button data-lab-job="'+esc(p.jobId)+'" data-lab-epoch="'+p.epoch+'">Inspect results</button></div>';
    }).join(''):labEmpty('No saved generated epoch results in this Set.');
    lab('warnings').textContent=(labSnapshot.warnings||[]).join(' · ');
    labHistory();
  }
  var reviewItems=[],reviewIndex=0,reviewRated=0,reviewSkipped=0,reviewRatedCurrent=false,reviewBusy=false,reviewExcluded=[];
  function labReviewApi(operation,criteria,endpoint){
    return fetch(endpoint||'/fs/epoch_finder',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({folder:folder,operation:operation,criteria:criteria||{}})})
      .then(function(response){return response.json().then(function(data){
        if(!response.ok||data.ok===false)throw new Error(data.error||'Insights action failed.');
        return data;
      });});
  }
  function labReviewProgress(){
    lab('review-progress').textContent=reviewItems.length?
      Math.min(reviewIndex+1,reviewItems.length)+' of '+reviewItems.length+
      ' · '+reviewRated+' rated · '+reviewSkipped+' skipped':'Review five saved Test renders';
  }
  function labReviewButtons(){
    var done=!reviewItems[reviewIndex];
    labReviewProgress();
    lab('review-stars').classList.toggle('hidden',done||reviewRatedCurrent);
    lab('review-skip').classList.toggle('hidden',done||reviewRatedCurrent);
    lab('review-next').classList.toggle('hidden',!done&&!reviewRatedCurrent);
    lab('review-undo').classList.toggle('hidden',!reviewRatedCurrent);
  }
  function labReviewRender(){
    var current=reviewItems[reviewIndex],done=!current;
    labReviewButtons();
    lab('review-reveal').textContent='';
    lab('review-status').textContent='';
    lab('review-media').replaceChildren();
    lab('review-wildcards').replaceChildren();
    if(done){
      if(!reviewItems.length){
        lab('review-progress').textContent='No available unrated renders';
        lab('review-status').textContent='No reviewable saved Test media found. Historical outputs may be unavailable or unlinked.';
        lab('review-next').classList.add('hidden');
      }else{
        lab('review-progress').textContent='Batch complete · '+reviewRated+' rated, '+reviewSkipped+' skipped';
        lab('review-status').textContent='Your saved ratings will appear in Insights when you close this review.';
        lab('review-next').textContent='Review five more';
      }
      return;
    }
    lab('review-next').textContent='Next render';
    var url='/fs/test_generations/media?folder='+encodeURIComponent(folder)+'&session='+encodeURIComponent(current.session)+'&media='+encodeURIComponent(current.mediaFile);
    var video=/\.(mp4|webm|mov|mkv)$/i.test(current.mediaFile)||current.mediaKind==='video';
    var media=document.createElement(video?'video':'img');
    media.src=url;
    if(video){media.controls=true;media.preload='metadata';media.playsInline=true;}
    else {media.alt='Unrated Test render';}
    lab('review-media').appendChild(media);
    var wildcards=(current.wildcards||[]).map(function(item){return item.phrase||item.value||item.label||'';}).filter(Boolean);
    lab('review-wildcards').innerHTML=wildcards.length?wildcards.map(function(value){return '<span>'+esc(value)+'</span>';}).join(''):'<span>No resolved wildcard summary recorded</span>';
  }
  function labReviewLoad(){
    reviewBusy=true;
    lab('review-progress').textContent='Finding unrated saved renders…';
    lab('review-status').textContent='';
    return labReviewApi('run_insights_review',{excluded:reviewExcluded}).then(function(data){
      reviewItems=data.items||[];reviewIndex=0;reviewRatedCurrent=false;
      if(!reviewItems.length){lab('review-progress').textContent='No reviewable saved renders';lab('review-status').textContent='All remaining unrated results may be unavailable or lack recorded epoch provenance.';}
      labReviewRender();
      if(!reviewItems.length)lab('review-progress').textContent='No available unrated renders';
    }).catch(function(exc){error(exc);lab('review-status').textContent=String(exc.message||exc);}).finally(function(){reviewBusy=false;});
  }
  function labReviewOpen(){
    reviewItems=[];reviewIndex=0;reviewRated=0;reviewSkipped=0;reviewExcluded=[];reviewRatedCurrent=false;
    lab('review-dialog').showModal();
    labReviewLoad();
  }
  function labReviewAdvance(skipped){
    if(reviewBusy)return;
    var item=reviewItems[reviewIndex];
    if(!item){labReviewLoad();return;}
    if(skipped){reviewSkipped++;reviewExcluded.push(item.id);}
    else if(!reviewRatedCurrent)return;
    reviewIndex++;reviewRatedCurrent=false;labReviewRender();
  }
  function labReviewRate(rating){
    var item=reviewItems[reviewIndex];
    if(!item||reviewBusy||reviewRatedCurrent)return;
    reviewBusy=true;
    Array.from(lab('review-stars').querySelectorAll('button')).forEach(function(b){b.disabled=true;});
    labReviewApi('test_rate_result',{session:item.session,mediaFile:item.mediaFile,rating:rating},'/fs/test_generations')
      .then(function(){
        reviewRated++;reviewRatedCurrent=true;
        labReviewButtons();
        lab('review-reveal').textContent='Rated '+rating+'/5 · '+(item.runName||'Run '+item.jobId.slice(-8))+' · Epoch '+item.epoch;
      }).catch(function(exc){error(exc);lab('review-status').textContent=String(exc.message||exc);})
      .finally(function(){reviewBusy=false;Array.from(lab('review-stars').querySelectorAll('button')).forEach(function(b){b.disabled=false;});});
  }
  function labReviewUndo(){
    var item=reviewItems[reviewIndex];
    if(!item||!reviewRatedCurrent||reviewBusy)return;
    reviewBusy=true;
    labReviewApi('test_rate_result',{session:item.session,mediaFile:item.mediaFile,rating:0},'/fs/test_generations')
      .then(function(){reviewRated--;reviewRatedCurrent=false;labReviewButtons();lab('review-reveal').textContent='';})
      .catch(function(exc){error(exc);lab('review-status').textContent=String(exc.message||exc);})
      .finally(function(){reviewBusy=false;});
  }
  function labLoad(){
    var serial=++labRequest,scope=folder;lab('status').textContent='Reading recorded Test and Campaign evidence…';
    fetch('/fs/epoch_finder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder:scope,operation:'run_analytics_overview'})})
      .then(function(r){return r.json().then(function(d){if(!r.ok||!d.ok)throw Error(d.error||'Could not load evidence');return d;});})
      .then(function(d){
        if(serial!==labRequest||scope!==folder)return;
        labSnapshot=d;labInventory=null;labRender();
        return labReviewApi('run_insights_inventory').then(function(details){
          if(serial!==labRequest||scope!==folder)return;
          labInventory=details;labHistory();
        }).catch(function(e){
          if(serial!==labRequest||scope!==folder)return;
          lab('history').textContent='Training history unavailable: '+String(e.message||e);
          error(e);
        });
      })
      .catch(function(e){if(serial!==labRequest)return;lab('status').textContent='Overview failed: '+String(e.message||e);error(e);});
  }
  lab('refresh').onclick=labLoad;
  Array.prototype.forEach.call(document.querySelectorAll('#run-analytics-screen .epoch-finder-sidebar details'),function(details){details.addEventListener('toggle',function(){if(details.open)labEnsureDetailIndex();});});
  lab('cohort').onchange=labDiscoveries;
  lab('discoveries').onchange=function(event){
    var input=event.target.closest('[data-insights-group]');if(!input)return;
    var hidden=new Set(labSnapshot.hiddenVlGroups||[]);
    if(input.checked)hidden.delete(input.dataset.insightsGroup);else hidden.add(input.dataset.insightsGroup);
    Array.from(lab('discoveries').querySelectorAll('input')).forEach(function(box){box.disabled=true;});
    labReviewApi('run_insights_groups',{hiddenVlGroups:Array.from(hidden)}).then(function(data){
      labSnapshot.hiddenVlGroups=data.hiddenVlGroups;labDiscoveries();
    }).catch(function(exc){error(exc);labDiscoveries();});
  };
  lab('featured').onclick=function(event){
    var b=event.target.closest('[data-lab-feature]');if(!b)return;
    if(b.dataset.labFeature==='inspect')window.runAnalyticsViewEpoch(b.dataset.labJob,Number(b.dataset.labEpoch));
    else window.testGenerationsPrepareContender(b.dataset.labJob,Number(b.dataset.labEpoch),10);
  };
  lab('review-close').onclick=function(){lab('review-dialog').close();};
  lab('review-dialog').addEventListener('close',function(){
    lab('review-media').replaceChildren();
    if(reviewRated)labLoad();
  });
  lab('review-stars').onclick=function(event){
    var b=event.target.closest('[data-insights-rating]');if(b)labReviewRate(Number(b.dataset.insightsRating));
  };
  lab('review-skip').onclick=function(){labReviewAdvance(true);};
  lab('review-next').onclick=function(){labReviewAdvance(false);};
  lab('review-undo').onclick=labReviewUndo;
  lab('review-dialog').addEventListener('keydown',function(event){
    if(event.ctrlKey||event.altKey||event.metaKey||event.target.tagName==='INPUT')return;
    if(/^[1-5]$/.test(event.key)&&!reviewRatedCurrent){event.preventDefault();labReviewRate(Number(event.key));}
    if(event.key.toLowerCase()==='s'&&!reviewRatedCurrent){event.preventDefault();labReviewAdvance(true);}
    if(event.key==='ArrowRight'&&reviewRatedCurrent){event.preventDefault();labReviewAdvance(false);}
  });
  lab('run').onchange=function(){labShowAll=false;labResults();};
  lab('sort').onchange=function(){labShowAll=false;labResults();};
  lab('detail').onclick=labDetail;
  ['contenders','explorer'].forEach(function(id){lab(id).onclick=function(event){if(event.target.closest('[data-lab-show-all]')){labShowAll=true;labResults();return;}var b=event.target.closest('[data-lab-job]');if(b)window.runAnalyticsViewEpoch(b.dataset.labJob,Number(b.dataset.labEpoch));};});
  lab('challenge-actions').onclick=function(event){
    var b=event.target.closest('[data-lab-action]');if(!b)return;
    var action=b.dataset.labAction;
    if(action==='detail'){labDetail();return;}
    if(action==='review'){labReviewOpen();return;}
    if(action==='ai'){labAiStart();return;}
    var list=labRanked(),p=action==='challenger'?list[1]:(list[0]||labPoints()[0]);
    if(p)window.runAnalyticsViewEpoch(p.jobId,p.epoch);else labDetail();
  };
})();
