/**
 * interaction.js
 * Pivot-constraint tonearm model with analog scrub behavior.
 *
 * State machine: IDLE → GRABBED → PLACED → IDLE
 *
 * Scrub mode (GRABBED while audio was playing):
 *   Audio keeps running while the needle is held.
 *   Position changes are micro-faded (no digital snap).
 *   Drag velocity modulates playback pitch for analog feel.
 *   On release → settle to final position, pitch ramps back to 1.0.
 *
 * Fresh drop (GRABBED while IDLE):
 *   Normal play() from the dropped position.
 */

const Interaction = (() => {

  // ── Arm angle constants ──────────────────────────────────────────
  const ARM_PARKED_ANGLE = -30;
  const ARM_OUTER_ANGLE  =  -6;
  const ARM_INNER_ANGLE  =  24;
  const ARM_DRAG_MIN = ARM_PARKED_ANGLE - 8;
  const ARM_DRAG_MAX = ARM_INNER_ANGLE  + 8;

  // ── DOM refs ──────────────────────────────────────────────────────
  let pivot        = null;
  let platterArea  = null;
  let recordCanvas = null;

  // ── Geometry ──────────────────────────────────────────────────────
  let pivotCenter  = { x: 0, y: 0 };
  let platCenter   = { x: 0, y: 0 };
  let recordRadius = 0;
  let innerGrooveR = 0;
  let outerGrooveR = 0;

  // ── Interaction state ─────────────────────────────────────────────
  let state        = 'IDLE';   // 'IDLE' | 'GRABBED' | 'PLACED'
  let currentAngle = ARM_PARKED_ANGLE;
  let callbacks    = {};

  // ── Scrub throttle ────────────────────────────────────────────────
  let lastScrubTime = 0;
  const SCRUB_THROTTLE = 65; // ms — matches AudioEngine SEEK_INTERVAL

  // ── Velocity tracking (for pitch during drag) ─────────────────────
  // Rolling low-pass average of drag speed in fractions/second.
  // Positive = inward (toward inner groove / later), negative = outward.
  let velPrevFrac = null;
  let velPrevTime = null;
  let scrubVelocity = 0;       // smoothed fractions/sec
  const VEL_ALPHA   = 0.35;    // smoothing factor (lower = smoother/slower)

  function _updateVelocity(frac, nowMs) {
    if (velPrevFrac !== null && velPrevTime !== null) {
      const dt = (nowMs - velPrevTime) / 1000;
      // Only use samples in a reasonable window (skip outliers)
      if (dt >= 0.008 && dt <= 0.15) {
        const raw  = (frac - velPrevFrac) / dt;
        scrubVelocity = scrubVelocity * (1 - VEL_ALPHA) + raw * VEL_ALPHA;
      }
    }
    velPrevFrac = frac;
    velPrevTime = nowMs;
  }

  function _resetVelocity() {
    velPrevFrac   = null;
    velPrevTime   = null;
    scrubVelocity = 0;
  }

  // ── Init ──────────────────────────────────────────────────────────
  function init(cb) {
    pivot        = document.getElementById('tonearm-pivot');
    platterArea  = document.getElementById('platter-area');
    recordCanvas = document.getElementById('record-canvas');
    callbacks    = cb || {};

    _updateGeometry();
    _applyAngle(ARM_PARKED_ANGLE, false);

    const headshell = document.getElementById('headshell');
    pivot.addEventListener('pointerdown', _onDown);
    headshell.addEventListener('pointerdown', _onDown);

    document.addEventListener('pointermove', _onMove, { passive: false });
    document.addEventListener('pointerup',     _onUp);
    document.addEventListener('pointercancel', _onUp);

    window.addEventListener('resize', _updateGeometry);

    // Suppress native browser drag ghost (Chrome/Firefox don't respect CSS user-drag)
    document.addEventListener('dragstart', (e) => e.preventDefault());
  }

  // ── Geometry ──────────────────────────────────────────────────────
  function _updateGeometry() {
    const pr = platterArea.getBoundingClientRect();
    platCenter = { x: pr.left + pr.width / 2, y: pr.top + pr.height / 2 };

    const rc = recordCanvas.getBoundingClientRect();
    recordRadius = rc.width / 2;
    innerGrooveR = recordRadius * 0.17;
    outerGrooveR = recordRadius * 0.93;

    const pv = pivot.getBoundingClientRect();
    pivotCenter = { x: pv.left + pv.width / 2, y: pv.top + pv.height / 2 };
  }

  // ── Angle ──────────────────────────────────────────────────────────
  function _applyAngle(deg, withTransition) {
    currentAngle = deg;
    pivot.style.transition = withTransition ? 'transform 0.55s ease-out' : 'none';
    pivot.style.transform  = `rotate(${deg}deg)`;
  }

  function _pointerToDeg(px, py) {
    const dx = px - pivotCenter.x;
    const dy = py - pivotCenter.y;
    return Math.atan2(dy, dx) * (180 / Math.PI) - 180;
  }

  // ── Record hit tests ───────────────────────────────────────────────
  function _distFromCenter(px, py) {
    const dx = px - platCenter.x;
    const dy = py - platCenter.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function _isOnRecord(px, py) {
    const d = _distFromCenter(px, py);
    return d >= innerGrooveR && d <= outerGrooveR;
  }

  function _pointerToFraction(px, py) {
    const d = _distFromCenter(px, py);
    return 1 - Math.max(0, Math.min(1,
      (d - innerGrooveR) / (outerGrooveR - innerGrooveR)
    ));
  }

  function _fractionToAngle(frac) {
    return ARM_OUTER_ANGLE + frac * (ARM_INNER_ANGLE - ARM_OUTER_ANGLE);
  }

  // ── Pointer: DOWN ──────────────────────────────────────────────────
  function _onDown(e) {
    if (state === 'GRABBED') return;
    e.preventDefault();
    e.stopPropagation();
    try { e.target.setPointerCapture(e.pointerId); } catch (_) {}

    AudioEngine.ensureContext();
    _updateGeometry();
    _resetVelocity();

    if (AudioEngine.isPlaying()) {
      // Audio is running — enter scrub mode.
      // Do NOT pause; let audio keep playing while needle is held.
      // Pitch and position are adjusted live via scrubTo().
      AudioEngine.beginScrub();
    }
    // If not playing: normal IDLE→GRABBED, no scrub needed.

    state = 'GRABBED';
    document.body.classList.add('dragging');
  }

  // ── Pointer: MOVE ──────────────────────────────────────────────────
  function _onMove(e) {
    if (state !== 'GRABBED') return;
    e.preventDefault();

    // Arm follows pointer along its arc
    const deg = Math.max(ARM_DRAG_MIN, Math.min(ARM_DRAG_MAX, _pointerToDeg(e.clientX, e.clientY)));
    _applyAngle(deg, false);

    if (!AudioEngine.isScrubbing() || !AudioEngine.hasAudio()) return;

    const nowMs = Date.now();
    const frac  = _pointerToFraction(e.clientX, e.clientY);
    _updateVelocity(frac, nowMs);

    // Throttled scrub (matches audio engine's seek interval)
    if (nowMs - lastScrubTime < SCRUB_THROTTLE) return;
    lastScrubTime = nowMs;

    if (_isOnRecord(e.clientX, e.clientY)) {
      AudioEngine.scrubTo(frac * AudioEngine.getDuration(), scrubVelocity);
      if (callbacks.onScrub) callbacks.onScrub(frac);
    }
  }

  // ── Pointer: UP ────────────────────────────────────────────────────
  function _onUp(e) {
    if (state !== 'GRABBED') return;
    document.body.classList.remove('dragging');

    const onRec   = _isOnRecord(e.clientX, e.clientY);
    const hasAudio = AudioEngine.hasAudio();
    const wasScrubbing = AudioEngine.isScrubbing();

    if (onRec && hasAudio) {
      const frac    = _pointerToFraction(e.clientX, e.clientY);
      const seekTo  = frac * AudioEngine.getDuration();
      const clamped = Math.max(ARM_OUTER_ANGLE - 1, Math.min(ARM_INNER_ANGLE, _pointerToDeg(e.clientX, e.clientY)));
      _applyAngle(clamped, false);

      state = 'PLACED';

      if (wasScrubbing) {
        // Was playing during drag — settle to final groove, ramp pitch back to 1.0.
        // Audio keeps playing; endScrub does a final micro-fade seek.
        AudioEngine.endScrub(seekTo);
        if (callbacks.onDrop) callbacks.onDrop(frac, seekTo);
      } else {
        // Fresh needle drop from parked position — start playback.
        AudioEngine.play(seekTo, _onTrackEnd);
        Renderer.startSpin();
        if (callbacks.onDrop) callbacks.onDrop(frac, seekTo);
      }
    } else {
      // Released off record
      if (wasScrubbing) {
        AudioEngine.endScrub(null);  // restore pitch only
        AudioEngine.pause();
        Renderer.stopSpin();
      } else if (AudioEngine.isPlaying()) {
        AudioEngine.pause();
        Renderer.stopSpin();
      }

      state = 'IDLE';
      _applyAngle(ARM_PARKED_ANGLE, true);
      if (callbacks.onLift) callbacks.onLift();
    }

    _resetVelocity();
  }

  // ── Track end ──────────────────────────────────────────────────────
  function _onTrackEnd() {
    state = 'IDLE';
    Renderer.stopSpin();
    _applyAngle(ARM_PARKED_ANGLE, true);
    if (callbacks.onEnd) callbacks.onEnd();
  }

  // ── Arm sync loop (called each animation frame) ───────────────────
  // Runs only while PLACED. During GRABBED, arm is manually controlled.
  function syncArmToPlayback() {
    if (state !== 'PLACED' || !AudioEngine.isPlaying()) return;
    const frac = Math.min(AudioEngine.getCurrentTime() / AudioEngine.getDuration(), 1);
    const deg  = _fractionToAngle(frac);
    currentAngle = deg;
    pivot.style.transition = 'none';
    pivot.style.transform  = `rotate(${deg}deg)`;
  }

  function parkArm(animate = true) {
    state = 'IDLE';
    _applyAngle(ARM_PARKED_ANGLE, animate);
  }

  function getState() { return state; }

  return { init, syncArmToPlayback, parkArm, getState };
})();
