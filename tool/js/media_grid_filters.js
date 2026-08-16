function mediaGridBuildFilterControls() {
  var els = mediaGridGetEls();
  if (!els.filters) throw new Error('Media Grid filters target is missing.');
  els.filters.innerHTML =
    '<div class="media-grid-filter-bar" aria-label="Grid filters">' +
      '<label class="media-grid-search-field media-grid-search-field-inline">' +
        '<span class="media-grid-filter-label">Search</span>' +
        '<input id="media-grid-filter-search" type="search" placeholder="filter (comma terms, -exclude)">' +
      '</label>' +
      '<label class="media-grid-filter-toggle"><input id="media-grid-filter-unreviewed" type="checkbox"><span>Unreviewed</span></label>' +
      '<label class="media-grid-filter-toggle"><input id="media-grid-filter-invalid-ar" type="checkbox"><span>Invalid AR</span></label>' +
      '<div class="media-grid-filter-divider" aria-hidden="true"></div>' +
      '<div class="media-grid-filter-rating-block">' +
        '<span class="media-grid-filter-subtitle">Stars</span>' +
        '<div id="media-grid-filter-stars" class="media-grid-filter-stars" aria-label="Rating filters"></div>' +
      '</div>' +
      '<div class="media-grid-filter-rating-block">' +
        '<span class="media-grid-filter-subtitle">Flags</span>' +
        '<div id="media-grid-filter-flags" class="media-grid-filter-stars" aria-label="Flag filters"></div>' +
      '</div>' +
      '<span id="media-grid-other-filters" class="media-grid-other-filters hidden">Other list filters active</span>' +
    '</div>';

  mediaGridBuildStarsFilter();
  mediaGridBuildFlagsFilter();

  var searchInput = document.getElementById('media-grid-filter-search');
  var unreviewedInput = document.getElementById('media-grid-filter-unreviewed');
  var invalidArInput = document.getElementById('media-grid-filter-invalid-ar');
  if (!searchInput || !unreviewedInput || !invalidArInput) {
    throw new Error('Media Grid mirrored filter controls are missing.');
  }

  searchInput.addEventListener('input', function () {
    ui.filterEl.value = this.value;
    mediaGridDispatchInput(ui.filterEl);
  });
  unreviewedInput.addEventListener('change', function () {
    ui.advancedFilterUnreviewedEl.checked = this.checked;
    mediaGridDispatchChange(ui.advancedFilterUnreviewedEl);
  });
  invalidArInput.addEventListener('change', function () {
    ui.advancedFilterInvalidArEl.checked = this.checked;
    mediaGridDispatchChange(ui.advancedFilterInvalidArEl);
  });
}

function mediaGridBuildStarsFilter(targetId, buttonClassName) {
  var target = document.getElementById(targetId || 'media-grid-filter-stars');
  if (!target) return;
  target.innerHTML = '';
  var values = ['no_star', '1', '2', '3', '4', '5'];
  values.forEach(function (value) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = buttonClassName || 'media-grid-filter-chip media-grid-filter-star';
    btn.setAttribute('data-filter-value', value);
    btn.textContent = value === 'no_star' ? '-' : '\u2605' + value;
    btn.title = value === 'no_star' ? 'Show unrated items' : 'Show ' + value + ' star items';
    btn.onclick = function () {
      mediaGridToggleMirroredCheckbox(ui.advancedFilterStarsEl, value);
    };
    target.appendChild(btn);
  });
}

function mediaGridBuildSurfaceFilterControls() {
  var target = document.getElementById('media-grid-surface-filters');
  if (!target) throw new Error('Media Grid surface filters target is missing.');
  target.innerHTML =
    '<input id="media-grid-surface-filter-search" class="media-grid-surface-filter-search" type="search" placeholder="filter…" aria-label="Filter media">' +
    '<label class="media-grid-surface-filter-toggle">' +
      '<input id="media-grid-surface-filter-invalid-ar" type="checkbox">' +
      '<span>Invalid AR</span>' +
    '</label>' +
    '<div class="media-grid-surface-stars" aria-label="Rating filters">' +
      '<div id="media-grid-surface-filter-stars" class="media-grid-surface-star-values"></div>' +
    '</div>';
  mediaGridBuildStarsFilter('media-grid-surface-filter-stars', 'media-grid-surface-star-filter');

  var searchInput = document.getElementById('media-grid-surface-filter-search');
  var invalidArInput = document.getElementById('media-grid-surface-filter-invalid-ar');
  if (!searchInput || !invalidArInput) throw new Error('Media Grid surface filter controls are missing.');
  searchInput.addEventListener('input', function () {
    ui.filterEl.value = this.value;
    mediaGridDispatchInput(ui.filterEl);
  });
  invalidArInput.addEventListener('change', function () {
    ui.advancedFilterInvalidArEl.checked = this.checked;
    mediaGridDispatchChange(ui.advancedFilterInvalidArEl);
  });
}

