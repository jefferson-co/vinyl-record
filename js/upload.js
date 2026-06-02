/**
 * upload.js
 * Handles audio file loading via the styled upload slot.
 * File never leaves the browser.
 */

const Upload = (() => {
  let onLoadedCallback = null;

  function init(onLoaded) {
    onLoadedCallback = onLoaded;
    const input = document.getElementById('file-input');
    input.addEventListener('change', _handleFile);

    // Drag-and-drop onto the entire turntable plinth
    const plinth = document.getElementById('turntable');
    plinth.addEventListener('dragover', (e) => { e.preventDefault(); });
    plinth.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file) _processFile(file);
    });
  }

  function _handleFile(e) {
    const file = e.target.files?.[0];
    if (file) _processFile(file);
    // Reset so same file can be re-selected
    e.target.value = '';
  }

  function _processFile(file) {
    if (!file.type.startsWith('audio/') && !_isKnownExt(file.name)) {
      console.warn('Not an audio file:', file.name);
      return;
    }

    // Update UI to loading state
    const label = document.getElementById('upload-label');
    const uploadText = document.getElementById('upload-text');
    uploadText.textContent = 'LOADING…';

    AudioEngine.loadFile(file, (duration) => {
      const name = _cleanName(file.name);
      _updateLabel(name);
      uploadText.textContent = name.length > 14 ? name.slice(0, 14) + '…' : name;
      label.classList.add('loaded');

      if (onLoadedCallback) onLoadedCallback(name, duration);
    });
  }

  function _isKnownExt(name) {
    return /\.(mp3|wav|m4a|ogg|aac|flac)$/i.test(name);
  }

  function _cleanName(filename) {
    // Remove extension, replace underscores/hyphens with spaces, title-case
    return filename
      .replace(/\.[^.]+$/, '')
      .replace(/[_\-]+/g, ' ')
      .trim();
  }

  function _updateLabel(name) {
    const titleEl = document.getElementById('label-title');
    const trackEl = document.getElementById('label-track');
    titleEl.textContent = 'SIDE A';
    trackEl.textContent = name;
  }

  return { init };
})();
