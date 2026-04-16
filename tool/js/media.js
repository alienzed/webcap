var MediaModule = (function() {
  var dropZone = null;
  var pagesApi = null;
  var editorApi = null;

  function init(config) {
    dropZone = config.dropZone;
    pagesApi = config.pagesApi;
    editorApi = config.editorApi;

    dropZone.addEventListener('dragover', function(e) {
      e.preventDefault();
      dropZone.classList.add('drag');
    });

    dropZone.addEventListener('dragleave', function() {
      dropZone.classList.remove('drag');
    });

    dropZone.addEventListener('drop', function(e) {
      e.preventDefault();
      dropZone.classList.remove('drag');
      handleDrop(e.dataTransfer.files);
    });
  }

  function handleDrop(files) {
    if (!pagesApi.getCurrentPage()) {
      pagesApi.setStatus('Load or create a page first');
      return;
    }
    if (!files || !files.length) {
      return;
    }
    var file = files[0];
    var lower = file.name.toLowerCase();
    if (!(/\.(mp4|webm|ogg)$/).test(lower)) {
      pagesApi.setStatus('Only .mp4 .webm .ogg');
      return;
    }
    uploadVideo(file, pagesApi.getCurrentPage());
  }

  function uploadVideo(file, pageName) {
    var formData = new FormData();
    formData.append('file', file);
    formData.append('page', pageName);

    HttpModule.postFormData('/upload', formData, function(status, responseText) {
      if (status !== 200) {
        pagesApi.setStatus('Upload failed');
        return;
      }
      var data = JSON.parse(responseText);
      editorApi.appendHtml(generateVideoHtml(data.filename, pageName));
      pagesApi.setStatus('Added video: ' + data.filename);
    });
  }

  function generateVideoHtml(filename, pageName) {
    return '<div class="row">\n' +
      '  <div class="col-12">\n' +
      '    <video controls style="width:100%;">\n' +
      '      <source src="/pages/' + encodeURIComponent(pageName) + '/media/' + encodeURIComponent(filename) + '">\n' +
      '    </video>\n' +
      '  </div>\n' +
      '</div>';
  }

  return {
    init: init
  };
})();
