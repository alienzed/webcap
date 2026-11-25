// Tag proposals are session-only; neither viewing an item nor opening this panel runs inference.
var singleItemTagAssistDraftsByMedia = {};
var singleItemTagAssistRequestToken = 0;
var singleItemTagAssistRequestPending = false;
var singleItemTagAssistApplyPending = false;

function singleItemTagAssistHasSight(item) {
  var metadata = item && (item.metadata || getMetadataForMedia(item.fileName));
  var sight = metadata && metadata.vision_sight;
  return !!(sight && sight.description && sight.inventory);
}

function singleItemTagAssistReset() {
  singleItemTagAssistDraftsByMedia = {};
  singleItemTagAssistRequestToken += 1;
  singleItemTagAssistRequestPending = false;
  singleItemTagAssistApplyPending = false;
}

function singleItemTagAssistCurrentDraft() {
  var item = state && state.currentItem;
  if (!item || !item.key) return null;
  var draft = singleItemTagAssistDraftsByMedia[item.key];
  return draft && draft.folder === String(state.folder || '') ? draft : null;
}

function singleItemTagAssistPublishCandidates(result, folder) {
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
    singleItemTagAssistDraftsByMedia[mediaItem.key] = {
      folder: String(folder), candidates: candidates
    };
  });
  singleItemTagAssistRefreshUi();
}

function singleItemTagAssistToggleDraftTerm(group, term) {
  var draft = singleItemTagAssistCurrentDraft();
  if (!draft) return;
  var entry = draft.candidates.find(function (candidate) {
    return candidate.group === group && candidate.term === term;
  });
  if (!entry) return;
  entry.selected = !entry.selected;
  singleItemTagAssistRefreshUi();
}

function singleItemTagAssistRefreshUi() {
  var item = state && state.currentItem;
  var bar = document.getElementById('single-item-tag-assist-toolbar');
  if (!bar) throw new Error('Tag Assist toolbar is missing.');
  var visible = !!(item && item.key && workspaceState.surface === 'default');
  bar.classList.toggle('hidden', !visible);
  if (!visible) return;
  var draft = singleItemTagAssistCurrentDraft();
  var suggest = document.getElementById('single-item-tag-assist-suggest');
  var apply = document.getElementById('single-item-tag-assist-apply');
  var discard = document.getElementById('single-item-tag-assist-discard');
  suggest.disabled = singleItemTagAssistRequestPending || singleItemTagAssistApplyPending;
  suggest.textContent = singleItemTagAssistRequestPending ? 'Suggesting…' : 'Suggest Tags';
  var hasProposals = !!(draft && draft.candidates.length);
  apply.classList.toggle('hidden', !hasProposals);
  discard.classList.toggle('hidden', !draft);
  apply.disabled = singleItemTagAssistApplyPending || !hasProposals ||
    !draft.candidates.some(function (candidate) { return candidate.selected; });
  discard.disabled = singleItemTagAssistApplyPending;
  refreshGroupWorkbenchForCurrentItem();
}

function singleItemTagAssistRenderGroupSuggestions(groupEl, requirementLabel, mediaKey) {
  var draft = singleItemTagAssistCurrentDraft();
  if (!draft || !state.currentItem || state.currentItem.key !== mediaKey) return;
  var entries = draft.candidates.filter(function (candidate) {
    return candidate.group === requirementLabel &&
      !hasChecklistAssignedTagForMediaKey(mediaKey, candidate.group, candidate.term);
  });
  if (!entries.length) return;
  var wrap = document.createElement('div');
  wrap.className = 'single-item-tag-assist-group-suggestions';
  var title = document.createElement('span');
  title.className = 'single-item-tag-assist-proposal-label';
  title.textContent = 'Proposed';
  wrap.appendChild(title);
  entries.forEach(function (candidate) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'group-workbench-term-btn single-item-tag-assist-proposal';
    btn.classList.toggle('single-item-tag-assist-proposal-selected', candidate.selected);
    btn.textContent = (candidate.selected ? '✓ ' : '+ ') + candidate.term;
    btn.title = candidate.confidence + ' confidence' + (candidate.why ? ' · ' + candidate.why : '') +
      ' · draft only until Apply Tags';
    btn.setAttribute('aria-pressed', candidate.selected ? 'true' : 'false');
    btn.onclick = function (event) {
      event.stopPropagation();
      singleItemTagAssistToggleDraftTerm(candidate.group, candidate.term);
    };
    wrap.appendChild(btn);
  });
  groupEl.appendChild(wrap);
}

function singleItemTagAssistDiscardProposals() {
  var item = state && state.currentItem;
  if (!item || singleItemTagAssistApplyPending) return;
  delete singleItemTagAssistDraftsByMedia[item.key];
  singleItemTagAssistRefreshUi();
}

