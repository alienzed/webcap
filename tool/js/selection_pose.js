var SELECTION_POSE_REPORT_FIELDS = [
  {
    panelId: 'selection-face-direction-panel',
    source: 'Face Direction',
    field: 'selection_pose_face_direction',
    rows: [
      { key: 'front', label: 'Front' },
      { key: 'three_quarter_left', label: '3/4 Left' },
      { key: 'left', label: 'Left' },
      { key: 'three_quarter_right', label: '3/4 Right' },
      { key: 'right', label: 'Right' },
      { key: 'up', label: 'Up' },
      { key: 'down', label: 'Down' },
      { key: 'unknown', label: 'Unknown' }
    ]
  },
  {
    panelId: 'selection-expression-panel',
    source: 'Expression',
    field: 'selection_pose_expression_primary',
    rows: [
      { key: 'neutral', label: 'Neutral' },
      { key: 'smile', label: 'Smile' },
      { key: 'open_mouth', label: 'Open Mouth' },
      { key: 'frown', label: 'Frown' },
      { key: 'surprised', label: 'Surprised' },
      { key: 'eyes_closed', label: 'Eyes Closed' },
      { key: 'pout', label: 'Pout' },
      { key: 'cheeks_puffed', label: 'Cheeks Puffed' },
      { key: 'unknown', label: 'Unknown' }
    ]
  },
  {
    panelId: 'selection-body-orientation-panel',
    source: 'Body Orientation',
    field: 'selection_pose_body_orientation',
    rows: [
      { key: 'front', label: 'Front' },
      { key: 'side', label: 'Side' },
      { key: 'three_quarter', label: 'Three-Quarter' },
      { key: 'rear', label: 'Rear' },
      { key: 'three_quarter_rear', label: 'Three-Quarter Rear' },
      { key: 'unknown', label: 'Unknown' }
    ]
  },
  {
    panelId: 'selection-pose-class-panel',
    source: 'Pose Class',
    field: 'selection_pose_pose_class',
    rows: [
      { key: 'standing', label: 'Standing' },
      { key: 'seated', label: 'Seated' },
      { key: 'kneeling_crouched', label: 'Kneeling/Crouched' },
      { key: 'reclining', label: 'Reclining' },
      { key: 'unknown', label: 'Unknown' }
    ]
  },
  {
    panelId: 'selection-arm-position-panel',
    source: 'Arm Position',
    field: 'selection_pose_arm_position',
    rows: [
      { key: 'both_up', label: 'Both Up' },
      { key: 'one_up', label: 'One Up' },
      { key: 'arms_out', label: 'Arms Out' },
      { key: 'hands_near_face', label: 'Hands Near Face' },
      { key: 'arms_down', label: 'Arms Down' },
      { key: 'mixed', label: 'Mixed' },
      { key: 'unknown', label: 'Unknown' }
    ]
  }
];

function getSelectionPoseFromMetadata(row) {
  if (!row || typeof row !== 'object') return null;
  if (row.selection_pose && typeof row.selection_pose === 'object') return row.selection_pose;
  if (!row.selection_pose_face_direction && !row.selection_pose_expression_primary && !row.selection_pose_body_orientation && !row.selection_pose_pose_class && !row.selection_pose_arm_position) {
    return null;
  }
  return {
    face_direction: row.selection_pose_face_direction,
    expression_primary: row.selection_pose_expression_primary,
    expressions: row.selection_pose_expressions,
    body_orientation: row.selection_pose_body_orientation,
    pose_class: row.selection_pose_pose_class,
    arm_position: row.selection_pose_arm_position
  };
}

