
state = {
  folder: '',
  suppressInput: false,
  items: [],
  childFolders: [],
  currentItem: null,
  objectUrl: '',
  mode: 'path',
  dirStack: [],
  listRenderSeq: 0,
  reviewedSet: new Set(),
  focusSet: null,
  flags: {}, // key: file or folder name, value: color string (red/yellow/orange/green)
  ratings: {} // key: media file name, value: integer 1..5
};
// Define global UI object (all static elements)
ui = {
  editorEl: document.getElementById('editor'),
  previewEl: document.getElementById('preview'),
  previewActionsEl: document.getElementById('preview-actions'),
  previewPrimaryActionAEl: document.getElementById('preview-action-primary-a'),
  previewPrimaryActionBEl: document.getElementById('preview-action-primary-b'),
  previewMoreActionsEl: document.getElementById('preview-action-more'),
  mediaListEl: document.getElementById('media-list'),
  filterEl: document.getElementById('media-filter'),
  captionFilterClearAllBtn: document.getElementById('caption-filter-clear-all-btn'),
  advancedFilterToggleBtn: document.getElementById('advanced-filter-toggle-btn'),
  advancedFilterPanel: document.getElementById('advanced-filter-panel'),
  advancedFilterMissingCaptionsEl: document.getElementById('advanced-filter-missing-captions'),
  advancedFilterReviewedEl: document.getElementById('advanced-filter-reviewed'),
  advancedFilterMinStarsEl: document.getElementById('advanced-filter-min-stars'),
  advancedFilterFlagEl: document.getElementById('advanced-filter-flag'),
  advancedFilterInvalidArEl: document.getElementById('advanced-filter-invalid-ar'),
  advancedFilterUnratedEl: document.getElementById('advanced-filter-unrated'),
  captionFilterCount: document.getElementById('caption-filter-count'),
  captionFilterCountTextEl: document.getElementById('caption-filter-count-text'),
  captionFilterCountSeparatorEl: document.getElementById('caption-filter-count-separator'),
  captionFilterRatedSummaryEl: document.getElementById('caption-filter-rated-summary'),
  statusEl: document.getElementById('status-text'),
  upBtn: document.getElementById('up-one-directory-btn'),
  refreshBtn: document.getElementById('refresh-btn'),
  utilityPathFlyoutEl: document.getElementById('utility-path-flyout'),
  utilityCurrentPathBtn: document.getElementById('utility-current-path-btn'),
  utilitySettingsBtn: document.getElementById('utility-settings-btn'),
  utilityRebootBtn: document.getElementById('utility-reboot-btn'),
  utilityHelpBtn: document.getElementById('utility-help-btn'),
  utilitySmartSetBtn: document.getElementById('utility-smart-set-btn'),
  createSetFromResultsBtn: document.getElementById('create-set-from-results-btn'),
  reviewBtn: document.getElementById('review-captions-btn'),
  focusSetExitBtn: document.getElementById('focus-set-exit-btn'),
  currentFolderRow: document.getElementById('current-folder-row'),
  consolePanelEl: document.getElementById('console-panel'),
  appSettingsModalEl: document.getElementById('app-settings-modal'),
  appSettingsCloseBtn: document.getElementById('app-settings-close-btn'),
  appSettingsCancelBtn: document.getElementById('app-settings-cancel-btn'),
  appSettingsSaveBtn: document.getElementById('app-settings-save-btn'),
  appSettingsSaveReloadBtn: document.getElementById('app-settings-save-reload-btn'),
  appSettingsStatusEl: document.getElementById('app-settings-status'),
  appSettingsRootEl: document.getElementById('app-settings-filesystem-root'),
  appSettingsModelsEl: document.getElementById('app-settings-filesystem-models'),
  appSettingsTrainingDiffusionPipeWslEl: document.getElementById('app-settings-training-diffusion-pipe-wsl'),
  appSettingsTrainingActivateScriptEl: document.getElementById('app-settings-training-activate-script'),
  appSettingsTrainingModePocEl: document.getElementById('app-settings-training-mode-poc'),
  appSettingsTrainingModeNormalEl: document.getElementById('app-settings-training-mode-normal'),
  appSettingsTrainingModeQualityEl: document.getElementById('app-settings-training-mode-quality'),
  appSettingsDebugEl: document.getElementById('app-settings-debug'),
  appSettingsJsonEl: document.getElementById('app-settings-json'),
  statsPhrasesEl: document.getElementById('stats-phrases'),
  statsPhrasesItemsEl: document.getElementById('stats-phrases-items'),
  statsPhrasesAddInputEl: document.getElementById('stats-phrases-add-input'),
  statsPhrasesAddBtnEl: document.getElementById('stats-phrases-add-btn'),
  primerMappingsEditBtnEl: document.getElementById('primer-mappings-edit-btn'),
  primerMappingsSummaryEl: document.getElementById('primer-mappings-summary'),
  reviewRulesEditBtnEl: document.getElementById('review-rules-edit-btn'),
  reviewRulesSummaryEl: document.getElementById('review-rules-summary'),
  advancedModalOverlayEl: document.getElementById('advanced-modal-overlay'),
  primerMappingsModalEl: document.getElementById('primer-mappings-modal'),
  primerMappingsModalBodyEl: document.getElementById('primer-mappings-modal-body'),
  primerMappingsSaveBtnEl: document.getElementById('primer-mappings-save-btn'),
  reviewRulesModalEl: document.getElementById('review-rules-modal'),
  reviewRulesModalBodyEl: document.getElementById('review-rules-modal-body'),
  reviewRulesSaveBtnEl: document.getElementById('review-rules-save-btn'),
};

