var workingContextState = {
  modelProfileId: 'wan22_t2v'
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

function setWorkingModelProfileId(profileId) {
  var previousProfileId = getWorkingModelProfileId();
  workingContextState.modelProfileId = String(profileId || 'wan22_t2v');
  notifyWorkingModelChanged(previousProfileId);
  return workingContextState.modelProfileId;
}

window.getWorkingModelProfileId = getWorkingModelProfileId;
window.setWorkingModelProfileId = setWorkingModelProfileId;
window.syncWorkingModelProfile = syncWorkingModelProfile;