function appendSelectionPoseMetadataRows(listEl, row) {
  var pose = getSelectionPoseFromMetadata(row);
  if (!pose) return;
  var expressionList = Array.isArray(pose.expressions) ? pose.expressions.map(function (value) {
    return String(value || '').replace(/_/g, ' ');
  }).filter(Boolean) : [];
  var expressionScoresStr = '';
  if (typeof pose.expression_scores === 'object' && pose.expression_scores) {
    var scorePairs = [];
    for (var key in pose.expression_scores) {
      if (pose.expression_scores.hasOwnProperty(key)) {
        scorePairs.push(key.replace(/_/g, ' ') + ': ' + Math.round(pose.expression_scores[key] * 100) + '%');
      }
    }
    expressionScoresStr = scorePairs.join(', ');
  }
  var fields = [
    ['Face Direction', pose.face_direction ? String(pose.face_direction).replace(/_/g, ' ') : 'unknown', null],
    ['Expression', expressionList.length ? expressionList.join(', ') : (pose.expression_primary || 'unknown'), expressionScoresStr],
    ['Body Orientation', pose.body_orientation ? String(pose.body_orientation).replace(/_/g, ' ') : 'unknown', null],
    ['Pose Class', pose.pose_class ? String(pose.pose_class).replace(/_/g, ' ') : 'unknown', null],
    ['Arm Position', pose.arm_position ? String(pose.arm_position).replace(/_/g, ' ') : 'unknown', null]
  ];
  fields.forEach(function (field) {
    var itemRow = document.createElement('div');
    itemRow.className = 'item-metadata-row';
    var labelEl = document.createElement('strong');
    labelEl.textContent = field[0];
    var valueEl = document.createElement('span');
    valueEl.textContent = field[1];
    if (String(field[1] || '').toLowerCase() === 'unknown') {
      valueEl.classList.add('item-metadata-value-error');
    } else {
      valueEl.classList.add('item-metadata-value-ok');
    }
    if (field[2]) {
      valueEl.title = field[2];
    }
    itemRow.appendChild(labelEl);
    itemRow.appendChild(valueEl);
    listEl.appendChild(itemRow);
  });
}

function buildSelectionPoseSummaryRows(rows, scopedFileNames, fieldDef) {
  var allowed = null;
  if (Array.isArray(scopedFileNames)) {
    allowed = {};
    scopedFileNames.forEach(function (name) {
      var key = String(name || '').trim();
      if (key) allowed[key] = true;
    });
  }
  var summary = {};
  (fieldDef.rows || []).forEach(function (row) {
    summary[row.key] = { key: row.key, label: row.label, count: 0, files: [] };
  });
  (rows || []).forEach(function (row) {
    var fileName = String((row && row.file) || '').trim();
    if (!fileName || (allowed && !allowed[fileName])) return;
    var pose = getSelectionPoseFromMetadata(row);
    if (!pose) return;
    var bucket = String(row[fieldDef.field] || '').trim().toLowerCase() || 'unknown';
    if (!summary[bucket]) {
      summary[bucket] = { key: bucket, label: bucket.replace(/_/g, ' '), count: 0, files: [] };
    }
    summary[bucket].count += 1;
    summary[bucket].files.push(fileName);
  });
  return (fieldDef.rows || []).map(function (row) {
    return summary[row.key] || { key: row.key, label: row.label, count: 0, files: [] };
  }).filter(function (row) {
    return row.count > 0 || row.key === 'unknown';
  });
}

function renderSelectionPoseSummaryPanel(doc, rows, scopedFileNames, fieldDef) {
  var panel = doc.getElementById(fieldDef.panelId);
  if (!panel) return;
  var summaryRows = buildSelectionPoseSummaryRows(rows, scopedFileNames, fieldDef);
  var total = summaryRows.reduce(function (sum, row) { return sum + row.count; }, 0);
  if (!total) {
    panel.innerHTML = '<div style="color:#777;">No MediaPipe pose metadata. Enable MediaPipe analysis in App Settings to generate these values.</div>';
    return;
  }
  var html = '<table><thead><tr><th>Bucket</th><th>Count</th><th>Percent</th></tr></thead><tbody>';
  summaryRows.forEach(function (row) {
    var percent = total ? Math.round((row.count / total) * 1000) / 10 : 0;
    html += '<tr><td><button class="fail-link selection-pose-link" data-file="' + encodeURIComponent(row.files[0] || '') +
      '" data-focus="' + encodeURIComponent((row.files || []).join('\n')) + '" data-source="' + encodeURIComponent(fieldDef.source) + '">' +
      escapeHtml(row.label) + '</button></td><td>' + row.count + '</td><td>' + percent + '%</td></tr>';
  });
  html += '</tbody></table>';
  panel.innerHTML = html;
  Array.prototype.forEach.call(panel.querySelectorAll('.selection-pose-link'), function (btn) {
    btn.onclick = function () {
      var fileName = decodeURIComponent(btn.getAttribute('data-file') || '');
      var focus = decodeURIComponent(btn.getAttribute('data-focus') || '');
      var files = focus ? focus.split('\n').filter(Boolean) : [];
      if (window.parent && window.parent.postMessage) {
        window.parent.postMessage({
          type: 'caption-review-select',
          fileName: fileName,
          focusFiles: files,
          focusSource: decodeURIComponent(btn.getAttribute('data-source') || ''),
          reportType: 'selection'
        }, '*');
      }
    };
  });
}

