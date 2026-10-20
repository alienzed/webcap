(function () {
  'use strict';
  var state = {tests:null, analytics:null};
  function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function element(tag, name, value) { var node=document.createElement(tag);if(name)node.className=name;if(value!=null)node.textContent=String(value);return node; }
  function request(folder,operation,criteria) {
    return fetch('/fs/epoch_finder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder:folder,operation:operation,criteria:criteria})})
      .then(function(r){return r.json().then(function(data){if(!r.ok||!data.ok)throw new Error(data.error||'Epoch inspection failed');return data;});});
  }
  function stat(title,value){var box=element('div','epoch-info-stat');box.appendChild(element('strong','',value));box.appendChild(element('span','',title));return box;}
  function renderHeader(root,view) {
    // Only the first render rebuilds the shell; subsequent pages update keyed cards.
    if(view.rendered){
      view.refreshCards();
      var more=view.moreButton;
      if(more)more.hidden=view.offset>=view.total;
      return;
    }
    view.rendered=true;
    root.replaceChildren();
    var header=element('div','epoch-info-header');
    header.appendChild(element('h3','', 'Epoch '+view.epoch));
    header.appendChild(element('p','', 'Run '+view.jobId.slice(-8)+' · All recorded Test and Campaign evidence'));
    root.appendChild(header);
    var summary=view.summary||{};
    var grid=element('div','epoch-info-stats');
    grid.appendChild(stat('Generations',summary.count==null?'—':summary.count));
    grid.appendChild(stat('Test / Campaign',String(summary.testCount||0)+' / '+String(summary.campaignCount||0)));
    grid.appendChild(stat('Manual ratings',summary.manualAverage==null?'—':Number(summary.manualAverage).toFixed(2)+' / 5'));
    grid.appendChild(stat('Rated Test renders',String(summary.rated||0)));
    grid.appendChild(stat('Test VL agreement',summary.testVl==null?'—':Math.round(summary.testVl*100)+'%'));
    grid.appendChild(stat('Scored VL attributes',summary.testVlJudgments||0));
    root.appendChild(grid);
    var training=view.training;
    if(training) {
      var loss=(training.lossPoints||[]).find(function(p){return p.epoch===view.epoch;});
      var box=element('div','epoch-info-training');
      box.appendChild(element('strong','', 'Training context'));
      box.appendChild(element('span','',loss&&Number.isFinite(loss.loss)?'Epoch loss '+Number(loss.loss).toFixed(4):'No saved loss measurement for this epoch'));
      var points=(training.lossPoints||[]).filter(function(p){return Number.isFinite(p.loss);});
      if(points.length>1) {
        var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 650 100');svg.setAttribute('role','img');svg.setAttribute('aria-label','Recorded training loss by epoch');
        var mn=Math.min.apply(null,points.map(function(p){return p.loss;})),mx=Math.max.apply(null,points.map(function(p){return p.loss;}));
        var x0=points[0].epoch,x1=points[points.length-1].epoch;
        var line=document.createElementNS(svg.namespaceURI,'polyline');
        line.setAttribute('points',points.map(function(p){return (15+620*(p.epoch-x0)/Math.max(1,x1-x0)).toFixed(1)+','+(10+80*(mx-p.loss)/Math.max(.000001,mx-mn)).toFixed(1);}).join(' '));
        line.setAttribute('fill','none');line.setAttribute('stroke','currentColor');line.setAttribute('stroke-width','2');svg.appendChild(line);box.appendChild(svg);
      }
      root.appendChild(box);
    }
    (summary.campaignScores||[]).forEach(function(score) {
      var p=element('p','epoch-info-campaign-score',score.name+': VL '+(score.score==null?'unscored':Math.round(score.score*100)+'%')+' · '+(score.observations||0)+' weighted observations (independent campaign protocol)');
      root.appendChild(p);
    });
    var toolbar=element('div','epoch-info-toolbar');
    toolbar.appendChild(element('strong','', 'Recorded generations'));
    var source=element('select');source.setAttribute('aria-label','Filter generation source');
    [['all','All sources'],['test','Test sessions'],['campaign','Campaigns'],['rated','Rated only']].forEach(function(p){var opt=element('option','',p[1]);opt.value=p[0];source.appendChild(opt);});
    var sort=element('select');sort.setAttribute('aria-label','Sort generation evidence');
    [['original','Original order'],['rating','Highest rated'],['recent','Newest first']].forEach(function(p){var opt=element('option','',p[1]);opt.value=p[0];sort.appendChild(opt);});
    toolbar.appendChild(source);toolbar.appendChild(sort);root.appendChild(toolbar);
    var gallery=view.gallery||element('div','epoch-info-grid');
    view.gallery=gallery;
    root.appendChild(gallery);
    function refreshCards(){
      var items=view.items.filter(function(x){return (x.source==='test'?x.mediaAvailable!==false:!!x.frame&&!x.framePruned) && (source.value==='all'||x.source===source.value||(source.value==='rated'&&x.source==='test'&&x.rating>0));});
      if(sort.value==='rating')items.sort(function(a,b){return Number(b.rating||0)-Number(a.rating||0);});
      if(sort.value==='recent')items.sort(function(a,b){return Number(b.startedAt||0)-Number(a.startedAt||0);});
      // Keyed reuse preserves video playback and open Details during paging/refresh.
      var ordered=new Set();
      items.forEach(function(item,index){
        if(!item||!item.id)return;
        ordered.add(item.id);
        var card=view.cards.get(item.id);
        if(!card){card=renderCard(item,view);if(card)view.cards.set(item.id,card);}
        if(card){
          var at=gallery.children[index]||null;
          if(card!==at)gallery.insertBefore(card,at);
        }
      });
      Array.from(gallery.children).forEach(function(card){
        if(card.dataset.resultKey&&!ordered.has(card.dataset.resultKey))card.remove();
      });
      var empty=gallery.querySelector('.epoch-info-empty');
      if(items.length&&empty)empty.remove();
      if(!items.length&&!empty)gallery.appendChild(element('p','epoch-info-empty', 'No matching recorded generations.'));
    }
    source.onchange=refreshCards;sort.onchange=refreshCards;refreshCards();
    view.refreshCards=refreshCards;
    {
      var more=element('button','review-captions-btn','Load more');
      view.moreButton=more;
      more.hidden=view.offset>=view.total;
      more.type='button';root.appendChild(more);
      more.onclick=function(){more.disabled=true;load(view,true).catch(function(e){showError(root,e);}).finally(function(){more.disabled=false;});};
    }
    if(view.warnings&&view.warnings.length){var d=element('details','epoch-info-warnings');d.appendChild(element('summary','', 'Evidence limitations'));view.warnings.forEach(function(w){d.appendChild(element('p','',w));});root.appendChild(d);}
  }
  function syncRatingSummary(view){
    // Refresh aggregate stats without recreating media elements, interactive
    // controls, filters or playback state.
    return request(view.folder,'checkpoint_workspace',{jobId:view.jobId,epoch:view.epoch,offset:0,limit:1})
      .then(function(data){
        if(state[view.mode]!==view)return;
        view.summary=data.summary||view.summary;
        var host=document.getElementById(view.host);
        var grid=host.querySelector('.epoch-info-stats');
        if(!grid)return;
        var cells=grid.querySelectorAll('.epoch-info-stat strong');
        if(cells[2])cells[2].textContent=view.summary.manualAverage==null?'—':Number(view.summary.manualAverage).toFixed(2)+' / 5';
        if(cells[3])cells[3].textContent=String(view.summary.rated||0);
        // Keep playback and current filter controls untouched.
      }).catch(function(e){showError(document.getElementById(view.host),e);});
  }
  function showError(root,e){root.appendChild(element('p','epoch-finder-error',e.message||e));window.reportConsoleError('Epoch Info',e);}
  function renderCard(item, view) {
    var available=item.source==='test' ? item.mediaAvailable!==false : !!item.frame&&!item.framePruned;
    if (!available) return null;
    var isTest=item.source==='test';
    var url=isTest?'/fs/test_generations/media?folder='+encodeURIComponent(view.folder)+'&session='+encodeURIComponent(item.session)+'&media='+encodeURIComponent(item.mediaFile)
      : '/fs/epoch_finder/frame?folder='+encodeURIComponent(view.folder)+'&campaign='+encodeURIComponent(item.campaignId)+'&frame='+encodeURIComponent(item.frame);
    var title=isTest?(item.runName||'Run')+' · Epoch '+view.epoch:'Campaign · Epoch '+view.epoch;
    var settings=item.settings||{}, meta=[];
    if (settings.megapixels!=null)meta.push(settings.megapixels+' MP');
    if (item.strength!=null)meta.push('Strength '+item.strength);
    if (settings.duration!=null)meta.push(settings.duration+'s');
    var evaluations=[],details=[];
    var checks=item.assessment&&item.assessment.comparison||[];
    if(item.assessment){
      var matches=checks.filter(function(c){return c.result==='match';}).length;
      var counted=checks.filter(function(c){return c.result==='match'||c.result==='mismatch';}).length;
      evaluations.push({label:counted?'VL '+matches+'/'+counted:'VL ✓',title:'Recorded original VL evidence; use Details for the judgments.'});
      details.push({label:'VL observations',value:checks.length?checks.map(function(c){return (c.label||c.id||'Attribute')+': '+c.result+' · expected '+(c.expectedText||'')+' · observed '+(c.selectedText||'');}):item.assessment.text||'Saved assessment'});
    }
    if((item.referenceAssessments||[]).length){
      evaluations.push({label:'Ref '+item.referenceAssessments.length,title:'Saved reference VL comparisons'});
      details.push({label:'Reference VL',value:item.referenceAssessments.map(function(v){return (v.label||v.group||'Reference')+': '+(v.verdict||'unclear')+' · '+(v.reference||'');})});
    }
    if((item.dinoAssessments||[]).length){
      evaluations.push({label:'DINO '+item.dinoAssessments.length,title:'Saved distinct DINO comparisons; per-reference scores under Details'});
      details.push({label:'DINOv2',value:item.dinoAssessments.map(function(v){return (v.reference||'Reference')+': '+(Number.isFinite(Number(v.similarity))?Number(v.similarity).toFixed(3):'unavailable');})});
    }
    if(item.prompt)details.push({label:'Resolved prompt',value:item.prompt,pre:true});
    if(item.seed!=null)details.push({label:'Seed',value:String(item.seed)});
    if(item.modelId)details.push({label:'Model',value:item.modelId});
    var card=createTestPreviewCard({
      className:'epoch-info-card',key:item.id,
      title:title, sourceDetail:isTest?'Test · '+item.session:'Campaign · Round '+item.round+' / Test '+(Number(item.case)+1),
      elapsed:item.elapsedMs!=null?Math.round(item.elapsedMs/1000)+'s':item.renderSeconds!=null?Math.round(item.renderSeconds)+'s':'',
      media:{kind:isTest&&(item.mediaKind==='video'||/\.(mp4|webm|mov|mkv)$/i.test(item.mediaFile||''))?'video':'image',url:url,alt:'Saved checkpoint result'},
      metadata:meta,wildcards:item.wildcards||[],evaluations:evaluations,details:details,
      rating:isTest?{value:item.rating,session:item.session,mediaFile:item.mediaFile,
        onRate:function(value,card){
          card.querySelectorAll('[data-test-rating]').forEach(function(button){button.disabled=true;});
          fetch('/fs/test_generations',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({folder:view.folder,operation:'test_rate_result',criteria:{session:item.session,mediaFile:item.mediaFile,rating:value}})})
            .then(function(r){return r.json().then(function(data){if(!r.ok||!data.ok)throw new Error(data.error||'Rating failed');return data;});})
            .then(function(data){item.rating=data.rating;updateTestPreviewCardRating(card,data.rating);syncRatingSummary(view);})
            .catch(function(e){updateTestPreviewCardRating(card,item.rating||0);showError(card,e);});
        }}:null,
      actions:[
        {label:'Open original',url:url},
        {label:isTest?'Open session':'Open campaign',onClick:function(){
          if(isTest)window.openTestBenchAnalyticsSession(item.session);
          else window.epochFinderInspectCampaign(item.campaignId,item.epoch,item.jobId);
        }}
      ]
    });
    return card;
  }
  function load(view,more,summaryOnly){
    var host=document.getElementById(view.host);
    if(!more&&!summaryOnly){host.replaceChildren(element('p','', 'Reading recorded epoch evidence…'));view.items=[];view.offset=0;}
    return request(view.folder,'checkpoint_workspace',{jobId:view.jobId,epoch:view.epoch,offset:summaryOnly?0:view.offset,limit:summaryOnly?1:24}).then(function(data){
      if(state[view.mode]!==view)return;
      if(!summaryOnly){view.items=view.items.concat(data.media||[]);view.offset=view.items.length;view.total=data.total;}
      if(data.summary)view.summary=data.summary;if(data.training!==undefined)view.training=data.training;
      if(data.warnings)view.warnings=data.warnings;
      renderHeader(host,view);
    }).catch(function(e){if(state[view.mode]===view)showError(host,e);throw e;});
  }
  window.epochInfoOpen=function(mode,folder,jobId,epoch){
    if(mode!=='tests'&&mode!=='analytics')throw new Error('Unknown epoch inspector view: '+mode);
    var host=mode==='tests'?'test-generations-epoch-info':'run-analytics-epoch-info';
    var view={mode:mode,host:host,folder:folder,jobId:String(jobId),epoch:Number(epoch),items:[],offset:0,total:0,cards:new Map(),rendered:false};
    state[mode]=view;
    if(mode==='tests') {
      document.getElementById('test-generations-session-surface').classList.add('hidden');
      document.getElementById(host).classList.remove('hidden');
    }else{
      document.getElementById('run-analytics-report-surface').classList.add('hidden');
      document.getElementById(host).classList.remove('hidden');
    }
    return load(view,false);
  };
  // Analytics selection and Test-to-epoch links use the same surface.
  window.runAnalyticsViewEpoch=function(jobId,epoch,returnMode){
    var mode=returnMode==='tests'?'tests':'analytics';
    if(mode==='analytics') {
      window.epochFinderShowMode('analytics');
    }
    var folder=window.runAnalyticsFolder();
    if(!folder)throw new Error('Select a Set before inspecting checkpoint results.');
    return window.epochInfoOpen(mode,folder,jobId,epoch);
  };
  window.epochInfoShowSession=function(){
    state.tests=null;document.getElementById('test-generations-epoch-info').classList.add('hidden');document.getElementById('test-generations-session-surface').classList.remove('hidden');
  };
  window.epochInfoShowAnalytics=function(){
    state.analytics=null;document.getElementById('run-analytics-epoch-info').classList.add('hidden');document.getElementById('run-analytics-report-surface').classList.remove('hidden');
  };
})();