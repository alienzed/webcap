(function () {
  'use strict';
  var root = document.getElementById('test-unified-workspace');
  var legacy = document.getElementById('test-generations-body');
  var folder = '', model = '', payload = {sessions:[],campaigns:[],media:[]};
  var perspective = 'experiments', selection = '', chosen = '', serial = 0;
  var loadedOffset = 0, pageSize = 48, loadingMore = false;
  var checkpointSelection = new Set();
  var previewObserver = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(function(entries) {entries.forEach(function(entry) {
        if(!entry.isIntersecting)return;
        previewObserver.unobserve(entry.target);
        loadPreview(entry.target);
      });}, {root:document.getElementById('test-unified-gallery'),rootMargin:'60px'})
    : null;
  var pendingPreviews=[],activePreviews=0,previewVersion=0;
  function loadPreview(node) {
    if(node.dataset.previewRequested)return;
    node.dataset.previewRequested='1';
    pendingPreviews.push({node:node,version:previewVersion});
    pumpPreviews();
  }
  function pumpPreviews() {
    while(activePreviews<3 && pendingPreviews.length) {
      var task=pendingPreviews.shift(),node=task.node;
      if(task.version!==previewVersion || !node.isConnected)continue;
      activePreviews++;
      var done=false;
      var timeout=setTimeout(finish,12000);
      function finish(){if(done)return;done=true;clearTimeout(timeout);activePreviews--;pumpPreviews();}
      node.addEventListener('error',finish,{once:true});
      if(node.tagName==='VIDEO') {
        node.addEventListener('loadedmetadata',function(){
          var d=Number(node.duration);
          try {node.currentTime=Number.isFinite(d)&&d>0?Math.min(0.15,d/2):0.1;}
          catch(e){finish();}
        },{once:true});
        node.addEventListener('loadeddata',finish,{once:true});
        node.addEventListener('seeked',finish,{once:true});
      } else node.addEventListener('load',finish,{once:true});
      node.src=node.dataset.previewSrc;
    }
  }
  function deferPreview(node,url) {
    node.dataset.previewSrc=url;
    if(previewObserver)previewObserver.observe(node);
    else loadPreview(node);
  }

  function el(id) { return document.getElementById('test-unified-' + id); }
  function text(node, value) { node.textContent = String(value == null ? '' : value); }
  function label(item) { return item.name || item.id; }
  function show(enabled) {
    root.classList.toggle('hidden', !enabled);
    legacy.classList.toggle('hidden', enabled);
    if (!enabled) {
      var originalBuild = document.querySelector('[data-test-generations-perspective="build"]');
      if (!originalBuild) throw new Error('Existing Test Build view is missing.');
      originalBuild.click();
    }
  }
  function api() {
    return fetch('/fs/epoch_finder', {method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({folder:folder,operation:'workspace_gallery',criteria:{modelId:model,limit:pageSize,offset:loadedOffset}})})
      .then(function(response) { return response.json().then(function(data) {
        if (!response.ok || !data.ok) throw new Error(data.error || 'Could not load generated results.');
        return data;
      }); });
  }
  function refresh() {
    var version = ++serial;
    loadedOffset = 0;
    text(el('description'), 'Loading first 48 results…');
    return api().then(function(result) {
      if (version !== serial) return;
      payload = result;
      renderList(); renderGallery();
    }).catch(function(error) {
      if (version !== serial) return;
      text(el('description'), 'Unable to load results: ' + String(error.message || error));
      console.error('[Test Generations Explore]', error);
      window.reportConsoleError('Test Generations Explore', error);
    });
  }
  function loadMore() {
    if (loadingMore || (payload.media || []).length >= Number(payload.total || 0)) return;
    loadingMore = true;
    loadedOffset = (payload.media || []).length;
    var version = serial;
    api().then(function(result) {
      if(version !== serial) return;
      payload.media = (payload.media || []).concat(result.media || []);
      payload.total = result.total;
      renderGallery();
    }).catch(function(error) {
      window.reportConsoleError('Test Generations load more',error);
      text(el('description'),'More results unavailable: '+String(error.message || error));
    }).finally(function(){loadingMore=false;});
  }
  function recordedTime(item) {
    var n=Number(item && item.startedAt || 0);
    return n>1e11 ? n/1000 : n;
  }
  function collections() {
    if (perspective === 'experiments') return payload.sessions.map(function(item) {
      return {id:'test:'+item.id, name:item.name, status:item.status, startedAt:item.startedAt};
    }).concat(payload.campaigns.map(function(item) {
      return {id:'campaign:'+item.id,name:item.name,status:item.status,startedAt:item.startedAt};
    })).sort(function(a,b){return recordedTime(b)-recordedTime(a);});
    var map = new Map();
    (payload.runs || []).forEach(function(run) {
      if (model && run.modelId !== model) return;
      (run.epochs || []).forEach(function(epoch) {
        if (!Number.isInteger(epoch)) return;
        var id = run.jobId + ':' + epoch;
        if (!map.has(id)) map.set(id,{id:id,name:(run.runName || 'Run '+String(run.jobId).slice(-8))+' · Epoch '+epoch});
      });
    });
    payload.media.forEach(function(item) {
      if (!item.jobId || !Number.isInteger(item.epoch)) return;
      var id = item.jobId + ':' + item.epoch;
      if (!map.has(id)) map.set(id,{id:id,name:(item.runName || 'Run ' + item.jobId.slice(-8))+' · Epoch '+item.epoch});
    });
    return Array.from(map.values()).sort(function(a,b) {return a.name.localeCompare(b.name,undefined,{numeric:true});});
  }
  function renderList() {
    ['experiments','checkpoints'].forEach(function(name) {
      var active=perspective===name;
      el(name).classList.toggle('active',active);
      el(name).setAttribute('aria-pressed',String(active));
    });
    var host=el('list');host.replaceChildren();
    collections().forEach(function(item) {
      var btn=document.createElement('button');btn.type='button';btn.className='test-unified-item';
      btn.classList.toggle('active',item.id===selection || (perspective==='checkpoints' && checkpointSelection.has(item.id)));
      btn.textContent=label(item)+(item.status?' · '+item.status:'');
      btn.addEventListener('click',function(event) {
        if (perspective==='checkpoints') {
          if(event.ctrlKey || event.metaKey || event.shiftKey) {
            if(checkpointSelection.has(item.id)) checkpointSelection.delete(item.id);
            else checkpointSelection.add(item.id);
          } else {checkpointSelection.clear(); checkpointSelection.add(item.id);}
        }
        selection = perspective==='checkpoints'
          ? (checkpointSelection.has(item.id) ? item.id : (checkpointSelection.values().next().value || ''))
          : item.id;
        renderList();renderGallery();
      });
      host.appendChild(btn);
    });
  }
  function selectedMedia() {
    return (payload.media||[]).filter(function(item) {
      if (!selection) return true;
      return perspective==='experiments' ? item.collectionId===selection
        : checkpointSelection.size ? checkpointSelection.has(item.jobId+':'+item.epoch)
          : item.jobId+':'+item.epoch===selection;
    });
  }
  function mediaUrl(item) {
    if (item.source==='campaign') return item.frame ? '/fs/epoch_finder/frame?folder='+encodeURIComponent(folder)+'&campaign='+encodeURIComponent(item.campaignId)+'&frame='+encodeURIComponent(item.frame) : '';
    return item.mediaFile ? '/fs/test_generations/media?folder='+encodeURIComponent(folder)+'&session='+encodeURIComponent(item.session)+'&media='+encodeURIComponent(item.mediaFile) : '';
  }
  function inspect(item) {
    chosen=item.id;
    var host=el('details'); host.replaceChildren();
    var original=mediaUrl(item);
    if (original && item.mediaAvailable !== false && !item.framePruned) {
      var preview=document.createElement(item.source==='campaign' || /\.(png|jpe?g|webp|gif|avif)$/i.test(item.mediaFile||'') || item.mediaKind==='image' ? 'img':'video');
      preview.className='test-unified-inspect-media';
      preview.src=original;
      if(preview.tagName==='VIDEO') preview.controls=true;
      else preview.alt='Selected generated result';
      host.appendChild(preview);
      var link=document.createElement('a');
      link.href=original;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open original';
      host.appendChild(link);
    }
    var name=document.createElement('h4');name.textContent=item.candidate || (item.epoch==null?'Unattributed result':'Epoch '+item.epoch);host.appendChild(name);
    [['Source',item.source],['Run',item.runName||item.jobId],['Epoch',item.epoch],['Candidate',item.candidateFile],['Type',item.kind],['Strength',item.strength],['Session',item.session],['Campaign',item.campaignId],['Round',item.round],['Case',item.case],['Seed',item.seed],['Rating',item.rating],['Render time (s)',item.renderSeconds],['VL time (s)',item.visionWallSeconds],['Elapsed (ms)',item.elapsedMs],['Prompt',item.prompt],['Settings',item.settings],['VL assessment',item.assessment],['Reference comparisons',item.referenceAssessments],['DINO evidence',item.dinoAssessments],['Error',item.error]].forEach(function(pair) {
      if (pair[1]===undefined || pair[1]===null || pair[1]==='')return;
      var section=document.createElement('section'),label=document.createElement('strong'),value=document.createElement('pre');
      label.textContent=pair[0];value.textContent=typeof pair[1]==='object'?JSON.stringify(pair[1],null,2):String(pair[1]);
      section.append(label,value);host.appendChild(section);
    });
    if(item.prompt) {
      var reuse=document.createElement('button');reuse.type='button';
      reuse.className='review-captions-btn';reuse.textContent='Use prompt in builder';
      reuse.addEventListener('click',function() {
        document.getElementById('test-generations-prompt').value=String(item.prompt);
        document.getElementById('test-generations-prompt').dispatchEvent(new Event('input',{bubbles:true}));
        builder(true);
      });
      host.appendChild(reuse);
    }
    var open=document.createElement('button');open.type='button';open.className='review-captions-btn';
    open.textContent='Open source '+(item.source==='campaign'?'campaign':'session');
    open.addEventListener('click',function() {
      mountExistingControls(false);show(false);
      if (item.source==='campaign') window.epochFinderInspectCampaign(item.campaignId,item.epoch,item.jobId);
      else {
        window.epochFinderShowMode('tests');
        var target=document.querySelector('[data-session-name]');
        target=Array.from(document.querySelectorAll('[data-session-name]')).find(function(e) {return e.dataset.sessionName===item.session;});
        if (target) target.click();
        else window.openTestBenchAnalyticsSession(item.session);
      }
    });host.appendChild(open);
  }
  function renderGallery() {
    var host=el('gallery');host.replaceChildren();
    previewVersion++;pendingPreviews.length=0;
    if(previewObserver)previewObserver.disconnect();
    var records=selectedMedia();
    if(!selection) records.sort(function(a,b){return recordedTime(b)-recordedTime(a);});
    if(chosen && !records.some(function(item){return item.id===chosen;})) {
      chosen='';text(el('details'),'Select an image to inspect its generation settings and assessments.');
    }
    if(perspective==='checkpoints' && checkpointSelection.size>1) records.sort(function(a,b){return (a.jobId+':'+a.epoch).localeCompare(b.jobId+':'+b.epoch,undefined,{numeric:true});});
    text(el('title'),selection ? (collections().find(function(x){return x.id===selection;})||{}).name || 'Results' : 'All generated results');
    var warningText=(payload.warnings||[]).filter(Boolean).join(' · ');
    text(el('description'),records.length+' shown of '+Number(payload.total || records.length)+' results · '+(perspective==='experiments'?'Experiments':'Checkpoints')+(warningText?' · '+warningText:''));
    el('description').classList.toggle('is-warning',!!warningText);
    var previousCheckpoint = '';
    records.forEach(function(item) {
      var checkpoint = item.jobId+':'+item.epoch;
      if (perspective==='checkpoints' && checkpointSelection.size>1 && checkpoint!==previousCheckpoint) {
        var heading=document.createElement('h3');heading.className='test-unified-group-title';
        heading.textContent=(item.runName||'Run '+item.jobId.slice(-8))+' · Epoch '+item.epoch;
        host.appendChild(heading);
        previousCheckpoint=checkpoint;
      }
      var card=document.createElement('button');card.type='button';card.className='test-unified-card';
      var src=mediaUrl(item);
      var isImage=item.source==='campaign' || /\.(png|jpe?g|webp|gif|avif)$/i.test(item.mediaFile||'') || item.mediaKind==='image';
      if(src && item.mediaAvailable !== false && !item.framePruned) {
        var media=document.createElement(isImage?'img':'video');
        if(isImage) {media.alt='Generated result';} else {media.preload='metadata';media.muted=true;media.playsInline=true;}
        card.appendChild(media);deferPreview(media,src);
      } else {var blank=document.createElement('span');blank.textContent=item.error || (item.framePruned?'Frame pruned':item.mediaAvailable===false?'Media missing':'No retained frame');card.appendChild(blank);}
      var title=document.createElement('span');title.textContent=(item.runName ? item.runName+' · ':'')+(item.epoch==null?'Unattributed':'Epoch '+item.epoch)+(item.rating?' · ★ '+item.rating:'');
      card.appendChild(title);card.classList.toggle('active',chosen===item.id);
      card.addEventListener('click',function(){inspect(item);host.querySelectorAll('.test-unified-card').forEach(function(node){node.classList.toggle('active',node===card);});});host.appendChild(card);
    });
    if(!records.length) {var p=document.createElement('p');p.textContent='No matching results in the loaded page. Load more to continue browsing.';host.appendChild(p);}
    if ((payload.media || []).length < Number(payload.total || 0)) {
      var more=document.createElement('button');more.type='button';more.className='review-captions-btn test-unified-load-more';
      more.textContent='Load more results ('+(payload.media || []).length+' / '+payload.total+')';
      more.addEventListener('click',loadMore);host.appendChild(more);
    }
  }
  var advancedScreens = {
    finder: document.getElementById('epoch-finder-screen'),
    references: document.getElementById('test-references-screen'),
    analytics: document.getElementById('run-analytics-screen')
  };
  var advancedMarkers = {};
  Object.keys(advancedScreens).forEach(function(mode) {
    var screen = advancedScreens[mode];
    if (!screen || !screen.parentNode) throw new Error('Missing original Test tool: ' + mode);
    var marker = document.createComment(mode + ' original location');
    screen.parentNode.insertBefore(marker, screen);
    advancedMarkers[mode] = marker;
  });
  var activeAdvanced = '';
  function highlightBuildMode(next) {
    ['normal','finder','references','analytics'].forEach(function(mode) {
      var selected=mode===next;
      el(mode).classList.toggle('active',selected);
      el(mode).setAttribute('aria-pressed',String(selected));
    });
  }
  function mountAdvanced(next) {
    if (activeAdvanced === next) return;
    if (activeAdvanced) {
      var prior = advancedScreens[activeAdvanced], marker = advancedMarkers[activeAdvanced];
      marker.parentNode.insertBefore(prior, marker.nextSibling);
      activeAdvanced = '';
      window.epochFinderShowMode('tests');
      legacy.classList.add('hidden');
    }
    if (next) {
      var target = advancedScreens[next];
      if (!target) throw new Error('Unknown advanced Test tool: ' + next);
      el('builder').appendChild(target);
      activeAdvanced = next;
      window.epochFinderShowMode(next);
      legacy.classList.add('hidden');
    }
    root.classList.toggle('test-unified-finder-building', !!next);
    highlightBuildMode(next || 'normal');
  }
  var mounted = false;
  var movable = [
    '.test-generations-next-run',
    '.test-generations-staged-panel',
    '#test-generations-batch-summary',
    '#test-generations-status',
    '#test-generations-error'
  ].map(function(selector) {
    var node = document.querySelector(selector);
    if (!node || !node.parentNode) throw new Error('Missing original Test control: ' + selector);
    var marker = document.createComment('Test control original position');
    node.parentNode.insertBefore(marker, node);
    return {node:node,marker:marker};
  });
  function mountExistingControls(enabled) {
    if (mounted === enabled) return;
    if (enabled) {
      movable.forEach(function(item) { el('builder').appendChild(item.node); });
    } else {
      movable.forEach(function(item) { item.marker.parentNode.insertBefore(item.node, item.marker.nextSibling); });
    }
    mounted = enabled;
  }
  function builder(enabled) {
    root.classList.toggle('test-unified-building',enabled);
    el('build').classList.toggle('active',enabled);
    el('explore').classList.toggle('active',!enabled);
    el('build').setAttribute('aria-pressed',String(enabled));
    el('explore').setAttribute('aria-pressed',String(!enabled));
    if (activeAdvanced) mountAdvanced('');
    if (enabled) highlightBuildMode('normal');
    mountExistingControls(enabled);
    el('builder').classList.toggle('hidden',!enabled);
    el('gallery').classList.toggle('hidden',enabled);
    el('inspector').classList.toggle('hidden',enabled);
    el('new').classList.toggle('hidden',enabled);
  }
  function legacyMode(mode) {if(activeAdvanced)mountAdvanced('');mountExistingControls(false);show(false);window.epochFinderShowMode(mode);}
  el('explore').onclick=function(){builder(false);if(folder)refresh();};
  el('build').onclick=function(){builder(true);};
  el('new').onclick=function(){builder(true);};
  el('experiments').onclick=function(){perspective='experiments';selection='';checkpointSelection.clear();renderList();renderGallery();};
  el('checkpoints').onclick=function(){perspective='checkpoints';selection='';checkpointSelection.clear();renderList();renderGallery();};
  el('reload').onclick=refresh;
  window.addEventListener('webcap:test-preview-updated', function () {
    if (!root.classList.contains('hidden') && el('builder').classList.contains('hidden')) refresh();
  });
  el('legacy').onclick=function(){if(activeAdvanced)mountAdvanced('');mountExistingControls(false);show(false);};
  el('normal').onclick=function(){builder(true);};
  el('finder').onclick=function(){mountExistingControls(false);mountAdvanced('finder');};
  el('references').onclick=function(){mountExistingControls(false);mountAdvanced('references');};
  el('analytics').onclick=function(){mountExistingControls(false);mountAdvanced('analytics');};
  var prepare=window.epochFinderPrepare;
  window.epochFinderPrepare=function(nextFolder) {
    folder=String(nextFolder||'');model=String(window.getWorkingModelProfileId()||'');
    prepare(nextFolder); if(folder && !root.classList.contains('hidden'))refresh();
  };
  var lastRouteKey = '';
  window.testGenerationsUnifiedRoute = function(info) {
    info = info || {};
    var context = String(info.folder || '') + '|' + String(info.modelId || '');
    if(context !== lastRouteKey) {
      lastRouteKey = context;
      perspective = 'experiments';
      checkpointSelection.clear();
      selection = info.rememberedSession ? 'test:' + String(info.rememberedSession) : '';
      chosen = '';
    }
    if(info.activitySession || info.activityCampaign) {
      exitToNative();
      return;
    }
    if(root.classList.contains('hidden')) {
      show(true);
      builder(false);
    }
    if(folder) refresh();
  };
  window.testGenerationsUnifiedOpen=function() {
    model=String(window.getWorkingModelProfileId()||'');show(true);builder(false);
    if(folder)refresh();
  };
  function exitToNative() {
    if (activeAdvanced) mountAdvanced('');
    mountExistingControls(false);
    show(false);
  }
  var inspectCampaign = window.epochFinderInspectCampaign;
  window.epochFinderInspectCampaign = function () {
    exitToNative();
    return inspectCampaign.apply(this, arguments);
  };
  var openActivity = window.openTestBenchActivity;
  window.openTestBenchActivity = function(target) {
    if(target && (target.sessionId || target.campaignId)) exitToNative();
    return openActivity.apply(this, arguments);
  };
  var openAnalyticsSession = window.openTestBenchAnalyticsSession;
  window.openTestBenchAnalyticsSession = function () {
    exitToNative();
    return openAnalyticsSession.apply(this, arguments);
  };
  var existing=document.querySelector('[data-test-generations-perspective="explore"]');
  if(!existing)throw new Error('Existing Explore entry is missing.');
  existing.addEventListener('click',function(){window.testGenerationsUnifiedOpen();});
})();
