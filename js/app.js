/**
 * app.js
 * Main orchestrator. Wires all modules together,
 * runs the main animation loop for arm sync.
 */

(function () {
  'use strict';

  // ── DOM refs ────────────────────────────────────────
  const statusDot  = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const hint       = document.getElementById('hint');

  // ── State ───────────────────────────────────────────
  let audioLoaded = false;
  let hintDismissed = false;

  // ── Boot ────────────────────────────────────────────
  window.addEventListener('DOMContentLoaded', () => {
    Renderer.init();
    Camera.init();
    Upload.init(onAudioLoaded);
    Interaction.init({
      onDrop:  onNeedleDrop,
      onLift:  onNeedleLift,
      onScrub: onScrub,
      onEnd:   onTrackEnd,
    });

    _addVentLines();
    _setStatus('READY', false);

    // Start main loop
    _mainLoop();
  });

  // ── Event handlers ───────────────────────────────────

  function onAudioLoaded(name, duration) {
    audioLoaded = true;
    // Stop any current playback, park arm
    AudioEngine.stop();
    Renderer.stopSpin(true);
    Interaction.parkArm(true);
    _setStatus('LOADED', false);
    _showHint('Drag the needle onto the record to play');
  }

  function onNeedleDrop(fraction, seekSeconds) {
    _dismissHint();
    _setStatus('PLAYING', true);
  }

  function onNeedleLift() {
    _setStatus(audioLoaded ? 'LOADED' : 'READY', false);
  }

  function onScrub(fraction) {
    // Visual feedback – status stays "PLAYING"
  }

  function onTrackEnd() {
    _setStatus('DONE', false);
    setTimeout(() => {
      _setStatus(audioLoaded ? 'LOADED' : 'READY', false);
    }, 2000);
  }

  // ── Main animation loop ──────────────────────────────
  // Syncs tonearm position to playback progress
  function _mainLoop() {
    Interaction.syncArmToPlayback();
    requestAnimationFrame(_mainLoop);
  }

  // ── UI helpers ───────────────────────────────────────

  function _setStatus(text, isPlaying) {
    statusText.textContent = text;
    statusDot.className = '';
    if (isPlaying) statusDot.classList.add('playing');
    else if (text === 'LOADED') statusDot.classList.add('ready');
  }

  function _showHint(msg) {
    if (hintDismissed) return;
    hint.textContent = msg;
    hint.classList.remove('hidden');
  }

  function _dismissHint() {
    hintDismissed = true;
    hint.classList.add('hidden');
  }

  // ── Decorative vent lines on plinth ─────────────────
  function _addVentLines() {
    const plinth = document.getElementById('turntable');
    const vent = document.createElement('div');
    vent.className = 'vent';
    for (let i = 0; i < 4; i++) {
      const line = document.createElement('div');
      line.className = 'vent-line';
      vent.appendChild(line);
    }
    plinth.appendChild(vent);
  }

})();
