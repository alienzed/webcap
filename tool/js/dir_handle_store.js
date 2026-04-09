var DirHandleStoreModule = (function() {
  var DB_NAME = 'mediaweb-local';
  var STORE_NAME = 'kv';
  var KEY_LAST_DIR = 'last-caption-dir';

  function openDb() {
    return new Promise(function(resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB not available'));
        return;
      }

      var req = window.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function() {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = function() {
        resolve(req.result);
      };
      req.onerror = function() {
        reject(req.error || new Error('Failed to open IndexedDB'));
      };
    });
  }

  function saveLastDir(handle, dirNames) {
    if (!handle) {
      return Promise.resolve();
    }

    return openDb().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        var data = {
          handle: handle,
          dirNames: Array.isArray(dirNames) ? dirNames.slice(0, 64) : []
        };
        store.put(data, KEY_LAST_DIR);
        tx.oncomplete = function() {
          db.close();
          resolve();
        };
        tx.onerror = function() {
          db.close();
          reject(tx.error || new Error('Failed to save directory handle'));
        };
      });
    }).catch(function() {
      return Promise.resolve();
    });
  }

  function loadLastDir() {
    return openDb().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var req = store.get(KEY_LAST_DIR);
        req.onsuccess = function() {
          db.close();
          resolve(req.result || null);
        };
        req.onerror = function() {
          db.close();
          reject(req.error || new Error('Failed to load directory handle'));
        };
      });
    }).catch(function() {
      return null;
    });
  }

  return {
    saveLastDir: saveLastDir,
    loadLastDir: loadLastDir
  };
})();