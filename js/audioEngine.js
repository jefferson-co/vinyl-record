/**
 * audioEngine.js
 * Web Audio API engine for the vinyl turntable.
 * Handles: playback, scrubbing, pitch wobble, procedural crackle.
 */

const AudioEngine = (() => {
  let ctx = null;
  let sourceNode = null;
  let audioBuffer = null;
  let crackleNode = null;
  let crackleGain = null;
  let masterGain = null;
  let wobbleTimeout = null;

  // Playback state
  let startOffset = 0;        // seconds into buffer when playback started
  let startTime = 0;          // ctx.currentTime when playback started
  let playing = false;
  let currentRate = 1.0;      // current playback rate (1 = normal)
  let targetRate = 1.0;

  // Callbacks
  let onEndCallback = null;

  function ensureContext() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 1.0;
      masterGain.connect(ctx.destination);
    }
    // Resume if suspended (iOS/Chrome autoplay policy)
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** Load a File object, decode it, and call back with duration */
  function loadFile(file, onReady) {
    ensureContext();
    const reader = new FileReader();
    reader.onload = (e) => {
      ctx.decodeAudioData(e.target.result, (buffer) => {
        stop();
        audioBuffer = buffer;
        startOffset = 0;
        if (onReady) onReady(buffer.duration);
      }, (err) => {
        console.error('Decode error', err);
      });
    };
    reader.readAsArrayBuffer(file);
  }

  /** Start playback from a given offset (seconds). */
  function play(offsetSeconds, onEnd) {
    if (!audioBuffer) return;
    ensureContext();

    // Clean up any existing source
    _destroySource();

    onEndCallback = onEnd || null;
    startOffset = Math.max(0, Math.min(offsetSeconds, audioBuffer.duration));
    startTime = ctx.currentTime;

    sourceNode = ctx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.playbackRate.value = 0.0; // will ramp up during wobble
    sourceNode.connect(masterGain);

    sourceNode.onended = () => {
      if (playing) {
        playing = false;
        _stopCrackle();
        if (onEndCallback) onEndCallback();
      }
    };

    sourceNode.start(0, startOffset);
    playing = true;

    _startWobble();
    _startCrackle();
  }

  /** Pause: stores current offset for resume. */
  function pause() {
    if (!playing || !sourceNode) return;
    startOffset = getCurrentTime();
    _destroySource();
    playing = false;
    _stopCrackle();
    if (wobbleTimeout) { clearTimeout(wobbleTimeout); wobbleTimeout = null; }
  }

  /** Stop completely, reset position. */
  function stop() {
    if (playing) pause();
    startOffset = 0;
    playing = false;
  }

  /** Seek to a position without interrupting play state. */
  function seek(seconds) {
    if (!audioBuffer) return;
    const wasPlaying = playing;
    const cb = onEndCallback;
    if (wasPlaying) {
      _destroySource();
      playing = false;
    }
    startOffset = Math.max(0, Math.min(seconds, audioBuffer.duration));
    if (wasPlaying) {
      play(startOffset, cb);
      // Don't re-trigger wobble on scrub
      _cancelWobble();
      _setRate(1.0);
    }
  }

  /** Returns current playback position in seconds. */
  function getCurrentTime() {
    if (!playing) return startOffset;
    return startOffset + (ctx.currentTime - startTime) * currentRate;
  }

  function getDuration() {
    return audioBuffer ? audioBuffer.duration : 0;
  }

  function isPlaying() { return playing; }

  function hasAudio() { return !!audioBuffer; }

  // ── Internal helpers ────────────────────────────────

  function _destroySource() {
    if (sourceNode) {
      try { sourceNode.stop(); } catch (e) {}
      sourceNode.disconnect();
      sourceNode = null;
    }
    currentRate = 1.0;
  }

  function _setRate(rate) {
    if (!sourceNode) return;
    currentRate = rate;
    const now = ctx.currentTime;
    sourceNode.playbackRate.cancelScheduledValues(now);
    sourceNode.playbackRate.setValueAtTime(rate, now);
  }

  function _rampRate(fromRate, toRate, durationSeconds) {
    if (!sourceNode) return;
    const now = ctx.currentTime;
    sourceNode.playbackRate.cancelScheduledValues(now);
    sourceNode.playbackRate.setValueAtTime(fromRate, now);
    sourceNode.playbackRate.linearRampToValueAtTime(toRate, now + durationSeconds);

    // Track rate for position calculation (approximate: use midpoint)
    const rampInterval = setInterval(() => {
      if (!sourceNode) { clearInterval(rampInterval); return; }
      currentRate = sourceNode.playbackRate.value;
    }, 50);
    setTimeout(() => {
      clearInterval(rampInterval);
      currentRate = toRate;
    }, durationSeconds * 1000);
  }

  function _startWobble() {
    // Dip to 0.72 and ramp to 1.0 over ~1.1s – analog startup feel
    _rampRate(0.0, 0.72, 0.15);
    setTimeout(() => {
      if (sourceNode) _rampRate(0.72, 0.95, 0.4);
    }, 150);
    setTimeout(() => {
      if (sourceNode) _rampRate(0.95, 1.0, 0.55);
    }, 550);
    wobbleTimeout = setTimeout(() => {
      currentRate = 1.0;
      wobbleTimeout = null;
    }, 1200);
  }

  function _cancelWobble() {
    if (wobbleTimeout) { clearTimeout(wobbleTimeout); wobbleTimeout = null; }
    _setRate(1.0);
    currentRate = 1.0;
  }

  // ── Procedural Vinyl Crackle ────────────────────────

  function _startCrackle() {
    if (!ctx || crackleNode) return;

    // Script processor generates white noise with random spikes
    const bufferSize = 4096;
    crackleGain = ctx.createGain();
    crackleGain.gain.setValueAtTime(0, ctx.currentTime);
    crackleGain.gain.linearRampToValueAtTime(0.028, ctx.currentTime + 0.8);
    crackleGain.connect(masterGain);

    crackleNode = ctx.createScriptProcessor(bufferSize, 0, 1);
    crackleNode.onaudioprocess = (e) => {
      const output = e.outputBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        // Base noise very low
        let sample = (Math.random() * 2 - 1) * 0.015;
        // Occasional pop/click (dust particle)
        if (Math.random() < 0.0008) {
          sample += (Math.random() * 2 - 1) * 0.6;
        }
        // Subtle hiss grain
        if (Math.random() < 0.006) {
          sample += (Math.random() * 2 - 1) * 0.12;
        }
        output[i] = sample;
      }
    };
    crackleNode.connect(crackleGain);
  }

  function _stopCrackle() {
    if (!crackleGain || !ctx) return;
    crackleGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
    const cg = crackleGain;
    const cn = crackleNode;
    setTimeout(() => {
      try { cn.disconnect(); cg.disconnect(); } catch (e) {}
    }, 500);
    crackleNode = null;
    crackleGain = null;
  }

  // Public API
  return {
    loadFile,
    play,
    pause,
    stop,
    seek,
    getCurrentTime,
    getDuration,
    isPlaying,
    hasAudio,
    ensureContext,
  };
})();
