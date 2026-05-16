// frame_player.js
// Frame-accurate video playback and stepping for WebCap
// Plain, linear, vanilla JS. No async/await. No clever patterns.
// Requires mp4box.js (include via CDN in tool.html)

var FramePlayer = {
  canvas: null,
  ctx: null,
  frames: [],
  currentFrame: 0,
  totalFrames: 0,
  playing: false,
  playTimer: null,
  frameRate: 30,
  ready: false,
  onPlaybackEnd: null, // callback when playback reaches end
  load: function(file, onReady, onError) {
    var self = this;
    self.frames = [];
    self.currentFrame = 0;
    self.totalFrames = 0;
    self.playing = false;
    self.ready = false;
    if (!self.canvas) return onError('No canvas');
    if (!window.VideoDecoder) return onError('WebCodecs VideoDecoder not supported');
    self.ctx = self.canvas.getContext('2d');
    var mp4boxfile = MP4Box.createFile();
    var videoTrack = null;
    var samples = [];
    mp4boxfile.onReady = function(info) {
      for (var i = 0; i < info.tracks.length; i++) {
        if (info.tracks[i].video) {
          videoTrack = info.tracks[i];
          self.frameRate = videoTrack.frame_rate || videoTrack.timescale || 30;
          break;
        }
      }
      if (!videoTrack) return onError('No video track found');
      mp4boxfile.setExtractionOptions(videoTrack.id, null, { nbSamples: 1 });
      mp4boxfile.start();
    };
    mp4boxfile.onSamples = function(id, user, newSamples) {
      for (var i = 0; i < newSamples.length; i++) {
        samples.push(newSamples[i]);
      }
    };
    var reader = new FileReader();
    reader.onload = function(e) {
      var arrayBuffer = e.target.result;
      arrayBuffer.fileStart = 0;
      mp4boxfile.appendBuffer(arrayBuffer);
      mp4boxfile.flush();
      if (!samples.length) return onError('No samples extracted');
      self.decodeAll(samples, videoTrack, onReady, onError);
    };
    reader.onerror = function(e) { onError(e); };
    reader.readAsArrayBuffer(file);
  },
  decodeAll: function(samples, track, onReady, onError) {
    var self = this;
    self.frames = [];
    self.totalFrames = samples.length;
    if (!window.VideoDecoder) return onError('WebCodecs VideoDecoder not supported');
    var decoder = new window.VideoDecoder({
      output: function(frame) { self.frames.push(frame); },
      error: function(e) { onError('Decoder error: ' + e); }
    });
    // --- DEBUG: Log track object for troubleshooting ---
    if (window.console && console.log) {
      console.log('[FramePlayer] Video track:', track);
    }
    // Patch: For H.264/AVC, robustly extract the decoder config
    var config = {
      codec: track.codec,
      codedWidth: track.video.width,
      codedHeight: track.video.height
    };
    if (/^avc1|^h264/i.test(track.codec)) {
      // Try all possible fields for the AVCDecoderConfigurationRecord
      var desc = null;
      if (track.avcC && track.avcC instanceof Uint8Array) {
        desc = track.avcC;
      } else if (track.codecConfig && track.codecConfig instanceof Uint8Array) {
        desc = track.codecConfig;
      } else if (track.extra && track.extra instanceof Uint8Array) {
        desc = track.extra;
      } else if (track.codecDescription && typeof track.codecDescription === 'string') {
        // Sometimes base64 encoded
        try {
          var b64 = track.codecDescription;
          var bin = atob(b64);
          var arr = new Uint8Array(bin.length);
          for (var j = 0; j < bin.length; ++j) arr[j] = bin.charCodeAt(j);
          desc = arr;
        } catch (e) {}
      }
      // --- Patch: Extract avcC from sample_descriptions if not found ---
      if (!desc && track.sample_descriptions && track.sample_descriptions.length) {
        var sd = track.sample_descriptions[0];
        // mp4box.js: avcC is usually in sd.avcC (Uint8Array or ArrayBuffer)
        if (sd.avcC && (sd.avcC instanceof Uint8Array || sd.avcC instanceof ArrayBuffer)) {
          desc = sd.avcC instanceof Uint8Array ? sd.avcC : new Uint8Array(sd.avcC);
        }
        // Sometimes as .config or .data
        else if (sd.config && (sd.config instanceof Uint8Array || sd.config instanceof ArrayBuffer)) {
          desc = sd.config instanceof Uint8Array ? sd.config : new Uint8Array(sd.config);
        }
        else if (sd.data && (sd.data instanceof Uint8Array || sd.data instanceof ArrayBuffer)) {
          desc = sd.data instanceof Uint8Array ? sd.data : new Uint8Array(sd.data);
        }
      }
      if (desc) {
        config.description = desc;
      } else {
        var msg = 'Frame-accurate playback is not possible: this video file is missing required H.264 initialization data (avcC). Please use a standard MP4.';
        if (window.console && console.warn) {
          console.warn('[FramePlayer] No AVCDecoderConfigurationRecord found in track:', track);
        }
        if (typeof onError === 'function') onError(msg);
        return;
      }
    }
    decoder.configure(config);
    var i = 0;
    function decodeNext() {
      if (i >= samples.length) {
        decoder.flush().then(function() {
          self.ready = true;
          self.showFrame(0);
          if (onReady) onReady();
        });
        return;
      }
      var sample = samples[i++];
      decoder.decode(new EncodedVideoChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp: sample.dts,
        data: sample.data
      }));
      setTimeout(decodeNext, 0);
    }
    decodeNext();
  },
  showFrame: function(idx) {
    var self = this;
    if (!self.ready || !self.frames.length) return;
    if (idx < 0) idx = 0;
    if (idx >= self.frames.length) idx = self.frames.length - 1;
    self.currentFrame = idx;
    var frame = self.frames[idx];
    if (frame) self.ctx.drawImage(frame, 0, 0, self.canvas.width, self.canvas.height);
  },
  stepForward: function() {
    var self = this;
    if (self.currentFrame < self.frames.length - 1) {
      self.showFrame(self.currentFrame + 1);
    } else if (self.playing) {
      self.pause();
      if (typeof self.onPlaybackEnd === 'function') self.onPlaybackEnd();
    }
  },
  stepBackward: function() {
    var self = this;
    if (self.currentFrame > 0) self.showFrame(self.currentFrame - 1);
  },
  play: function() {
    var self = this;
    if (self.playing) return;
    self.playing = true;
    function next() {
      if (!self.playing) return;
      self.stepForward();
      if (self.currentFrame < self.frames.length - 1) {
        self.playTimer = setTimeout(next, 1000 / self.frameRate);
      } else {
        self.playing = false;
        if (typeof self.onPlaybackEnd === 'function') self.onPlaybackEnd();
      }
    }
    next();
  },
  pause: function() {
    var self = this;
    self.playing = false;
    if (self.playTimer) clearTimeout(self.playTimer);
  },
  getCurrentTime: function() {
    var self = this;
    return self.currentFrame / self.frameRate;
  },
  seekToTime: function(seconds) {
    var self = this;
    if (!self.ready || !self.frames.length) return;
    var idx = Math.round(seconds * self.frameRate);
    self.showFrame(idx);
  }
};
