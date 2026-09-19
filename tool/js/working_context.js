var workingContextState = {
  modelProfileId: 'wan22_t2v'
};

function workingModelProfileStorageKey(folder) {
  return 'webcap.trainingProfile.' + String(folder || '');
}

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

function syncWorkingModelProfileForFolder(folder, profiles) {
  var availableProfiles = Array.isArray(profiles) ? profiles : [];
  var stored = '';
  try { stored = localStorage.getItem(workingModelProfileStorageKey(folder)) || ''; } catch (err) {}

  var current = getWorkingModelProfileId();
  var next = hasWorkingModelProfile(availableProfiles, stored)
    ? stored
    : (hasWorkingModelProfile(availableProfiles, current)
      ? current
      : (availableProfiles.length ? String(availableProfiles[0].id || '') : current));

  var previousProfileId = getWorkingModelProfileId();
  workingContextState.modelProfileId = next || 'wan22_t2v';
  try {
    localStorage.setItem(workingModelProfileStorageKey(folder), workingContextState.modelProfileId);
  } catch (err) {}
  notifyWorkingModelChanged(previousProfileId);
  return workingContextState.modelProfileId;
}

function setWorkingModelProfileId(profileId, folder) {
  var previousProfileId = getWorkingModelProfileId();
  workingContextState.modelProfileId = String(profileId || 'wan22_t2v');
  try {
    localStorage.setItem(workingModelProfileStorageKey(folder), workingContextState.modelProfileId);
  } catch (err) {}
  notifyWorkingModelChanged(previousProfileId);
  return workingContextState.modelProfileId;
}

window.getWorkingModelProfileId = getWorkingModelProfileId;
window.setWorkingModelProfileId = setWorkingModelProfileId;
window.syncWorkingModelProfileForFolder = syncWorkingModelProfileForFolder;
