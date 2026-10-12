// One explicit human validation receipt shared by all annotation/caption workflows.
// Tag proposals are session-only; neither viewing an item nor opening this panel runs inference.
var aiValidationReceiptsByMedia = {};
var aiValidationDraftsByMedia = {};
var aiValidationRequestToken = 0;
var aiValidationRequestPending = false;

function aiValidationFingerprint(value) {
  var text = String(value || '');
  var first = 2166136261;
  var second = 2246822519;
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 3266489917);
  }
  return text.length + ':' + (first >>> 0).toString(16) + ':' + (second >>> 0).toString(16);
}

function aiValidationCurrentInput(item) {
  if (!item || !item.key) return '';
  var entries = getChecklistAssignmentEntriesForMediaKey(item.key).map(function (entry) {
    return [String(entry.requirement || '').toLowerCase(), String(entry.term || '').toLowerCase()];
  }).sort(function (a, b) {
    return JSON.stringify(a).localeCompare(JSON.stringify(b));
  });
  var other = getUnscopedTagsForMediaKey(item.key).map(function (tag) {
    return String(tag || '').trim().toLowerCase();
  }).sort();
  return aiValidationFingerprint(JSON.stringify([
    String(item.caption || '').trim(), entries, other
  ]));
}

function aiValidationSightInput(item) {
  var metadata = item && (item.metadata || getMetadataForMedia(item.fileName));
  var sight = metadata && metadata.vision_sight;
  if (!sight || !sight.description || !sight.inventory) return '';
  return aiValidationFingerprint(JSON.stringify([sight.description, sight.inventory]));
}

function isAiValidatedForItem(item) {
  if (!item || !item.key) return false;
  var receipt = aiValidationReceiptsByMedia[item.key];
  if (!receipt || receipt.version !== 1 || receipt.content !== aiValidationCurrentInput(item)) return false;
  var sightInput = aiValidationSightInput(item);
  // Media metadata may still be loading. Do not revoke approval on a transient absence.
  return !sightInput || receipt.sight === sightInput;
}

function aiValidationRestoreReceipts(receipts) {
  aiValidationReceiptsByMedia = {};
  aiValidationDraftsByMedia = {};
  aiValidationRequestToken += 1;
  aiValidationRequestPending = false;
  Object.keys(receipts && typeof receipts === 'object' ? receipts : {}).forEach(function (key) {
    var row = receipts[key];
    if (row && row.version === 1 && typeof row.content === 'string' && typeof row.sight === 'string') {
      aiValidationReceiptsByMedia[key] = { version: 1, content: row.content, sight: row.sight };
    }
  });
}

function aiValidationCurrentDraft() {
  var item = state && state.currentItem;
  if (!item || !item.key) return null;
  var draft = aiValidationDraftsByMedia[item.key];
  return draft && draft.folder === String(state.folder || '') ? draft : null;
}

function aiValidationPublishCandidates(result, folder) {
  if (String(folder || '') !== String(state.folder || '')) return;
  (result && Array.isArray(result.items) ? result.items : []).forEach(function (row) {
    var mediaItem = (state.items || []).find(function (item) {
      return item && item.fileName === row.file;
    });
    if (!mediaItem) return;
    var candidates = (Array.isArray(row.candidates) ? row.candidates : []).filter(function (candidate) {
      return candidate && candidate.existing &&
        getChecklistKeywordTermsForRequirement(candidate.group).some(function (term) {
          return String(term).toLowerCase() === String(candidate.term || '').toLowerCase();
        }) &&
        !hasChecklistAssignedTagForMediaKey(mediaItem.key, candidate.group, candidate.term);
    }).map(function (candidate) {
      return {
        group: String(candidate.group), term: String(candidate.term),
        confidence: String(candidate.confidence || ''), why: String(candidate.why || ''),
        selected: candidate.confidence === 'high'
      };
    });
    aiValidationDraftsByMedia[mediaItem.key] = {
      folder: String(folder), candidates: candidates
    };
  });
  aiValidationRefreshUi();
}

function aiValidationToggleDraftTerm(group, term) {
  var draft = aiValidationCurrentDraft();
  if (!draft) return;
  var entry = draft.candidates.find(function (candidate) {
    return candidate.group === group && candidate.term === term;
  });
  if (!entry) return;
  entry.selected = !entry.selected;
  aiValidationRefreshUi();
}