function renderSelectionPoseReportPanels(doc, rows, scopedFileNames) {
  SELECTION_POSE_REPORT_FIELDS.forEach(function (fieldDef) {
    renderSelectionPoseSummaryPanel(doc, rows, scopedFileNames, fieldDef);
  });
}

function getSelectionPoseSuggestedTags(row, existingTags) {
  var pose = getSelectionPoseFromMetadata(row);
  if (!pose) return [];
  var existing = {};
  (existingTags || []).forEach(function (tag) {
    var key = String(tag || '').trim().toLowerCase();
    if (key) existing[key] = true;
  });
  var suggestions = [];
  var seen = {};

  function push(tagText) {
    var tag = String(tagText || '').trim();
    if (!tag) return;
    var low = tag.toLowerCase();
    if (existing[low] || seen[low]) return;
    seen[low] = true;
    suggestions.push(tag);
  }

  var orientationMap = {
    front: 'front',
    side: 'side',
    three_quarter: 'three-quarter',
    rear: 'rear',
    three_quarter_rear: 'three-quarter rear'
  };
  var bodyOrientation = String(pose.body_orientation || '').trim().toLowerCase();
  if (orientationMap[bodyOrientation]) {
    push(orientationMap[bodyOrientation]);
  } else {
    var faceDirection = String(pose.face_direction || '').trim().toLowerCase();
    if (faceDirection === 'front') push('front');
    if (faceDirection === 'left' || faceDirection === 'right') push('side');
    if (faceDirection === 'three_quarter_left' || faceDirection === 'three_quarter_right') push('three-quarter');
  }

  var poseClassMap = {
    standing: 'standing',
    seated: 'sitting',
    kneeling_crouched: 'kneeling',
    reclining: 'lying on her back'
  };
  var poseClass = String(pose.pose_class || '').trim().toLowerCase();
  if (poseClassMap[poseClass]) {
    push(poseClassMap[poseClass]);
  }

  var armPositionMap = {
    both_up: 'arms up',
    one_up: 'one arm up',
    arms_out: 'arms spread'
  };
  var armPosition = String(pose.arm_position || '').trim().toLowerCase();
  if (armPositionMap[armPosition]) {
    push(armPositionMap[armPosition]);
  }

  var expression = String(pose.expression_primary || '').trim().toLowerCase();
  if (expression === 'smile') push('smiling');
  if (expression === 'surprised') push('surprised');
  if (expression === 'neutral') push('neutral expression');

  return suggestions.slice(0, 4);
}

