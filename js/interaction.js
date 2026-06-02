/**
 * interaction.js
 * Clean pivot-constraint tonearm model. No spring, no bounce.
 *
 * State machine: IDLE → GRABBED → PLACED → IDLE
 *
 * - IDLE:    arm is parked at rest position
 * - GRABBED: pointer down on pivot/headshell, arm tracks pointer in arc
 * - PLACED:  needle on record, playback active, arm syncs to progress
 *
 * Transition behavior:
 * - During grab:   transition: none  (arm is instant/direct)
 * - Park on miss:  transition: 0.55s ease-out (single smooth ease, no overshoot)
 * - Sync during playback: transition: none
 */

const Interaction = (() => {

  // ── Arm angle constants (CSS rotate on #tonearm-pivot) ─────────
  // Arm extends LEFT. negative = tip UP (parked), positive = tip DOWN (inner)
  const ARM_PARKED_ANGLE = -30;
  const ARM_OUTER_ANGLE  =  -6;
  const ARM_INNER_ANGLE  =  24;
  // Drag clamping — allow slight overshoot past park/inner for feel
  const ARM_DRAG_MIN = ARM_PARKED_ANGLE - 8;
  const ARM_DRAG_MAX = ARM_INNER_ANGLE  + 8;

  // ── DOM refs ─────────────────────────────────────────────────────
  let pivot      = null;
  let platterArea = null;
  let recordCanvas = null;

  // ── Geometry (refreshed on init + resize) ───────────────────────
  let pivotCenter  = { x: 0, y: 0 };
  let platCenter   = { x: 0, y: 0 };
  let recordRadius = 0;
  let innerGrooveR = 0;
  let outerGrooveR = 0;

  // ── State ────────────────────────────────────────────────────────
  let state = 'IDLE';           // 'IDLE' | 'GRABBED' | 'PLACED'
  let currentAngle = ARM_PARKED_ANGLE;
  let callbacks    = {};
  let lastScrubTime = 0;
  const SCRUB_THROTTLE = 30;    // ms

  // ── Public init ──────────────────────────────────────────────────
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

    // Kill native browser drag ghost on ALL browsers (Chrome/Firefox ignore CSS user-drag).
    // Without this, clicking any element and dragging shows a semi-transparent copy ghost.
    document.addEventListener('dragstart', (e) => e.preventDefault());
  }

  // ── Geometry ─────────────────────────────────────────────────────
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

  // ── Angle application ─────────────────────────────────────────────
  // withTransition: false → transition: none (during drag / sync)
  // withTransition: true  → single ease-out for park animation
  function _applyAngle(deg, withTransition) {
    currentAngle = deg;
    pivot.style.transition = withTransition
      ? 'transform 0.55s ease-out'
      : 'none';
    pivot.style.transform = `rotate(${deg}deg)`;
  }

  // ── Polar coordinate: pointer → CSS arm angle ────────────────────
  // Arm base direction is WEST (180° from east). CSS rotate = deviation.
  function _pointerToDeg(px, py) {
    const dx = px - pivotCenter.x;
    const dy = py - pivotCenter.y;
    return Math.atan2(dy, dx) * (180 / Math.PI) - 180;
  }

  // ── Record hit testing ────────────────────────────────────────────
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

  // ── Pointer handlers ──────────────────────────────────────────────
  function _onDown(e) {
    if (state === 'GRABBED') return;
    e.preventDefault();
    e.stopPropagation();

    // Capture pointer so move/up fire here even if finger slides off element.
    // Critical for mobile — without this, fast swipes lose tracking.
    try { e.target.setPointerCapture(e.pointerId); } catch (_) {}

    AudioEngine.ensureContext();
    _updateGeometry();

    // If playing, lift needle first
    if (state === 'PLACED' || AudioEngine.isPlaying()) {
      AudioEngine.pause();
      Renderer.stopSpin();
      if (callbacks.onLift) callbacks.onLift();
    }

    state = 'GRABBED';
    document.body.classList.add('dragging');
  }

  function _onMove(e) {
    if (state !== 'GRABBED') return;
    e.preventDefault();

    const deg = Math.max(ARM_DRAG_MIN,
      Math.min(ARM_DRAG_MAX, _pointerToDeg(e.clientX, e.clientY)));
    _applyAngle(deg, false);

    // Live scrub hint while hovering over groove band
    const now = Date.now();
    if (now - lastScrubTime < SCRUB_THROTTLE) return;
    lastScrubTime = now;
    if (_isOnRecord(e.clientX, e.clientY) && AudioEngine.hasAudio()) {
      if (callbacks.onScrub) callbacks.onScrub(_pointerToFraction(e.clientX, e.clientY));
    }
  }

  function _onUp(e) {
    if (state !== 'GRABBED') return;

    document.body.classList.remove('dragging');

    if (_isOnRecord(e.clientX, e.clientY) && AudioEngine.hasAudio()) {
      const frac   = _pointerToFraction(e.clientX, e.clientY);
      const seekTo = frac * AudioEngine.getDuration();

      // Clamp angle to valid groove range, no transition — arm stays put
      const clamped = Math.max(ARM_OUTER_ANGLE - 1,
        Math.min(ARM_INNER_ANGLE, _pointerToDeg(e.clientX, e.clientY)));
      _applyAngle(clamped, false);

      state = 'PLACED';
      AudioEngine.play(seekTo, _onTrackEnd);
      Renderer.startSpin();
      if (callbacks.onDrop) callbacks.onDrop(frac, seekTo);
    } else {
      // Miss — ease arm back to park, no bounce
      state = 'IDLE';
      _applyAngle(ARM_PARKED_ANGLE, true);
      if (callbacks.onLift) callbacks.onLift();
    }
  }

  function _onTrackEnd() {
    state = 'IDLE';
    Renderer.stopSpin();
    _applyAngle(ARM_PARKED_ANGLE, true);
    if (callbacks.onEnd) callbacks.onEnd();
  }

  // ── Playback sync (called each animation frame) ───────────────────
  // Moves arm inward as track progresses. transition: none so it's frame-perfect.
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