function aiValidationRefreshUi() {
  var item = state && state.currentItem;
  var bar = document.getElementById('ai-validation-toolbar');
  if (!bar) throw new Error('AI validation toolbar is missing.');
  var visible = !!(item && item.key && workspaceState.surface === 'default');
  bar.classList.toggle('hidden', !visible);
  if (!visible) return;
  var draft = aiValidationCurrentDraft();
  var status = document.getElementById('ai-validation-status');
  var suggest = document.getElementById('ai-validation-suggest');
  var apply = document.getElementById('ai-validation-apply');
  var discard = document.getElementById('ai-validation-discard');
  var validate = document.getElementById('ai-validation-complete');
  status.textContent = isAiValidatedForItem(item) ? 'AI Validated' : 'Needs AI validation';
  suggest.disabled = aiValidationRequestPending;
  suggest.textContent = aiValidationRequestPending ? 'Suggesting…' : 'Suggest Tags';
  var hasProposals = !!(draft && draft.candidates.length);
  apply.classList.toggle('hidden', !hasProposals);
  discard.classList.toggle('hidden', !draft);
  apply.disabled = !hasProposals || !draft.candidates.some(function (candidate) { return candidate.selected; });
  validate.disabled = aiValidationRequestPending;
  refreshGroupWorkbenchForCurrentItem();
}

function aiValidationRenderGroupSuggestions(groupEl, requirementLabel, mediaKey) {
  var draft = aiValidationCurrentDraft();
  if (!draft || !state.currentItem || state.currentItem.key !== mediaKey) return;
  var entries = draft.candidates.filter(function (candidate) {
    return candidate.group === requirementLabel &&
      !hasChecklistAssignedTagForMediaKey(mediaKey, candidate.group, candidate.term);
  });
  if (!entries.length) return;
  var wrap = document.createElement('div');
  wrap.className = 'ai-validation-group-suggestions';
  var title = document.createElement('span');
  title.className = 'ai-validation-proposal-label';
  title.textContent = 'Proposed';
  wrap.appendChild(title);
  entries.forEach(function (candidate) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'group-workbench-term-btn ai-validation-proposal';
    btn.classList.toggle('ai-validation-proposal-selected', candidate.selected);
    btn.textContent = (candidate.selected ? '✓ ' : '+ ') + candidate.term;
    btn.title = candidate.confidence + ' confidence' + (candidate.why ? ' · ' + candidate.why : '') +
      ' · draft only until Apply Tags';
    btn.setAttribute('aria-pressed', candidate.selected ? 'true' : 'false');
    btn.onclick = function (event) {
      event.stopPropagation();
      aiValidationToggleDraftTerm(candidate.group, candidate.term);
    };
    wrap.appendChild(btn);
  });
  groupEl.appendChild(wrap);
}

function aiValidationDiscardProposals() {
  var item = state && state.currentItem;
  if (!item) return;
  delete aiValidationDraftsByMedia[item.key];
  aiValidationRefreshUi();
}

function aiValidationApplyProposals() {
  var item = state && state.currentItem;
  var draft = aiValidationCurrentDraft();
  if (!item || !draft) return;
  var selected = draft.candidates.filter(function (candidate) { return candidate.selected; });
  if (!selected.length) return;
  selected.forEach(function (candidate) {
    if (!hasChecklistAssignedTagForMediaKey(item.key, candidate.group, candidate.term)) {
      assignChecklistTagToMediaKey(item.key, candidate.group, candidate.term,
        { skipSave: true, skipRefresh: true });
    }
  });
  delete aiValidationDraftsByMedia[item.key];
  saveMediaAnnotationState(item.key).then(function (ok) {
    if (!ok) throw new Error('Could not save proposed tag assignments.');
    refreshTagDrivenPanelsForMediaKey(item.key);
    aiValidationRefreshUi();
  }).catch(function (err) {
    reportConsoleError('AI Validation · Apply tags', err);
    setStatus('AI Validation could not save the selected tags: ' + err.message);
  });
}

function aiValidationSuggestCurrentItem() {
  var item = state && state.currentItem;
  if (!item || aiValidationRequestPending) return;
  var folder = String(state.folder || '');
  var director = String(getDirectorModelPreference() || '');
  var model = String(getCaptionVisionModelId() || '');
  if (!director || !model) {
    setStatus('Select Director and Vision models before suggesting tags.');
    return;
  }
  if (!aiValidationSightInput(item)) {
    setStatus('No saved Sight for this item. Run the VL scan first.');
    return;
  }
  var token = ++aiValidationRequestToken;
  aiValidationRequestPending = true;
  aiValidationRefreshUi();
  var groups = checklistItems.map(function (group) {
    return { group: group, alias: getRequirementGroupAlias(group),
      terms: getChecklistKeywordTermsForRequirement(group) };
  });
  var current = {};
  current[item.fileName] = getChecklistAssignmentEntriesForMediaKey(item.key).map(function (entry) {
    return { group: entry.requirement, term: entry.term };
  });
  fetch('/fs/vision_schema', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operation: 'suggest_tags', folder: folder, visionModel: model, directorModel: director,
      files: [item.fileName], existingGroups: groups,
      captionTemplate: String(statsGetPrimerOptionsFromDom().template || ''),
      currentAssignments: current, existingOnly: true
    })
  }).then(function (response) {
    return response.json().then(function (payload) {
      if (!response.ok || !payload || payload.ok === false) {
        throw new Error(payload && payload.error || 'Tag suggestion request failed.');
      }
      return payload;
    });
  }).then(function (payload) {
    if (!payload.job || !payload.job.jobId) throw new Error('Tag Assist returned no job.');
    return waitForCaptionAssistJob(payload.job);
  }).then(function (job) {
    if (token !== aiValidationRequestToken || folder !== String(state.folder || '')) return;
    if (!job.result || !job.result.tagCandidates) throw new Error('Tag Assist returned no candidates.');
    aiValidationPublishCandidates(job.result.tagCandidates, folder);
    setStatus('Tag suggestions are ready. Select what applies, then Apply Tags.');
  }).catch(function (err) {
    if (token !== aiValidationRequestToken) return;
    reportConsoleError('AI Validation · Suggest tags', err);
    setStatus('Could not suggest tags: ' + String(err.message || err));
  }).then(function () {
    if (token === aiValidationRequestToken) {
      aiValidationRequestPending = false;
      aiValidationRefreshUi();
    }
  });
}

