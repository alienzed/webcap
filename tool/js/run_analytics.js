(function () {
  'use strict';
  var folder = '', runs = [], report = null, generation = 0, previewGeneration = 0, selection = new Set(), sessionFilter = '', directorJob = '', directorContext = '', selectedCohort = '', previewFacts = null, previewKey = ''; 
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
      .then(function(data){if(token===generation&&origin===folder){report=data;render();}})
      .catch(function(exc){if(token===generation)error(exc);})
      .finally(function(){if(token===generation){el('analyze').textContent='Analyze selected';updateScopeUi();}});
  }
  function discover() {
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
    if(next===folder)return;folder=next;generation++;runs=[];selection=new Set();report=null;sessionFilter='';
    el('run-choices').innerHTML='';el('coverage').textContent='Choose a run to begin.';
    el('chart').innerHTML='';el('table').innerHTML='';el('findings').innerHTML='';el('warnings').innerHTML='';
    el('campaign').innerHTML='<option value="">No campaign</option>';el('session').innerHTML='<option value="">All sessions</option>';
    el('director').disabled=true;updateScopeUi();previewGeneration++;previewFacts=null;previewKey='';el('director-result').textContent='';el('director-status').textContent='';clearError();
  };
  window.runAnalyticsOpen=discover;
  el('run-choices').onchange=function(event){
    var cb=event.target.closest('[data-analytics-run]');if(!cb)return;
    if(cb.checked)selection.add(cb.dataset.analyticsRun);else selection.delete(cb.dataset.analyticsRun);
    generation++;report=null;previewGeneration++;previewFacts=null;previewKey='';el('director').disabled=true;el('analyze').disabled=false;el('analyze').textContent='Analyze selected';el('coverage').textContent='Selection changed — Analyze selected to refresh.';el('chart').innerHTML='';el('table').innerHTML='';el('findings').innerHTML='';
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
    el('epoch-media-dialog').close();
    el('epoch-media-grid').replaceChildren();
    el('epoch-media-more').classList.add('hidden');
    if(back==='finder')window.epochFinderShowMode('finder');
  }
  function epochMediaLoad(more) {
    if (!epochMediaScope || epochMediaLoading) return;
    var scope=epochMediaScope, serial=epochMediaSerial;
    epochMediaLoading=true;
    el('epoch-media-status').textContent='Loading recorded checkpoint results…';
    fetch('/fs/epoch_finder',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({folder:folder,operation:'workspace_gallery',criteria:{
        limit:8,offset:more?epochMediaOffset:0,checkpoints:[scope.jobId+':'+scope.epoch]
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
        el('epoch-media-status').textContent=epochMediaOffset+' / '+epochMediaTotal+' recorded results';
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
    epochMediaReturnMode=returnMode==='finder'?'finder':'analytics';
    el('epoch-media-close').textContent=epochMediaReturnMode==='finder'?'← Back to Campaign':'← Back to Analytics';
    window.epochFinderShowMode('analytics');
    epochMediaSerial++;
    epochMediaScope={jobId:id,epoch:num};
    epochMediaOffset=0;
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
    if(epochMediaReturnMode==='finder')window.epochFinderShowMode('finder');
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
})();
