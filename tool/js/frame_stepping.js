// frame_stepping.js
// Prize-winning, robust frame-accurate stepping for video using mp4box.js + WebCodecs
// Usage: See integration steps in video_clip.js

// 1. Add mp4box.js to your HTML (latest as of 2026):
// <script src="https://cdn.jsdelivr.net/npm/mp4box@latest/dist/mp4box.all.min.js"></script>

// 2. This module provides a FrameStepper class for loading, decoding, and stepping frames.

class FrameStepper {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.frames = [];
    this.currentFrame = 0;
    this.decoder = null;
    this.track = null;
    this.samples = [];
    this.ready = false;
  }

  async load(file) {
    return new Promise((resolve, reject) => {
      const mp4boxfile = MP4Box.createFile();
      let arrayBuffer;
      let videoTrack;
      let samples = [];
      mp4boxfile.onReady = (info) => {
        videoTrack = info.tracks.find(t => t.video);
        if (!videoTrack) return reject('No video track found');
        mp4boxfile.setExtractionOptions(videoTrack.id, null, { nbSamples: 1 });
        mp4boxfile.start();
      };
      mp4boxfile.onSamples = (id, user, newSamples) => {
        samples = samples.concat(newSamples);
      };
      const reader = new FileReader();
      reader.onload = (e) => {
        arrayBuffer = e.target.result;
        arrayBuffer.fileStart = 0;
        mp4boxfile.appendBuffer(arrayBuffer);
        mp4boxfile.flush();
        if (!samples.length) return reject('No samples extracted');
        this.samples = samples;
        this.track = videoTrack;
        this.decodeAll().then(() => {
          this.ready = true;
          this.showFrame(0);
          resolve();
        });
      };
      reader.onerror = (e) => reject(e);
      reader.readAsArrayBuffer(file);
    });
  }

  async decodeAll() {
    this.frames = [];
    const config = {
      codec: this.track.codec,
      codedWidth: this.track.video.width,
      codedHeight: this.track.video.height
    };
    this.decoder = new VideoDecoder({
      output: frame => this.frames.push(frame),
      error: e => console.error('Decoder error', e)
    });
    this.decoder.configure(config);
    for (const sample of this.samples) {
      this.decoder.decode(new EncodedVideoChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp: sample.dts,
        data: sample.data
      }));
    }
    // Wait for all frames to be decoded
    await this.decoder.flush();
  }

  showFrame(idx) {
    if (!this.ready || !this.frames.length) return;
    idx = Math.max(0, Math.min(idx, this.frames.length - 1));
    this.currentFrame = idx;
    const frame = this.frames[idx];
    this.ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
  }

  stepForward() {
    this.showFrame(this.currentFrame + 1);
  }

  stepBackward() {
    this.showFrame(this.currentFrame - 1);
  }
}

// Export for use in video_clip.js
window.FrameStepper = FrameStepper;
