// Balance distribution wheel overlay for preview.

function balanceWheelPercent(count, total) {
  if (!total) return '0%';
  var value = Math.round((count / total) * 1000) / 10;
  return String(value).replace(/\.0$/, '') + '%';
}

function getBalanceWheelVisibleItems() {
  return getFilteredMediaItems(false).filter(function (item) {
    return !!(item && item.key);
  });
}

function getBalanceWheelStats() {
  var variables = normalizeSetVariables(state.setVariables);
  var items = getBalanceWheelVisibleItems();
  var currentItem = state.currentItem && state.currentItem.key ? state.currentItem : null;
  var rows = [];
  variables.forEach(function (variable) {
    var assignments = items.map(function (item) { return setVariableAssignedTerms(item, variable.group); });
    var current = currentItem ? setVariableAssignedTerms(currentItem, variable.group) : new Set();
    variable.terms.forEach(function (term) {
      var key = normalizeChecklistTerm(term).toLowerCase();
      rows.push({group:variable.group, term:term, index:rows.length,
        count:assignments.filter(function (assigned) { return assigned.has(key); }).length,
        currentMatch:current.has(key)});
    });
  });
  return {rows:rows, total:items.length, currentItem:currentItem};
}

function balanceWheelColor(index) {
  var colors = [
    '#60a5fa',
    '#f59e0b',
    '#34d399',
    '#f472b6',
    '#a78bfa',
    '#f87171',
    '#22d3ee',
    '#c084fc'
  ];
  return colors[index % colors.length];
}

function balanceWheelArcPath(cx, cy, radius, startAngle, endAngle) {
  var start = balanceWheelPolar(cx, cy, radius, endAngle);
  var end = balanceWheelPolar(cx, cy, radius, startAngle);
  var largeArc = endAngle - startAngle <= 180 ? '0' : '1';
  return [
    'M', start.x, start.y,
    'A', radius, radius, 0, largeArc, 0, end.x, end.y
  ].join(' ');
}

function balanceWheelPolar(cx, cy, radius, angle) {
  var radians = (angle - 90) * Math.PI / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians)
  };
}

function buildBalanceWheelTitle(stats) {
  if (!stats.currentItem) return 'Select a media item.';
  if (!stats.rows.length) return 'No Set Variables configured.';
  if (!stats.total) return 'No filtered media items.';
  var matched = stats.rows.filter(function (row) { return row.currentMatch; });
  if (!matched.length) return 'No selected variable terms assigned to this item.';
  return matched.map(function (row) {
    return row.group + ' · ' + row.term + ': ' + row.count + '/' + stats.total +
      ' (' + balanceWheelPercent(row.count, stats.total) + ')';
  }).join('\n');
}

function renderBalanceWheelSvg(stats) {
  var cx = 50;
  var cy = 50;
  var radius = 36;
  var strokeWidth = 17;
  var sector = stats.rows.length ? 360 / stats.rows.length : 0;
  var parts = [
    '<svg viewBox="0 0 100 100" aria-hidden="true">',
    '<circle cx="50" cy="50" r="' + radius + '" class="balance-wheel-bg"></circle>'
  ];

  stats.rows.forEach(function (row) {
    if (!row.count || !stats.total) return;
    var sweep = Math.min(sector - Math.min(1, sector / 10), (row.count / stats.total) * sector);
    if (sweep <= 0) return;
    var start = row.index * sector;
    var end = start + sweep;
    var classes = 'balance-wheel-slice' + (row.currentMatch ? ' is-current' : '');
    parts.push(
      '<path class="' + classes + '" d="' + balanceWheelArcPath(cx, cy, radius, start, end) + '"' +
      ' stroke="' + balanceWheelColor(row.index) + '" stroke-width="' + strokeWidth + '"' +
      ' fill="none" stroke-linecap="butt"></path>'
    );
  });

  if (!stats.rows.some(function (row) { return row.count > 0; })) {
    parts.push('<circle cx="50" cy="50" r="20" class="balance-wheel-zero"></circle>');
  }

  parts.push('</svg>');
  return parts.join('');
}

function updateBalanceDistributionWheel() {
  var el = ui.balanceDistributionWheelEl;
  var stats = getBalanceWheelStats();
  if (!stats.currentItem || !stats.rows.length) {
    el.classList.add('hidden');
    el.innerHTML = '';
    el.removeAttribute('title');
    return;
  }

  el.innerHTML = renderBalanceWheelSvg(stats);
  el.title = buildBalanceWheelTitle(stats);
  el.classList.remove('hidden');
}

function hideBalanceDistributionWheel() {
  var el = ui.balanceDistributionWheelEl;
  el.classList.add('hidden');
  el.innerHTML = '';
  el.removeAttribute('title');
}
