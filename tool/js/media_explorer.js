(function () {
  'use strict';
  var visible = false, items = [], offset = 0, total = 0, active = -1, role = '', loading = false;
  var selected = new Set(), anchor = -1;
  var source = '', pageSize = 60, serial = 0, full = false, complete = false, activeRequest = null;
  var exportItems = [];
  function chooseExport(chosen) {
    exportItems = chosen;
    if (!chosen.length) return;
    var dialog = el('media-explorer-export-dialog');
    text(el('media-explorer-export-heading'), 'Copy to Set');
    text(el('media-explorer-export-count'), chosen.length + ' media file' + (chosen.length === 1 ? '' : 's'));
    el('media-explorer-export-submit').textContent = 'Copy to Set';
    el('media-explorer-export-status').textContent = '';
    el('media-explorer-export-new-set').value = '';
    browseDestinations();
    dialog.showModal();
  }
  function browseDestinations() {
    var path = el('media-explorer-export-destination').value.trim();
    var host = el('media-explorer-export-folders'); host.replaceChildren();
    return fetch('/fs/media_explorer/external/destinations?destination=' + encodeURIComponent(path))
      .then(function (res) { return res.json().then(function (data) {
        if (!res.ok || !data.ok) throw Error(data.error || 'Could not list Set folders');
        return data;
      }); }).then(function (data) {
        (data.folders || []).forEach(function (name) {
          var button = document.createElement('button'); button.type = 'button';
          button.textContent = '📁 ' + name; button.onclick = function () {
            el('media-explorer-export-destination').value = [path, name].filter(Boolean).join('/');
            browseDestinations();
          }; host.appendChild(button);
        });
      }).catch(function (err) {
        el('media-explorer-export-status').textContent = err.message; report(err);
      });
  }
  // Native drag state is scoped to this workspace; no filesystem writes occur until drop.
  var draggedExternalIds = [];
  function setupMediaDrag(host, item) {
    if (item.source !== 'external') return;
    host.draggable = true;
    host.addEventListener('dragstart', function (event) {
      var chosen = selected.has(item.id) ? chosenExternalFiles() : [item];
      draggedExternalIds = chosen.map(function (entry) {return entry.id;});
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', chosen.map(function (entry) {return entry.relativePath;}).join('\\n'));
    });
    host.addEventListener('dragend', function () {draggedExternalIds = [];});
  }
  function chosenExternalFiles() {
    return items.filter(function (item) { return item.source === 'external' && selected.has(item.id); });
  }
  function moveExternalTo(destination, chosen) {
    if (!chosen.length) return;
    var names = chosen.map(function (item) { return item.relativePath; });
    if (!window.confirm('Move ' + names.length + ' file(s) to /' + destination + '?')) return;
    externalAction('move', {path: externalPath, files: names, destination: destination}, function (result) {
      refreshExternalFiles();
      if (result.warning) report(new Error(result.warning));
    });
  }
  function allowFolderDrop(button, destination) {
    button.classList.add('media-explorer-folder-drop');
    button.addEventListener('dragover', function (event) {
      if (!draggedExternalIds.length) return;
      event.preventDefault(); event.dataTransfer.dropEffect = 'move';
      button.classList.add('drag-over');
    });
    button.addEventListener('dragleave', function () { button.classList.remove('drag-over'); });
    button.addEventListener('drop', function (event) {
      button.classList.remove('drag-over');
      if (!draggedExternalIds.length) return;
      event.preventDefault(); event.stopPropagation();
      var ids = new Set(draggedExternalIds);
      var chosen = items.filter(function (item) { return item.source === 'external' && ids.has(item.id); });
      draggedExternalIds = [];
      moveExternalTo(typeof destination === 'function' ? destination() : destination, chosen);
    });
  }
  function promptMediaAction(title, initial, confirmText, onSubmit, options) {
    options = options || {};
    var dialog = document.createElement('dialog');
    dialog.className = 'media-explorer-action-dialog';
    var form = document.createElement('form'); form.method = 'dialog';
    var heading = document.createElement('h3'); heading.textContent = title;
    var input = document.createElement('input'); input.type = 'text';
    input.value = initial || ''; input.setAttribute('aria-label',title);
    input.required = !options.allowEmpty;
    if (options.tagSuggestions) input.setAttribute('list','media-explorer-known-tags');
    var status = document.createElement('p'); status.setAttribute('role','status');
    var buttons = document.createElement('div'); buttons.className = 'media-explorer-action-buttons';
    var cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
    var submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = confirmText;
    buttons.appendChild(cancel); buttons.appendChild(submit);
    form.appendChild(heading); form.appendChild(input);
    var folderHost = null;
    if (options.folders) {
      folderHost = document.createElement('div'); folderHost.className = 'media-explorer-dialog-folders';
      form.appendChild(folderHost);
      var sequence = 0;
      function renderChoices() {
        var path = input.value.trim();
        var call = ++sequence;
        fetch('/fs/media_explorer/external?'+new URLSearchParams({
          path:externalPath,directory:path,recursive:'0',limit:'1',offset:'0'
        })).then(function (res) {return res.json().then(function (data) {
          if (!res.ok || !data.ok) throw Error(data.error || 'Cannot browse destination');
          if (call !== sequence) return;
          folderHost.replaceChildren();
          var up = document.createElement('button'); up.type='button';
          up.textContent = '↑ Parent'; up.disabled = !path;
          up.addEventListener('click',function () {
            input.value=path.split('/').slice(0,-1).join('/');renderChoices();
          });folderHost.appendChild(up);
          var create = document.createElement('button');create.type='button';
          create.textContent = '+ New folder here';
          create.addEventListener('click',function () {
            promptMediaAction('Create folder in /'+path,'','Create folder',function (name) {
              return externalActionStrict('create-folder',{path:externalPath,directory:path,name:name})
                .then(function () {renderChoices();});
            });
          });folderHost.appendChild(create);
          (data.folders || []).forEach(function (name) {
            var next=document.createElement('button');next.type='button';
            next.textContent='📁 '+name;
            next.addEventListener('click',function () {input.value=[path,name].filter(Boolean).join('/');renderChoices();});
            folderHost.appendChild(next);
          });
          status.textContent = '';
        });}).catch(function (err) {if(call===sequence)status.textContent=err.message;});
      }
      input.addEventListener('change',renderChoices);
      renderChoices();
    }
    form.appendChild(status);form.appendChild(buttons);dialog.appendChild(form);
    document.body.appendChild(dialog);
    cancel.addEventListener('click',function () {dialog.close();});
    dialog.addEventListener('close',function () {dialog.remove();});
    form.addEventListener('submit',function (event) {
      event.preventDefault();
      var value=input.value.trim();
      if (!value && !options.allowEmpty) return;
      submit.disabled = true;
      Promise.resolve(onSubmit(value)).then(function (result) {
        if (result === false) {submit.disabled=false;return;}
        dialog.close();
      }).catch(function (err) {status.textContent=err.message;submit.disabled=false;report(err);});
    });
    dialog.showModal();input.focus();input.select();
  }
  function externalActionStrict(endpoint, data) {
    return fetch('/fs/media_explorer/external/'+endpoint,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)
    }).then(function (res) {return res.json().then(function (body) {
      if(!res.ok || !body.ok)throw Error(body.error || endpoint+' failed');
      return body;
    });});
  }
  function createExternalFolder() {
    if (!isExternal() || !externalPath) return;
    promptMediaAction('Create folder in /'+externalDirectory, '', 'Create folder', function (name) {
      return externalActionStrict('create-folder', {path:externalPath,directory:externalDirectory,name:name})
        .then(function () {load(true,{refreshFilesystem:true});});
    });
  }
  var needsLoad = true;
  var externalDirectory = '', externalFolders = [], reverseSort = false, galleryHome = null;
  function setExternalDirectory(path) {
    markSavedViewModified();
    externalDirectory = path; selected.clear(); anchor = -1;
    el('media-explorer-recursive').checked = false; selectItem(-1); load(true);
  }
  function renderExternalFolders() {
    var host = el('media-explorer-folder-rows'); host.replaceChildren();
    el('media-explorer-external-navigation').classList.toggle('hidden', !isExternal());
    el('media-explorer-directory-label').textContent = '/' + externalDirectory;
    el('media-explorer-directory-label').title = '/' + externalDirectory;
    el('media-explorer-up').disabled = !externalDirectory;
    if (!isExternal() || el('media-explorer-recursive').checked) return;
    externalFolders.forEach(function (name) {
      var button = document.createElement('button');
      button.type = 'button'; button.textContent = '📁 ' + name;
      var destination = [externalDirectory, name].filter(Boolean).join('/');
      button.onclick = function () { setExternalDirectory(destination); };
      button.addEventListener('contextmenu',function (event) {
        event.preventDefault();event.stopPropagation();
        showContextMenu(event.clientX,event.clientY,[
          {label:'Open folder',run:function () {setExternalDirectory(destination);}},
          {label:'Rename folder…',run:function () {
            promptMediaAction('Rename folder',name,'Rename',function (nextName) {
              return externalActionStrict('rename-folder',{path:externalPath,folder:destination,name:nextName})
                .then(function () {load(true,{refreshFilesystem:true});});
            });
          }},
          {label:'Move folder…',run:function () {
            promptMediaAction('Move folder '+name,externalDirectory,'Move folder',function (path) {
              return externalActionStrict('move-folder',{path:externalPath,folder:destination,destination:path})
                .then(function () {load(true,{refreshFilesystem:true});});
            },{allowEmpty:true,folders:true});
          }},
          {label:'New subfolder…',run:function () {
            promptMediaAction('Create folder in /'+destination,'','Create folder',function (nextName) {
              return externalActionStrict('create-folder',{path:externalPath,directory:destination,name:nextName})
                .then(function () {load(true,{refreshFilesystem:true});});
            });
          }},
          {separator:true},
          {label:'Move folder to Trash',run:function () {
            if(!window.confirm('Move folder /'+destination+
              ' and all its contents to the operating system Trash?'))return;
            externalActionStrict('trash-folder',{path:externalPath,folder:destination})
              .then(function () {load(true,{refreshFilesystem:true});}).catch(report);
          }}
        ]);
      });
      var row = document.createElement('div');
      row.className = 'media-explorer-folder-row';
      var more = document.createElement('button'); more.type = 'button';
      more.textContent = '⋯'; more.className = 'media-explorer-folder-menu';
      more.title = 'Folder actions for ' + name;
      more.setAttribute('aria-label', 'Folder actions for '+name);
      more.addEventListener('click',function (event) {
        event.preventDefault();event.stopPropagation();
        button.dispatchEvent(new MouseEvent('contextmenu',{
          bubbles:true,cancelable:true,clientX:more.getBoundingClientRect().left,
          clientY:more.getBoundingClientRect().bottom
        }));
      });
      allowFolderDrop(row, destination);
      row.appendChild(button);row.appendChild(more);
      host.appendChild(row);
    });
  }
  function renderMainPreview() {
    var stage = el('media-explorer-preview-stage');
    if (explorerMode === 'grid') return;
    var item = active >= 0 ? items[active] : null;
    var id = item ? item.id : '';
    if (stage.dataset.id === id && stage.children.length && !stage.querySelector('#media-explorer-grid')) return;
    stage.dataset.id = id;
    stage.replaceChildren();
    if (item) stage.appendChild(mediaElement(item, true));
    else { var label = document.createElement('span'); label.textContent = 'Select a file to preview'; stage.appendChild(label); }
  }
  function selectSideRow(id, event, checkbox) {
    var index = items.findIndex(function (item) { return item.id === id; });
    if (index < 0) return;
    if (checkbox || event.ctrlKey || event.metaKey || event.shiftKey) {
      if (event.shiftKey && anchor >= 0) {
        for (var i = Math.min(index, anchor); i <= Math.max(index, anchor); i++) selected.add(items[i].id);
      } else if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      anchor = index;
    } else {
      anchor = index; selected.clear(); selectItem(index);
    }
    updateSelection();
  }
  function syncSideListSelection() {
    Array.prototype.forEach.call(el('media-explorer-side-list').children, function (row) {
      var id = row.dataset.id;
      row.classList.toggle('active', active >= 0 && items[active] && items[active].id === id);
      row.classList.toggle('selected', selected.has(id));
      row.querySelector('input').checked = selected.has(id);
    });
  }

  function externalAction(endpoint, data, success) {
    return fetch('/fs/media_explorer/external/' + endpoint, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)
    }).then(function (res) { return res.json().then(function (body) {
      if (!res.ok || !body.ok) throw Error(body.error || endpoint + ' failed');
      return body;
    }); }).then(function (result) {
      if (success) success(result);
      return result;
    }).catch(report);
  }
  function externalChoices(item) {
    var selectedItems = items.filter(function (candidate) { return selected.has(candidate.id); });
    return selected.has(item.id) && selectedItems.length > 1 ? selectedItems : [item];
  }
  function removeTrashedItems(paths) {
    var removed = new Set(paths);
    var ids = new Set(items.filter(function (entry) {
      return entry.source === 'external' && removed.has(entry.relativePath);
    }).map(function (entry) { return entry.id; }));
    if (!ids.size) return;
    var activeId = active >= 0 && items[active] ? items[active].id : '';
    // Invalidate any in-flight listing before it can restore just-trashed files.
    serial++;
    if (activeRequest) activeRequest.abort();
    activeRequest = null; loading = false;
    items = items.filter(function (entry) { return !ids.has(entry.id); });
    ids.forEach(function (id) {
      var card = Array.from(el('media-explorer-grid').children).find(function (node) { return node.dataset.id === id; });
      if (card) card.remove();
      selected.delete(id); mediaFacts.delete(id);
    });
    Array.from(el('media-explorer-grid').children).forEach(function (card, index) {
      card.dataset.index = index;
    });
    offset = Math.max(0, offset - ids.size);
    total = Math.max(items.length, total - ids.size);
    anchor = -1;
    active = items.findIndex(function (entry) { return entry.id === activeId; });
    selectItem(active);
    renderSideList(); updateSelection(); count(); emptyState();
    el('media-explorer-grid').setAttribute('aria-busy', 'false');
    el('media-explorer-more-btn').disabled = false;
  }
  function refreshExternalFiles(editedItem) {
    // Only rebuild the changed thumbnail. Stable cards keep their playback,
    // selection and DOM identity through the authoritative listing refresh.
    if (editedItem) {
      editedMediaVersions.set(editedItem.id, Date.now());
      var card = Array.from(el('media-explorer-grid').children).find(function (node) {
        return node.dataset.id === editedItem.id;
      });
      if (card) card.remove();
    }
    selected.clear(); selectItem(-1);
    mediaFacts.clear(); externalRevision = -1;
    load(true, {refreshFilesystem:true});
  }
  function renameExternalFile(item) {
    promptMediaAction('Rename file',item.fileName,'Rename',function (name) {
      if(name===item.fileName)return;
      return externalActionStrict('rename',{path:externalPath,file:item.relativePath,newName:name})
        .then(function (result) {refreshExternalFiles();if(result.warning)report(new Error(result.warning));});
    });
  }
  function transformExternalImage(item, operation, label) {
    if (!window.confirm(label + ' ' + item.fileName + '?\\nThe original will be retained for restoration.')) return;
    externalAction('image-edit', {
      path:externalPath,file:item.relativePath,operation:operation
    }, function () { refreshExternalFiles(item); });
  }
  function cropExternalImage(item) {
    openExternalImageCropModal(item, {
      path:externalPath,file:item.relativePath,mediaUrl:item.mediaUrl
    }, function () { refreshExternalFiles(item); });
  }
  function externalMutation(item, action) {
    var chosen = externalChoices(item);
    var names = chosen.map(function (candidate) { return candidate.relativePath; });
    var destination = '';
    if (action === 'move') {
      promptMediaAction('Move '+chosen.length+' file(s) to folder',externalDirectory,'Move files',function (path) {
        return externalActionStrict('move',{path:externalPath,files:names,destination:path})
          .then(function (result) {refreshExternalFiles();if(result.warning)report(new Error(result.warning));});
      },{allowEmpty:true,folders:true});return;
    } else if (!window.confirm('Move ' + chosen.length + ' file(s) to the operating system Trash?')) return;
    externalAction(action, {path: externalPath, files:names, destination:destination}, function (result) {
      if (action === 'trash') {
        if (typeof result.revision === 'number') externalRevision = result.revision;
        removeTrashedItems(result.trashed || []);
        return;
      }
      refreshExternalFiles();
      if (result.warning) report(new Error(result.warning));
    });
  }
  function openExternalClipEditor(item) {
    if (item.source !== 'external' || item.mediaKind !== 'video')
      throw new Error('Clip to Set requires an external video.');
    if (typeof openVideoClipModal !== 'function')
      throw new Error('The shared video Clip editor is unavailable.');
    openVideoClipModal({fileName:item.fileName}, null, {
      path:externalPath, file:item.relativePath, mediaUrl:item.mediaUrl,
      destination:el('media-explorer-export-destination').value.trim()
    });
  }
  function trashGenerations(item) {
    var chosen = selected.has(item.id) ? items.filter(function (entry) {
      return selected.has(entry.id);
    }) : [item];
    // Saved references are part of their owning generation, not separate trashable files.
    if (!chosen.length || chosen.some(function (entry) {
      return entry.source !== 'generate' || entry.role !== 'generated' || !entry.storageId;
    })) {
      report(new Error('Select only generated results to move to Trash.'));
      return;
    }
    var ids = Array.from(new Set(chosen.map(function (entry) { return entry.storageId; })));
    if (!window.confirm('Move ' + ids.length + ' generation(s), including saved references, to the operating system Trash?')) return;
    var moved = 0;
    ids.reduce(function (chain, storageId) {
      return chain.then(function () {
        return fetch('/fs/generate/result/trash', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({storageId: storageId})
        }).then(function (response) {
          return response.json().then(function (payload) {
            if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not move generation to Trash.');
            moved++;
          });
        });
      });
    }, Promise.resolve()).catch(function (error) {
      report(new Error('Moved ' + moved + ' of ' + ids.length + ' generation(s) to Trash: ' + error.message));
    }).finally(function () {
      if (moved) {
        selected.clear(); active = -1; artifact = '';
        selectItem(-1); load(true);
      }
    });
  }
  function curateExternal(item, change) {
    return externalAction('curate', Object.assign({path:externalPath,file:item.relativePath},change),
      function (result) {
        item.rating = result.rating; item.tags = result.tags;
        if (active >= 0 && items[active] && items[active].id === item.id)
          selectItem(-1), selectItem(items.findIndex(function (entry) {return entry.id === item.id;}));
        load(true, {soft:true});
      });
  }
  function editMediaTags(item) {
    promptMediaAction('Edit tags (comma-separated)',(item.tags || []).join(', '),'Save tags',function (value) {
      var tags=value.split(',').map(function (tag) {return tag.trim();}).filter(Boolean);
      return saveCurationFor(item,{tags:tags}).then(function (result) {
        item.tags=result.tags;
        if(item.source==='external')item.rating=result.rating;
        load(true,{soft:true});
      });
    },{allowEmpty:true,tagSuggestions:true});
  }
  function rateExplorerItem(item, value) {
    if (item.source === 'external') return curateExternal(item,{rating:value});
    var url, payload;
    if (item.source === 'generate' && item.role === 'generated' && item.storageId) {
      url = '/fs/generate/result/rating';
      payload = {storageId:item.storageId, rating:value};
    } else if (item.source === 'test' && item.ownerFolder && item.storageId) {
      url = '/fs/test_generations';
      payload = {folder:item.ownerFolder, operation:'test_rate_result',
        criteria:{session:item.storageId, mediaFile:item.fileName, rating:value}};
    } else return;
    fetch(url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      .then(function (res) { return res.json().then(function (body) {
        if (!res.ok || body.ok === false) throw Error(body.error || 'Rating failed');
        return body;
      }); }).then(function (result) {
        item.rating = result.rating;
        if (active >= 0 && items[active] && items[active].id === item.id) selectItem(active);
        if (el('media-explorer-rating').value || el('media-explorer-sort').value === 'rating') load(true);
        else {
          var card = Array.from(el('media-explorer-grid').children).find(function (node) {return node.dataset.id === item.id;});
          if (card) text(card.querySelector('.media-explorer-card-sub'),cardSummary(item));
        }
      }).catch(report);
  }
  function provenanceLinks(item) {
    var links = [], seen = new Set();
    (item.uses || []).forEach(function (use) {
      var label = (use.label || use.storageId || use.role || 'Source');
      var key = [use.source,use.storageId,use.takeId || ''].join(':');
      if (seen.has(key)) return;
      seen.add(key);
      var run = null;
      if (use.source === 'storyboard' && item.storageId && use.storageId) {
        run = function () {window.openStoryboardActivity({
          storyId:item.storageId,sceneId:use.storageId,takeId:use.takeId || ''
        });};
      } else if (use.source === 'generate' && use.storageId) {
        run = function () {window.openGenerateActivity({storageId:use.storageId});};
      } else if (use.source === 'test' && item.ownerFolder && use.storageId) {
        run = function () {window.openTestBenchActivity({
          folder:item.ownerFolder,sessionId:use.storageId,modelId:item.model || ''
        });};
      } else if (use.source === 'epoch' && item.ownerFolder && use.storageId) {
        run = function () {window.openTestBenchActivity({
          folder:item.ownerFolder,campaignId:use.storageId,modelId:item.model || ''
        });};
      }
      if (run) links.push({label:label+' · '+(use.role || use.source),run:run});
    });
    return links;
  }
  function collectionTag(view) {
    return view && view.filters && String(view.filters.tag || '').startsWith('Collection · ')
      ? view.filters.tag : '';
  }
  function collectionMatchesScope(view) {
    if (!collectionTag(view)) return false;
    return isExternal()
      ? view.filters.source === 'external' && view.filters.externalPath === externalPath
      : view.filters.source !== 'external';
  }
  function addToCollection(chosen, existingView) {
    if(!chosen.length)return;
    function apply(name,tag,view) {
      return Promise.allSettled(chosen.map(function (item) {
        return saveCurationFor(item,{
          tags:Array.from(new Set((item.tags || []).concat([tag])))
        });
      })).then(function (results) {
        var successes=results.filter(function (result) {return result.status==='fulfilled';}).length;
        var failed=results.length-successes;
        if(!successes)throw Error('Could not add any media: '+results[0].reason.message);
        if(view) {
          load(true,{soft:true});
          if(failed)throw Error('Added '+successes+' of '+results.length+' items; '+failed+' failed');
          return;
        }
        var filters=currentViewFilters();
        filters.source=isExternal()?'external':'';
        filters.role='';filters.tag=tag;filters.search='';filters.rating='';
        filters.kind='';filters.model='';filters.folder='';filters.date='';
        filters.sort='newest';filters.direction='desc';
        filters.full=!isExternal();filters.storyboardType='';
        ['min-side','min-mp','min-duration','max-duration'].forEach(function (id) {filters[id]='';});
        var viewName='Collection: '+name+(isExternal()?' · '+externalPath.slice(-24):'');
        return fetch('/fs/media_explorer/views',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({name:viewName,filters:filters})
        }).then(function (res) {return res.json().then(function (body) {
          if(!res.ok || !body.ok)throw Error(body.error || 'Could not save collection view');
          showSavedViews(body.views,'');
          load(true,{soft:true});
          if(failed)throw Error('Added '+successes+' of '+results.length+' items; '+failed+' failed');
        });});
      });
    }
    if(existingView) return apply(existingView.name,collectionTag(existingView),existingView).catch(report);
    promptMediaAction('Create collection', '', 'Create and add', function (name) {
      if(name.length>(isExternal()?32:48) || name.includes(','))
        throw Error('Use a shorter collection name without commas.');
      return apply(name,'Collection · '+name,null);
    });
  }
  function chooseCollection(chosen) {
    if(!chosen.length)return;
    fetch('/fs/media_explorer/views').then(function (res) {
      return res.json().then(function (body) {
        if(!res.ok || !body.ok)throw Error(body.error || 'Could not list collections');
        showSavedViews(body.views,el('media-explorer-view-select').value);
        return body.views.filter(collectionMatchesScope);
      });
    }).then(function (collections) {
      if(!collections.length) {addToCollection(chosen);return;}
      var options=collections.map(function (view) {
        return {label:view.name.replace(/^Collection: /,''),run:function () {
          addToCollection(chosen,view);
        }};
      });
      options.push({separator:true});
      options.push({label:'New collection…',run:function () {addToCollection(chosen);}});
      var box=el('media-explorer-selection').getBoundingClientRect();
      showContextMenu(box.left,box.bottom,options);
    }).catch(report);
  }
  function itemActions(item) {
    var current = function () { return items.findIndex(function (candidate) {return candidate.id===item.id;}); };
    var actions = [
      {label:'View full size',run:function () {openLoupe(current());}},
      {label:'Show details',run:function () {selectItem(current());}}
    ];
    if (item.source === 'generate' && item.storageId) {
      actions.push({label:'Open in Generate',run:function () {
        window.openGenerateActivity({storageId:item.storageId});
      }});
    } else if (item.source === 'test' && item.ownerFolder && item.storageId) {
      actions.push({label:'Open Test session',run:function () {
        window.openTestBenchActivity({folder:item.ownerFolder,sessionId:item.storageId,
          modelId:item.model || ''});
      }});
    } else if (item.source === 'epoch' && item.ownerFolder && item.storageId) {
      actions.push({label:'Open Campaign',run:function () {
        window.openTestBenchActivity({folder:item.ownerFolder,campaignId:item.storageId,
          modelId:item.model || ''});
      }});
    } else if (item.source === 'storyboard' && item.storageId &&
               (item.uses || []).length === 1) {
      actions.push({label:'Manage in Storyboard',run:function () {
        var use=item.uses[0];
        window.openStoryboardActivity({storyId:item.storageId,sceneId:use.storageId,
          takeId:use.takeId || ''});
      }});
    } else if (item.source === 'external') {
      actions.push({label:'Show in file browser',run:function () {
        externalAction('reveal',{path:externalPath,file:item.relativePath});
      }});
    }
    var provenanceActions = provenanceLinks(item);
    if (provenanceActions.length) {
      actions.push({label:'Used by · '+provenanceActions.length,children:provenanceActions});
    }
    actions.push({separator:true});
    if (item.source === 'external') {
      actions.push({label:'Copy to Set…',run:function () {chooseExport(externalChoices(item));}});
      actions.push({label:'Edit tags…',run:function () {editMediaTags(item);}});
      actions.push({label:'Rename…',run:function () {renameExternalFile(item);}});
      actions.push({label:'Move to folder…',run:function () {externalMutation(item,'move');}});
      var edit = [];
      if (item.mediaKind === 'video') {
        edit.push({label:'Clip video to Set…',run:function () {openExternalClipEditor(item);}});
      }
      if (['.png','.jpg','.jpeg','.webp','.bmp'].some(function (ext) {
        return item.fileName.toLowerCase().endsWith(ext);
      })) {
        edit.push({label:'Crop image…',run:function () {cropExternalImage(item);}});
        [
          ['Rotate left 90°','rotate_left_90'],
          ['Rotate right 90°','rotate_right_90'],
          ['Flip horizontal','flip_horizontal'],
          ['Flip vertical','flip_vertical']
        ].forEach(function (transform) {
          edit.push({label:transform[0],run:function () {
            transformExternalImage(item,transform[1],transform[0]);
          }});
        });
      }
      if (edit.length) actions.push({label:'Edit media',children:edit});
    }
    if (item.source === 'generate' && item.role === 'generated') {
      actions.push({label:'Copy to Set…',run:function () {chooseExport(
        selected.has(item.id) ? items.filter(function (entry) {
          return selected.has(entry.id) && entry.source==='generate' &&
            entry.role==='generated';
        }) : [item]);}});
      actions.push({label:'Edit tags…',run:function () {editMediaTags(item);}});
    } else if (item.source==='test' && item.ownerFolder && item.storageId) {
      actions.push({label:'Copy to Set…',run:function () {chooseExport(
        selected.has(item.id) ? items.filter(function (entry) {
          return selected.has(entry.id) && entry.source==='test' && entry.ownerFolder &&
            entry.storageId;
        }) : [item]);}});
      actions.push({label:'Edit tags…',run:function () {editMediaTags(item);}});
    } else if (item.source==='epoch' || item.source==='storyboard') {
      actions.push({label:'Copy to Set…',run:function () {chooseExport(
        selected.has(item.id) ? items.filter(function (entry) {
          return selected.has(entry.id) &&
            (entry.source==='epoch' || entry.source==='storyboard');
        }) : [item]);}});
      actions.push({label:'Edit tags…',run:function () {editMediaTags(item);}});
    }
    if (item.source==='external' ||
        (item.source==='generate' && item.role==='generated' && item.storageId) ||
        (item.source==='test' && item.ownerFolder && item.storageId) ||
        (item.source==='epoch' && item.ownerFolder && item.storageId) ||
        (item.source==='storyboard' && item.storageId)) {
      actions.push({label:'Add to collection…',run:function () {
        chooseCollection(selected.has(item.id) && selectedCuratable().length ?
          selectedCuratable() : [item]);
      }});
      var memberships=(item.tags || []).filter(function (tag) {
        return tag.startsWith('Collection · ');
      });
      if(memberships.length) actions.push({label:'Remove from collection',children:
        memberships.map(function (tag) {
          return {label:tag.slice('Collection · '.length),run:function () {
            saveCurationFor(item,{tags:(item.tags || []).filter(function (value) {
              return value!==tag;
            })}).then(function () {load(true,{soft:true});}).catch(report);
          }};
        })
      });
    }
    if (item.mediaUrl) {
      actions.push({label:'Download original',run:function () {
        var link=document.createElement('a');link.href=item.mediaUrl;
        link.download=item.fileName || 'media';link.click();
      }});
    }
    if (item.source === 'external' ||
        (item.source === 'generate' && item.role === 'generated' && item.storageId) ||
        (item.source === 'test' && item.ownerFolder && item.storageId)) {
      var ratings=[];
      for(var value=0;value<=5;value++)(function (rating) {
        ratings.push({label:rating?'★'.repeat(rating)+' ('+rating+'/5)':'Clear rating',
          run:function () {rateExplorerItem(item,rating);}});
      })(value);
      actions.push({label:'Rate'+(item.rating?' · '+item.rating+'/5':''),children:ratings});
    }
    if (item.source === 'external') {
      actions.push({separator:true});
      actions.push({label:'Move to Trash',run:function () {externalMutation(item,'trash');}});
    } else if (item.source === 'generate' && item.role === 'generated' && item.storageId) {
      actions.push({separator:true});
      actions.push({label:'Move to Trash',run:function () {trashGenerations(item);}});
    }
    return actions;
  }
  function openItemMenu(item, button, event) {
    event.preventDefault();
    event.stopPropagation();
    var rect = button.getBoundingClientRect();
    var x = event.clientX != null ? event.clientX : rect.left;
    var y = event.clientY != null ? event.clientY : rect.bottom;
    showContextMenu(x, y, itemActions(item));
  }
  function addItemMenu(host, item) {
    var menu = document.createElement('button');
    menu.type = 'button'; menu.className = 'media-explorer-item-menu';
    menu.textContent = '⋯'; menu.title = 'Actions for ' + item.fileName;
    menu.setAttribute('aria-label', 'Actions for ' + item.fileName);
    menu.addEventListener('click', function (event) { openItemMenu(item, menu, event); });
    host.addEventListener('contextmenu', function (event) { openItemMenu(item, host, event); });
    host.appendChild(menu);
  }
  function renderSideList() {
    if (explorerMode !== 'grid') return;
    var host = el('media-explorer-side-list');
    var existing = new Map(Array.prototype.map.call(host.children, function (row) { return [row.dataset.id, row]; }));
    var keep = new Set(items.map(function (item) { return item.id; }));
    existing.forEach(function (row, id) { if (!keep.has(id)) row.remove(); });
    items.forEach(function (item, index) {
      var row = existing.get(item.id);
      if (!row) {
        row = document.createElement('div'); row.className = 'media-explorer-side-row'; row.dataset.id = item.id; row.dataset.mediaKind = item.mediaKind;
        var check = document.createElement('input'); check.type = 'checkbox';
        check.setAttribute('aria-label', 'Select ' + item.fileName);
        check.addEventListener('click', function (event) { event.stopPropagation(); selectSideRow(item.id, event, true); });
        var button = document.createElement('button'); button.type = 'button'; button.className = 'media-explorer-side-open';
        button.addEventListener('click', function (event) { selectSideRow(item.id, event, false); });
        button.addEventListener('dblclick', function () {
          var next = items.findIndex(function (candidate) { return candidate.id === item.id; });
          if (next >= 0) { selectItem(next); openLoupe(); }
        });
        row.appendChild(check); row.appendChild(button); addItemMenu(row, item);
        setupMediaDrag(row, item);
      }
      row.dataset.mediaKind = item.mediaKind;
      row.querySelector('button').textContent = item.fileName;
      row.querySelector('button').title = item.relativePath || item.fileName;
      row.querySelector('input').setAttribute('aria-label', 'Select ' + item.fileName);
      if (host.children[index] !== row) host.insertBefore(row, host.children[index] || null);
    });
    syncSideListSelection();
  }
  function placeGallery() {
    var gallery = el('media-explorer-grid'), stage = el('media-explorer-preview-stage');
    if (!galleryHome) galleryHome = el('media-explorer-gallery-area');
    el('media-explorer-workspace').classList.toggle('explorer-grid-mode', explorerMode === 'grid');
    el('media-explorer-side-list').classList.toggle('hidden', explorerMode !== 'grid');
    if (explorerMode === 'grid') { stage.dataset.id = ''; stage.replaceChildren(); stage.appendChild(gallery); renderSideList(); }
    else { galleryHome.appendChild(gallery); renderMainPreview(); }
  }
  var explorerMode = 'grid', externalPath = '', externalDiscoveryTimer = null, externalMetadataTimer = null;
  var recentFolderRequest = 0;
  function showRecentFolders(folders) {
    var select = el('media-explorer-saved-folders');
    var input = el('media-explorer-external-path');
    // Offer the last folder as a starting path. Restoring a path never starts discovery.
    if (!externalPath && !input.value.trim() && folders.length) input.value = folders[0];
    select.replaceChildren();
    var empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Recent folders…'; select.appendChild(empty);
    folders.forEach(function (path) {
      var option = document.createElement('option'); option.value = path; option.textContent = path; select.appendChild(option);
    });
    select.value = folders.includes(externalPath) ? externalPath :
      (folders.includes(input.value.trim()) ? input.value.trim() : '');
    el('media-explorer-forget-folder').disabled = !select.value;
  }
  function requestRecentFolders() {
    var request = ++recentFolderRequest;
    return fetch('/fs/media_explorer/external/folders').then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || !body.ok) throw Error(body.error || 'Could not load external folders');
        return body;
      });
    }).then(function (body) {
      if (request === recentFolderRequest) showRecentFolders(body.folders);
    }).catch(report);
  }
  function saveRecentFolder(path) {
    var request = ++recentFolderRequest;
    return fetch('/fs/media_explorer/external/folders', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({path:path})
    }).then(function (res) { return res.json().then(function (body) {
      if (!res.ok || !body.ok) throw Error(body.error || 'Could not remember external folder');
      return body;
    }); }).then(function (body) {
      if (request === recentFolderRequest) showRecentFolders(body.folders);
    }).catch(report);
  }
  var externalRevision = -1, externalPendingRefresh = false, externalOverview = '', externalJobSummary = '', lastExternalError = '';
  function externalSummary() {
    var node = el('media-explorer-metadata-progress');
    text(node, [externalOverview, externalJobSummary].filter(Boolean).join(' · '));
    node.classList.toggle('hidden', !node.textContent);
    el('media-explorer-stop-metadata').classList.toggle('hidden', !externalJobRunning);
  }
  var externalJobRunning = false;
  function canRefreshExternalPage() {
    return !loading && !selected.size && active < 0 && offset <= pageSize &&
      !el('media-explorer-loupe').open && !el('media-explorer-compare-dialog').open;
  }
  function pollExternalDiscovery() {
    if (!visible || !isExternal() || !externalPath) return;
    fetch('/fs/media_explorer/external/status?path=' + encodeURIComponent(externalPath))
      .then(function (res) { return res.json().then(function (data) {
        if (!res.ok || !data.ok) throw Error(data.error || 'External discovery status failed');
        return data;
      }); }).then(function (data) {
        if (!visible || !isExternal()) return;
        externalOverview = data.discovered + ' found · ' + data.analyzed + ' analyzed' +
          (data.complete ? '' : ' · discovering') + (data.warnings ? ' · ' + data.warnings + ' warnings' : '');
        externalSummary();
        if (data.error && data.error !== lastExternalError) { lastExternalError = data.error; report(new Error(data.error)); }
        if (data.lastWarning && data.lastWarning !== lastExternalError) { lastExternalError = data.lastWarning; window.reportConsoleError('External media discovery', data.lastWarning); }
        if (data.revision !== externalRevision) {
          if (canRefreshExternalPage()) load(true, {soft:true});
          else {
            externalPendingRefresh = true;
            externalOverview += ' · Refresh to include changes';
            externalSummary(); count();
          }
        }
        if (!data.complete) externalDiscoveryTimer = setTimeout(pollExternalDiscovery, 1400);
      }).catch(report);
  }
  function isExternal() { return source === 'external'; }
  function externalParams() { return {directory:externalDirectory, recursive:el('media-explorer-recursive').checked ? '1' : '0', path:externalPath, min_side:el('media-explorer-min-side').value, min_mp:el('media-explorer-min-mp').value, min_duration:el('media-explorer-min-duration').value, max_duration:el('media-explorer-max-duration').value}; }
  function syncExternalControls() {
    var external = isExternal();
    el('media-explorer-external-path-bar').classList.toggle('hidden', !external);
    el('media-explorer-external-navigation').classList.toggle('hidden', !external);
    var createFolder = el('media-explorer-new-folder');
    if (createFolder) {
      createFolder.disabled = !externalPath || !external;
      createFolder.title = !externalPath ? 'Browse an external folder first' : 'Create a folder here';
    }
    el('media-explorer-folder-rows').classList.toggle('hidden', !external);
    el('media-explorer-external-filters').classList.toggle('hidden', false);
    el('media-explorer-scan-all').classList.toggle('hidden', external);
    if (external) el('media-explorer-scope').classList.add('hidden');
    el('media-explorer-model').classList.toggle('hidden', external);
    el('media-explorer-folder').classList.toggle('hidden', external);
    el('media-explorer-rating').classList.toggle('hidden', false);
    el('media-explorer-tag').classList.toggle('hidden', false);
    el('media-explorer-date').classList.toggle('hidden', false);
    el('media-explorer-size').disabled = explorerMode !== 'grid';
    el('media-explorer-workspace').querySelector('.media-explorer-size-label').classList.toggle('hidden', explorerMode !== 'grid');
    el('media-explorer-workspace').querySelector('.media-explorer-fit-controls').classList.toggle('hidden', explorerMode !== 'grid');
    el('media-explorer-metadata-progress').classList.toggle('hidden', !external || !(externalOverview || externalJobSummary));
    el('media-explorer-stop-metadata').classList.toggle('hidden', !external || !externalJobRunning);
    el('media-explorer-search').placeholder = external ? 'Search files, paths and tags…' : 'Search generated media, prompts, models…';
    ['path', 'type', 'size', 'resolution', 'megapixels', 'duration'].forEach(function (value) {
      var option = el('media-explorer-sort').querySelector('option[value="' + value + '"]');
      option.hidden = false;
    });
    el('media-explorer-sort').querySelector('option[value="rating"]').hidden = false;
    el('media-explorer-sort-reverse').classList.remove('hidden');
  }
  function setExplorerMode(next) {
    if (next === 'single') {
      if (items.length) openLoupe(active >= 0 ? active : 0);
      return; // Existing fullscreen viewer is the Single Item presentation.
    }
    explorerMode = next;
    var gallery = el('media-explorer-grid');
    gallery.classList.toggle('explorer-list', next === 'list');
    document.querySelectorAll('[data-explorer-mode]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.explorerMode === next));
    });
    items.forEach(function (item, index) {
      var card = gallery.children[index];
      if (!card || card.dataset.id !== item.id) return;
      var frame = card.querySelector('.media-explorer-card-thumb');
      var media = frame.querySelector('img, video, .external-video-placeholder');
      if (next === 'list' && media) media.remove();
      if (next !== 'list' && !media) frame.prepend(
        item.source === 'external' ? externalTileMedia(item) : mediaElement(item, false));
    });
    syncExternalControls(); placeGallery();
  }
  function externalTileMedia(item) {
    if (item.mediaKind === 'video') {
      var placeholder = document.createElement('span');
      placeholder.className = 'external-video-placeholder';
      text(placeholder, '▶ Video');
      return placeholder;
    }
    return mediaElement(item, false);
  }
  function stopExternalTimers() {
    clearTimeout(externalDiscoveryTimer); clearTimeout(externalMetadataTimer);
    externalDiscoveryTimer = null; externalMetadataTimer = null;
  }
  function externalMetadataStatus() {
    if (!visible || !isExternal() || !externalPath) return;
    fetch('/fs/media_explorer/external/metadata/status').then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || !data.ok) throw Error(data.error || 'Metadata status failed');
        return data;
      });
    }).then(function (job) {
      if (!visible || !isExternal()) return;
      externalJobRunning = !!job.running;
      externalJobSummary = job.total
        ? 'Metadata ' + job.completed + '/' + job.total + ' · ' + job.failed + ' failed' +
          (job.uncached ? ' · ' + job.uncached + ' uncached' : '') +
          (job.running && job.current ? ' · ' + job.current : '') + (job.canceled ? ' · stopped' : '')
        : '';
      externalSummary();
      if (job.lastError && job.lastError !== lastExternalError) {
        lastExternalError = job.lastError;
        window.reportConsoleError('Media Explorer metadata', job.lastError);
      }
      if (job.running) externalMetadataTimer = setTimeout(externalMetadataStatus, 1600);
      else if (job.total && canRefreshExternalPage() && externalRevision !== -1) load(true, {soft:true});
      else if (job.total) {
        externalPendingRefresh = true;
        externalJobSummary += ' · Refresh to show updated metadata';
        externalSummary(); count();
      }
    }).catch(report);
  }
  function requestExternalMetadata(scope, files) {
    var payload = Object.assign(externalParams(), {
      scope:scope, files:files || [], kind:el('media-explorer-kind').value,
      search:el('media-explorer-search').value.trim()
    });
    return fetch('/fs/media_explorer/external/metadata', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || !data.ok) throw Error(data.error || 'Metadata scan failed');
        return data;
      });
    }).then(function (job) {
      externalJobRunning = !!job.running;
      if (!job.discoveryComplete && scope === 'filtered') {
        externalJobSummary = 'Scanning discovered matches; folder discovery is still running';
      }
      externalSummary();
      if (job.running) {
        clearTimeout(externalMetadataTimer);
        externalMetadataTimer = setTimeout(externalMetadataStatus, 300);
      }
    }).catch(report);
  }

  var routeInitialized = false;
  var sourceNames = {generate: 'Generate', test: 'Test Generations', epoch: 'Campaigns', storyboard: 'Storyboard', external: 'External folders'};
  var roleNames = {generated: 'Generated', reference: 'Reference', source: 'Source media'};
  var mediaFacts = new Map();
  var editedMediaVersions = new Map();
  var loupeReturn = null;
  var artifact = '', owner = '';
  function storyboardType() { return source === 'storyboard' ? el('media-explorer-storyboard-type').value : ''; }
  function syncStoryboardType() { el('media-explorer-storyboard-type').classList.toggle('hidden', source !== 'storyboard'); }
  function el(id) { return document.getElementById(id); }
  function report(err) {
    var message = String(err && err.message || err);
    el('media-explorer-status').textContent = message;
    el('media-explorer-status').dataset.state = 'error';
    window.reportConsoleError('Media Explorer', message);
  }
  function text(node, value) { node.textContent = String(value == null ? '' : value); }
  function detail(label, value, dl) {
    if (value === undefined || value === null || value === '') return;
    var dt = document.createElement('dt'), dd = document.createElement('dd');
    text(dt, label); text(dd, value); dl.appendChild(dt); dl.appendChild(dd);
  }
  function externalCardSummary(item) {
    var meta = item.metadata || {};
    var summary = (meta.resolution || 'Metadata unknown') +
      (meta.duration != null ? ' · ' + duration(meta.duration) : '');
    if (item.rating) summary += ' · ★ ' + item.rating;
    if (item.tags && item.tags.length) summary += ' · ' + item.tags.join(', ');
    return summary;
  }
  function cardSummary(item) {
    return ((item.source === 'generate' && item.role !== 'reference' ? item.model : item.contextLabel) || item.model || sourceNames[item.source]) +
      (item.rating ? ' · ★ ' + item.rating : '');
  }
  function badgeText(item) {
    var facts = mediaFacts.get(item.id) || {};
    return item.mediaKind === 'video' ? '▶ ' + (duration(Number.isFinite(facts.duration) ? facts.duration : item.duration) || 'Video') :
      (item.roles || [item.role]).map(function (role) { return roleNames[role] || role; }).join(' · ');
  }
  function duration(value) {
    if (!Number.isFinite(Number(value)) || value == null) return '';
    var seconds = Math.floor(Number(value));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }
  function bytes(value) {
    if (value == null) return '';
    return value >= 1048576 ? (value / 1048576).toFixed(1) + ' MB' : Math.ceil(value / 1024) + ' KB';
  }
  function renderDetails(item, dl) {
    dl.replaceChildren();
    var facts = mediaFacts.get(item.id) || {};
    detail('Roles', (item.roles || [item.role]).map(function (role) { return roleNames[role] || role; }).join(' · '), dl);
    detail('Producer', sourceNames[item.source], dl); detail('Model', item.model, dl);
    detail('Workflow', item.workflow, dl);
    detail('Set', item.ownerFolder, dl);
    detail('Path', item.relativePath, dl);
    detail('Dimensions', facts.resolution || (item.metadata && item.metadata.resolution) || item.resolution, dl);
    if (item.metadata && item.metadata.resolution) { var wh = item.metadata.resolution.split('x').map(Number); detail('Megapixels', (wh[0] * wh[1] / 1000000).toFixed(2) + ' MP', dl); }
    if (item.mediaKind === 'video') detail('Duration', duration(Number.isFinite(facts.duration) ? facts.duration : (item.metadata && item.metadata.duration != null ? item.metadata.duration : item.duration)), dl);
    detail('File size', bytes(item.fileSize), dl);
    detail('Seed', item.seed, dl); detail('Epoch', item.epoch, dl);
    if (item.rating !== null) detail('Rating', item.rating ? item.rating + ' / 5' : 'Unrated', dl);
    if (item.tags && item.tags.length) {
      var term=document.createElement('dt');text(term,'Tags');dl.appendChild(term);
      var tags=document.createElement('dd');tags.className='media-explorer-tag-links';
      item.tags.forEach(function (tag) {
        var button=document.createElement('button');button.type='button';
        button.textContent=tag;button.title='Filter media by tag: '+tag;
        button.addEventListener('click',function () {
          el('media-explorer-tag').value=tag;load(true);
        });
        tags.appendChild(button);
      });
      dl.appendChild(tags);
    }
    detail('Date', item.createdAt ? new Date(item.createdAt).toLocaleString() : '', dl);
    detail('LoRAs', (item.loras || []).map(function (lora) { return lora.name + (lora.strength != null ? ' × ' + lora.strength : ''); }).join(', '), dl);
  }
  function mediaElement(item, controls) {
    var media = document.createElement(item.mediaKind === 'video' ? 'video' : 'img');
    media.src = item.mediaUrl;
    if (media.tagName === 'VIDEO') { media.controls = !!controls; media.preload = 'metadata'; }
    else { media.alt = item.fileName; media.loading = controls ? 'eager' : 'lazy'; }
    media.addEventListener(item.mediaKind === 'video' ? 'loadedmetadata' : 'load', function () {
      var width = media.videoWidth || media.naturalWidth, height = media.videoHeight || media.naturalHeight;
      mediaFacts.set(item.id, {resolution: width && height ? width + ' × ' + height : '', duration: media.duration});
      if (visible && items[active] && items[active].id === item.id) {
        renderDetails(items[active], el('media-explorer-inspector-body').querySelector('.media-explorer-detail'));
      }
      if (!controls && item.mediaKind === 'video') text(media.parentElement.querySelector('.media-explorer-card-badge'), badgeText(item));
    });
    media.addEventListener('error', function () {
      var message = 'Could not load media: ' + item.fileName + ' (' + item.mediaUrl + ')' +
        (media.error ? ' · ' + media.error.message + ' (code ' + media.error.code + ')' : '');
      window.reportConsoleError('Media Explorer', message);
      var host = media.parentElement, error = host.querySelector('.media-explorer-card-error');
      if (!error) { error = document.createElement('div'); error.className = 'media-explorer-card-error'; host.appendChild(error); }
      text(error, 'Preview unavailable · Open the Console for details.');
      error.title = message;
    });
    return media;
  }
  function updateSelection() {
    var panel = el('media-explorer-selection');
    panel.classList.toggle('hidden', !selected.size);
    text(el('media-explorer-selected-count'), selected.size + ' selected (loaded items)');
    text(el('media-explorer-selection-hint'), selected.size > 4 ? 'Compare supports up to 4 selections' : '');
    el('media-explorer-selection-hint').classList.toggle('hidden', selected.size <= 4);
    var chosen = items.filter(function (item) { return selected.has(item.id); });
    var copyable = chosen.length > 0 && (isExternal() ||
      chosen.every(function (entry) {return entry.source==='generate' && entry.role==='generated';}) ||
      chosen.every(function (entry) {return entry.source==='test' && entry.ownerFolder && entry.storageId;}) ||
      chosen.every(function (entry) {return entry.source==='epoch' || entry.source==='storyboard';}));
    el('media-explorer-copy-selected').classList.toggle('hidden', !copyable);
    el('media-explorer-compare').disabled = chosen.length < 2 || chosen.length > 4;
    text(el('media-explorer-compare'), chosen.length > 2 && chosen.length <= 4 ? 'Survey' : 'Compare');
    el('media-explorer-compare').title = 'Compare 2–4 media; videos play independently';
    syncSideListSelection();
    syncBulkActions();
    Array.prototype.forEach.call(el('media-explorer-grid').children, function (card, i) {
      card.classList.toggle('selected', selected.has(items[i].id));
      card.querySelector('.media-explorer-card-check').checked = selected.has(items[i].id);
    });
  }
  function selectItem(index) {
    active = index;
    syncSideListSelection();
    Array.prototype.forEach.call(el('media-explorer-grid').children, function (card, i) {
      card.classList.toggle('active', i === index);
      var button = card.querySelector('.media-explorer-card-open');
      button.tabIndex = i === (index < 0 ? 0 : index) ? 0 : -1;
      card.querySelector('.media-explorer-card-check').tabIndex = button.tabIndex;
      button.setAttribute('aria-current', i === index ? 'true' : 'false');
    });
    var inspector = el('media-explorer-inspector'), host = el('media-explorer-inspector-body');
    if (items[index] && host.dataset.id === items[index].id && !inspector.classList.contains('hidden')) {
      renderDetails(items[index], host.querySelector('.media-explorer-detail'));
      host.querySelectorAll('.media-explorer-rating button').forEach(function (button, score) {
        button.setAttribute('aria-pressed', Number(items[index].rating || 0) === score ? 'true' : 'false');
      });
      return;
    }
    host.dataset.id = items[index] ? items[index].id : '';
    host.replaceChildren();
    if (index < 0 || !items[index]) { inspector.classList.add('hidden'); renderMainPreview(); return; }
    var item = items[index];
    text(el('media-explorer-inspector-name'), item.fileName);
    el('media-explorer-inspector-name').title = item.fileName;
    var provenance = document.createElement('div'); provenance.className = 'media-explorer-provenance';
    text(provenance, item.source === 'external' ? 'External · ' + item.relativePath : 'Owned by · ' + sourceNames[item.source] + ' › ' + (item.contextLabel || item.storageId)); host.appendChild(provenance);
    var actions = document.createElement('div'); actions.className = 'media-explorer-inspector-actions'; host.appendChild(actions);
    if (item.storageId) {
      var related = document.createElement('button');
      related.type = 'button';
      related.className = 'review-captions-btn';
      text(related, 'Show media from this ' + (sourceNames[item.source] || 'source'));
      related.addEventListener('click', function () {
        owner = item.storageId; source = item.source; role = ''; artifact = '';
        el('media-explorer-search').value = '';
        facetIds.forEach(function (id) { el('media-explorer-' + id).value = ''; });
        el('media-explorer-storyboard-type').value = '';
        sourceButtons.forEach(function (button) {
          button.classList.toggle('active', button.dataset.mediaSource === source);
        });
        load(true);
      });
      actions.appendChild(related);
    }
    var dl = document.createElement('dl'); dl.className = 'media-explorer-detail';
    renderDetails(item, dl);
    host.appendChild(dl);
    function section(title, value, expanded) {
      if (!value) return;
      var group = document.createElement('details'), summary = document.createElement('summary'), content = document.createElement('p');
      group.className = 'media-explorer-inspector-section'; group.open = !!expanded;
      text(summary, title); text(content, value); group.appendChild(summary); group.appendChild(content); host.appendChild(group);
    }
    section('Prompt', item.prompt, true);
    if (item.sourcePrompt !== item.prompt) section('Original prompt', item.sourcePrompt, false);
    if (item.assessment) section(item.assessment.label + (item.assessment.model ? ' · ' + item.assessment.model : ''), item.assessment.text, false);
    var uses = Array.from(new Map((item.uses || []).map(function (use) { return [use.source + ':' + use.storageId + ':' + (use.takeId || '') + ':' + use.role, use]; })).values());
    if (uses.length) {
      var relationships = document.createElement('details'), relationshipsTitle = document.createElement('summary');
      relationships.className = 'media-explorer-inspector-section'; relationships.open = true;
      text(relationshipsTitle, 'Used by · ' + uses.length); relationships.appendChild(relationshipsTitle);
      provenanceLinks(item).forEach(function (link) {
        var button=document.createElement('button');
        button.type='button';button.className='media-explorer-use-link';
        text(button,link.label);
        button.addEventListener('click',link.run);
        relationships.appendChild(button);
      });
      host.appendChild(relationships);
      if (item.source === 'storyboard' && uses.length > 1) {
        text(relationshipsTitle, 'Choose owning scene · ' + uses.length);
      }
    }
    if ((item.source==='test' && item.ownerFolder && item.storageId) ||
        (item.source==='epoch' && item.ownerFolder && item.storageId) ||
        (item.source==='storyboard' && item.storageId)) {
      var copyOwned = document.createElement('button');
      copyOwned.type='button';copyOwned.className='review-captions-btn';
      text(copyOwned,'Copy to Set');
      copyOwned.addEventListener('click',function () {chooseExport([item]);});
      actions.appendChild(copyOwned);
      var tagOwned = document.createElement('button');
      tagOwned.type='button';tagOwned.className='review-captions-btn';
      text(tagOwned,'Edit tags…');
      tagOwned.addEventListener('click',function () {editMediaTags(item);});
      actions.appendChild(tagOwned);
    }
    if (item.source==='external' ||
        (item.source==='generate' && item.role==='generated' && item.storageId) ||
        (item.source==='test' && item.ownerFolder && item.storageId) ||
        (item.source==='epoch' && item.ownerFolder && item.storageId) ||
        (item.source==='storyboard' && item.storageId)) {
      var collect = document.createElement('button');
      collect.type='button';collect.className='review-captions-btn';
      text(collect,'Add to collection…');
      collect.addEventListener('click',function () {chooseCollection([item]);});
      actions.appendChild(collect);
    }
    if (item.source === 'generate' && item.role === 'generated' && item.storageId) {
      var copyGenerated = document.createElement('button');
      copyGenerated.type='button';copyGenerated.className='review-captions-btn';
      copyGenerated.textContent='Copy to Set';
      copyGenerated.addEventListener('click',function () {chooseExport([item]);});
      actions.appendChild(copyGenerated);
      var tagButton = document.createElement('button');
      tagButton.type = 'button';tagButton.className='review-captions-btn';
      tagButton.textContent='Edit tags…';
      tagButton.addEventListener('click',function () {editMediaTags(item);});
      actions.appendChild(tagButton);
      var ratingRow = document.createElement('div');
      ratingRow.className = 'media-explorer-rating';
      var ratingLabel = document.createElement('span');
      text(ratingLabel, 'Rate generation');
      ratingRow.appendChild(ratingLabel);
      for (var score = 0; score <= 5; score++) {
        (function (value) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'review-captions-btn';
          text(button, value === 0 ? 'Clear' : String(value) + '★');
          button.setAttribute('aria-label', value === 0 ? 'Clear rating' : 'Rate ' + value + ' out of 5');
          button.setAttribute('aria-pressed', Number(item.rating || 0) === value ? 'true' : 'false');
          button.addEventListener('click', function () {
            Array.prototype.forEach.call(ratingRow.querySelectorAll('button'), function (node) { node.disabled = true; });
            fetch('/fs/generate/result/rating', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({storageId: item.storageId, rating: value})
            }).then(function (response) {
              return response.json().then(function (payload) {
                if (!response.ok || !payload || payload.ok === false) {
                  throw new Error(payload && payload.error || 'Could not update rating.');
                }
                return payload;
              });
            }).then(function (payload) {
              item.rating = payload.rating;
              if (visible && active >= 0 && items[active] === item) {
                Array.prototype.forEach.call(ratingRow.querySelectorAll('button'), function (node, score) {
                  node.setAttribute('aria-pressed', Number(item.rating || 0) === score ? 'true' : 'false');
                });
                dl.querySelectorAll('dt').forEach(function (node) { if (node.textContent === 'Rating') text(node.nextElementSibling, item.rating ? item.rating + ' / 5' : 'Unrated'); });
              }
              var card = el('media-explorer-grid').children[items.indexOf(item)];
              if (card) {
                var sub = card.querySelector('.media-explorer-card-sub');
                text(sub, isExternal() ? externalCardSummary(item) : cardSummary(item));
              }
              if (visible && (el('media-explorer-rating').value || el('media-explorer-sort').value === 'rating')) load(true);
            }).catch(report).finally(function () {
              Array.prototype.forEach.call(ratingRow.querySelectorAll('button'), function (node) { node.disabled = false; });
            });
          });
          ratingRow.appendChild(button);
        })(score);
      }
      host.appendChild(ratingRow);
    }
    if (item.source === 'test' && item.ownerFolder && item.storageId && item.fileName) {
      var testRating = document.createElement('div');
      testRating.className = 'media-explorer-rating';
      var testRatingLabel = document.createElement('span');
      text(testRatingLabel, 'Rate Test result');
      testRating.appendChild(testRatingLabel);
      for (var testScore = 0; testScore <= 5; testScore++) {
        (function (value) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'review-captions-btn';
          text(button, value === 0 ? 'Clear' : String(value) + '★');
          button.setAttribute('aria-label', value === 0 ? 'Clear Test rating' : 'Rate Test result ' + value + ' out of 5');
          button.setAttribute('aria-pressed', String(Number(item.rating || 0) === value));
          button.addEventListener('click', function () {
            testRating.querySelectorAll('button').forEach(function (node) { node.disabled = true; });
            fetch('/fs/test_generations', {
              method: 'POST', headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({folder: item.ownerFolder, operation: 'test_rate_result',
                criteria: {session: item.storageId, mediaFile: item.fileName, rating: value}})
            }).then(function (response) {
              return response.json().then(function (payload) {
                if (!response.ok || !payload || !payload.ok) throw new Error(payload && payload.error || 'Could not rate Test result.');
                return payload;
              });
            }).then(function (payload) {
              item.rating = payload.rating;
              testRating.querySelectorAll('button').forEach(function (node, score) {
                node.setAttribute('aria-pressed', String(Number(item.rating || 0) === score));
              });
              renderDetails(item, dl);
              var card = el('media-explorer-grid').children[items.indexOf(item)];
              if (card) text(card.querySelector('.media-explorer-card-sub'), isExternal() ? ((item.metadata && item.metadata.resolution) || 'Metadata unknown') : cardSummary(item));
              if (visible && (el('media-explorer-rating').value || el('media-explorer-sort').value === 'rating')) load(true);
            }).catch(report).finally(function () {
              testRating.querySelectorAll('button').forEach(function (node) { node.disabled = false; });
            });
          });
          testRating.appendChild(button);
        })(testScore);
      }
      host.appendChild(testRating);
    }
    if (item.source === 'test' && item.ownerFolder && item.storageId) {
      var back = document.createElement('button');
      back.type = 'button';
      back.className = 'review-captions-btn';
      text(back, 'Open Test session');
      back.addEventListener('click', function () {
        window.openTestBenchActivity({folder: item.ownerFolder, sessionId: item.storageId, modelId: item.model || ''});
      });
      actions.appendChild(back);
    }
    if (item.source === 'storyboard' && item.storageId) {
      var storyBtn = document.createElement('button');
      storyBtn.type = 'button'; storyBtn.className = 'review-captions-btn';
      text(storyBtn, (item.uses || []).length > 1 ? 'Choose owning scene in Used by' : 'Manage in Storyboard');
      storyBtn.disabled = (item.uses || []).length !== 1;
      storyBtn.addEventListener('click', function () {
        var scene = item.uses && item.uses[0] && item.uses[0].storageId || '';
        window.openStoryboardActivity({storyId: item.storageId, sceneId: scene, takeId: item.uses && item.uses[0] && item.uses[0].takeId || ''});
      });
      actions.appendChild(storyBtn);
    }
    if (item.source === 'generate') {
      var generate = document.createElement('button'); generate.type = 'button'; generate.className = 'review-captions-btn';
      text(generate, item.role === 'reference' ? 'Open using generation' : 'Open in Generate');
      generate.addEventListener('click', function () { window.openGenerateActivity({storageId: item.storageId}); }); actions.appendChild(generate);
    }
    if (item.source === 'epoch' && item.ownerFolder && item.model) {
      var epoch = document.createElement('button'); epoch.type = 'button'; epoch.className = 'review-captions-btn';
      text(epoch, 'Open Campaign'); epoch.addEventListener('click', function () {
        window.openTestBenchActivity({folder: item.ownerFolder, modelId: item.model, campaignId: item.storageId});
      }); actions.appendChild(epoch);
    }
    if (item.source === 'generate' && item.role === 'generated' && item.storageId) {
      var trashButton = document.createElement('button');
      trashButton.type = 'button'; trashButton.className = 'review-captions-btn';
      text(trashButton, 'Move to Trash');
      trashButton.addEventListener('click', function () { trashGenerations(item); });
      actions.appendChild(trashButton);
    }
    var deletion = null;
    if (item.source === 'generate' && item.role === 'generated' && item.storageId) {
      deletion = {label: 'Delete generation', description: 'generation and its stored references',
        url: '/fs/generate/result/delete', data: {storageId: item.storageId}};
    } else if (item.source === 'test' && item.ownerFolder && item.storageId) {
      deletion = {label: 'Delete Test session', description: 'entire Test session and all its generated results',
        url: '/fs/test_generations', data: {folder: item.ownerFolder, operation: 'test_delete_session',
          criteria: {session: item.storageId}}};
    } else if (item.source === 'epoch' && item.ownerFolder && item.storageId) {
      deletion = {label: 'Delete campaign', description: 'entire campaign and its generated results',
        url: '/fs/epoch_finder', data: {folder: item.ownerFolder, operation: 'delete',
          criteria: {campaignId: item.storageId}}};
    }
    if (deletion) {
      var deleteButton = document.createElement('button');
      deleteButton.type = 'button'; deleteButton.className = 'review-captions-btn';
      text(deleteButton, deletion.label);
      deleteButton.addEventListener('click', function () {
        if (!window.confirm('Delete the ' + deletion.description + '? This cannot be undone.')) return;
        deleteButton.disabled = true;
        fetch(deletion.url, {method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(deletion.data)})
          .then(function (response) { return response.json().then(function (payload) {
            if (!response.ok || !payload || !payload.ok)
              throw new Error(payload && payload.error || 'Could not delete generated media.');
            return payload;
          }); })
          .then(function () { selected.clear(); active = -1; artifact = ''; selectItem(-1); load(true); })
          .catch(report).finally(function () { deleteButton.disabled = false; });
      });
      var destructive = document.createElement('div'); destructive.className = 'media-explorer-danger-actions';
      destructive.appendChild(deleteButton); host.appendChild(destructive);
    }
    if (item.source === 'external') {
      var copy = document.createElement('button'); copy.type = 'button'; copy.className = 'review-captions-btn';
      copy.textContent = 'Copy to Set';
      copy.onclick = function () {
        var choices = items.filter(function (candidate) { return selected.has(candidate.id); });
        chooseExport(choices.length ? choices : [item]);
      }; actions.appendChild(copy);
      function externalInspectorAction(label, action) {
        var button = document.createElement('button');
        button.type = 'button'; button.className = 'review-captions-btn';
        text(button,label); button.addEventListener('click',action); actions.appendChild(button);
      }
      externalInspectorAction('Edit Tags…',function () { editMediaTags(item); });
      externalInspectorAction('Rename…',function () { renameExternalFile(item); });
      externalInspectorAction('Move to Folder…',function () { externalMutation(item,'move'); });
      if (['.png','.jpg','.jpeg','.webp','.bmp'].some(function (ext) { return item.fileName.toLowerCase().endsWith(ext); }))
        externalInspectorAction('Crop image…',function () { cropExternalImage(item); });
      if (item.mediaKind === 'video') {
        var clip = document.createElement('button'); clip.type = 'button'; clip.className = 'review-captions-btn';
        clip.textContent = 'Edit video (Clip to Set)…'; clip.onclick = function () { openExternalClipEditor(item); };
        actions.appendChild(clip);
      }
    }
    if (item.mediaUrl) {
      var download = document.createElement('a');
      download.className = 'review-captions-btn';
      download.href = item.mediaUrl;
      download.download = item.fileName || 'media';
      download.textContent = 'Download original';
      actions.appendChild(download);
    }
    var open = document.createElement('button'); open.type = 'button';
    open.className = 'review-captions-btn'; text(open, 'View full size');
    open.addEventListener('click', function () { openLoupe(); }); actions.appendChild(open);
    if (typeof related !== 'undefined') actions.appendChild(related);
    inspector.classList.remove('hidden'); renderMainPreview();
  }
  function openLoupe(index) {
    var dlg = el('media-explorer-loupe');
    if (!dlg.open) loupeReturn = {inspectorOpen: !el('media-explorer-inspector').classList.contains('hidden'), scroll: (explorerMode === 'grid' ? el('media-explorer-preview-stage').parentElement : el('media-explorer-gallery-area')).scrollTop};
    if (typeof index === 'number') selectItem(index);
    if (active < 0 || !items[active]) return;
    el('media-explorer-loupe-content').classList.remove('zoomed');
    el('media-explorer-zoom').setAttribute('aria-pressed', 'false');
    el('media-explorer-zoom').disabled = items[active].mediaKind === 'video';
    el('media-explorer-inspector-body').querySelectorAll('video').forEach(function (video) { video.pause(); });
    el('media-explorer-loupe-content').replaceChildren(mediaElement(items[active], true));
    text(el('media-explorer-loupe-name'), (active + 1) + ' / ' + items.length + ' · ' + items[active].fileName);
    text(el('media-explorer-loupe-caption'), (items[active].roles || [items[active].role]).join(' · ') + ' · ' + cardSummary(items[active]));
    el('media-explorer-previous').disabled = active === 0;
    el('media-explorer-next').disabled = active === items.length - 1;
    if (!dlg.open) dlg.showModal();
  }
  function renderCard(item, index) {
    var card = document.createElement('article');
    card.className = 'media-explorer-card'; card.title = item.fileName;
    card.dataset.id = item.id;
    card.dataset.mediaKind = item.mediaKind;
    card.dataset.index = index;
    setupMediaDrag(card, item);
    var open = document.createElement('button'); open.type = 'button'; open.className = 'media-explorer-card-open';
    open.tabIndex = index === 0 ? 0 : -1;
    open.setAttribute('aria-label', item.fileName + ', ' + item.role);
    card.appendChild(open);
    var frame = document.createElement('div'); frame.className = 'media-explorer-card-thumb';
    if (explorerMode === 'grid') frame.appendChild(
      item.source === 'external' ? externalTileMedia(item) : mediaElement(item, false));
    open.appendChild(frame);
    var badge = document.createElement('span'); badge.className = 'media-explorer-card-badge';
    text(badge, badgeText(item));
    frame.appendChild(badge);
    var meta = document.createElement('div'); meta.className = 'media-explorer-card-meta';
    var name = document.createElement('div'); name.className = 'media-explorer-card-name';
    text(name, item.fileName); meta.appendChild(name);
    if (item.relativePath) { var relative = document.createElement('div'); relative.className = 'media-explorer-card-path'; text(relative, item.relativePath); meta.appendChild(relative); }
    var sub = document.createElement('div'); sub.className = 'media-explorer-card-sub';
    text(sub, isExternal() ? externalCardSummary(item) : cardSummary(item));
    meta.appendChild(sub); open.appendChild(meta);
    var check = document.createElement('input'); check.type = 'checkbox'; check.className = 'media-explorer-card-check';
    check.tabIndex = index === 0 ? 0 : -1;
    check.setAttribute('aria-label', 'Select ' + item.fileName);
    check.addEventListener('click', function (event) {
      event.stopPropagation();
      var index = Number(card.dataset.index);
      if (event.shiftKey && anchor >= 0) {
        for (var i = Math.min(index, anchor); i <= Math.max(index, anchor); i++) selected.add(items[i].id);
      } else if (selected.has(item.id)) selected.delete(item.id);
      else selected.add(item.id);
      anchor = index; updateSelection();
    });
    card.appendChild(check);
    addItemMenu(card, item);
    card.addEventListener('click', function (event) {
      var index = Number(card.dataset.index), item = items[index];
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        if (event.shiftKey && anchor >= 0) {
          for (var i = Math.min(index, anchor); i <= Math.max(index, anchor); i++) selected.add(items[i].id);
        } else if (selected.has(item.id)) selected.delete(item.id);
        else selected.add(item.id);
        anchor = index; updateSelection();
      } else { anchor = index; selected.clear(); updateSelection(); selectItem(index); }
    });
    card.addEventListener('dblclick', function () { selectItem(Number(card.dataset.index)); openLoupe(); });
    return card;
  }
  function maybeLoadMore() {
    if (!visible || loading || offset >= total || externalPendingRefresh) return;
    var side = el('media-explorer-gallery-area');
    var center = el('media-explorer-preview-stage').parentElement;
    var scrollers = explorerMode === 'grid' ? [side, center] : [side];
    if (scrollers.some(function (node) {
      return node.clientHeight > 0 && node.scrollHeight - node.scrollTop - node.clientHeight < 350;
    })) load(false);
  }
  function count() {
    text(el('media-explorer-count'), items.length + (items.length < total ? ' of ' + total : '') + (total === 1 ? ' item' : ' items') + (isExternal() && !complete ? ' · discovering…' : ''));
    el('media-explorer-more-btn').classList.toggle('hidden', !externalPendingRefresh);
    text(el('media-explorer-more-btn'), externalPendingRefresh ? 'Refresh results' : 'Load more');
    el('media-explorer-scope').classList.toggle('hidden', complete || isExternal());
    el('media-explorer-view-full-size').disabled = !items.length;
  }
  var facetIds = ['kind', 'model', 'folder', 'rating', 'date'];
  var technicalNames = {'min-side':'Short side ≥', 'min-mp':'MP ≥',
    'min-duration':'Duration ≥', 'max-duration':'Duration ≤'};
  function hasFilters() {
    if (isExternal()) return el('media-explorer-search').value.trim() ||
      el('media-explorer-kind').value || el('media-explorer-date').value ||
      el('media-explorer-rating').value || el('media-explorer-tag').value.trim() ||
      ['min-side', 'min-mp', 'min-duration', 'max-duration'].some(function (name) { return el('media-explorer-' + name).value; });
    return artifact || owner || role || source || storyboardType() || el('media-explorer-search').value.trim() ||
      facetIds.some(function (id) { return el('media-explorer-' + id).value; }) ||
      el('media-explorer-tag').value.trim() ||
      ['min-side', 'min-mp', 'min-duration', 'max-duration'].some(function (id) { return el('media-explorer-' + id).value; });
  }
  function emptyState() {
    var empty = el('media-explorer-empty'); empty.classList.toggle('hidden', items.length > 0 || loading);
    var filtered = hasFilters();
    if (el('media-explorer-status').dataset.state === 'error' && el('media-explorer-status').textContent) {
      text(el('media-explorer-empty-title'), 'Could not load this view');
      text(el('media-explorer-empty-description'), 'Your filters are kept. Try again, or open the Console for the full error.');
      text(el('media-explorer-empty-action'), 'Try again'); return;
    }
    text(el('media-explorer-empty-title'), isExternal() && !externalPath ? 'Choose an external folder' :
      isExternal() && !complete ? 'Discovering files…' : filtered ? 'No matching media' :
      (isExternal() ? 'No media in this folder' : 'Generated media, in one place'));
    text(el('media-explorer-empty-description'), isExternal()
      ? (!externalPath ? 'Select a remembered folder or enter a path and choose Browse. No folder scans until you browse.' :
        !complete ? 'Files will appear as they are discovered. Browsing remains responsive.' :
        'Browse another folder or adjust the filters. Technical filters include items with known metadata only.')
      : (filtered ? 'Try a different source, search or filter.' : 'Generated outputs and saved references appear here. Scan full history for older generated media.'));
    text(el('media-explorer-empty-action'), isExternal() ? (!externalPath ? 'Choose folder' : 'Refresh') :
      (!full ? 'Scan full history' : filtered ? 'Clear filters' : 'Refresh library'));
  }
  function filterControls() {
    var chips = el('media-explorer-filter-chips'); chips.replaceChildren();
    function chip(label, clear) {
      var button = document.createElement('button'); button.type = 'button'; text(button, label + ' ×');
      button.title = label; button.setAttribute('aria-label', 'Remove filter: ' + label); button.addEventListener('click', clear); chips.appendChild(button);
    }
    var search = el('media-explorer-search');
    if (artifact) chip('Focused media', function () { artifact = ''; load(true); });
    if (owner) chip('Related to ' + owner, function () { owner = ''; load(true); });
    if (storyboardType()) chip(storyboardType() === 'exports' ? 'Exported Sequences' : 'Scenes', function () { el('media-explorer-storyboard-type').value = ''; load(true); });
    if (search.value.trim()) chip('“' + search.value.trim() + '”', function () { search.value = ''; load(true); });
    if (isExternal()) {
      if (el('media-explorer-tag').value.trim()) chip('Tag: ' + el('media-explorer-tag').value.trim(), function () {el('media-explorer-tag').value = '';load(true);});
      if (el('media-explorer-rating').value) chip('Rating: ' + el('media-explorer-rating').value, function () {el('media-explorer-rating').value='';load(true);});
      if (el('media-explorer-date').value) chip('Date ' + el('media-explorer-date').value + ' days', function () { el('media-explorer-date').value = ''; load(true); });
      ['min-side', 'min-mp', 'min-duration', 'max-duration'].forEach(function (name) {
        var input = el('media-explorer-' + name);
        if (input.value) chip(technicalNames[name] + ' ' + input.value, function () { input.value = ''; load(true); });
      });
    } else {
      if (el('media-explorer-tag').value.trim()) chip('Tag: '+el('media-explorer-tag').value.trim(),function () {el('media-explorer-tag').value='';load(true);});
      facetIds.slice(1).forEach(function (id) {
        var select = el('media-explorer-' + id);
        if (select.value) chip(select.options[select.selectedIndex].textContent, function () { select.value = ''; load(true); });
      });
      ['min-side', 'min-mp', 'min-duration', 'max-duration'].forEach(function (name) {
        var input = el('media-explorer-' + name);
        if (input.value) chip(technicalNames[name] + ' ' + input.value, function () { input.value = ''; load(true); });
      });
    }
    var filterCount = chips.children.length;
    var countNode = el('media-explorer-filter-count');
    if (countNode) countNode.textContent = filterCount ? String(filterCount) : '';
    el('media-explorer-clear-filters').classList.toggle('hidden', !hasFilters() && el('media-explorer-sort').value === 'newest' && !reverseSort);
    var activeSource = sourceButtons.find(function (button) { return button.classList.contains('active'); });
    text(el('media-explorer-heading'), activeSource ? activeSource.textContent : 'WebCap media');
    sourceButtons.forEach(function (button) { button.setAttribute('aria-pressed', String(button.classList.contains('active'))); });
  }
  function facets(data) {
    ['model', 'folder'].forEach(function (id) {
      var select = el('media-explorer-' + id), current = select.value;
      var options = (data || {})[id === 'model' ? 'models' : 'folders'] || [];
      if (current && options.indexOf(current) < 0) options = options.concat([current]);
      select.replaceChildren();
      var any = document.createElement('option'); any.value = ''; text(any, id === 'model' ? 'All models' : 'All Sets'); select.appendChild(any);
      options.forEach(function (value) { var option = document.createElement('option'); option.value = value; text(option, value); select.appendChild(option); });
      select.value = current;
      select.classList.toggle('hidden', !options.length);
    });
  }
  function load(reset, options) {
    options = options || {};
    if (!visible) return;
    syncExternalControls();
    clearTimeout(debounce);
    window.syncShellLocationRoute();
    syncStoryboardType();
    filterControls();
    if (isExternal() && !externalPath) {
      // Reset the pending owner response too: its result must not repopulate this view.
      serial++;
      if (activeRequest) activeRequest.abort();
      activeRequest = null; loading = false; needsLoad = true;
      items = []; total = 0; offset = 0; active = -1; selected.clear();
      el('media-explorer-grid').replaceChildren();
      renderSideList(); selectItem(-1); renderExternalFolders();
      el('media-explorer-scope').classList.add('hidden');
      el('media-explorer-view-full-size').disabled = true;
      text(el('media-explorer-count'), 'No folder selected');
      text(el('media-explorer-status'), 'Choose a recent folder or enter a path and select Browse.');
      el('media-explorer-status').dataset.state = '';
      emptyState();
      return;
    }
    if (reset) {
      serial++; loading = false; needsLoad = true;
    }
    if (loading && !reset) return;
    if (reset && activeRequest) activeRequest.abort();
    var request = serial;
    loading = true;
    el('media-explorer-grid').setAttribute('aria-busy', 'true');
    el('media-explorer-more-btn').disabled = true;
    emptyState();
    var controller = new AbortController(); activeRequest = controller;
    el('media-explorer-scan-all').disabled = full && loading;
    el('media-explorer-status').textContent = isExternal() ? 'Discovering external media…' : (full ? 'Scanning full generated-media history…' : 'Discovering recent media…');
    el('media-explorer-status').dataset.state = 'loading';
    var qs = new URLSearchParams({limit:pageSize, offset:reset ? 0 : offset, role:role,
      kind:el('media-explorer-kind').value, search:el('media-explorer-search').value.trim(),
      sort:el('media-explorer-sort').value, source:source, full:full ? '1' : '0',
      storyboard_type:storyboardType(), model:el('media-explorer-model').value, folder:el('media-explorer-folder').value, rating:el('media-explorer-rating').value, tag:el('media-explorer-tag').value.trim(), date:el('media-explorer-date').value, artifact:artifact, owner:owner});
    ['min-side', 'min-mp', 'min-duration', 'max-duration'].forEach(function (id) {
      qs.set(id.replace(/-/g, '_'), el('media-explorer-' + id).value);
    });
    qs.set('direction', reverseSort ? 'asc' : 'desc');
    if (isExternal()) {
      Object.entries(externalParams()).forEach(function (entry) { qs.set(entry[0], entry[1]); });
      qs.set('date', el('media-explorer-date').value);
      qs.set('directory', externalDirectory);
      qs.set('recursive', el('media-explorer-recursive').checked ? '1' : '0');
    }
    if (isExternal() && options.refreshFilesystem) qs.set('refresh', '1');
    fetch((isExternal() ? '/fs/media_explorer/external?' : '/fs/media_explorer?') + qs, {signal: controller.signal}).then(function (res) {
      return res.json().catch(function (err) { throw new Error('Media discovery HTTP ' + res.status + ': ' + err.message); }).then(function (data) {
        if (!res.ok || !data.ok) throw new Error(data.error || 'Media discovery failed.');
        return data;
      });
    }).then(function (data) {
      if (request !== serial || !visible) return;
      total = data.total;
      if (reset && isExternal()) externalPendingRefresh = false;
      if (isExternal() && options.rememberFolder) saveRecentFolder(externalPath);
      complete = !!data.complete;
      if (isExternal()) {
        externalFolders = data.folders || []; renderExternalFolders();
        externalRevision = data.revision;
        externalOverview = data.discovered + ' found · ' + data.analyzed + ' analyzed' + (data.complete ? '' : ' · discovering');
        if (data.warnings) externalOverview += ' · ' + data.warnings + ' warnings';
        externalSummary();
        if (data.error) report(new Error(data.error));
        if (data.lastWarning && data.lastWarning !== lastExternalError) {
          lastExternalError = data.lastWarning;
          window.reportConsoleError('External media discovery', data.lastWarning);
        }
      }
      var incoming = data.items || [];
      if (isExternal()) incoming.forEach(function (item) {
        var version = editedMediaVersions.get(item.id);
        if (version && item.mediaUrl) item.mediaUrl += '&edited=' + version;
      });
      var host = el('media-explorer-grid');
      if (reset) {
        var previousItems = new Map(items.map(function (item) { return [item.id, item]; }));
        var previous = items[active], cards = new Map();
        Array.prototype.forEach.call(host.children, function (card) { cards.set(card.dataset.id, card); });
        var keep = new Set(incoming.map(function (item) { return item.id; }));
        cards.forEach(function (card, id) { if (!keep.has(id)) card.remove(); });
        items = []; offset = 0; active = -1; anchor = -1;
        if (!options.soft) selected.forEach(function (id) { if (!keep.has(id)) selected.delete(id); });
        incoming.forEach(function (item, index) {
          var card = cards.get(item.id);
          if (card) item = Object.assign(previousItems.get(item.id), item);
          items.push(item);
          if (!card) card = renderCard(item, index);
          text(card.querySelector('.media-explorer-card-sub'), isExternal() ? externalCardSummary(item) : cardSummary(item));
          text(card.querySelector('.media-explorer-card-badge'), badgeText(item));
          card.querySelector('.media-explorer-card-open').setAttribute('aria-label', item.fileName + ', ' + item.role);
          card.dataset.index = index;
          card.dataset.mediaKind = item.mediaKind;
          if (host.children[index] !== card) host.insertBefore(card, host.children[index] || null);
          if (previous && previous.id === item.id) active = index;
        });
        offset = incoming.length;
        if (artifact) active = items.findIndex(function (item) { return item.id === artifact; });
        if (active < 0) selectItem(-1);
        else selectItem(active);
      } else {
        var loaded = new Set(items.map(function (item) { return item.id; }));
        incoming.forEach(function (item) {
          if (loaded.has(item.id)) return;
          loaded.add(item.id);
          var index = items.length; items.push(item); host.appendChild(renderCard(item, index));
        });
        offset += incoming.length;
      }
      {
        var known = new Set(data.facets && data.facets.tags || []);
        items.forEach(function (item) {(item.tags || []).forEach(function (tag) {known.add(tag);});});
        var datalist = el('media-explorer-known-tags'); datalist.replaceChildren();
        Array.from(known).sort().forEach(function (tag) {
          var option = document.createElement('option'); option.value = tag; datalist.appendChild(option);
        });
      }
      count(); renderSideList(); updateSelection(); renderMainPreview();
      if (!isExternal()) facets(data.facets);
      needsLoad = false;
      if (isExternal()) {
        if (!data.complete) {
          clearTimeout(externalDiscoveryTimer);
          externalDiscoveryTimer = setTimeout(pollExternalDiscovery, 1400);
        }

      }
      if (!data.error) text(el('media-explorer-status'), '');
    }).catch(function (err) { if (request === serial && err.name !== 'AbortError') report(err); })
      .finally(function () { if (request === serial) {
        loading = false; activeRequest = null; el('media-explorer-scan-all').disabled = false;
        el('media-explorer-more-btn').disabled = false; el('media-explorer-grid').setAttribute('aria-busy', 'false'); emptyState();
        maybeLoadMore();
      } });
  }
  function open(target) {
    if (visible && !target) return;
    if (!routeInitialized) {
      routeInitialized = true;
      if (window.location.hash.split('?')[0] === '#/media') {
        var params = new URLSearchParams(window.location.hash.split('?')[1] || '');
        role = params.get('role') || ''; source = params.get('source') || '';
        artifact = params.get('artifact') || ''; owner = params.get('owner') || '';
        full = params.get('full') === '1';
        el('media-explorer-search').value = params.get('q') || '';
        el('media-explorer-tag').value = params.get('tag') || '';
        el('media-explorer-kind').value = params.get('kind') || '';
        el('media-explorer-sort').value = params.get('sort') || 'newest';
        facetIds.slice(1).forEach(function (id) {
          var value = params.get(id === 'folder' ? 'mediaSet' : id) || '';
          if (value && (id === 'model' || id === 'folder')) {
            var option = document.createElement('option'); option.value = value; text(option, value); el('media-explorer-' + id).appendChild(option);
          }
          el('media-explorer-' + id).value = value;
        });
        ['min-side', 'min-mp', 'min-duration', 'max-duration'].forEach(function (id) {
          el('media-explorer-' + id).value = params.get(id) || '';
        });
        reverseSort = params.get('direction') === 'asc';
        el('media-explorer-sort-reverse').setAttribute('aria-pressed', String(reverseSort));
        sourceButtons.forEach(function (button, index) {
          var match = source ? button.dataset.mediaSource === source : button.dataset.mediaRole === role;
          button.classList.toggle('active', match);
          if (match) el('media-explorer-source-chooser').value = index;
        });
      }
    }
    if (target) {
      source = target.source; role = ''; artifact = target.id; owner = ''; full = true; needsLoad = true;
      el('media-explorer-search').value = ''; el('media-explorer-sort').value = 'newest';
      facetIds.forEach(function (id) { el('media-explorer-' + id).value = ''; });
      ['min-side', 'min-mp', 'min-duration', 'max-duration'].forEach(function (id) { el('media-explorer-' + id).value = ''; });
      reverseSort = false; el('media-explorer-sort-reverse').setAttribute('aria-pressed', 'false');
      sourceButtons.forEach(function (button, index) {
        var match = button.dataset.mediaSource === source;
        button.classList.toggle('active', match);
        if (match) el('media-explorer-source-chooser').value = index;
      });
    }
    window.closeGenerateActivity(); window.closeTestBenchActivity();
    window.closeStoryboardActivity(); window.closeStorageActivity();
    visible = true;
    syncExternalControls(); setExplorerMode(explorerMode);
    el('media-explorer-workspace').classList.remove('hidden');
    el('app-frame').classList.add('workspace-media-explorer-open');
    window.syncApplicationShellContext();
    window.syncShellLocationRoute();
    if (needsLoad || isExternal()) load(true);
    if (isExternal()) requestRecentFolders();
    if (isExternal() && externalPath) externalMetadataStatus();
  }
  function close() {
    visible = false; serial++;
    stopExternalTimers();
    clearTimeout(debounce);
    el('media-explorer-scan-all').disabled = false;
    el('media-explorer-workspace').querySelectorAll('video').forEach(function (video) { video.pause(); });
    if (activeRequest) { activeRequest.abort(); activeRequest = null; }
    loading = false;
    el('media-explorer-workspace').classList.add('hidden');
    el('app-frame').classList.remove('workspace-media-explorer-open');
    var dlg = el('media-explorer-loupe'); if (dlg.open) dlg.close();
    var compare = el('media-explorer-compare-dialog'); if (compare.open) compare.close();
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-media-role]'), function (button) {
    button.addEventListener('click', function () {
      role = button.dataset.mediaRole;
      artifact = ''; owner = '';
      source = '';
      stopExternalTimers(); externalJobRunning = false;

      syncExternalControls();
      Array.prototype.forEach.call(document.querySelectorAll('.media-explorer-source'), function (node) {
        node.classList.toggle('active', node === button);
      });
      load(true);
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-media-source]'), function (button) {
    button.addEventListener('click', function () {
      source = button.dataset.mediaSource;
      stopExternalTimers(); externalJobRunning = false;

      if (isExternal()) {
        requestRecentFolders();
        externalDirectory = ''; externalFolders = [];
        ['model', 'folder', 'rating'].forEach(function (id) { el('media-explorer-' + id).value = ''; });
        el('media-explorer-tag').value = '';
        if (el('media-explorer-sort').value === 'rating') el('media-explorer-sort').value = 'newest';
      }
      setExplorerMode(explorerMode);
      syncExternalControls();
      artifact = ''; owner = '';
      role = '';
      Array.prototype.forEach.call(document.querySelectorAll('.media-explorer-source'), function (node) { node.classList.toggle('active', node === button); });
      load(true);
    });
  });
  document.querySelectorAll('[data-explorer-mode]').forEach(function (btn) { btn.addEventListener('click', function () { setExplorerMode(btn.dataset.explorerMode); }); });
  el('media-explorer-open-path').addEventListener('click', function () {
    var nextPath = el('media-explorer-external-path').value.trim();
    externalPath = nextPath;
    externalDirectory = ''; externalFolders = [];
    mediaFacts.clear();
    externalRevision = -1; externalPendingRefresh = false; externalOverview = ''; externalJobSummary = ''; externalJobRunning = false;
    stopExternalTimers(); selected.clear(); updateSelection();
    load(true, {refreshFilesystem:true, rememberFolder:true});
  });
  el('media-explorer-saved-folders').addEventListener('change', function () {
    var path = this.value;
    el('media-explorer-forget-folder').disabled = !path;
    if (!path) return;
    el('media-explorer-external-path').value = path;
    el('media-explorer-open-path').click();
  });
  el('media-explorer-forget-folder').addEventListener('click', function () {
    var path = el('media-explorer-saved-folders').value;
    if (!path) return;
    var request = ++recentFolderRequest;
    fetch('/fs/media_explorer/external/folders', {
      method: 'DELETE', headers: {'Content-Type':'application/json'}, body:JSON.stringify({path:path})
    }).then(function (res) { return res.json().then(function (body) {
      if (!res.ok || !body.ok) throw Error(body.error || 'Could not forget external folder');
      return body;
    }); }).then(function (body) {
      if (request === recentFolderRequest) showRecentFolders(body.folders);
    }).catch(report);
  });
  el('media-explorer-external-path').addEventListener('keydown', function (e) { if (e.key === 'Enter') el('media-explorer-open-path').click(); });
  el('media-explorer-gallery-area').addEventListener('scroll', maybeLoadMore);
  el('media-explorer-preview-stage').parentElement.addEventListener('scroll', maybeLoadMore);
  el('media-explorer-copy-selected').addEventListener('click', function () {
    chooseExport(items.filter(function (item) { return selected.has(item.id); }));
  });
  el('media-explorer-export-destination').addEventListener('change', browseDestinations);
  el('media-explorer-export-up').addEventListener('click', function () {
    var field = el('media-explorer-export-destination');
    field.value = field.value.trim().split('/').slice(0,-1).join('/'); browseDestinations();
  });
  el('media-explorer-export-cancel').addEventListener('click', function () { el('media-explorer-export-dialog').close(); });
  el('media-explorer-export-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var submit = el('media-explorer-export-submit');
    var generated = exportItems[0] && exportItems[0].source === 'generate';
    var testing = exportItems[0] && exportItems[0].source === 'test';
    var owned = exportItems[0] &&
      (exportItems[0].source === 'epoch' || exportItems[0].source === 'storyboard');
    var payload = {
      destination: el('media-explorer-export-destination').value.trim(),
      newSet: el('media-explorer-export-new-set').value.trim()
    };
    if (generated) payload.storageIds = Array.from(new Set(exportItems.map(function (item) {return item.storageId;})));
    else if(testing) payload.results=exportItems.map(function (item) {
      return {folder:item.ownerFolder,session:item.storageId,mediaFile:item.fileName};
    });
    else if(owned) payload.results=exportItems.map(function (item) {
      return {source:item.source,folder:item.ownerFolder,storageId:item.storageId,
        mediaFile:item.fileName,mediaPath:item.mediaPath};
    });
    else {payload.path=externalPath;payload.files=exportItems.map(function (item) {return item.relativePath;});}
    submit.disabled = true;
    text(el('media-explorer-export-status'), 'Copying media…');
    fetch(generated ? '/fs/media_explorer/generated/copy' :
      (testing ? '/fs/media_explorer/test/copy' :
        (owned ? '/fs/media_explorer/owned/copy' : '/fs/media_explorer/external/copy')), {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
    }).then(function (res) { return res.json().then(function (data) {
      if (!res.ok || !data.ok) throw Error(data.error || 'Export failed'); return data;
    }); }).then(function (data) {
      var count = data.copied.length + ' files copied';
      text(el('media-explorer-export-status'), count + ' to ' + data.destination);
    }).catch(function (err) { text(el('media-explorer-export-status'), err.message); report(err); })
      .finally(function () { submit.disabled = false; });
  });
  var quickFilters = el('media-explorer-quick-filters');
  quickFilters.appendChild(el('media-explorer-tag'));
  quickFilters.appendChild(el('media-explorer-rating'));
  var savedMediaViews = [];
  function markSavedViewModified() {
    var chooser = el('media-explorer-view-select');
    if (!chooser.value) return;
    chooser.value = '';
    el('media-explorer-delete-view').disabled = true;
    el('media-explorer-rename-view').disabled = true;
  }
  function currentViewFilters() {
    var filters = {source:source,role:role,search:el('media-explorer-search').value.trim(),
      tag:el('media-explorer-tag').value.trim(),rating:el('media-explorer-rating').value,
      kind:el('media-explorer-kind').value,model:el('media-explorer-model').value,
      folder:el('media-explorer-folder').value,date:el('media-explorer-date').value,
      sort:el('media-explorer-sort').value,direction:reverseSort?'asc':'desc',
      full:full,recursive:el('media-explorer-recursive').checked,
      storyboardType:storyboardType()};
    ['min-side','min-mp','min-duration','max-duration'].forEach(function (id) {
      filters[id]=el('media-explorer-'+id).value;
    });
    if(isExternal()) {
      filters.externalPath=externalPath;
      filters.externalDirectory=externalDirectory;
    }
    return filters;
  }
  function showSavedViews(views, selectedName) {
    savedMediaViews=views || [];
    var select=el('media-explorer-view-select');
    select.replaceChildren();
    var placeholder=document.createElement('option');placeholder.value='';
    placeholder.textContent='Saved views…';select.appendChild(placeholder);
    savedMediaViews.forEach(function (view) {
      var option=document.createElement('option');option.value=view.name;
      option.textContent=view.name;select.appendChild(option);
    });
    select.value=selectedName || '';
    el('media-explorer-delete-view').disabled=!select.value;
    el('media-explorer-rename-view').disabled=!select.value;
  }
  function loadSavedViews() {
    return fetch('/fs/media_explorer/views').then(function (res) {
      return res.json().then(function (payload) {
        if(!res.ok || !payload.ok)throw Error(payload.error || 'Could not load saved views');
        showSavedViews(payload.views,el('media-explorer-view-select').value);
      });
    }).catch(report);
  }
  function applySavedView(view) {
    if(!view || !view.filters)return;
    var f=view.filters;
    source=f.source || '';role=f.role || '';
    artifact='';owner='';
    full=Boolean(f.full);
    ['search','tag','rating','kind','model','folder','date','sort'].forEach(function (id) {
      var key=id==='search'?'search':id;
      el('media-explorer-'+id).value=f[key] || (id==='sort'?'newest':'');
    });
    ['min-side','min-mp','min-duration','max-duration'].forEach(function (id) {
      el('media-explorer-'+id).value=f[id] || '';
    });
    el('media-explorer-storyboard-type').value=f.storyboardType || '';
    reverseSort=f.direction==='asc';
    el('media-explorer-sort-reverse').setAttribute('aria-pressed',String(reverseSort));
    externalPath=source==='external' ? f.externalPath || '' : externalPath;
    externalDirectory=source==='external' ? f.externalDirectory || '' : '';
    el('media-explorer-external-path').value=externalPath;
    el('media-explorer-recursive').checked=Boolean(f.recursive);
    sourceButtons.forEach(function (button,index) {
      var match=source ? button.dataset.mediaSource===source :
        button.dataset.mediaRole===role;
      button.classList.toggle('active',match);
      if(match)el('media-explorer-source-chooser').value=index;
    });
    selected.clear();anchor=-1;selectItem(-1);
    if(source==='external') {
      externalRevision=-1;externalPendingRefresh=false;
      stopExternalTimers();
    }
    load(true,{refreshFilesystem:source==='external'});
  }
  ['media-explorer-search','media-explorer-tag'].forEach(function (id) {
    el(id).addEventListener('input', markSavedViewModified);
  });
  ['media-explorer-kind','media-explorer-rating','media-explorer-model',
    'media-explorer-folder','media-explorer-date','media-explorer-sort',
    'media-explorer-storyboard-type','media-explorer-recursive',
    'media-explorer-min-side','media-explorer-min-mp',
    'media-explorer-min-duration','media-explorer-max-duration'].forEach(function (id) {
    el(id).addEventListener('change', markSavedViewModified);
  });
  document.querySelectorAll('.media-explorer-source').forEach(function (button) {
    button.addEventListener('click',markSavedViewModified);
  });
  el('media-explorer-sort-reverse').addEventListener('click',markSavedViewModified);
  el('media-explorer-clear-filters').addEventListener('click',markSavedViewModified);
  el('media-explorer-external-path').addEventListener('input',markSavedViewModified);
  el('media-explorer-view-select').addEventListener('focus',loadSavedViews);
  el('media-explorer-view-select').addEventListener('change',function () {
    el('media-explorer-delete-view').disabled=!this.value;
    el('media-explorer-rename-view').disabled=!this.value;
    var view=savedMediaViews.find(function (entry) {
      return entry.name===el('media-explorer-view-select').value;
    });
    if(view)applySavedView(view);
  });
  el('media-explorer-save-view').addEventListener('click',function () {
    promptMediaAction('Save current view','','Save view',function (name) {
      return fetch('/fs/media_explorer/views',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name:name,filters:currentViewFilters()})
      }).then(function (res) {return res.json().then(function (payload) {
        if(!res.ok || !payload.ok)throw Error(payload.error || 'Could not save view');
        showSavedViews(payload.views,name);
      });});
    });
  });
  el('media-explorer-rename-view').addEventListener('click',function () {
    var current=el('media-explorer-view-select').value;
    if(!current)return;
    promptMediaAction('Rename saved view',current,'Rename',function (newName) {
      return fetch('/fs/media_explorer/views/rename',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name:current,newName:newName})
      }).then(function (res) {return res.json().then(function (body) {
        if(!res.ok || !body.ok)throw Error(body.error || 'Could not rename saved view');
        showSavedViews(body.views,newName);
      });});
    });
  });
  el('media-explorer-delete-view').addEventListener('click',function () {
    var name=el('media-explorer-view-select').value;
    if(!name || !window.confirm('Delete saved view "'+name+'"? This does not delete media.'))return;
    fetch('/fs/media_explorer/views',{
      method:'DELETE',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:name})
    }).then(function (res) {return res.json().then(function (payload) {
      if(!res.ok || !payload.ok)throw Error(payload.error || 'Could not delete view');
      showSavedViews(payload.views,'');
    });}).catch(report);
  });
  var newFolderButton = document.createElement('button');
  newFolderButton.type = 'button'; newFolderButton.className = 'review-captions-btn';
  newFolderButton.id = 'media-explorer-new-folder'; newFolderButton.textContent = '+ New folder';
  newFolderButton.addEventListener('click', createExternalFolder);
  el('media-explorer-external-navigation').appendChild(newFolderButton);
  allowFolderDrop(el('media-explorer-up'), function () {return externalDirectory.split('/').slice(0,-1).join('/');});
  var bulkMoveButton = document.createElement('button');
  bulkMoveButton.type = 'button'; bulkMoveButton.className = 'review-captions-btn';
  bulkMoveButton.textContent = 'Move to Folder…';
  bulkMoveButton.addEventListener('click', function () {
    var chosen = chosenExternalFiles();
    if (chosen.length) externalMutation(chosen[0], 'move');
  });
  function selectedCuratable() {
    var chosen=items.filter(function (item) {return selected.has(item.id);});
    if (!chosen.length || !chosen.every(function (item) {
      return item.source==='external' ||
        (item.source==='generate' && item.role==='generated' && item.storageId) ||
        (item.source==='test' && item.ownerFolder && item.storageId) ||
        (item.source==='epoch' && item.ownerFolder && item.storageId) ||
        (item.source==='storyboard' && item.storageId);
    })) return [];
    return chosen;
  }
  function saveCurationFor(item, change) {
    if (item.source==='external') return externalActionStrict('curate',
      Object.assign({path:externalPath,file:item.relativePath},change));
    var kind=Object.prototype.hasOwnProperty.call(change,'tags') ? 'tags' : 'rating';
    var url=item.source==='test' ? '/fs/media_explorer/test/tags' :
      '/fs/generate/result/'+kind;
    if(item.source==='epoch' || item.source==='storyboard') {
      if(kind!=='tags')return Promise.reject(Error('Ratings are not supported for this producer.'));
      return fetch('/fs/media_explorer/owned/tags',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({source:item.source,folder:item.ownerFolder || '',
          storageId:item.storageId,mediaFile:item.fileName,
          mediaPath:item.mediaPath,tags:change.tags})
      }).then(function (res) {return res.json().then(function (body) {
        if(!res.ok || !body.ok)throw Error(body.error || 'Could not save tags');
        return body;
      });});
    }
    if(item.source==='test' && kind==='rating')
      return fetch('/fs/test_generations',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({folder:item.ownerFolder,operation:'test_rate_result',
          criteria:{session:item.storageId,mediaFile:item.fileName,rating:change.rating}})
      }).then(function (res) {return res.json().then(function (body) {
        if(!res.ok || body.ok===false)throw Error(body.error || 'Could not rate Test result');
        return body;
      });});
    var payload=item.source==='test'
      ? Object.assign({folder:item.ownerFolder,session:item.storageId,mediaFile:item.fileName},change)
      : Object.assign({storageId:item.storageId},change);
    return fetch(url,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
    }).then(function (res) {return res.json().then(function (body) {
      if(!res.ok || !body.ok)throw Error(body.error || 'Curation failed');
      return body;
    });});
  }
  function bulkCurate(choice) {
    var chosen=selectedCuratable();
    if(!chosen.length)return;
    function apply(changeForItem, verb) {
      return Promise.allSettled(chosen.map(function (item) {
        return saveCurationFor(item,changeForItem(item));
      })).then(function (results) {
        var failed=results.filter(function (result) {return result.status==='rejected';});
        load(true,{soft:true});
        if(failed.length)throw Error(verb+' '+(results.length-failed.length)+'/'+results.length+
          ' files; '+failed.length+' failed: '+failed[0].reason.message);
      });
    }
    if(choice==='tags') {
      promptMediaAction('Add tags to '+chosen.length+' files','','Add tags',function (value) {
        var added=value.split(',').map(function (tag) {return tag.trim();}).filter(Boolean);
        if(!added.length)return false;
        return apply(function (item) {
          return {tags:Array.from(new Set((item.tags || []).concat(added)))};
        },'Tagged');
      },{tagSuggestions:true});
    } else {
      var entries=Array.from({length:6},function (_,rating) {
        return {label:rating?'★'.repeat(rating)+' ('+rating+'/5)':'Clear rating',run:function () {
          apply(function () {return {rating:rating};},'Rated').catch(report);
        }};
      });
      var anchor=bulkRateButton.getBoundingClientRect();
      showContextMenu(anchor.left,anchor.bottom,entries);
    }
  }
  var bulkTagsButton = document.createElement('button');
  bulkTagsButton.type = 'button';bulkTagsButton.className = 'review-captions-btn';
  bulkTagsButton.textContent = 'Add tags…';
  bulkTagsButton.addEventListener('click',function () {bulkCurate('tags');});
  var bulkRateButton = document.createElement('button');
  bulkRateButton.type = 'button';bulkRateButton.className = 'review-captions-btn';
  bulkRateButton.textContent = 'Rate ★';
  bulkRateButton.addEventListener('click',function (event) {event.stopPropagation();bulkCurate('rating');});
  var bulkCollectionButton=document.createElement('button');
  bulkCollectionButton.type='button';bulkCollectionButton.className='review-captions-btn';
  bulkCollectionButton.textContent='Add to collection…';
  bulkCollectionButton.addEventListener('click',function (event) {event.stopPropagation();chooseCollection(selectedCuratable());});
  var bulkRemoveCollectionButton = document.createElement('button');
  bulkRemoveCollectionButton.type = 'button';
  bulkRemoveCollectionButton.className = 'review-captions-btn';
  bulkRemoveCollectionButton.textContent = 'Remove from collection…';
  bulkRemoveCollectionButton.addEventListener('click',function (event) {
    event.stopPropagation();
    var chosen = selectedCuratable();
    if (!chosen.length) return;
    var common = (chosen[0].tags || []).filter(function (tag) {
      return tag.startsWith('Collection · ') && chosen.every(function (item) {
        return (item.tags || []).includes(tag);
      });
    });
    var options = common.map(function (tag) {
      return {label:tag.slice('Collection · '.length),run:function () {
        Promise.allSettled(chosen.map(function (item) {
          return saveCurationFor(item,{tags:(item.tags || []).filter(function (value) {
            return value !== tag;
          })});
        })).then(function (results) {
          var failed=results.filter(function (result) {return result.status==='rejected';});
          load(true,{soft:true});
          if (failed.length) report(new Error('Removed '+(results.length-failed.length)+
            ' of '+results.length+' items; '+failed.length+' failed: '+failed[0].reason.message));
        }).catch(report);
      }};
    });
    var rect=bulkRemoveCollectionButton.getBoundingClientRect();
    showContextMenu(rect.left,rect.bottom,options);
  });
  var bulkTrashButton = document.createElement('button');
  bulkTrashButton.type = 'button'; bulkTrashButton.className = 'review-captions-btn';
  bulkTrashButton.textContent = 'Move to Trash';
  bulkTrashButton.addEventListener('click', function () {
    var chosen = chosenExternalFiles();
    if (chosen.length) externalMutation(chosen[0], 'trash');
  });
  el('media-explorer-selection').insertBefore(bulkMoveButton, el('media-explorer-compare'));
  el('media-explorer-selection').insertBefore(bulkTrashButton, el('media-explorer-compare'));
  el('media-explorer-selection').insertBefore(bulkTagsButton, el('media-explorer-compare'));
  el('media-explorer-selection').insertBefore(bulkRateButton, el('media-explorer-compare'));
  el('media-explorer-selection').insertBefore(bulkCollectionButton, el('media-explorer-compare'));
  el('media-explorer-selection').insertBefore(bulkRemoveCollectionButton, el('media-explorer-compare'));
  function syncBulkActions() {
    var show = isExternal() && chosenExternalFiles().length > 0;
    bulkMoveButton.classList.toggle('hidden',!show);
    bulkTrashButton.classList.toggle('hidden',!show);
    var curation=selectedCuratable().length>0;
    bulkTagsButton.classList.toggle('hidden',!curation);
    bulkCollectionButton.classList.toggle('hidden',!curation);
    var canRemove = curation && (selectedCuratable()[0].tags || []).some(function (tag) {
      return tag.startsWith('Collection · ') && selectedCuratable().every(function (item) {
        return (item.tags || []).includes(tag);
      });
    });
    bulkRemoveCollectionButton.classList.toggle('hidden',!canRemove);
    bulkRateButton.classList.toggle('hidden',!curation ||
      !selectedCuratable().every(function (item) {return item.source==='external' ||
        item.source==='generate' || item.source==='test';}));
  }
  el('media-explorer-up').addEventListener('click', function () { setExternalDirectory(externalDirectory.split('/').slice(0, -1).join('/')); });
  el('media-explorer-recursive').addEventListener('change', function () { renderExternalFolders(); load(true); });
  el('media-explorer-sort-reverse').addEventListener('click', function () {
    reverseSort = !reverseSort; el('media-explorer-sort-reverse').setAttribute('aria-pressed', String(reverseSort)); load(true);
  });
  var grip = el('media-explorer-resizer'), explorerWorkspace = el('media-explorer-workspace'), resizing = false;
  grip.addEventListener('pointerdown', function (e) { resizing = true; grip.classList.add('dragging'); grip.setPointerCapture(e.pointerId); });
  grip.addEventListener('pointermove', function (e) {
    if (!resizing) return;
    var rect = explorerWorkspace.querySelector('.media-explorer-main').getBoundingClientRect();
    explorerWorkspace.style.setProperty('--explorer-list-width', Math.max(220, Math.min(650, e.clientX - rect.left)) + 'px');
  });
  function endResize() { resizing = false; grip.classList.remove('dragging'); }
  grip.addEventListener('pointerup', endResize);
  grip.addEventListener('pointercancel', endResize);
  grip.addEventListener('lostpointercapture', endResize);
  grip.addEventListener('dblclick', function () { explorerWorkspace.style.setProperty('--explorer-list-width', '292px'); });
  grip.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault();
    var width = parseInt(explorerWorkspace.style.getPropertyValue('--explorer-list-width'), 10) || 292;
    explorerWorkspace.style.setProperty('--explorer-list-width', Math.max(220, Math.min(650, width + (e.key === 'ArrowRight' ? 20 : -20))) + 'px');
  });
  el('media-explorer-generate-metadata').addEventListener('click', function () { requestExternalMetadata('filtered'); });
  el('media-explorer-stop-metadata').addEventListener('click', function () {
    fetch('/fs/media_explorer/external/metadata/stop', {method:'POST'}).then(function (res) {
      if (!res.ok) throw Error('Could not stop metadata analysis');
      return res.json();
    }).then(function () { externalMetadataStatus(); }).catch(report);
  });
  ['min-side', 'min-mp', 'min-duration', 'max-duration'].forEach(function (name) { el('media-explorer-' + name).addEventListener('change', function () { load(true); }); });
  el('media-explorer-clear-selection').addEventListener('click', function () { selected.clear(); updateSelection(); });
  el('media-explorer-compare').addEventListener('click', function () {
    var chosen = items.filter(function (item) { return selected.has(item.id); });
    if (chosen.length < 2 || chosen.length > 4) return;
    el('media-explorer-inspector-body').querySelectorAll('video').forEach(function (video) { video.pause(); });
    var host = el('media-explorer-compare-content');
    host.replaceChildren();
    host.classList.toggle('survey', chosen.length > 2);
    chosen.forEach(function (item) {
      var pane = document.createElement('div'); pane.className = 'media-explorer-compare-pane';
      pane.tabIndex = 0;
      pane.setAttribute('role', 'group'); pane.setAttribute('aria-label', item.fileName);
      pane.appendChild(mediaElement(item, true));
      var label = document.createElement('span'); text(label, item.fileName); pane.appendChild(label);
      host.appendChild(pane);
    });
    text(el('media-explorer-compare-dialog').querySelector('strong'), (chosen.length > 2 ? 'Survey' : 'Compare') + ' · ' + chosen.length + ' selected');
    text(el('media-explorer-compare-hint'), chosen.some(function (item) { return item.mediaKind === 'video'; }) ? 'Original media · independent playback' : 'Original media · ← → move focus');
    el('media-explorer-compare-dialog').showModal();
  });
  el('media-explorer-compare-close').addEventListener('click', function () { el('media-explorer-compare-dialog').close(); });
  el('media-explorer-refresh').addEventListener('click', function () {
    if (isExternal()) { mediaFacts.clear(); externalRevision = -1; externalPendingRefresh = false; load(true, {refreshFilesystem:true}); }
    else load(true);
  });
  el('media-explorer-scan-all').addEventListener('click', function () { full = true; load(true); });
  el('media-explorer-more-btn').addEventListener('click', function () { load(externalPendingRefresh, externalPendingRefresh ? {} : undefined); });
  var debounce;
  el('media-explorer-search').addEventListener('input', function () {
    artifact = ''; owner = '';
    clearTimeout(debounce); debounce = setTimeout(function () { load(true); }, 250);
  });
  el('media-explorer-kind').addEventListener('change', function () { load(true); });
  el('media-explorer-tag').addEventListener('input', function () {
    clearTimeout(debounce);
    debounce=setTimeout(function () {load(true);},250);
  });
  el('media-explorer-storyboard-type').addEventListener('change', function () { load(true); });
  facetIds.slice(1).forEach(function (id) { el('media-explorer-' + id).addEventListener('change', function () { load(true); }); });
  el('media-explorer-sort').addEventListener('change', function () { load(true); });
  el('media-explorer-size').addEventListener('input', function () {
    el('media-explorer-grid').style.setProperty('--media-tile-width', this.value + 'px');
  });
  var sourceButtons = Array.prototype.slice.call(document.querySelectorAll('.media-explorer-source'));
  sourceButtons.forEach(function (button, index) {
    button.setAttribute('aria-label', button.textContent);
    var option = document.createElement('option'); option.value = index; text(option, button.textContent);
    el('media-explorer-source-chooser').appendChild(option);
    button.addEventListener('click', function () { el('media-explorer-source-chooser').value = index; });
  });
  el('media-explorer-source-chooser').addEventListener('change', function () { sourceButtons[Number(this.value)].click(); });
  el('media-explorer-clear-filters').addEventListener('click', function () {
    el('media-explorer-search').value = ''; el('media-explorer-sort').value = 'newest';
    reverseSort = false; el('media-explorer-sort-reverse').setAttribute('aria-pressed', 'false');
    facetIds.forEach(function (id) { el('media-explorer-' + id).value = ''; });
    el('media-explorer-tag').value = '';
    el('media-explorer-storyboard-type').value = '';
    if (isExternal()) {
      ['min-side', 'min-mp', 'min-duration', 'max-duration'].forEach(function (name) {
        el('media-explorer-' + name).value = '';
      });
      load(true);
    } else {
      ['min-side', 'min-mp', 'min-duration', 'max-duration'].forEach(function (name) { el('media-explorer-' + name).value = ''; });
      sourceButtons.find(function (btn) { return btn.hasAttribute('data-media-role') && btn.dataset.mediaRole === ''; }).click();
    }
  });
  el('media-explorer-empty-action').addEventListener('click', function () {
    if (isExternal()) {
      if (!externalPath) el('media-explorer-external-path').focus();
      else load(true, {refreshFilesystem:true});
    }
    else if (el('media-explorer-status').dataset.state === 'error' && el('media-explorer-status').textContent) load(true);
    else if (!full) { full = true; load(true); }
    else if (hasFilters()) el('media-explorer-clear-filters').click();
    else load(true);
  });
  ['fit', 'fill'].forEach(function (mode) {
    el('media-explorer-' + mode).addEventListener('click', function () {
      el('media-explorer-grid').classList.toggle('fill', mode === 'fill');
      el('media-explorer-fit').setAttribute('aria-pressed', String(mode === 'fit'));
      el('media-explorer-fill').setAttribute('aria-pressed', String(mode === 'fill'));
    });
  });
  ['media-explorer-loupe', 'media-explorer-compare-dialog'].forEach(function (id) {
    el(id).addEventListener('close', function () {
      this.querySelectorAll('video').forEach(function (video) { video.pause(); });
      if (id === 'media-explorer-loupe' && loupeReturn) {
        if (!loupeReturn.inspectorOpen) el('media-explorer-inspector').classList.add('hidden');
        (explorerMode === 'grid' ? el('media-explorer-preview-stage').parentElement :
          el('media-explorer-gallery-area')).scrollTop = loupeReturn.scroll;
        loupeReturn = null;
      }
      if (active >= 0 && visible) el('media-explorer-grid').children[active].querySelector('.media-explorer-card-open').focus({preventScroll: true});
    });
  });
  el('media-explorer-zoom').addEventListener('click', function () {
    var zoomed = el('media-explorer-loupe-content').classList.toggle('zoomed');
    this.setAttribute('aria-pressed', String(zoomed));
  });
  el('media-explorer-compare-dialog').addEventListener('keydown', function (event) {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || event.target.tagName === 'VIDEO') return;
    event.preventDefault();
    var panes = Array.prototype.slice.call(el('media-explorer-compare-content').children);
    var current = panes.indexOf(event.target.closest('.media-explorer-compare-pane'));
    panes[Math.max(0, Math.min(panes.length - 1, current + (event.key === 'ArrowLeft' ? -1 : 1)))].focus();
  });
  el('media-explorer-close-details').addEventListener('click', function () {
    var previous = active; selectItem(-1);
    if (previous >= 0) el('media-explorer-grid').children[previous].querySelector('.media-explorer-card-open').focus({preventScroll: true});
  });
  el('media-explorer-close-loupe').addEventListener('click', function () { el('media-explorer-loupe').close(); });
  el('media-explorer-next').addEventListener('click', function () { selectItem(Math.min(items.length - 1, active + 1)); openLoupe(); });
  el('media-explorer-previous').addEventListener('click', function () { selectItem(Math.max(0, active - 1)); openLoupe(); });
  document.addEventListener('keydown', function (event) {
    if (!visible || event.defaultPrevented || el('media-explorer-compare-dialog').open) return;
    if (!el('media-explorer-workspace').contains(event.target)) return;
    if (event.target.closest('input, select, textarea, [contenteditable="true"]') && event.target.type !== 'checkbox') return;
    var loupe = el('media-explorer-loupe').open;
    if (!loupe && event.key === 'Escape') { selected.clear(); updateSelection(); selectItem(-1); return; }
    if (!loupe && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault(); items.forEach(function (item) { selected.add(item.id); }); updateSelection(); return;
    }
    if (!loupe && !event.target.closest('.media-explorer-card')) return;
    var focused = Number(event.target.closest('.media-explorer-card') && event.target.closest('.media-explorer-card').dataset.index);
    if (!loupe && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
      var targetCard = event.target.closest('.media-explorer-card');
      if (targetCard && items[focused]) {
        event.preventDefault();
        var menu = targetCard.querySelector('.media-explorer-item-menu');
        if (menu) openItemMenu(items[focused],menu,event);
      }
      return;
    }
    if (!loupe && event.key === 'Enter') { event.preventDefault(); openLoupe(focused); return; }
    if (!loupe && event.key === ' ' && event.target.type !== 'checkbox') {
      event.preventDefault();
      var id = items[focused].id;
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      anchor = focused; updateSelection(); return;
    }
    if (loupe && event.key.toLowerCase() === 'z' && !event.ctrlKey && !event.metaKey && !el('media-explorer-zoom').disabled) {
      event.preventDefault(); el('media-explorer-zoom').click(); return;
    }
    var columns = getComputedStyle(el('media-explorer-grid')).gridTemplateColumns.split(' ').length;
    var delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : !loupe && event.key === 'ArrowUp' ? -columns : !loupe && event.key === 'ArrowDown' ? columns : !loupe && event.key === 'Home' ? -focused : !loupe && event.key === 'End' ? items.length - 1 - focused : 0;
    if (delta && items.length) {
      event.preventDefault(); var next = Math.max(0, Math.min(items.length - 1, (loupe ? active : focused) + delta));
      selectItem(next);
      if (loupe) openLoupe(); else {
        if (event.shiftKey) {
          if (anchor < 0) anchor = focused;
          for (var i = Math.min(anchor, next); i <= Math.max(anchor, next); i++) selected.add(items[i].id);
          updateSelection();
        }
        el('media-explorer-grid').children[next].querySelector('.media-explorer-card-open').focus();
      }
    }
  });
  window.openMediaExplorerActivity = open;
  window.closeMediaExplorerActivity = close;
  window.appendMediaExplorerRouteParams = function (params) {
    if (role) params.set('role', role);
    if (source) params.set('source', source);
    if (artifact) params.set('artifact', artifact);
    if (owner) params.set('owner', owner);
    if (full) params.set('full', '1');
    if (el('media-explorer-search').value.trim()) params.set('q', el('media-explorer-search').value.trim());
    if (el('media-explorer-tag').value.trim()) params.set('tag', el('media-explorer-tag').value.trim());
    if (el('media-explorer-kind').value) params.set('kind', el('media-explorer-kind').value);
    facetIds.slice(1).forEach(function (id) { if (el('media-explorer-' + id).value) params.set(id === 'folder' ? 'mediaSet' : id, el('media-explorer-' + id).value); });
    ['min-side', 'min-mp', 'min-duration', 'max-duration'].forEach(function (id) { if (el('media-explorer-' + id).value) params.set(id, el('media-explorer-' + id).value); });
    if (el('media-explorer-sort').value !== 'newest') params.set('sort', el('media-explorer-sort').value);
    if (reverseSort) params.set('direction', 'asc');
  };
})();
