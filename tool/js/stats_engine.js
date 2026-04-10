var StatsEngineModule = (function() {
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
    and: true
  };

  function normalize(text) {
    return String(text || '').toLowerCase();
  }

  function tokenize(text) {
    return normalize(text).split(/[^a-z0-9]+/).filter(Boolean);
  }

  function parsePhrases(multiline) {
    return String(multiline || '')
      .split(/\r?\n/)
      .map(function(line) { return line.trim(); })
      .filter(Boolean);
  }

  function parseTokenRules(multiline) {
    return String(multiline || '')
      .split(/\r?\n/)
      .map(function(line) { return line.trim(); })
      .filter(Boolean)
      .map(function(line) {
        var idx = line.indexOf('=>');
        if (idx === -1) {
          return null;
        }
        var left = line.slice(0, idx).trim().toLowerCase();
        var rightRaw = line.slice(idx + 2).trim();
        var right = rightRaw.toLowerCase();
        if (!left || !right) {
          return null;
        }

        // Primer assignment lines (e.g. file:fd => view=face down) are not validation rules.
        if (right.indexOf('=') !== -1) {
          return null;
        }

        var scope = 'file';
        var trigger = left;
        var colon = left.indexOf(':');
        if (colon > 0) {
          var prefix = left.slice(0, colon).trim();
          var value = left.slice(colon + 1).trim();
          if ((prefix === 'file' || prefix === 'caption') && value) {
            scope = prefix;
            trigger = value;
          }
        }

        if (!trigger) {
          return null;
        }

        return { scope: scope, trigger: trigger, required: right };
      })
      .filter(Boolean);
  }

  function normalizedCaptionKey(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function computeLengthInsights(captionRows) {
    if (!captionRows.length) {
      return {
        shortestCaptions: [],
        longestCaptions: [],
        shortOutliers: [],
        longOutliers: []
      };
    }

    var sorted = captionRows.slice().sort(function(a, b) {
      return a.tokenCount - b.tokenCount || a.charCount - b.charCount || a.fileName.localeCompare(b.fileName);
    });

    var shortestCaptions = sorted.slice(0, 10);
    var longestCaptions = sorted.slice(-10).reverse();

    var cut = Math.max(1, Math.floor(sorted.length * 0.05));
    var shortOutliers = sorted.slice(0, cut);
    var longOutliers = sorted.slice(-cut).reverse();

    return {
      shortestCaptions: shortestCaptions,
      longestCaptions: longestCaptions,
      shortOutliers: shortOutliers,
      longOutliers: longOutliers
    };
  }

  function computeDuplicateInsights(duplicatesMap) {
    return Object.keys(duplicatesMap)
      .map(function(key) {
        return duplicatesMap[key];
      })
      .filter(function(group) { return group.count > 1; })
      .sort(function(a, b) { return b.count - a.count || a.files[0].localeCompare(b.files[0]); })
      .slice(0, 20);
  }

  function compute(items, options) {
    var requiredPhrase = normalize(options && options.requiredPhrase || '').trim();
    var phrases = parsePhrases(options && options.phrases || '');
    var tokenRules = parseTokenRules(options && options.tokenRules || '');

    var total = items.length;
    var withCaption = 0;
    var missingCaption = 0;
    var requiredHits = 0;
    var requiredMissing = [];
    var phraseCounts = {};
    var ruleFailures = [];
    var tokenCounts = {};
    var captionRows = [];
    var duplicatesMap = {};

    phrases.forEach(function(p) {
      phraseCounts[p] = 0;
    });

    items.forEach(function(item) {
      var caption = String(item.caption || '');
      var captionNorm = normalize(caption);
      var fileNorm = normalize(item.fileName || '');

      if (caption.trim()) {
        withCaption += 1;
      } else {
        missingCaption += 1;
      }

      if (requiredPhrase && captionNorm.indexOf(requiredPhrase) !== -1) {
        requiredHits += 1;
      } else if (requiredPhrase) {
        requiredMissing.push({
          fileName: item.fileName,
          reason: 'Missing required phrase "' + requiredPhrase + '"'
        });
      }

      phrases.forEach(function(p) {
        if (captionNorm.indexOf(normalize(p)) !== -1) {
          phraseCounts[p] += 1;
        }
      });

      tokenRules.forEach(function(rule) {
        if (rule.scope === 'caption') {
          if (captionNorm.indexOf(rule.trigger) !== -1 && captionNorm.indexOf(rule.required) === -1) {
            ruleFailures.push({
              fileName: item.fileName,
              reason: 'Caption phrase "' + rule.trigger + '" requires phrase "' + rule.required + '"'
            });
          }
          return;
        }
        if (fileNorm.indexOf(rule.trigger) !== -1 && captionNorm.indexOf(rule.required) === -1) {
          ruleFailures.push({
            fileName: item.fileName,
            reason: 'Filename token "' + rule.trigger + '" requires phrase "' + rule.required + '"'
          });
        }
      });

      tokenize(caption).forEach(function(tok) {
        if (TOKEN_BLACKLIST[tok]) {
          return;
        }
        tokenCounts[tok] = (tokenCounts[tok] || 0) + 1;
      });

      var trimmed = caption.trim();
      if (trimmed) {
        var row = {
          fileName: item.fileName,
          charCount: caption.length,
          tokenCount: tokenize(caption).length
        };
        captionRows.push(row);

        var dupKey = normalizedCaptionKey(caption);
        if (!duplicatesMap[dupKey]) {
          duplicatesMap[dupKey] = {
            normalizedCaption: dupKey,
            sample: trimmed,
            count: 0,
            files: []
          };
        }
        duplicatesMap[dupKey].count += 1;
        duplicatesMap[dupKey].files.push(item.fileName);
      }
    });

    var rareTokens = Object.keys(tokenCounts)
      .filter(function(tok) { return tokenCounts[tok] <= 2; })
      .sort(function(a, b) { return tokenCounts[a] - tokenCounts[b] || a.localeCompare(b); })
      .slice(0, 50)
      .map(function(tok) { return { token: tok, count: tokenCounts[tok] }; });

    var topTokens = Object.keys(tokenCounts)
      .sort(function(a, b) { return tokenCounts[b] - tokenCounts[a] || a.localeCompare(b); })
      .slice(0, 50)
      .map(function(tok) { return { token: tok, count: tokenCounts[tok] }; });

    var phraseSummary = phrases.map(function(p) {
      var count = phraseCounts[p] || 0;
      var pct = total ? Math.round((count / total) * 1000) / 10 : 0;
      return { phrase: p, count: count, percent: pct };
    });

    var requiredPercent = total ? Math.round((requiredHits / total) * 1000) / 10 : 0;
    var lengthInsights = computeLengthInsights(captionRows);
    var duplicateCaptions = computeDuplicateInsights(duplicatesMap);

    return {
      total: total,
      withCaption: withCaption,
      missingCaption: missingCaption,
      requiredPhrase: requiredPhrase,
      requiredHits: requiredHits,
      requiredPercent: requiredPercent,
      requiredMissing: requiredMissing,
      phraseSummary: phraseSummary,
      ruleFailures: ruleFailures,
      shortestCaptions: lengthInsights.shortestCaptions,
      longestCaptions: lengthInsights.longestCaptions,
      shortOutliers: lengthInsights.shortOutliers,
      longOutliers: lengthInsights.longOutliers,
      duplicateCaptions: duplicateCaptions,
      topTokens: topTokens,
      rareTokens: rareTokens
    };
  }

  return {
    compute: compute,
    parsePhrases: parsePhrases,
    parseTokenRules: parseTokenRules
  };
})();