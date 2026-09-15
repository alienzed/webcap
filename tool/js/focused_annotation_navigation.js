// Focus Annotation navigation calculations.
// This file deliberately has no DOM, selection, rendering, or workspace-state access.

var FocusedAnnotationNavigation = (function () {
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function normalizeKeys(values) {
    var seen = {};
    return (Array.isArray(values) ? values : []).map(function (value) {
      return String(value || '').trim();
    }).filter(function (key) {
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function isReviewed(reviewedByItem, itemKey, groupKey) {
    return !!(reviewedByItem && reviewedByItem[itemKey] && reviewedByItem[itemKey][groupKey]);
  }

  function firstPendingGroupIndex(scope, itemIndex, startIndex) {
    var itemKey = scope.itemKeys[itemIndex];
    if (!itemKey) return -1;
    for (var i = Math.max(0, Number(startIndex) || 0); i < scope.groupKeys.length; i++) {
      if (!isReviewed(scope.reviewedByItem, itemKey, scope.groupKeys[i])) return i;
    }
    return -1;
  }

  function hasPending(scope) {
    for (var itemIndex = 0; itemIndex < scope.itemKeys.length; itemIndex++) {
      if (firstPendingGroupIndex(scope, itemIndex, 0) >= 0) return true;
    }
    return false;
  }

  function buildScope(input) {
    var source = input || {};
    return {
      itemKeys: normalizeKeys(source.itemKeys),
      groupKeys: normalizeKeys(source.groupKeys),
      reviewedByItem: source.reviewedByItem || {}
    };
  }

  function result(scope, itemIndex, groupIndex, outcome) {
    var itemKey = itemIndex >= 0 ? scope.itemKeys[itemIndex] : '';
    var groupKey = groupIndex >= 0 ? scope.groupKeys[groupIndex] : '';
    return {
      outcome: outcome || 'active',
      itemIndex: itemIndex,
      groupIndex: groupIndex,
      itemKey: itemKey,
      groupKey: groupKey
    };
  }

  function unavailable(scope) {
    if (!scope.itemKeys.length || !scope.groupKeys.length) return true;
    return false;
  }

  function start(input, preferredItemKey) {
    var scope = buildScope(input);
    if (unavailable(scope)) return result(scope, -1, -1, 'unavailable');
    var preferredIndex = scope.itemKeys.indexOf(String(preferredItemKey || '').trim());
    if (preferredIndex >= 0) {
      var preferredGroup = firstPendingGroupIndex(scope, preferredIndex, 0);
      if (preferredGroup >= 0) return result(scope, preferredIndex, preferredGroup);
    }
    for (var itemIndex = 0; itemIndex < scope.itemKeys.length; itemIndex++) {
      var groupIndex = firstPendingGroupIndex(scope, itemIndex, 0);
      if (groupIndex >= 0) return result(scope, itemIndex, groupIndex);
    }
    return result(scope, -1, -1, 'scope-complete');
  }

  // Automatic Focus traversal is group-first and never wraps the entry group.
  function advance(input, cursor) {
    var scope = buildScope(input);
    if (unavailable(scope)) return result(scope, -1, -1, 'unavailable');
    // Reconciliation may intentionally start immediately before the first item.
    // Keeping -1 here lets it examine item zero instead of silently skipping it.
    var requestedItem = Number(cursor && cursor.itemIndex);
    var currentItem = isFinite(requestedItem)
      ? Math.max(-1, Math.min(scope.itemKeys.length - 1, requestedItem))
      : 0;
    var currentGroup = clamp(cursor && cursor.groupIndex, 0, scope.groupKeys.length - 1);
    for (var itemIndex = currentItem + 1; itemIndex < scope.itemKeys.length; itemIndex++) {
      if (!isReviewed(scope.reviewedByItem, scope.itemKeys[itemIndex], scope.groupKeys[currentGroup])) {
        return result(scope, itemIndex, currentGroup);
      }
    }
    for (var groupIndex = currentGroup + 1; groupIndex < scope.groupKeys.length; groupIndex++) {
      for (var nextItemIndex = 0; nextItemIndex < scope.itemKeys.length; nextItemIndex++) {
        if (!isReviewed(scope.reviewedByItem, scope.itemKeys[nextItemIndex], scope.groupKeys[groupIndex])) {
          return result(scope, nextItemIndex, groupIndex);
        }
      }
    }
    return result(scope, -1, -1, hasPending(scope) ? 'pass-complete' : 'scope-complete');
  }

  function moveItem(input, cursor, delta) {
    var scope = buildScope(input);
    if (unavailable(scope)) return result(scope, -1, -1, 'unavailable');
    var currentItem = clamp(cursor && cursor.itemIndex, 0, scope.itemKeys.length - 1);
    var currentGroup = clamp(cursor && cursor.groupIndex, 0, scope.groupKeys.length - 1);
    var nextItem = currentItem + (delta < 0 ? -1 : 1);
    if (nextItem >= 0 && nextItem < scope.itemKeys.length) return result(scope, nextItem, currentGroup);
    var nextGroup = currentGroup + (delta < 0 ? -1 : 1);
    if (nextGroup < 0 || nextGroup >= scope.groupKeys.length) return result(scope, currentItem, currentGroup);
    return result(scope, delta < 0 ? scope.itemKeys.length - 1 : 0, nextGroup);
  }

  function moveGroup(input, cursor, delta) {
    var scope = buildScope(input);
    if (unavailable(scope)) return result(scope, -1, -1, 'unavailable');
    var currentItem = clamp(cursor && cursor.itemIndex, 0, scope.itemKeys.length - 1);
    var currentGroup = clamp(cursor && cursor.groupIndex, 0, scope.groupKeys.length - 1);
    var nextGroup = currentGroup + (delta < 0 ? -1 : 1);
    if (nextGroup < 0 || nextGroup >= scope.groupKeys.length) return result(scope, currentItem, currentGroup);
    return result(scope, currentItem, nextGroup);
  }

  function reconcile(input, cursor) {
    var scope = buildScope(input);
    if (unavailable(scope)) return result(scope, -1, -1, 'unavailable');
    var oldItemKey = String(cursor && cursor.itemKey || '').trim();
    var oldGroupKey = String(cursor && cursor.groupKey || '').trim();
    var itemIndex = scope.itemKeys.indexOf(oldItemKey);
    var groupIndex = scope.groupKeys.indexOf(oldGroupKey);
    if (itemIndex >= 0 && groupIndex >= 0) return result(scope, itemIndex, groupIndex);
    var startItem = itemIndex >= 0 ? itemIndex : clamp(cursor && cursor.itemIndex, 0, scope.itemKeys.length - 1);
    var startGroup = groupIndex >= 0 ? groupIndex : clamp(cursor && cursor.groupIndex, 0, scope.groupKeys.length - 1);
    return advance(scope, { itemIndex: startItem - 1, groupIndex: startGroup });
  }

  return {
    start: start,
    advance: advance,
    moveItem: moveItem,
    moveGroup: moveGroup,
    reconcile: reconcile,
    hasPending: function (input) { return hasPending(buildScope(input)); }
  };
})();