const DEFAULT_CHECKLIST_ITEMS = [
  "Key Phrase",
  "Expression",
  "Position",
  "Action",
  "Clothing",
  "Traits",
  "Setting",
  "Lighting",
  "Viewpoint",
];

const DEFAULT_CHECKLIST_ITEM_KEYWORDS = {
  "Key Phrase": "",
  "Expression": "smiling, frowning, surprised, angry, happy, sad, tired, excited, expression",
  "Position": "left, right, center, top, bottom, foreground, background",
  "Action": "standing, sitting, running, walking, holding, looking, eating, drinking, touching, rubbing",
  "Clothing": "shirt, pants, dress, jacket, coat, shoes, hat, uniform",
  "Traits": "lips, make-up, hair",
  "Setting": "background, theme",
  "Lighting": "lighting, bright, dark, shadow, sunlight, neon, backlit, twilight",
  "Viewpoint": "front, side, back, aerial, close-up, wide shot, low angle, high angle"
};

// Central palette for flag colors (order matters for UI)
const FLAG_COLORS = ['red', 'green', 'blue', 'yellow', 'orange'];

// Set this to true to enable debug logging
var DEBUG = false;
var FOLDER_STATE_VERSION = 1;
var FOLDER_STATE_FILE = '.webcap_state.json';
var IMAGE_EXTENSIONS = { '.jpg': true, '.jpeg': true, '.png': true, '.gif': true, '.webp': true, '.bmp': true };
var MEDIA_EXTENSIONS = {
  '.mp4': true, '.webm': true, '.ogg': true, '.mov': true, '.mkv': true, '.avi': true, '.m4v': true,
  '.jpg': true, '.jpeg': true, '.png': true, '.gif': true, '.webp': true, '.bmp': true
};

// Global variable for the root folder label (set from config)
var ROOT_FOLDER_LABEL = '/';
var ROOT_FOLDER_PATH = '';

// Tokens in this blacklist will be ignored when counting frequency for stats/primer purposes. This is a simple way to filter out common stop words without needing a full NLP pipeline. The list can be expanded as needed.
var TOKEN_BLACKLIST = {
  a: true,
  an: true,
  the: true,
  is: true,
  are: true,
  was: true,
  were: true,
  be: true,
  being: true,
  been: true,
  on: true,
  in: true,
  to: true,
  of: true,
  for: true,
  with: true,
  by: true,
  from: true,
  at: true,
  as: true,
  or: true,
  but: true,
  she: true,
  her: true,
  his: true,
  it: true,
  they: true,
  he: true,
  him: true,
  them: true,
  this: true,
  that: true,
  these: true,
  those: true,
  does: true,
  and: true
};
