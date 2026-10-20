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
    var gallery=element('div','epoch-info-grid');root.appendChild(gallery);
    function refreshCards(){
      var items=view.items.filter(function(x){return source.value==='all'||x.source===source.value||(source.value==='rated'&&x.source==='test'&&x.rating>0);});
      if(sort.value==='rating')items.sort(function(a,b){return Number(b.rating||0)-Number(a.rating||0);});
      if(sort.value==='recent')items.sort(function(a,b){return Number(b.startedAt||0)-Number(a.startedAt||0);});
      // Sorting or explicit filter changes are the only reasons to reconstruct cards.
      gallery.replaceChildren();
      items.forEach(function(item){gallery.appendChild(renderCard(item,view));});
      if(!items.length)gallery.appendChild(element('p','', 'No matching recorded generations.'));
    }
    source.onchange=refreshCards;sort.onchange=refreshCards;refreshCards();
    view.refreshCards=refreshCards;
    if(view.offset<view.total) {
      var more=element('button','review-captions-btn','Load more');
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
  function renderCard(item,view) {
    var card=element('article','epoch-info-card');
    var head=element('div','epoch-info-card-head');
    head.appendChild(element('strong','',item.source==='test'?'Test session '+item.session:'Campaign '+item.campaignId.slice(0,8)));
    head.appendChild(element('span','',item.source==='test'?(item.candidate||'Test generation'):('Round '+item.round+' · Test '+(Number(item.case)+1))));
    card.appendChild(head);
    var media=element('div','epoch-info-media');
    var available=item.source==='test'?item.mediaAvailable!==false:!!item.frame&&!item.framePruned;
    var uri=item.source==='test'?'/fs/test_generations/media?folder='+encodeURIComponent(view.folder)+'&session='+encodeURIComponent(item.session)+'&media='+encodeURIComponent(item.mediaFile):'/fs/epoch_finder/frame?folder='+encodeURIComponent(view.folder)+'&campaign='+encodeURIComponent(item.campaignId)+'&frame='+encodeURIComponent(item.frame||'');
    if(available) {
      var isVideo=item.source==='test'&&(item.mediaKind==='video'||/\.(mp4|webm|mov|mkv)$/i.test(item.mediaFile||''));
      var preview=element(isVideo?'video':'img');
      preview.src=uri;if(isVideo){preview.controls=true;preview.preload='metadata';preview.playsInline=true;}else{preview.loading='lazy';preview.alt='Saved checkpoint render';}
      media.appendChild(preview);
    }else media.appendChild(element('p','',item.framePruned?'Frame pruned after evaluation':'Media unavailable'));
    card.appendChild(media);
    var meta=element('div','epoch-info-card-info');
    if(item.source==='test') {
      var rating=element('div','epoch-info-rating');rating.setAttribute('aria-label','Rate Test render');
      function stars(n){rating.replaceChildren();for(var value=1;value<=5;value++){(function(v){var b=element('button','test-generations-result-star'+(v<=n?' active':''),v<=n?'★':'☆');b.title='Rate '+v+' stars';b.type='button';b.onclick=function(){setRating(v);};rating.appendChild(b);})(value);}}
      function setRating(v){Array.from(rating.querySelectorAll('button')).forEach(function(b){b.disabled=true;});
        fetch('/fs/test_generations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder:view.folder,operation:'test_rate_result',criteria:{session:item.session,mediaFile:item.mediaFile,rating:v}})})
          .then(function(r){return r.json().then(function(data){if(!r.ok||!data.ok)throw new Error(data.error||'Rating failed');return data;});})
          .then(function(data){item.rating=data.rating;stars(data.rating);syncRatingSummary(view);})
          .catch(function(e){stars(item.rating||0);showError(meta,e);});}
      stars(item.rating||0);meta.appendChild(rating);
    }else meta.appendChild(element('span','epoch-info-readonly','Campaign VL · no manual rating'));
    var wildcard=item.wildcards||[];
    if(wildcard.length){var list=element('div','epoch-info-wildcards');wildcard.forEach(function(entry){list.appendChild(element('span','',typeof entry==='string'?entry:(entry.label+': '+entry.value)));});meta.appendChild(list);}
    var settings=item.settings||{};
    var labels=[];if(settings.megapixels!=null)labels.push(settings.megapixels+' MP');if(settings.duration!=null)labels.push(settings.duration+'s');if(item.seed!=null)labels.push('Seed '+item.seed);if(item.strength!=null)labels.push('Strength '+item.strength);if(item.elapsedMs!=null)labels.push(Math.round(item.elapsedMs/1000)+'s render');
    if(labels.length)meta.appendChild(element('p','epoch-info-meta',labels.join(' · ')));
    var a=item.assessment;
    if(a&&typeof a==='object') {
      var checks=a.comparison||[];var matched=checks.filter(function(c){return c.result==='match';}).length;
      var compared=checks.filter(function(c){return c.result==='match'||c.result==='mismatch';}).length;
      var details=element('details','epoch-info-assessment');
      details.appendChild(element('summary','', 'VL assessment · '+(compared?matched+'/'+compared+' direct matches':'saved evidence')));
      checks.forEach(function(c){details.appendChild(element('p','', (c.label||c.id||'Attribute')+': '+c.result));});
      if(a.text)details.appendChild(element('pre','',a.text));meta.appendChild(details);
    }
    if(item.referenceAssessments&&item.referenceAssessments.length||item.dinoAssessments&&item.dinoAssessments.length){
      var extra=element('details','epoch-info-assessment');extra.appendChild(element('summary','', 'Reference comparisons'));(item.referenceAssessments||[]).forEach(function(v){extra.appendChild(element('p','',(v.label||'Reference')+': '+v.verdict));});(item.dinoAssessments||[]).forEach(function(v){extra.appendChild(element('p','',(v.reference||'DINO')+': '+Number(v.similarity).toFixed(3)));});meta.appendChild(extra);
    }
    if(item.prompt){var p=element('details','epoch-info-assessment');p.appendChild(element('summary','', 'Resolved prompt'));p.appendChild(element('pre','',item.prompt));meta.appendChild(p);}
    var actions=element('div','epoch-info-actions');
    if(available){var original=element('a','', 'Open original ↗');original.href=uri;original.target='_blank';original.rel='noopener noreferrer';actions.appendChild(original);}
    var origin=element('button','review-captions-btn','Open '+(item.source==='test'?'session':'campaign'));origin.type='button';origin.onclick=function(){if(item.source==='test')window.openTestBenchAnalyticsSession(item.session);else window.epochFinderInspectCampaign(item.campaignId,item.epoch,item.jobId);};actions.appendChild(origin);
    meta.appendChild(actions);card.appendChild(meta);return card;
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
    var view={mode:mode,host:host,folder:folder,jobId:String(jobId),epoch:Number(epoch),items:[],offset:0,total:0};
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