function mediaGridBuildFlagsFilter() {
  var target = document.getElementById('media-grid-filter-flags');
  if (!target) return;
  target.innerHTML = '';
  var defs = [
    { value: 'no_flag', title: 'Show items with no flag', text: '-' },
    { value: 'red', title: 'Show red-flagged items', dot: 'red' },
    { value: 'green', title: 'Show green-flagged items', dot: 'green' },
    { value: 'blue', title: 'Show blue-flagged items', dot: 'blue' },
    { value: 'yellow', title: 'Show yellow-flagged items', dot: 'yellow' },
    { value: 'orange', title: 'Show orange-flagged items', dot: 'orange' }
  ];
  defs.forEach(function (def) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'media-grid-filter-chip media-grid-filter-flag';
    btn.setAttribute('data-filter-value', def.value);
    btn.title = def.title;
    if (def.dot) {
      btn.innerHTML = '<span class="flag-dot flag-dot--' + def.dot + '"></span>';
    } else {
      btn.textContent = def.text;
    }
    btn.onclick = function () {
      mediaGridToggleMirroredCheckbox(ui.advancedFilterFlagEl, def.value);
    };
    target.appendChild(btn);
  });
}

function mediaGridToggleMirroredCheckbox(sourceEl, value) {
  var input = sourceEl.querySelector('input[value="' + String(value).replace(/"/g, '\\"') + '"]');
  if (!input) throw new Error('Media Grid filter source is missing: ' + value);
  input.checked = !input.checked;
  mediaGridDispatchChange(input);
}

function mediaGridDispatchInput(el) {
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function mediaGridDispatchChange(el) {
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function mediaGridSyncFilterControls() {
  var searchInput = document.getElementById('media-grid-filter-search');
  var unreviewedInput = document.getElementById('media-grid-filter-unreviewed');
  var invalidArInput = document.getElementById('media-grid-filter-invalid-ar');
  if (!searchInput || !unreviewedInput || !invalidArInput) return;
  searchInput.value = String(ui.filterEl.value || '');
  unreviewedInput.checked = !!ui.advancedFilterUnreviewedEl.checked;
  invalidArInput.checked = !!ui.advancedFilterInvalidArEl.checked;
  mediaGridSyncFilterToggle('media-grid-filter-unreviewed');
  mediaGridSyncFilterToggle('media-grid-filter-invalid-ar');
  mediaGridSyncFilterChipGroup('media-grid-filter-stars', getAdvancedStarFilterValues());
  mediaGridSyncFilterChipGroup('media-grid-filter-flags', getAdvancedFlagFilterValues());
  var hiddenFiltersActive = !!(
    ui.advancedFilterMissingCaptionsEl.checked ||
    ui.advancedFilterReviewedEl.checked ||
    ui.advancedFilterIncompleteEl.checked ||
    ui.advancedFilterUntaggedEl.checked ||
    ui.advancedFilterPruneCandidatesEl.checked ||
    ui.advancedFilterSupersetEl.checked
  );
  var otherFiltersHint = document.getElementById('media-grid-other-filters');
  if (otherFiltersHint) {
    otherFiltersHint.classList.toggle('hidden', !hiddenFiltersActive);
  }
  mediaGridSyncSurfaceFilterControls();
}

function mediaGridSyncSurfaceFilterControls() {
  var searchInput = document.getElementById('media-grid-surface-filter-search');
  var invalidArInput = document.getElementById('media-grid-surface-filter-invalid-ar');
  if (!searchInput || !invalidArInput) return;
  searchInput.value = String(ui.filterEl.value || '');
  invalidArInput.checked = !!ui.advancedFilterInvalidArEl.checked;
  var invalidArToggle = invalidArInput.closest('.media-grid-surface-filter-toggle');
  if (invalidArToggle) invalidArToggle.classList.toggle('active', invalidArInput.checked);
  mediaGridSyncFilterChipGroup('media-grid-surface-filter-stars', getAdvancedStarFilterValues());
}

function mediaGridSyncFilterToggle(inputId) {
  var input = document.getElementById(inputId);
  var label = input ? input.closest('.media-grid-filter-toggle') : null;
  if (label) label.classList.toggle('active', !!input.checked);
}

function mediaGridSyncFilterChipGroup(containerId, activeValues) {
  var active = {};
  activeValues.forEach(function (value) {
    active[String(value)] = true;
  });
  var container = document.getElementById(containerId);
  if (!container) return;
  var buttons = container.querySelectorAll('[data-filter-value]');
  for (var i = 0; i < buttons.length; i++) {
    var value = buttons[i].getAttribute('data-filter-value');
    buttons[i].classList.toggle('active', !!active[value]);
  }
}

function mediaGridSetRailCollapsed(collapsed) {
  mediaGridState.railCollapsed = !!collapsed;
  renderMediaGridLeftRail();
}

function mediaGridRenderFocusList() {
  var els = mediaGridGetEls();
  if (!els.focusList) return;
  els.focusList.innerHTML = '';
  var activeSet = mediaGridGetActiveFocusSet();
  (mediaGridState.focusSets || []).filter(function (entry) {
    return entry && entry.count > 0;
  }).forEach(function (entry) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'media-grid-focus-btn' + (activeSet && activeSet.key === entry.key ? ' active' : '');
    btn.title = entry.tooltip;
    btn.onclick = function () {
      mediaGridState.focusSetKey = entry.key;
      renderMediaGridModal();
    };

    var labelWrap = document.createElement('span');
    labelWrap.className = 'media-grid-focus-btn-main';
    var label = document.createElement('span');
    label.className = 'media-grid-focus-btn-label';
    label.textContent = entry.label;
    labelWrap.appendChild(label);
    btn.appendChild(labelWrap);

    var count = document.createElement('span');
    count.className = 'media-grid-focus-btn-count';
    count.textContent = String(entry.count);
    btn.appendChild(count);

    els.focusList.appendChild(btn);
  });
}

function renderMediaGridLeftRail() {
  var els = mediaGridGetEls();
  if (!els.rail || !els.railCollapseBtn) return;
  els.rail.classList.toggle('is-collapsed', !!mediaGridState.railCollapsed);
  els.railHint.textContent = mediaGridState.baseItems.length + ' visible in ' + mediaGridGetSourceLabel();
  els.railCollapseBtn.textContent = mediaGridState.railCollapsed ? '>' : '<';
  els.railCollapseBtn.title = mediaGridState.railCollapsed ? 'Expand left rail' : 'Collapse left rail';
  els.railCollapseBtn.setAttribute('aria-label', mediaGridState.railCollapsed ? 'Expand left rail' : 'Collapse left rail');
  els.focusMeta.textContent = mediaGridState.baseItems.length + ' visible';
  var loading = typeof isMediaMetadataLoading === 'function' && isMediaMetadataLoading();
  els.focusLoading.textContent = loading ? 'Metadata-driven sets will sharpen as analysis finishes.' : '';
  els.focusLoading.classList.toggle('hidden', !loading);
  mediaGridRenderFocusList();
}

function renderMediaGridActiveScope() {
  var els = mediaGridGetEls();
  if (!els.activeSet) return;
  els.activeSet.innerHTML = '';
  var activeSet = mediaGridGetActiveFocusSet();
  if (!activeSet) return;

  var titleWrap = document.createElement('div');
  titleWrap.className = 'media-grid-active-set-copy';

  var title = document.createElement('div');
  title.className = 'media-grid-active-set-title';
  title.textContent = activeSet.label;
  title.title = activeSet.tooltip;
  titleWrap.appendChild(title);

  var meta = document.createElement('div');
  meta.className = 'media-grid-active-set-meta';
  if (activeSet.key === 'all') {
    meta.textContent = mediaGridState.items.length + ' visible in the current working scope';
  } else {
    meta.textContent = mediaGridState.items.length + ' of ' + mediaGridState.baseItems.length + ' visible match this focus set';
  }
  titleWrap.appendChild(meta);
  els.activeSet.appendChild(titleWrap);

  var scopeBadge = document.createElement('div');
  scopeBadge.className = 'media-grid-active-set-badge';
  scopeBadge.textContent = mediaGridGetSourceLabel();
  els.activeSet.appendChild(scopeBadge);
}
