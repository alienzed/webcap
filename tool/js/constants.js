
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
  ratings: {}, // key: media file name, value: integer 1..5
  mutatedSet: new Set(), // key: media file name
  mutatedByMediaSource: {}, // key: media file name, value: 'best_effort' | 'deterministic'
  mutationStatusSeq: 0
};
// Define global UI object (all static elements)
ui = {
  editorEl: document.getElementById('editor'),
  editorApplyPrimerBtn: document.getElementById('editor-apply-primer-btn'),
  previewEl: document.getElementById('preview'),
  previewActionsEl: document.getElementById('preview-actions'),
  previewMutationIndicatorEl: document.getElementById('preview-mutation-indicator'),
  previewPrimaryActionAEl: document.getElementById('preview-action-primary-a'),
  previewPrimaryActionBEl: document.getElementById('preview-action-primary-b'),
  previewMoreActionsEl: document.getElementById('preview-action-more'),
  mediaListEl: document.getElementById('media-list'),
  filterEl: document.getElementById('media-filter'),
  captionFilterClearAllBtn: document.getElementById('caption-filter-clear-all-btn'),
  advancedFilterToggleBtn: document.getElementById('advanced-filter-toggle-btn'),
  advancedFilterPanel: document.getElementById('advanced-filter-panel'),
  advancedFilterInfoBtn: document.getElementById('advanced-filter-info-btn'),
  advancedFilterMissingCaptionsEl: document.getElementById('advanced-filter-missing-captions'),
  advancedFilterReviewedEl: document.getElementById('advanced-filter-reviewed'),
  advancedFilterUnreviewedEl: document.getElementById('advanced-filter-unreviewed'),
  advancedFilterStarsEl: document.getElementById('advanced-filter-stars'),
  advancedFilterFlagEl: document.getElementById('advanced-filter-flag'),
  advancedFilterInvalidArEl: document.getElementById('advanced-filter-invalid-ar'),
  advancedFilterUntaggedEl: document.getElementById('advanced-filter-untagged'),
  advancedFilterIncompleteEl: document.getElementById('advanced-filter-incomplete'),
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

// Mappings defaults live in one place so behavior can be reasoned about and tuned consistently.
const MAPPINGS_SYSTEM_DEFAULTS = {
  requirements: {
    items: [
      "Position",
      "Viewpoint",
      "Expression",
      "Action",
      "Clothing",
      "Traits",
      "Setting",
      "Jewelry",
      "Surface",
      "Hair",
      "Limbs",
      "Lighting"
    ],
    keywordsByItem: {
      "Position": "crouching, folded, kneeling, kneeling sitting, leaning back, leaning downward, leaning forward, leaning to the side, lying on her back, lying on her side, on all fours, posing, side sitting, sitting, squatting, standing, upside down",
      "Viewpoint": "close-up,front, low-position, medium close-up, overhead, portrait, rear, side, three-quarter, three-quarter rear",
      "Expression": "closed-mouth smile, excited, faint smile, happy, neutral expression, sad, smiling, surprised, serious, smirking, upset",
      "Action": "standing, sitting, running, walking, holding, looking, eating, drinking, touching, rubbing",
      "Clothing": "shirt, pants, dress, jacket, coat, shoes, hat, uniform, skirt, shorts, suit, tie, swimsuit, high-heels, boots, sneakers,",
      "Traits": "lipstick, make-up, styled hair, lip gloss, glistening skin, painted nails",
      "Setting": "photo studio, bedroom, living room, kitchen, office, outdoors", 
      "Jewelry": "necklace, earrings, bracelet, ring, watch, tiara, anklet",
      "Surface": "bed, chair, couch, floor, table, ground, grass, sand, water",
      "Hair": "braided hair, curly hair, hair covering face, long hair, pigtails, ponytail, short hair, styled hair, straight hair, updo, wavy hair",
      "Limbs": "arms crossed, arms spread, arms up, hand on head, hand on hip, knees drawn up, legs crossed, legs spread, one arm down, one arm up, one leg crossed over the other, one leg up",
      "Lighting": "bright, bright background, candle, dark, dim, natural, neon, shadows, studio, sunlight, window"
    }
  },
  primer: {
    requirementDefaultScope: "tag",
    keyAliases: {
      "key phrase": "subject",
      "viewpoint": "view"
    }
  }
};

// Legacy aliases retained to avoid broad churn while we migrate callsites.
const DEFAULT_CHECKLIST_ITEMS = MAPPINGS_SYSTEM_DEFAULTS.requirements.items;
const DEFAULT_CHECKLIST_ITEM_KEYWORDS = MAPPINGS_SYSTEM_DEFAULTS.requirements.keywordsByItem;
const DEFAULT_REQUIREMENT_PRIMER_KEY_ALIASES = MAPPINGS_SYSTEM_DEFAULTS.primer.keyAliases;

function normalizeRequirementDefaultsItemLabel(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function getConfigRequirementDefaultsBlock() {
  var cfg = (window && window.APP_CONFIG && typeof window.APP_CONFIG === 'object') ? window.APP_CONFIG : {};
  var req = (cfg && cfg.requirements && typeof cfg.requirements === 'object') ? cfg.requirements : null;
  return req;
}

function getDefaultRequirementItems() {
  var req = getConfigRequirementDefaultsBlock();
  var source = (req && Array.isArray(req.items) && req.items.length)
    ? req.items
    : DEFAULT_CHECKLIST_ITEMS;
  var out = [];
  var seen = {};
  source.forEach(function (raw) {
    var label = normalizeRequirementDefaultsItemLabel(raw);
    var key = label.toLowerCase();
    if (!label || seen[key]) return;
    seen[key] = true;
    out.push(label);
  });
  return out;
}

function getDefaultRequirementKeywordsByItem() {
  var out = {};
  Object.keys(DEFAULT_CHECKLIST_ITEM_KEYWORDS || {}).forEach(function (key) {
    var label = normalizeRequirementDefaultsItemLabel(key);
    if (!label) return;
    out[label] = String(DEFAULT_CHECKLIST_ITEM_KEYWORDS[key] || '').trim();
  });
  var req = getConfigRequirementDefaultsBlock();
  if (req && req.keywordsByItem && typeof req.keywordsByItem === 'object') {
    Object.keys(req.keywordsByItem).forEach(function (key) {
      var label = normalizeRequirementDefaultsItemLabel(key);
      if (!label) return;
      out[label] = String(req.keywordsByItem[key] || '').trim();
    });
  }
  return out;
}

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
