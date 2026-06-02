/**
 * interaction.js
 * Handles all needle/tonearm drag interactions.
 * Maps radial position to playback time.
 * Works with both mouse and touch (pointer events).
 */

const Interaction = (() => {
  // DOM refs
  let pivot = null;
  let platterArea = null;
  let recordCanvas = null;

  // Geometry (computed on init and resize)
  let pivotCenter = { x: 0, y: 0 };     // pivot center in page coords
  let platCenter  = { x: 0, y: 0 };     // record center in page coords
  let recordRadius = 0;                   // px radius of record
  let innerGrooveR = 0;                  // innermost playable groove radius (px)
  let outerGrooveR = 0;                  // outermost groove radius (px)

  // Tonearm angle geometry (CSS rotate on pivot, arm extends LEFT)
  // negative = arm tip goes UP (needle parked/lifted above record plane)
  // 0°       = arm horizontal, pointing left
  // positive = arm tip goes DOWN (toward inner groove)
  const ARM_PARKED_ANGLE   = -30; // lifted off record, resting to upper-right
  const ARM_OUTER_ANGLE    =  -6; // needle at outer groove
  const ARM_INNER_ANGLE    =  24; // needle at inner groove

  // Interaction state
  let isDragging = false;
  let isOnRecord = false;
  let currentArmAngle = ARM_PARKED_ANGLE;
  let dragStartAngle = 0;
  let callbacks = {};

  // Throttle for scrub updates
  let lastScrubTime = 0;
  const SCRUB_THROTTLE_MS = 32; // ~30fps

  function init(cb) {
    pivot = document.getElementById('tonearm-pivot');
    platterArea = document.getElementById('platter-area');
    recordCanvas = document.getElementById('record-canvas');
    callbacks = cb || {};

    _updateGeometry();
    _setArmAngle(ARM_PARKED_ANGLE, false);
    _attachEvents();

    window.addEventListener('resize', () => {
      _updateGeometry();
    });
  }

  function _updateGeometry() {
    const pr = platterArea.getBoundingClientRect();
    platCenter = {
      x: pr.left + pr.width  / 2,
      y: pr.top  + pr.height / 2
    };

    const rc = recordCanvas.getBoundingClientRect();
    recordRadius = rc.width / 2;
    innerGrooveR = recordRadius * 0.17;   // center label edge
    outerGrooveR = recordRadius * 0.93;   // outer playable edge

    const pv = pivot.getBoundingClientRect();
    pivotCenter = {
      x: pv.left + pv.width  / 2,
      y: pv.top  + pv.height / 2
    };
  }

  function _setArmAngle(deg, animate) {
    currentArmAngle = deg;
    if (animate) {
      pivot.classList.add('smooth-transition');
    } else {
      pivot.classList.remove('smooth-transition');
    }
    // Rotate the entire pivot (arm tube + headshell are children)
    pivot.style.transform = `rotate(${deg}deg)`;
  }

  /** Convert arm angle → playback fraction (0=outer, 1=inner) */
  function _angleToFraction(deg) {
    return Math.max(0, Math.min(1,
      (deg - ARM_OUTER_ANGLE) / (ARM_INNER_ANGLE - ARM_OUTER_ANGLE)
    ));
  }

  /** Convert playback fraction → arm angle */
  function _fractionToAngle(frac) {
    return ARM_OUTER_ANGLE + frac * (ARM_INNER_ANGLE - ARM_OUTER_ANGLE);
  }

  /**
   * Given a pointer position, compute the CSS rotation angle that would
   * point the arm toward the pointer.
   *
   * Arm extends LEFT from pivot (180° from east = negative X direction).
   * CSS rotate(0deg) = arm horizontal left.
   * CSS rotate(+deg) = arm tip moves DOWN (clockwise).
   * CSS rotate(-deg) = arm tip moves UP (counterclockwise).
   *
   * We compute the angle from the arm's base direction (west/left = 180°) to
   * the vector from pivot to pointer, measured clockwise.
   */
  function _pointerToArmAngle(px, py) {
    const dx = px - pivotCenter.x;
    const dy = py - pivotCenter.y;
    // atan2 in screen coords (Y down): angle from east, clockwise
    const degFromEast = Math.atan2(dy, dx) * (180 / Math.PI);
    // Base arm direction is WEST (180°). CSS rotate = deviation from base direction.
    // degFromEast for WEST = 180°. Our CSS rotate = degFromEast - 180.
    let cssAngle = degFromEast - 180;
    // Normalize to a reasonable range (-180 to 180)
    if (cssAngle > 180) cssAngle -= 360;
    if (cssAngle < -180) cssAngle += 360;
    return cssAngle;
  }

  /** Is pointer within the record's playable groove band? */
  function _isOnRecord(px, py) {
    const dx = px - platCenter.x;
    const dy = py - platCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist >= innerGrooveR && dist <= outerGrooveR;
  }

  /** Compute playback fraction from pointer position on record */
  function _pointerToFraction(px, py) {
    const dx = px - platCenter.x;
    const dy = py - platCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Outer edge = 0, inner = 1
    return 1 - Math.max(0, Math.min(1,
      (dist - innerGrooveR) / (outerGrooveR - innerGrooveR)
    ));
  }

  // ── Pointer event handlers ────────────────────────

  // Pointer Events API provides clientX/clientY directly on all event types
  function _getPointerPos(e) {
    return { x: e.clientX, y: e.clientY };
  }

  function _onPointerDown(e) {
    if (isDragging) return;  // prevent double-fire from bubbling
    e.preventDefault();
    e.stopPropagation();
    AudioEngine.ensureContext();
    _updateGeometry();

    isDragging = true;
    document.body.classList.add('dragging');

    const pos = _getPointerPos(e);
    dragStartAngle = _pointerToArmAngle(pos.x, pos.y);

    // If already playing, don't call onLift yet — just start dragging
    if (isOnRecord && AudioEngine.isPlaying()) {
      // Lifting needle
      AudioEngine.pause();
      Renderer.stopSpin();
      isOnRecord = false;
      if (callbacks.onLift) callbacks.onLift();
    }
  }

  function _onPointerMove(e) {
    if (!isDragging) return;
    e.preventDefault();

    const pos = _getPointerPos(e);
    let deg = _pointerToArmAngle(pos.x, pos.y);

    // Clamp arm to valid range with a bit of overshoot allowed for UX feel
    deg = Math.max(ARM_PARKED_ANGLE - 5, Math.min(ARM_INNER_ANGLE + 4, deg));
    _setArmAngle(deg, false);

    // Throttle scrub updates
    const now = Date.now();
    if (now - lastScrubTime < SCRUB_THROTTLE_MS) return;
    lastScrubTime = now;

    // If dragging over record while playing, scrub
    if (_isOnRecord(pos.x, pos.y) && AudioEngine.hasAudio()) {
      const frac = _pointerToFraction(pos.x, pos.y);
      const seekTo = frac * AudioEngine.getDuration();
      if (AudioEngine.isPlaying()) {
        AudioEngine.seek(seekTo);
        if (callbacks.onScrub) callbacks.onScrub(frac);
      }
    }
  }

  function _onPointerUp(e) {
    if (!isDragging) return;
    isDragging = false;
    document.body.classList.remove('dragging');

    const pos = { x: e.clientX, y: e.clientY };

    const onRec = _isOnRecord(pos.x, pos.y);

    if (onRec && AudioEngine.hasAudio()) {
      const frac = _pointerToFraction(pos.x, pos.y);
      const seekTo = frac * AudioEngine.getDuration();
      const armDeg = _pointerToArmAngle(pos.x, pos.y);
      const clampedDeg = Math.max(ARM_OUTER_ANGLE - 1, Math.min(ARM_INNER_ANGLE, armDeg));
      _setArmAngle(clampedDeg, false);
      isOnRecord = true;

      AudioEngine.play(seekTo, _onTrackEnd);
      Renderer.startSpin();
      if (callbacks.onDrop) callbacks.onDrop(frac, seekTo);
    } else {
      // Park the arm
      _setArmAngle(ARM_PARKED_ANGLE, true);
      isOnRecord = false;
      if (callbacks.onLift) callbacks.onLift();
    }
  }

  function _attachEvents() {
    // Pointer events on pivot (captures pivot + arm tube children)
    pivot.addEventListener('pointerdown', _onPointerDown);

    // Headshell also initiates drag (pointer-events: all in CSS)
    const headshell = document.getElementById('headshell');
    headshell.addEventListener('pointerdown', _onPointerDown);

    // Capture move/up on document so drag works even if pointer leaves elements
    document.addEventListener('pointermove', _onPointerMove, { passive: false });
    document.addEventListener('pointerup', _onPointerUp);
    document.addEventListener('pointercancel', _onPointerUp);
  }

  function _onTrackEnd() {
    // Auto-park arm when track ends
    isOnRecord = false;
    Renderer.stopSpin();
    _setArmAngle(ARM_PARKED_ANGLE, true);
    if (callbacks.onEnd) callbacks.onEnd();
  }

  /** Called each animation frame to sync arm with playback progress */
  function syncArmToPlayback() {
    if (!isOnRecord || isDragging || !AudioEngine.isPlaying()) return;
    const frac = AudioEngine.getCurrentTime() / AudioEngine.getDuration();
    const targetAngle = _fractionToAngle(Math.min(frac, 1));
    // Smooth but direct set (no CSS transition during playback)
    currentArmAngle = targetAngle;
    pivot.style.transform = `rotate(${targetAngle}deg)`;
  }

  /** Programmatically park the arm (e.g., after upload). */
  function parkArm(animate = true) {
    isOnRecord = false;
    _setArmAngle(ARM_PARKED_ANGLE, animate);
  }

  function getIsOnRecord() { return isOnRecord; }

  return { init, syncArmToPlayback, parkArm, getIsOnRecord };
})();
