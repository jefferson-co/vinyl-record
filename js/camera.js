/**
 * camera.js
 * Manages camera view modes: Top View (default) and Front Angled View.
 */

const Camera = (() => {
  let rig = null;
  let toggleBtn = null;
  let label = null;
  let isAngled = false;

  function init() {
    rig = document.getElementById('camera-rig');
    toggleBtn = document.getElementById('camera-toggle');
    label = document.getElementById('camera-label');

    toggleBtn.addEventListener('click', toggle);
  }

  function toggle() {
    isAngled = !isAngled;
    if (isAngled) {
      rig.classList.add('angled');
      label.textContent = 'TOP VIEW';
    } else {
      rig.classList.remove('angled');
      label.textContent = 'FRONT VIEW';
    }
  }

  return { init, toggle };
})();
