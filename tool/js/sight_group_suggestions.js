// Group-scoped, inference-free suggestions from already saved Open Sight.
// This does not alter Sight, infer missing visual facts, or expand vocabulary.
(function () {
  'use strict';

  var FIELD_ALIASES = {
    viewpoint: ['viewpoint', 'view', 'camera position', 'camera angle'],
    position: ['position', 'pose', 'body position'],
    setting: ['setting', 'scene', 'location'],
    background: ['background', 'backdrop', 'scenery'],
    lighting: ['lighting', 'light'],
    surface: ['surface', 'support']
  };
  var AMBIGUOUS_ANCHORS = {
    front: true, rear: true, back: true, side: true, left: true, right: true,
    light: true, dark: true, white: true, black: true, red: true, blue: true,
    high: true, low: true, short: true, long: true, small: true, large: true,
    standing: true, sitting: true, lying: true, open: true, closed: true,
    face: true, body: true, hand: true, head: true, top: true, bottom: true
  };

  function normalizedSightPhrase(value) {
    return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  function splitSightDescription(description) {
    // Coordinate adjectives such as "black and white" remain intact.
    var sections = String(description || '').split(/[,;]|\.\s+/);
    var parts = [];
    sections.forEach(function (section) {
      var conjunctions = section.split(/\s+(and|while)\s+/i);
      for (var index = 0; index < conjunctions.length; index += 2) {
        var segment = String(conjunctions[index] || '').trim();
        if (!segment) continue;
        var preceding = index > 0 ? String(conjunctions[index - 1]).toLowerCase() : '';
        if (preceding === 'and' && parts.length &&
            /\b(?:black|white|red|green|blue|yellow)\s*$/i.test(parts[parts.length - 1]) &&
            /^(?:black|white|red|green|blue|yellow)\b/i.test(segment)) {
          parts[parts.length - 1] += ' and ' + segment;
        } else {
          parts.push(segment);
        }
      }
    });
    return parts;
  }

  function getSightGroupSuggestionRows(mediaItem, groupLabel) {
    var itemSight = mediaItem && mediaItem.metadata && mediaItem.metadata.vision_sight;
    var cachedMetadata = mediaItem && getMetadataForMedia(mediaItem.fileName);
    var sight = itemSight || (cachedMetadata && cachedMetadata.vision_sight);
    if (!sight || !sight.inventory || !groupLabel) return [];
    var inventory = sight.inventory;
    var alias = String(getRequirementGroupAlias(groupLabel) || '');
    var groupNames = [groupLabel, alias].map(normalizedSightPhrase).filter(Boolean);
    var vocabulary = getChecklistKeywordTermsForRequirement(groupLabel);
    var terms = vocabulary.map(function (value) {
      return { original: value, normalized: normalizedSightPhrase(value) };
    }).filter(function (entry) { return !!entry.normalized; });
    var matchedFields = Object.keys(FIELD_ALIASES).filter(function (field) {
      return FIELD_ALIASES[field].some(function (candidate) {
        return groupNames.indexOf(normalizedSightPhrase(candidate)) !== -1;
      });
    });
    var rows = [];
    var seen = Object.create(null);

    function matchingTerm(phrase) {
      var key = normalizedSightPhrase(phrase);
      return terms.find(function (entry) { return entry.normalized === key; }) || null;
    }

    function hasGroupAnchor(phrase) {
      var haystack = ' ' + normalizedSightPhrase(phrase) + ' ';
      return terms.some(function (entry) {
        if (!entry.normalized || entry.normalized.length < 5 ||
            AMBIGUOUS_ANCHORS[entry.normalized] ||
            getChecklistRequirementsForTag(entry.original).length !== 1) return false;
        return haystack.indexOf(' ' + entry.normalized + ' ') !== -1;
      });
    }

    function add(phrase, source) {
      var value = String(phrase || '').replace(/\s+/g, ' ').trim();
      var key = normalizedSightPhrase(value);
      if (!key || seen[key]) return;
      seen[key] = true;
      var term = matchingTerm(value);
      rows.push({
        group: groupLabel, term: term ? term.original : value,
        kind: term ? 'tag' : 'phrase', source: source
      });
    }

    // Schema-owned categories: there is no semantic guess when these match.
    matchedFields.forEach(function (field) {
      (Array.isArray(inventory[field]) ? inventory[field] : []).forEach(function (value) {
        add(value, field);
      });
    });

    // Other groups, including user-defined ones, can reuse strong, unique
    // vocabulary anchors inside Sight's object/attribute and detail evidence.
    var observations = [];
    (Array.isArray(inventory.details) ? inventory.details : []).forEach(function (value) {
      observations.push(value);
    });
    (Array.isArray(inventory.things) ? inventory.things : []).forEach(function (thing) {
      if (!thing || !thing.name) return;
      observations.push(thing.name);
      (Array.isArray(thing.qualities) ? thing.qualities : []).forEach(function (quality) {
        observations.push(String(quality || '') + ' ' + thing.name);
      });
    });
    observations.forEach(function (value) {
      if (matchingTerm(value) || hasGroupAnchor(value)) add(value, 'inventory');
    });

    // Reuse verbatim short clauses, only when grounded by a category observation
    // or an unambiguous vocabulary anchor. Never synthesize a new description.
    var fieldEvidence = [];
    matchedFields.forEach(function (field) {
      (Array.isArray(inventory[field]) ? inventory[field] : []).forEach(function (value) {
        var normalized = normalizedSightPhrase(value);
        if (normalized.length >= 5) fieldEvidence.push(normalized);
      });
    });
    splitSightDescription(sight.description).forEach(function (phrase) {
      var normalized = normalizedSightPhrase(phrase);
      var wordCount = normalized ? normalized.split(' ').length : 0;
      if (wordCount < 2 || wordCount > 10) return;
      var matchesField = fieldEvidence.some(function (term) {
        return (' ' + normalized + ' ').indexOf(' ' + term + ' ') !== -1;
      });
      if (matchesField || matchingTerm(phrase) || hasGroupAnchor(phrase)) {
        add(phrase, 'description');
      }
    });
    return rows;
  }

  window.getSightGroupSuggestionRows = getSightGroupSuggestionRows;
  window.splitSightDescription = splitSightDescription;
})();
