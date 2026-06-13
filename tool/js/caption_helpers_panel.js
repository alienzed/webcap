// Caption helper tab switching and folder-state loading.

function setCaptionHelperTab(tabName) {
  if (tabName !== 'requirements' && tabName !== 'tags' && tabName !== 'analysis' && tabName !== 'metadata') {
    tabName = 'requirements';
  }
  captionHelperActiveTab = tabName;
  document.getElementById('caption-helper-tab-requirements-btn').classList.remove('active');
  document.getElementById('caption-helper-tab-tags-btn').classList.remove('active');
  document.getElementById('caption-helper-tab-analysis-btn').classList.remove('active');
  document.getElementById('caption-helper-tab-metadata-btn').classList.remove('active');
  document.getElementById('caption-helper-tab-requirements').classList.add('hidden');
  document.getElementById('caption-helper-tab-tags').classList.add('hidden');
  document.getElementById('caption-helper-tab-analysis').classList.add('hidden');
  document.getElementById('caption-helper-tab-metadata').classList.add('hidden');
  var tagResults = document.getElementById('tag-term-results');
  if (tagResults) tagResults.classList.add('hidden');

  if (tabName === 'requirements') {
    document.getElementById('caption-helper-tab-requirements-btn').classList.add('active');
    document.getElementById('caption-helper-tab-requirements').classList.remove('hidden');
    return;
  }
  if (tabName === 'tags') {
    document.getElementById('caption-helper-tab-tags-btn').classList.add('active');
    document.getElementById('caption-helper-tab-tags').classList.remove('hidden');
    return;
  }
  if (tabName === 'analysis') {
    document.getElementById('caption-helper-tab-analysis-btn').classList.add('active');
    document.getElementById('caption-helper-tab-analysis').classList.remove('hidden');
    return;
  }
  if (tabName === 'metadata') {
    document.getElementById('caption-helper-tab-metadata-btn').classList.add('active');
    document.getElementById('caption-helper-tab-metadata').classList.remove('hidden');
    return;
  }
}

function loadCaptionHelpersFromFolderState(folderState) {
  captionHelperPhrases = [];
  captionHelperNotes = String(folderState.caption_set_notes || '');
  annotateStripVisible = !!folderState.annotate_strip_visible;
  captionHelperPanelCollapsed = !!folderState.caption_helper_panel_collapsed;
  updateAnnotateStripToggleUi();
  updateCaptionHelperCollapseUi();
  var notesEditor = document.getElementById('set-notes-editor');
  if (notesEditor) {
    notesEditor.value = captionHelperNotes;
  }
  renderAnnotateStrip();
}

window.loadCaptionHelpersFromFolderState = loadCaptionHelpersFromFolderState;
window.setCaptionHelperTab = setCaptionHelperTab;
