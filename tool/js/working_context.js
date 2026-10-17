var workingContextState = {
  modelProfileId: 'wan22_t2v',
  selectionVersion: 0,
  saveQueue: Promise.resolve()
};

function getWorkingModelProfileId() {
  return String(workingContextState.modelProfileId || 'wan22_t2v');
}

function notifyWorkingModelChanged(previousProfileId) {
  var currentProfileId = getWorkingModelProfileId();
  if (String(previousProfileId || '') === currentProfileId) return;
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('webcap:working-model-changed', {
      detail: { profileId: currentProfileId }
    }));
  }
}

function hasWorkingModelProfile(profiles, profileId) {
  var id = String(profileId || '');
  return !!id && (Array.isArray(profiles) ? profiles : []).some(function (profile) {
    return profile && profile.id === id;
  });
}

function syncWorkingModelProfile(profiles) {
  var availableProfiles = Array.isArray(profiles) ? profiles : [];
  var current = getWorkingModelProfileId();
  var next = hasWorkingModelProfile(availableProfiles, current)
    ? current
    : (availableProfiles.length ? String(availableProfiles[0].id || '') : current);

  var previousProfileId = getWorkingModelProfileId();
  workingContextState.modelProfileId = next || 'wan22_t2v';
  notifyWorkingModelChanged(previousProfileId);
  return workingContextState.modelProfileId;
}

function persistWorkingModelProfile(profileId) {
  // Serialize rapid changes; only explicit user selections write settings.
  workingContextState.saveQueue = workingContextState.saveQueue.catch(function () {}).then(function () {
    return fetch('/app/config/working_model_profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: profileId })
    }).then(function (response) {
      if (!response.ok) throw new Error('Could not save Base Model preference (' + response.status + ').');
    });
  }).catch(function (err) {
    if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Base Model preference', err);
    else console.error('[Base Model preference]', err);
  });
}

function restoreWorkingModelProfile() {
  var startedAtVersion = workingContextState.selectionVersion;
  fetch('/app/config').then(function (response) {
    if (!response.ok) throw new Error('Could not load Base Model preference.');
    return response.json();
  }).then(function (config) {
    if (workingContextState.selectionVersion !== startedAtVersion) return;
    var saved = String(config.working_model_profile || '').trim();
    if (!saved) return;
    var profiles = typeof trainingWorkspaceState !== 'undefined' ? trainingWorkspaceState.profiles : [];
    if (Array.isArray(profiles) && profiles.length && !hasWorkingModelProfile(profiles, saved)) return;
    var previousProfileId = getWorkingModelProfileId();
    workingContextState.modelProfileId = saved;
    notifyWorkingModelChanged(previousProfileId);
    if (typeof window.refreshWorkingModelSelector === 'function') {
      window.refreshWorkingModelSelector().catch(function (err) {
        console.error('[Base Model preference] Could not refresh selector:', err);
      });
    }
  }).catch(function (err) {
    console.error('[Base Model preference]', err);
  });
}

function setWorkingModelProfileId(profileId) {
  var previousProfileId = getWorkingModelProfileId();
  workingContextState.modelProfileId = String(profileId || 'wan22_t2v');
  if (workingContextState.modelProfileId !== previousProfileId) {
    workingContextState.selectionVersion += 1;
    persistWorkingModelProfile(workingContextState.modelProfileId);
  }
  notifyWorkingModelChanged(previousProfileId);
  return workingContextState.modelProfileId;
}

window.getWorkingModelProfileId = getWorkingModelProfileId;
window.setWorkingModelProfileId = setWorkingModelProfileId;
window.syncWorkingModelProfile = syncWorkingModelProfile;

restoreWorkingModelProfile();
