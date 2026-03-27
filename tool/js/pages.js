var PagesModule = (function() {
  var currentPage = '';
  var pages = [];
  var pageListEl = null;
  var filterEl = null;
  var statusEl = null;
  var editorApi = null;

  function init(config) {
    pageListEl = config.pageListEl;
    filterEl = config.filterEl;
    statusEl = config.statusEl;
    editorApi = config.editorApi;

    filterEl.addEventListener('input', function() {
      renderPageList(filterEl.value);
    });
  }

  function setStatus(text) {
    statusEl.textContent = text || '';
  }

  function normalizePageName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function httpGet(url, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onload = function() {
      callback(xhr.status, xhr.responseText);
    };
    xhr.send();
  }

  function httpPostJson(url, data, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function() {
      callback(xhr.status, xhr.responseText);
    };
    xhr.send(JSON.stringify(data));
  }

  function extractMetadata(html, pageName) {
    var titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    var tagsMatch = html.match(/<meta[^>]+name=["']tags["'][^>]+content=["']([^"']*)["'][^>]*>/i);
    var title = titleMatch ? stripTags(titleMatch[1]).trim() : pageName;
    var tags = tagsMatch ? tagsMatch[1].split(',').map(function(tag) { return tag.trim(); }).filter(Boolean) : [];
    return { name: pageName, title: title, tags: tags };
  }

  function stripTags(str) {
    return str.replace(/<[^>]+>/g, '');
  }

  function renderPageList(filterText) {
    var q = (filterText || '').toLowerCase();
    pageListEl.innerHTML = '';
    pages.forEach(function(page) {
      var haystack = (page.name + ' ' + page.title + ' ' + page.tags.join(' ')).toLowerCase();
      if (q && haystack.indexOf(q) === -1) {
        return;
      }
      var item = document.createElement('div');
      item.className = 'page-item' + (page.name === currentPage ? ' active' : '');
      item.setAttribute('data-page', page.name);
      item.innerHTML = '<div>' + escapeHtml(page.title || page.name) + '</div>' +
        '<div class="page-meta">' + escapeHtml(page.name + (page.tags.length ? ' | ' + page.tags.join(', ') : '')) + '</div>';
      item.onclick = function() {
        switchPage(page.name);
      };
      pageListEl.appendChild(item);
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function refreshPages(callback) {
    httpGet('/pages', function(status, text) {
      if (status !== 200) {
        setStatus('Could not list pages');
        if (callback) { callback(); }
        return;
      }
      var names = JSON.parse(text);
      pages = [];
      if (!names.length) {
        renderPageList(filterEl.value);
        if (callback) { callback(); }
        return;
      }
      var remaining = names.length;
      names.forEach(function(name) {
        httpGet('/load?page=' + encodeURIComponent(name), function(loadStatus, html) {
          if (loadStatus === 200) {
            pages.push(extractMetadata(html, name));
          } else {
            pages.push({ name: name, title: name, tags: [] });
          }
          remaining -= 1;
          if (remaining === 0) {
            pages.sort(function(a, b) { return a.name.localeCompare(b.name); });
            renderPageList(filterEl.value);
            if (callback) { callback(); }
          }
        });
      });
    });
  }

  function loadPage(name, callback) {
    httpGet('/load?page=' + encodeURIComponent(name), function(status, html) {
      if (status !== 200) {
        setStatus('Could not load page');
        if (callback) { callback(false); }
        return;
      }
      currentPage = name;
      editorApi.setContent(html);
      renderPageList(filterEl.value);
      setStatus('Loaded: ' + name);
      if (callback) { callback(true); }
    });
  }

  function saveCurrentPage(callback) {
    if (!currentPage) {
      if (callback) { callback(true); }
      return;
    }
    httpPostJson('/save', { page: currentPage, html: editorApi.getContent() }, function(status) {
      if (status === 200) {
        refreshPages(function() {
          setStatus('Saved: ' + currentPage);
          if (callback) { callback(true); }
        });
      } else {
        setStatus('Could not save page');
        if (callback) { callback(false); }
      }
    });
  }

  function switchPage(name) {
    if (!currentPage) {
      loadPage(name);
      return;
    }
    saveCurrentPage(function() {
      loadPage(name);
    });
  }

  function createPage(rawName, callback) {
    var name = normalizePageName(rawName || '');
    if (!name) {
      setStatus('Invalid page name');
      if (callback) { callback(false); }
      return;
    }

    var proceed = function() {
      httpPostJson('/create', { page: name }, function(status, response) {
        if (status !== 200) {
          var msg = 'Could not create page';
          try {
            msg = JSON.parse(response).error || msg;
          } catch (e) {}
          setStatus(msg);
          if (callback) { callback(false); }
          return;
        }
        refreshPages(function() {
          loadPage(name, callback);
        });
      });
    };

    if (currentPage) {
      saveCurrentPage(function() {
        proceed();
      });
    } else {
      proceed();
    }
  }
  window.openCurrentPage = function() {
    if (!currentPage) return;

    var url = "/pages/" + currentPage + "/index.html";
    window.open(url, "_blank");
  }

  function getCurrentPage() {
    return currentPage;
  }

  return {
    init: init,
    refreshPages: refreshPages,
    loadPage: loadPage,
    saveCurrentPage: saveCurrentPage,
    switchPage: switchPage,
    createPage: createPage,
    getCurrentPage: getCurrentPage,
    setStatus: setStatus
  };
})();
