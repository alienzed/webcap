function mediaGridBuildStarsFilter(targetId, buttonClassName) {
  var target = document.getElementById(targetId);
  if (!target) throw new Error('Media Grid surface rating filters target is missing.');
  target.innerHTML = '';
  var values = ['no_star', '1', '2', '3', '4', '5'];
  values.forEach(function (value) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = buttonClassName || 'media-grid-surface-star-filter';
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
