var FACE_FOCUS_BUCKETS = [
  { key: 'close', label: 'Close' },
  { key: 'medium', label: 'Medium' },
  { key: 'body', label: 'Body' },
  { key: 'unknown', label: 'Unknown' }
];

function normalizeFaceFocusBucket(value) {
  var bucket = String(value || '').toLowerCase().trim();
  for (var i = 0; i < FACE_FOCUS_BUCKETS.length; i += 1) {
    if (FACE_FOCUS_BUCKETS[i].key === bucket) return bucket;
  }
  return 'unknown';
}

function getFaceFocusFromMetadata(row) {
  if (!row || typeof row !== 'object') return null;
  if (row.face_focus && typeof row.face_focus === 'object') return row.face_focus;
  if (!row.face_focus_bucket && row.face_count === undefined) return null;
  return {
    bucket: row.face_focus_bucket,
    face_count: row.face_count,
    largest_height_pct: row.largest_face_height_pct,
    largest_area_pct: row.largest_face_area_pct,
    largest_score: row.largest_face_score
  };
}

function formatFaceFocusPercent(value) {
  var n = Number(value);
  if (!isFinite(n)) return '-';
  return String(Math.round(n)) + '%';
}

function formatFaceFocusScore(value) {
  var n = Number(value);
  if (!isFinite(n)) return '-';
  return String(Math.round(n * 100)) + '%';
}

function getFaceFocusBucketLabel(bucket) {
  var key = normalizeFaceFocusBucket(bucket);
  for (var i = 0; i < FACE_FOCUS_BUCKETS.length; i += 1) {
    if (FACE_FOCUS_BUCKETS[i].key === key) return FACE_FOCUS_BUCKETS[i].label;
  }
  return 'Unknown';
}

function appendFaceFocusMetadataRows(listEl, row) {
  var focus = getFaceFocusFromMetadata(row);
  if (!focus) return;
  var bucket = normalizeFaceFocusBucket(focus.bucket);
  var fields = [
    ['Face Focus', getFaceFocusBucketLabel(bucket), bucket],
    ['Largest Face', formatFaceFocusPercent(focus.largest_height_pct) + ' height', ''],
    ['Face Score', formatFaceFocusScore(focus.largest_score), '']
  ];
  fields.forEach(function (field) {
    var itemRow = document.createElement('div');
    itemRow.className = 'item-metadata-row';
    var labelEl = document.createElement('strong');
    labelEl.textContent = field[0];
    var valueEl = document.createElement('span');
    valueEl.textContent = field[1];
    if (field[2]) {
      valueEl.classList.add(field[2] === 'unknown' ? 'item-metadata-value-error' : 'item-metadata-value-ok');
    }
    itemRow.appendChild(labelEl);
    itemRow.appendChild(valueEl);
    listEl.appendChild(itemRow);
  });
}

function buildFaceFocusSummaryRows(rows, scopedFileNames) {
  var allowed = null;
  if (Array.isArray(scopedFileNames)) {
    allowed = {};
    scopedFileNames.forEach(function (name) {
      var key = String(name || '').trim();
      if (key) allowed[key] = true;
    });
  }
  var summary = {};
  FACE_FOCUS_BUCKETS.forEach(function (bucket) {
    summary[bucket.key] = { bucket: bucket.key, label: bucket.label, count: 0, files: [] };
  });
  (rows || []).forEach(function (row) {
    var fileName = String((row && row.file) || '').trim();
    if (!fileName || (allowed && !allowed[fileName])) return;
    var focus = getFaceFocusFromMetadata(row);
    if (!focus) return;
    var bucket = normalizeFaceFocusBucket(focus.bucket);
    summary[bucket].count += 1;
    summary[bucket].files.push(fileName);
  });
  return FACE_FOCUS_BUCKETS.map(function (bucket) {
    return summary[bucket.key];
  });
}

function renderFaceFocusReportPanel(doc, rows, scopedFileNames) {
  var panel = doc.getElementById('face-focus-panel');
  if (!panel) return;
  var summaryRows = buildFaceFocusSummaryRows(rows, scopedFileNames);
  var total = summaryRows.reduce(function (sum, row) { return sum + row.count; }, 0);
  if (!total) {
    panel.innerHTML = '<div style="color:#777;">No image face focus metadata. Enable Face Focus analysis in App Settings to generate these values.</div>';
    return;
  }
  var html = '<table><thead><tr><th>Focus</th><th>Count</th><th>Percent</th></tr></thead><tbody>';
  summaryRows.forEach(function (row) {
    var percent = total ? Math.round((row.count / total) * 1000) / 10 : 0;
    html += '<tr><td><button class="fail-link face-focus-link" data-file="' + encodeURIComponent(row.files[0] || '') +
      '" data-focus="' + encodeURIComponent(row.files.join('\n')) + '" data-source="' + encodeURIComponent('Face Focus') + '">' +
      escapeHtml(row.label) + '</button></td><td>' + row.count + '</td><td>' + percent + '%</td></tr>';
  });
  html += '</tbody></table>';
  panel.innerHTML = html;
  Array.prototype.forEach.call(panel.querySelectorAll('.face-focus-link'), function (btn) {
    btn.onclick = function () {
      var fileName = decodeURIComponent(btn.getAttribute('data-file') || '');
      var focus = decodeURIComponent(btn.getAttribute('data-focus') || '');
      var files = focus ? focus.split('\n').filter(Boolean) : [];
      if (window.parent && window.parent.postMessage) {
        window.parent.postMessage({
          type: 'caption-review-select',
          fileName: fileName,
          focusFiles: files,
          focusSource: 'Face Focus',
          reportType: 'selection'
        }, '*');
      }
    };
  });
}
