// Balance distribution wheel overlay for preview.

function balanceWheelNormalize(text) {
  return normalizeBalancePhrase(text);
}

function balanceWheelPercent(count, total) {
  if (!total) return '0%';
  var value = Math.round((count / total) * 1000) / 10;
  return String(value).replace(/\.0$/, '') + '%';
}

function balanceWheelItemTags(item) {
  if (!item || !item.key) return [];
  return getTagsForMediaKey(item.key).map(balanceWheelNormalize).filter(Boolean);
}

function balanceWheelCaptionMatches(item, phrase) {
  return captionContainsPhrase(String((item && item.caption) || ''), phrase);
}

function balanceWheelTagMatches(item, phrase) {
  var target = balanceWheelNormalize(phrase).toLowerCase();
  if (!target) return false;
  return balanceWheelItemTags(item).some(function (tag) {
    return tag.toLowerCase() === target;
  });
}

function balanceWheelItemMatchesPhrase(item, phrase) {
  return balanceWheelCaptionMatches(item, phrase) || balanceWheelTagMatches(item, phrase);
}

function getBalanceWheelPhrases() {
  var seen = {};
  return (Array.isArray(statsBalancePhrases) ? statsBalancePhrases : [])
    .map(balanceWheelNormalize)
    .filter(function (phrase) {
      var key = phrase.toLowerCase();
      if (!phrase || seen[key]) return false;
      seen[key] = true;
      return true;
    });
}

function getBalanceWheelVisibleItems() {
  return getFilteredMediaItems(false).filter(function (item) {
    return !!(item && item.key);
  });
}

function getBalanceWheelItemCaption(item) {
  if (state.currentItem && item && item.key === state.currentItem.key && ui.editorEl) {
    return String(ui.editorEl.value || '');
  }
  return String((item && item.caption) || '');
}

function getBalanceWheelStats() {
  var phrases = getBalanceWheelPhrases();
  var items = getBalanceWheelVisibleItems();
  var currentKey = state.currentItem && state.currentItem.key;
  var currentItem = currentKey ? state.currentItem : null;
  var total = items.length;

  var rows = phrases.map(function (phrase, idx) {
    var count = 0;
    var currentCaptionMatch = currentItem ? captionContainsPhrase(getBalanceWheelItemCaption(currentItem), phrase) : false;
    var currentTagMatch = currentItem ? balanceWheelTagMatches(currentItem, phrase) : false;
    items.forEach(function (item) {
      if (captionContainsPhrase(getBalanceWheelItemCaption(item), phrase) || balanceWheelTagMatches(item, phrase)) {
        count += 1;
      }
    });
    return {
      phrase: phrase,
      count: count,
      index: idx,
      currentMatch: currentCaptionMatch || currentTagMatch,
      currentCaptionMatch: currentCaptionMatch,
      currentTagMatch: currentTagMatch
    };
  });

  return {
    phrases: phrases,
    rows: rows,
    total: total,
    currentItem: currentItem
  };
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
  if (!stats.phrases.length) return 'No balance phrases configured.';
  if (!stats.total) return 'No filtered media items.';

  var matched = stats.rows.filter(function (row) { return row.currentMatch; });
  if (!matched.length) return 'No matched balance phrases in current item.';
  return matched.map(function (row) {
    var sources = [];
    if (row.currentCaptionMatch) sources.push('caption');
    if (row.currentTagMatch) sources.push('tag');
    return row.phrase + ': ' + row.count + '/' + stats.total + ' (' +
      balanceWheelPercent(row.count, stats.total) + ')' +
      (sources.length ? ' via ' + sources.join('+') : '');
  }).join('\n');
}

function renderBalanceWheelSvg(stats) {
  var cx = 50;
  var cy = 50;
  var radius = 36;
  var strokeWidth = 17;
  var angle = 0;
  var maxAngle = 360;
  var parts = [
    '<svg viewBox="0 0 100 100" aria-hidden="true">',
    '<circle cx="50" cy="50" r="' + radius + '" class="balance-wheel-bg"></circle>'
  ];

  stats.rows.forEach(function (row) {
    if (!row.count || !stats.total) return;
    var sweep = Math.max(0, Math.min(maxAngle - angle, (row.count / stats.total) * 360));
    if (sweep <= 0) return;
    var start = angle;
    var end = angle + sweep;
    angle = end;
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
  if (!stats.currentItem || !stats.phrases.length) {
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
