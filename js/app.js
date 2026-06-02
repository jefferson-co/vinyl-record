/**
 * app.js
 * Main orchestrator. Wires all modules together,
 * runs the main animation loop for arm sync.
 */

(function () {
  'use strict';

  const statusDot  = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const hint       = document.getElementById('hint');

  let audioLoaded    = false;
  let hintDismissed  = false;

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
    Spotify.init(onSpotifyTrackSelected);

    _addVentLines();
    _setStatus('READY', false);
    _mainLoop();
  });

  // ── Audio loaded (file upload) ────────────────────────────────────
  function onAudioLoaded(name, duration) {
    audioLoaded = true;
    AudioEngine.stop();
    Renderer.stopSpin(true);
    Interaction.parkArm(true);
    _setStatus('LOADED', false);
    _showHint('Drag the needle onto the record to play');
  }

  // ── Spotify track selected ────────────────────────────────────────
  function onSpotifyTrackSelected(track) {
    // Stop current playback and park
    AudioEngine.stop();
    Renderer.stopSpin(true);
    Interaction.parkArm(true);

    // Update center label
    document.getElementById('label-title').textContent = 'SPOTIFY';
    document.getElementById('label-track').textContent = track.name;

    // Update upload slot label to show track name
    const uploadText = document.getElementById('upload-text');
    const shortName = track.name.length > 14 ? track.name.slice(0, 14) + '…' : track.name;
    uploadText.textContent = shortName;
    document.getElementById('upload-label').classList.add('loaded');

    _setStatus('LOADING', false);
    _showHint(`Loading: ${track.name}`);

    AudioEngine.loadUrl(
      track.previewUrl,
      (duration) => {
        audioLoaded = true;
        _setStatus('LOADED', false);
        _showHint('Drag the needle onto the record to play');
      },
      () => {
        _setStatus('ERROR', false);
        _showHint('Preview unavailable — try another track');
        setTimeout(() => _showHint('Drag the needle onto the record to play'), 3000);
      }
    );
  }

  // ── Needle interaction callbacks ──────────────────────────────────
  function onNeedleDrop(fraction, seekSeconds) {
    _dismissHint();
    _setStatus('PLAYING', true);
  }

  function onNeedleLift() {
    _setStatus(audioLoaded ? 'LOADED' : 'READY', false);
  }

  function onScrub() { /* status stays "PLAYING" */ }

  function onTrackEnd() {
    _setStatus('DONE', false);
    setTimeout(() => {
      _setStatus(audioLoaded ? 'LOADED' : 'READY', false);
    }, 2000);
  }

  // ── Animation loop ────────────────────────────────────────────────
  function _mainLoop() {
    Interaction.syncArmToPlayback();
    requestAnimationFrame(_mainLoop);
  }

  // ── UI helpers ────────────────────────────────────────────────────
  function _setStatus(text, isPlaying) {
    statusText.textContent = text;
    statusDot.className = '';
    if (isPlaying) statusDot.classList.add('playing');
    else if (text === 'LOADED') statusDot.classList.add('ready');
  }

  function _showHint(msg) {
    hint.textContent = msg;
    hint.classList.remove('hidden');
  }

  function _dismissHint() {
    hintDismissed = true;
    hint.classList.add('hidden');
  }

  function _addVentLines() {
    const plinth = document.getElementById('turntable');
    const vent   = document.createElement('div');
    vent.className = 'vent';
    for (let i = 0; i < 4; i++) {
      const line = document.createElement('div');
      line.className = 'vent-line';
      vent.appendChild(line);
    }
    plinth.appendChild(vent);
  }

})();