function singleItemTagAssistApplyProposals() {
  var item = state && state.currentItem;
  var draft = singleItemTagAssistCurrentDraft();
  if (!item || !draft || singleItemTagAssistApplyPending) return Promise.resolve(false);
  var selected = draft.candidates.filter(function (candidate) { return candidate.selected; });
  if (!selected.length) return Promise.resolve(false);
  var folder = String(state.folder || '');
  var key = item.key;
  // A rejected annotation save must not leave provisional tag edits behind.
  // Preserve the pre-Apply values, including unscoped tags consumed by grouping.
  function snapshotMediaEntry(map) {
    return Object.prototype.hasOwnProperty.call(map, key) ? JSON.parse(JSON.stringify(map[key])) : null;
  }
  var before = {
    assignments: snapshotMediaEntry(checklistAssignmentsByMedia),
    unscoped: snapshotMediaEntry(captionItemTagsByMedia),
    checked: snapshotMediaEntry(checklistCheckedByMedia),
    descriptors: snapshotMediaEntry(checklistTermDescriptorsByMedia),
    descriptorSnapshot: checklistTermDescriptorSnapshotMediaKeys.has(key),
    reviewed: !!(state.reviewedSet && state.reviewedSet.has(key)),
    undoStack: state.undoStack
  };
  var appliedUndoStack = null;
  function rollback() {
    if (folder !== String(state.folder || '')) return;
    function restore(map, value) {
      if (value === null) delete map[key];
      else map[key] = value;
    }
    restore(checklistAssignmentsByMedia, before.assignments);
    restore(captionItemTagsByMedia, before.unscoped);
    restore(checklistCheckedByMedia, before.checked);
    restore(checklistTermDescriptorsByMedia, before.descriptors);
    if (before.descriptorSnapshot) checklistTermDescriptorSnapshotMediaKeys.add(key);
    else checklistTermDescriptorSnapshotMediaKeys.delete(key);
    if (state.reviewedSet) {
      if (before.reviewed) state.reviewedSet.add(key);
      else state.reviewedSet.delete(key);
    }
    if (state.undoStack === appliedUndoStack) state.undoStack = before.undoStack;
    invalidateChecklistRequirementProgress(key);
    refreshTagDrivenPanelsForMediaKey(key);
  }
  singleItemTagAssistApplyPending = true;
  singleItemTagAssistRefreshUi();
  try {
    selected.forEach(function (candidate) {
      if (!hasChecklistAssignedTagForMediaKey(key, candidate.group, candidate.term)) {
        if (!assignChecklistTagToMediaKey(key, candidate.group, candidate.term,
            { skipSave: true, skipRefresh: true })) {
          throw new Error('Could not assign proposed tag: ' + candidate.term);
        }
      }
    });
  } catch (err) {
    appliedUndoStack = state.undoStack;
    rollback();
    singleItemTagAssistApplyPending = false;
    reportConsoleError('Tag Assist · Apply tags', err);
    setStatus('Tag Assist could not apply the selected tags: ' + String(err.message || err));
    singleItemTagAssistRefreshUi();
    return Promise.resolve(false);
  }
  appliedUndoStack = state.undoStack;
  return saveMediaAnnotationState(key).then(function (ok) {
    if (!ok) throw new Error('Could not save proposed tag assignments.');
    if (folder !== String(state.folder || '')) return false;
    delete singleItemTagAssistDraftsByMedia[key];
    refreshTagDrivenPanelsForMediaKey(key);
    return true;
  }).catch(function (err) {
    rollback();
    reportConsoleError('Tag Assist · Apply tags', err);
    setStatus('Tag Assist could not save the selected tags: ' + String(err.message || err));
    return false;
  }).then(function (ok) {
    singleItemTagAssistApplyPending = false;
    singleItemTagAssistRefreshUi();
    return ok;
  });
}

function singleItemTagAssistSuggestCurrentItem() {
  var item = state && state.currentItem;
  if (!item || singleItemTagAssistRequestPending || singleItemTagAssistApplyPending) return;
  var folder = String(state.folder || '');
  var director = String(getDirectorModelPreference() || '');
  var model = String(getCaptionVisionModelId() || '');
  if (!director || !model) {
    setStatus('Select Director and Vision models before suggesting tags.');
    return;
  }
  if (!singleItemTagAssistHasSight(item)) {
    setStatus('No saved Sight for this item. Run the VL scan first.');
    return;
  }
  var token = ++singleItemTagAssistRequestToken;
  singleItemTagAssistRequestPending = true;
  singleItemTagAssistRefreshUi();
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
    if (token !== singleItemTagAssistRequestToken || folder !== String(state.folder || '')) return;
    if (!job.result || !job.result.tagCandidates) throw new Error('Tag Assist returned no candidates.');
    singleItemTagAssistPublishCandidates(job.result.tagCandidates, folder);
    setStatus('Tag suggestions are ready. Select what applies, then Apply Tags.');
  }).catch(function (err) {
    if (token !== singleItemTagAssistRequestToken) return;
    reportConsoleError('Tag Assist · Suggest tags', err);
    setStatus('Could not suggest tags: ' + String(err.message || err));
  }).then(function () {
    if (token === singleItemTagAssistRequestToken) {
      singleItemTagAssistRequestPending = false;
      singleItemTagAssistRefreshUi();
    }
  });
}

function bindSingleItemTagAssistControls() {
  [
    ['single-item-tag-assist-suggest', singleItemTagAssistSuggestCurrentItem],
    ['single-item-tag-assist-apply', singleItemTagAssistApplyProposals],
    ['single-item-tag-assist-discard', singleItemTagAssistDiscardProposals]
  ].forEach(function (entry) {
    var btn = document.getElementById(entry[0]);
    if (!btn) throw new Error('Missing Tag Assist control: ' + entry[0]);
    btn.onclick = entry[1];
  });
}
bindSingleItemTagAssistControls();