function buildSuggestedSelectionRows(rows, scopedFileNames) {
  var allowed = null;
  if (Array.isArray(scopedFileNames)) {
    allowed = {};
    scopedFileNames.forEach(function (name) {
      var key = String(name || '').trim();
      if (key) allowed[key] = true;
    });
  }
  var candidates = [];
  (rows || []).forEach(function (row) {
    var fileName = String((row && row.file) || '').trim();
    if (!fileName || (allowed && !allowed[fileName])) return;
    var focusBucket = String(row.face_focus_bucket || '').trim().toLowerCase() || 'unknown';
    if (focusBucket !== 'close' && focusBucket !== 'medium' && focusBucket !== 'body') return;
    var pose = getSelectionPoseFromMetadata(row);
    if (!pose) return;
    var score = 0.0;
    if (focusBucket === 'close') score += 3.0;
    if (focusBucket === 'medium') score += 2.6;
    if (focusBucket === 'body') score += 1.8;
    if (pose.body_orientation && pose.body_orientation !== 'unknown') score += 1.2;
    if (pose.pose_class && pose.pose_class !== 'unknown') score += 0.8;
    if (pose.arm_position && pose.arm_position !== 'unknown') score += (pose.arm_position === 'mixed' ? 0.2 : 0.6);
    if (pose.expression_primary && pose.expression_primary !== 'unknown') score += (pose.expression_primary === 'neutral' ? 0.2 : 0.5);
    candidates.push({
      file: fileName,
      focusBucket: focusBucket,
      score: score
    });
  });
  candidates.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.file.localeCompare(b.file);
  });
  var targetCount = Math.min(35, Math.max(15, Math.round(candidates.length * 0.3)));
  var quotas = {
    close: Math.max(1, Math.round(targetCount * 0.4)),
    medium: Math.max(1, Math.round(targetCount * 0.35)),
    body: Math.max(1, Math.round(targetCount * 0.25))
  };
  var selectedByBucket = { close: [], medium: [], body: [] };
  candidates.forEach(function (candidate) {
    var bucket = candidate.focusBucket;
    if (!selectedByBucket[bucket]) return;
    if (selectedByBucket[bucket].length >= quotas[bucket]) return;
    selectedByBucket[bucket].push(candidate.file);
  });
  var allFiles = [];
  ['close', 'medium', 'body'].forEach(function (bucket) {
    selectedByBucket[bucket].forEach(function (fileName) {
      if (allFiles.indexOf(fileName) === -1) allFiles.push(fileName);
    });
  });
  return [
    { key: 'all', label: 'Suggested Candidates', files: allFiles },
    { key: 'close', label: 'Close Candidates', files: selectedByBucket.close },
    { key: 'medium', label: 'Medium Candidates', files: selectedByBucket.medium },
    { key: 'body', label: 'Body Candidates', files: selectedByBucket.body }
  ];
}

function renderSuggestedSelectionPanel(doc, rows, scopedFileNames) {
  var panel = doc.getElementById('selection-suggested-candidates-panel');
  if (!panel) return;
  var suggestionRows = buildSuggestedSelectionRows(rows, scopedFileNames);
  var totalFiles = suggestionRows[0] && suggestionRows[0].files ? suggestionRows[0].files.length : 0;
  if (!totalFiles) {
    panel.innerHTML = '<div style="color:#777;">No conservative candidate subset yet.</div>';
    return;
  }
  var html = '<table><thead><tr><th>Group</th><th>Count</th></tr></thead><tbody>';
  suggestionRows.forEach(function (row) {
    if (!row.files.length) return;
    html += '<tr><td><button class="fail-link selection-suggested-link" data-file="' + encodeURIComponent(row.files[0] || '') +
      '" data-focus="' + encodeURIComponent(row.files.join('\n')) + '" data-source="' + encodeURIComponent('Suggested Candidates') + '">' +
      escapeHtml(row.label) + '</button></td><td>' + row.files.length + '</td></tr>';
  });
  html += '</tbody></table>';
  panel.innerHTML = html;
  Array.prototype.forEach.call(panel.querySelectorAll('.selection-suggested-link'), function (btn) {
    btn.onclick = function () {
      var fileName = decodeURIComponent(btn.getAttribute('data-file') || '');
      var focus = decodeURIComponent(btn.getAttribute('data-focus') || '');
      var files = focus ? focus.split('\n').filter(Boolean) : [];
      if (window.parent && window.parent.postMessage) {
        window.parent.postMessage({
          type: 'caption-review-select',
          fileName: fileName,
          focusFiles: files,
          focusSource: 'Suggested Candidates',
          reportType: 'selection'
        }, '*');
      }
    };
  });
}
