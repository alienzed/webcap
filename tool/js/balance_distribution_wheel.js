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
  var rows = [], groups = [];
  variables.forEach(function (variable) {
    var coverage = setVariableCoverage(variable, items);
    var current = currentItem ? setVariableAssignedTerms(currentItem, variable.group) : new Set();
    var termRows = coverage.terms.map(function (term) {
      var key = normalizeChecklistTerm(term.label).toLowerCase();
      var row = {group:variable.group, term:term.label, index:rows.length,
        count:term.files.length, currentMatch:current.has(key)};
      row.color = balanceWheelColor(row.index);
      rows.push(row);
      return row;
    });
    var currentCount = termRows.filter(function (row) { return row.currentMatch; }).length;
    var groupRows = coverage.rows.map(function (entry, index) {
      var term = index < termRows.length ? termRows[index] : null;
      return {term:entry.label, index:index, count:entry.files.length,
        color:term ? term.color : entry.key === 'multiple' ? '#f59e0b' : '#94a3b8',
        currentMatch:!!currentItem && (term ? term.currentMatch && (!variable.exclusive || currentCount === 1) :
          entry.key === 'multiple' ? currentCount > 1 : currentCount === 0)};
    });
    groups.push({group:variable.group, partition:variable.exclusive, rows:groupRows, total:items.length});
  });
  return {rows:rows, groups:groups, total:items.length, currentItem:currentItem};
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

  var angle = 0;
  stats.rows.forEach(function (row) {
    if (!row.count || !stats.total) return;
    var sweep = stats.partition ? (row.count / stats.total) * 360 :
      Math.min(sector - Math.min(1, sector / 10), (row.count / stats.total) * sector);
    if (sweep <= 0) return;
    var start = stats.partition ? angle : row.index * sector;
    var end = start + sweep;
    if (stats.partition) angle = end;
    var classes = 'balance-wheel-slice' + (row.currentMatch ? ' is-current' : '');
    var style = ' class="' + classes + '" stroke="' + row.color + '" stroke-width="' +
      strokeWidth + '" fill="none" stroke-linecap="butt"';
    if (sweep >= 359.999999) {
      parts.push('<circle cx="50" cy="50" r="' + radius + '"' + style + '></circle>');
    } else {
      parts.push('<path d="' + balanceWheelArcPath(cx, cy, radius, start, end) + '"' + style + '></path>');
    }
  });

  if (!stats.rows.some(function (row) { return row.count > 0; })) {
    parts.push('<circle cx="50" cy="50" r="20" class="balance-wheel-zero"></circle>');
  }

  parts.push('</svg>');
  return parts.join('');
}

function renderBalanceWheelGroups(stats) {
  return '<div class="balance-wheel-groups">' + stats.groups.map(function (group) {
    return '<section class="balance-wheel-group"><h3>' + escapeHtml(group.group) + '</h3>' +
      renderBalanceWheelSvg(group) +
      '<div class="balance-wheel-kind">' + (group.partition ? 'Share of media' : 'Independent coverage') + '</div>' +
      '<div class="balance-wheel-legend">' + group.rows.map(function (row) {
        return '<div class="balance-wheel-legend-row' + (row.currentMatch ? ' is-current' : '') + '">' +
          '<span class="balance-wheel-swatch" style="background-color:' + row.color + '"></span>' +
          '<span class="balance-wheel-term">' + escapeHtml(row.term) + '</span>' +
          '<span class="balance-wheel-count">' + row.count + '/' + group.total +
          ' (' + balanceWheelPercent(row.count, group.total) + ')</span></div>';
      }).join('') + '</div></section>';
  }).join('') + '</div>';
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

  var previousPanel = el.querySelector('.balance-wheel-groups');
  var scrollTop = previousPanel ? previousPanel.scrollTop : 0;
  el.innerHTML = '<div class="balance-wheel-trigger">' + renderBalanceWheelSvg(stats) + '</div>' +
    renderBalanceWheelGroups(stats);
  el.querySelector('.balance-wheel-trigger').title = buildBalanceWheelTitle(stats);
  el.querySelector('.balance-wheel-groups').scrollTop = scrollTop;
  el.classList.remove('hidden');
}

function hideBalanceDistributionWheel() {
  var el = ui.balanceDistributionWheelEl;
  el.classList.add('hidden');
  el.innerHTML = '';
  el.removeAttribute('title');
}
