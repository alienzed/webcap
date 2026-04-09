var HttpModule = (function() {
  function get(url, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onload = function() {
      callback(xhr.status, xhr.responseText);
    };
    xhr.send();
  }

  function postJson(url, data, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function() {
      callback(xhr.status, xhr.responseText);
    };
    xhr.send(JSON.stringify(data));
  }

  function postFormData(url, formData, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.onload = function() {
      callback(xhr.status, xhr.responseText);
    };
    xhr.send(formData);
  }

  return {
    get: get,
    postJson: postJson,
    postFormData: postFormData
  };
})();