function aiValidationCompleteCurrentItem() {
  var item = state && state.currentItem;
  if (!item || aiValidationRequestPending) return;
  var draft = aiValidationCurrentDraft();
  if (draft && draft.candidates.some(function (candidate) { return candidate.selected; })) {
    setStatus('Apply or discard the selected tag proposals before validating.');
    return;
  }
  var folder = String(state.folder || '');
  var key = item.key;
  var next = null;
  var visible = getFilteredMediaItems(false);
  var idx = visible.findIndex(function (candidate) { return candidate.key === key; });
  if (idx >= 0 && visible.length > 1) next = visible[(idx + 1) % visible.length];
  var caption = String(ui.editorEl.value || '');
  if (!caption.trim()) {
    setStatus('Save a caption before marking this item AI Validated.');
    return;
  }
  var button = document.getElementById('ai-validation-complete');
  button.disabled = true;
  cancelEditorAutosaveForCaption(folder, item.fileName);
  saveCaptionDirect(folder, item.fileName, caption, key, { skipRenderFileList: true }).then(function () {
    if (folder !== String(state.folder || '') || !state.currentItem || state.currentItem.key !== key) {
      throw new Error('The selected Set or item changed during validation.');
    }
    aiValidationReceiptsByMedia[key] = {
      version: 1, content: aiValidationCurrentInput(item), sight: aiValidationSightInput(item)
    };
    delete aiValidationDraftsByMedia[key];
    return saveFolderStateForCurrentRoot().then(function (ok) {
      if (!ok) throw new Error('Could not persist the AI validation receipt.');
    });
  }).then(function () {
    renderFileList();
    if (next && getFilteredMediaItems(false).some(function (row) { return row.key === next.key; })) {
      return selectPathMedia(next);
    }
    setStatus('AI Validated. No further matching items remain.');
  }).catch(function (err) {
    delete aiValidationReceiptsByMedia[key];
    reportConsoleError('AI Validation · Complete', err);
    setStatus('AI Validation failed: ' + String(err.message || err));
  }).then(aiValidationRefreshUi);
}

function aiValidationVocabularyMutated(mutations, schema, analysis) {
  var evidence = analysis && Array.isArray(analysis.evidence) ? analysis.evidence : [];
  var byId = {};
  evidence.forEach(function (row) { byId[String(row.id || '')] = row; });
  (mutations || []).forEach(function (mutation) {
    var group = String(mutation.group || '').toLowerCase();
    (mutation.terms || []).forEach(function (term) {
      (schema && Array.isArray(schema.groups) ? schema.groups : []).forEach(function (proposal) {
        var label = String(proposal.targetGroup || proposal.name || '').toLowerCase();
        if (label !== group) return;
        (proposal.terms || []).forEach(function (suggested) {
          if (String(suggested.term || '').toLowerCase() !== String(term).toLowerCase()) return;
          (suggested.evidenceIds || []).forEach(function (id) {
            var row = byId[String(id)];
            (row && row.media || []).forEach(function (file) {
              delete aiValidationReceiptsByMedia[String(file)];
            });
          });
        });
      });
    });
  });
}

function bindAiValidationControls() {
  [
    ['ai-validation-suggest', aiValidationSuggestCurrentItem],
    ['ai-validation-apply', aiValidationApplyProposals],
    ['ai-validation-discard', aiValidationDiscardProposals],
    ['ai-validation-complete', aiValidationCompleteCurrentItem]
  ].forEach(function (entry) {
    var btn = document.getElementById(entry[0]);
    if (!btn) throw new Error('Missing AI validation control: ' + entry[0]);
    btn.onclick = entry[1];
  });
}
bindAiValidationControls();
