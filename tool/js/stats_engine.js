var StatsEngineModule = (function() {
  var TOKEN_BLACKLIST = {
    a: true,
    is: true,
    on: true,
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
        var token = line.slice(0, idx).trim().toLowerCase();
        var phrase = line.slice(idx + 2).trim().toLowerCase();
        if (!token || !phrase) {
          return null;
        }
        return { token: token, phrase: phrase };
      })
      .filter(Boolean);
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
        if (fileNorm.indexOf(rule.token) !== -1 && captionNorm.indexOf(rule.phrase) === -1) {
          ruleFailures.push({
            fileName: item.fileName,
            reason: 'Token "' + rule.token + '" requires phrase "' + rule.phrase + '"'
          });
        }
      });

      tokenize(caption).forEach(function(tok) {
        if (TOKEN_BLACKLIST[tok]) {
          return;
        }
        tokenCounts[tok] = (tokenCounts[tok] || 0) + 1;
      });
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