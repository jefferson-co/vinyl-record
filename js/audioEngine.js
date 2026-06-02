/**
 * audioEngine.js
 * Web Audio API engine for the vinyl turntable.
 *
 * Audio graph:
 *   sourceNode → musicGain → masterGain → destination
 *   crackleNode → crackleGain → masterGain → destination
 *
 * musicGain is used only for per-seek micro-fades during scrub,
 * so the crackle layer is never interrupted.
 */

const AudioEngine = (() => {

  let ctx         = null;
  let sourceNode  = null;
  let audioBuffer = null;
  let masterGain  = null;
  let musicGain   = null;   // ← fades only music, not crackle
  let crackleNode = null;
  let crackleGain = null;
  let wobbleTimeout = null;

  // Playback position tracking
  let startOffset  = 0;     // seconds from buffer start when source was started
  let startTime    = 0;     // ctx.currentTime when source was started
  let playing      = false;
  let currentRate  = 1.0;   // live playback rate (updated as ramps run)
  let onEndCallback = null;

  // Scrub state
  let scrubActive    = false;
  let scrubSeekId    = 0;   // incremented each _fadedSeek call; stale timeouts compare against it
  let lastScrubSeekTs = 0;  // Date.now() of last actual seek during scrub

  const FADE_OUT    = 0.004;  // 4 ms  – fade musicGain to 0 before seek
  const FADE_IN     = 0.005;  // 5 ms  – fade musicGain back after seek
  const FADE_DELAY  = 5;      // 5 ms  – setTimeout gap (matches FADE_OUT)
  const SEEK_INTERVAL = 65;   // ms    – max scrub seek rate (~15/sec)
  const PITCH_RAMP    = 0.06; // s     – time to ramp to scrub pitch
  const PITCH_RETURN  = 0.15; // s     – time to ramp pitch back to 1.0 after scrub

  // ── Context bootstrap ─────────────────────────────────────────────
  function ensureContext() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();

      masterGain = ctx.createGain();
      masterGain.gain.value = 1.0;
      masterGain.connect(ctx.destination);

      musicGain = ctx.createGain();
      musicGain.gain.value = 1.0;
      musicGain.connect(masterGain);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // ── File loading ──────────────────────────────────────────────────
  function loadFile(file, onReady) {
    ensureContext();
    const reader = new FileReader();
    reader.onload = (ev) => {
      ctx.decodeAudioData(ev.target.result, (buffer) => {
        stop();
        audioBuffer  = buffer;
        startOffset  = 0;
        if (onReady) onReady(buffer.duration);
      }, (err) => console.error('Decode error', err));
    };
    reader.readAsArrayBuffer(file);
  }

  // ── Playback ──────────────────────────────────────────────────────
  function play(offsetSeconds, onEnd) {
    if (!audioBuffer) return;
    ensureContext();
    _destroySource();

    onEndCallback = onEnd || null;
    startOffset   = Math.max(0, Math.min(offsetSeconds, audioBuffer.duration));
    startTime     = ctx.currentTime;
    currentRate   = 0.0;

    sourceNode = ctx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.playbackRate.value = 0.0;
    sourceNode.connect(musicGain);   // ← musicGain, not masterGain
    sourceNode.onended = () => {
      if (playing) {
        playing = false;
        _stopCrackle();
        if (onEndCallback) onEndCallback();
      }
    };
    sourceNode.start(0, startOffset);
    playing = true;

    // Make sure musicGain is at 1.0 before wobble ramp
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.setValueAtTime(1.0, ctx.currentTime);

    _startWobble();
    _startCrackle();
  }

  function pause() {
    if (!playing || !sourceNode) return;
    startOffset = getCurrentTime();
    _destroySource();
    playing = false;
    _stopCrackle();
    if (wobbleTimeout) { clearTimeout(wobbleTimeout); wobbleTimeout = null; }
  }

  function stop() {
    if (playing) pause();
    startOffset = 0;
    playing     = false;
  }

  // Legacy seek – kept for non-scrub seek calls
  function seek(seconds) {
    if (!audioBuffer) return;
    const wasPlaying = playing;
    const cb         = onEndCallback;
    if (wasPlaying) { _destroySource(); playing = false; }
    startOffset = Math.max(0, Math.min(seconds, audioBuffer.duration));
    if (wasPlaying) {
      play(startOffset, cb);
      _cancelWobble();
      _setRate(1.0);
    }
  }

  function getCurrentTime() {
    if (!playing) return startOffset;
    return startOffset + (ctx.currentTime - startTime) * currentRate;
  }

  function getDuration() { return audioBuffer ? audioBuffer.duration : 0; }
  function isPlaying()   { return playing; }
  function hasAudio()    { return !!audioBuffer; }
  function isScrubbing() { return scrubActive; }

  // ── Internal: source management ──────────────────────────────────
  function _destroySource() {
    if (sourceNode) {
      try { sourceNode.stop(); } catch (_) {}
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

  function _rampRate(from, to, dur) {
    if (!sourceNode) return;
    const now = ctx.currentTime;
    sourceNode.playbackRate.cancelScheduledValues(now);
    sourceNode.playbackRate.setValueAtTime(from, now);
    sourceNode.playbackRate.linearRampToValueAtTime(to, now + dur);
    const iv = setInterval(() => {
      if (!sourceNode) { clearInterval(iv); return; }
      currentRate = sourceNode.playbackRate.value;
    }, 50);
    setTimeout(() => { clearInterval(iv); currentRate = to; }, dur * 1000);
  }

  // ── Wobble ────────────────────────────────────────────────────────
  function _startWobble() {
    _rampRate(0.0, 0.72, 0.15);
    setTimeout(() => { if (sourceNode) _rampRate(0.72, 0.95, 0.40); }, 150);
    setTimeout(() => { if (sourceNode) _rampRate(0.95, 1.00, 0.55); }, 550);
    wobbleTimeout = setTimeout(() => { currentRate = 1.0; wobbleTimeout = null; }, 1200);
  }

  function _cancelWobble() {
    if (wobbleTimeout) { clearTimeout(wobbleTimeout); wobbleTimeout = null; }
    _setRate(1.0);
    currentRate = 1.0;
  }

  // ── Crackle ───────────────────────────────────────────────────────
  function _startCrackle() {
    if (!ctx || crackleNode) return;
    crackleGain = ctx.createGain();
    crackleGain.gain.setValueAtTime(0, ctx.currentTime);
    crackleGain.gain.linearRampToValueAtTime(0.028, ctx.currentTime + 0.8);
    crackleGain.connect(masterGain);
    crackleNode = ctx.createScriptProcessor(4096, 0, 1);
    crackleNode.onaudioprocess = (ev) => {
      const out = ev.outputBuffer.getChannelData(0);
      for (let i = 0; i < out.length; i++) {
        let s = (Math.random() * 2 - 1) * 0.015;
        if (Math.random() < 0.0008) s += (Math.random() * 2 - 1) * 0.6;
        if (Math.random() < 0.006)  s += (Math.random() * 2 - 1) * 0.12;
        out[i] = s;
      }
    };
    crackleNode.connect(crackleGain);
  }

  function _stopCrackle() {
    if (!crackleGain || !ctx) return;
    crackleGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
    const cg = crackleGain, cn = crackleNode;
    setTimeout(() => { try { cn.disconnect(); cg.disconnect(); } catch (_) {} }, 500);
    crackleNode = null;
    crackleGain = null;
  }

  // ── Analog scrub system ───────────────────────────────────────────
  //
  // Principle: the needle is dragged while the record keeps playing.
  // Position changes use micro-fades (4ms out → seek → 5ms in) to mask
  // the buffer discontinuity — the result sounds like the stylus skipping
  // lightly across grooves, not a digital mute.
  //
  // Pitch is varied by drag velocity:
  //   fast inward  (velocity > 0) → slight pitch down  (0.88–1.0)
  //   fast outward (velocity < 0) → slight pitch up    (1.0–1.12)
  // Magnitude is kept subtle. On release, pitch ramps back to 1.0.

  function beginScrub() {
    scrubActive     = true;
    lastScrubSeekTs = 0;   // force first seek to go through immediately
  }

  /**
   * scrubTo(targetSeconds, velocity)
   *   targetSeconds – target playback position (from pointer fraction)
   *   velocity      – fractions/sec (positive = inward/later, negative = outward/earlier)
   */
  function scrubTo(targetSeconds, velocity) {
    if (!scrubActive || !playing || !audioBuffer) return;

    const target = Math.max(0, Math.min(targetSeconds, audioBuffer.duration));

    // Pitch deviation: subtle, clamped to ±20%
    // Inward drag (positive velocity) → slight slowdown feel
    // Outward drag (negative velocity) → slight speed-up feel
    const pitchOffset = Math.max(-0.20, Math.min(0.20, -velocity * 0.10));
    const scrubRate   = 1.0 + pitchOffset;

    const now = Date.now();
    if (now - lastScrubSeekTs >= SEEK_INTERVAL) {
      lastScrubSeekTs = now;
      _fadedSeek(target, scrubRate, null);
    } else {
      // Between seeks: just nudge the playback rate for the pitch feel
      // without the cost of a full buffer restart
      _rampPitch(scrubRate, PITCH_RAMP);
    }
  }

  /**
   * endScrub(finalSeconds | null)
   *   finalSeconds – settle position on release (null = no seek, caller pauses)
   */
  function endScrub(finalSeconds) {
    if (!scrubActive) return;
    scrubActive = false;

    if (finalSeconds !== null && playing && audioBuffer) {
      // Final settle seek: start at current pitch, ramp back to 1.0 after
      _fadedSeek(
        Math.max(0, Math.min(finalSeconds, audioBuffer.duration)),
        currentRate,
        1.0           // rampToRate – applied after the new source starts
      );
    } else if (playing && sourceNode) {
      // No final seek: just ramp pitch back to normal
      _rampPitch(1.0, PITCH_RETURN);
    }
  }

  // ── Micro-fade seek ───────────────────────────────────────────────
  //
  // _fadedSeek(seconds, startRate, rampToRate)
  //
  //  1. Fade musicGain → 0  over FADE_OUT ms
  //  2. After FADE_DELAY ms: recreate sourceNode at `seconds`, rate = startRate
  //  3. Fade musicGain → 1  over FADE_IN ms
  //  4. If rampToRate provided: schedule a playbackRate ramp to rampToRate
  //
  // Race safety: each call increments scrubSeekId. The setTimeout closure
  // checks its captured id; if a newer seek has fired, the old one is a no-op.
  //
  function _fadedSeek(seconds, startRate, rampToRate) {
    if (!ctx || !audioBuffer || !musicGain) return;

    const id  = ++scrubSeekId;
    const now = ctx.currentTime;

    // Fade out musicGain
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setValueAtTime(musicGain.gain.value, now);
    musicGain.gain.linearRampToValueAtTime(0.0, now + FADE_OUT);

    setTimeout(() => {
      if (id !== scrubSeekId) return;   // stale — a newer seek already fired
      if (!playing || !audioBuffer) return;

      const savedCb = onEndCallback;

      // Tear down old source
      if (sourceNode) {
        try { sourceNode.stop(); } catch (_) {}
        sourceNode.disconnect();
        sourceNode = null;
      }

      // Build new source at target position
      const safeOffset = Math.max(0, Math.min(seconds, audioBuffer.duration));
      sourceNode = ctx.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.playbackRate.value = startRate;
      sourceNode.connect(musicGain);
      sourceNode.onended = () => {
        if (playing) {
          playing = false;
          _stopCrackle();
          if (savedCb) savedCb();
        }
      };

      startOffset = safeOffset;
      startTime   = ctx.currentTime;
      currentRate = startRate;
      sourceNode.start(0, safeOffset);

      // Fade musicGain back in
      const t = ctx.currentTime;
      musicGain.gain.cancelScheduledValues(t);
      musicGain.gain.setValueAtTime(0.0, t);
      musicGain.gain.linearRampToValueAtTime(1.0, t + FADE_IN);

      // Optional: schedule pitch ramp (e.g. back to 1.0 after scrub release)
      if (rampToRate !== null && rampToRate !== undefined && rampToRate !== startRate) {
        const t2 = ctx.currentTime;
        sourceNode.playbackRate.cancelScheduledValues(t2);
        sourceNode.playbackRate.setValueAtTime(startRate, t2);
        sourceNode.playbackRate.linearRampToValueAtTime(rampToRate, t2 + PITCH_RETURN);
        setTimeout(() => { currentRate = rampToRate; }, PITCH_RETURN * 1000 + 20);
      }

    }, FADE_DELAY);
  }

  // Apply a smooth pitch ramp to the current (live) sourceNode
  function _rampPitch(toRate, dur) {
    if (!sourceNode || !ctx) return;
    const now = ctx.currentTime;
    sourceNode.playbackRate.cancelScheduledValues(now);
    sourceNode.playbackRate.setValueAtTime(currentRate, now);
    sourceNode.playbackRate.linearRampToValueAtTime(toRate, now + dur);
    setTimeout(() => { currentRate = toRate; }, dur * 1000 + 10);
  }

  // ── Public API ────────────────────────────────────────────────────
  return {
    ensureContext,
    loadFile,
    play,
    pause,
    stop,
    seek,
    getCurrentTime,
    getDuration,
    isPlaying,
    hasAudio,
    isScrubbing,
    beginScrub,
    scrubTo,
    endScrub,
  };
})();
