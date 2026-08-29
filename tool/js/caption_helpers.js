var captionHelperActiveTab = 'requirements';
var captionHelperPhrases = [];
var captionHelperNotes = '';
var debouncedSetNotesSave = debounceCreate(500);
var annotateStripVisible = false;
var captionHelperPanelCollapsed = false;

function captureCaptionHelpersFolderStateSave() {
  var capturedSave = captureCurrentFolderStateSave();
  if (!capturedSave) return null;
  capturedSave.snapshot.caption_set_notes = captionHelperNotes;
  capturedSave.snapshot.annotate_strip_visible = !!annotateStripVisible;
  capturedSave.snapshot.caption_helper_panel_collapsed = !!captionHelperPanelCollapsed;
  return capturedSave;
}

function saveCaptionHelpersToFolderState(capturedSave) {
  return writeCapturedFolderState(capturedSave || captureCaptionHelpersFolderStateSave());
}
