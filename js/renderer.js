/**
 * renderer.js
 * Canvas-based rendering for the vinyl record and wood grain.
 * Handles groove drawing, spin animation, and reflection effects.
 */

const Renderer = (() => {
  let recordCanvas = null;
  let recordCtx = null;
  let woodCanvas = null;
  let woodCtx = null;
  let spinAngle = 0;           // degrees, continuously incremented
  let lastTimestamp = null;
  let rafId = null;
  let spinning = false;
  let spinSpeed = 0;           // degrees per second (target: 360/1.8 = 200 deg/s)
  const TARGET_SPEED = 360 / 1.8; // 33⅓ RPM

  // Reflection shimmer state
  let shimmerAngle = 0;

  function init() {
    recordCanvas = document.getElementById('record-canvas');
    recordCtx = recordCanvas.getContext('2d');
    woodCanvas = document.getElementById('wood-grain');
    woodCtx = woodCanvas.getContext('2d');

    _sizeCanvases();
    _drawWoodGrain();
    _drawRecord(0);

    window.addEventListener('resize', () => {
      _sizeCanvases();
      _drawWoodGrain();
    });
  }

  function _sizeCanvases() {
    // Record canvas – match CSS size (use devicePixelRatio for sharpness)
    const dpr = window.devicePixelRatio || 1;
    const plinth = document.getElementById('turntable');
    const rec = document.getElementById('record-canvas');

    const recCss = rec.getBoundingClientRect();
    recordCanvas.width  = Math.round(recCss.width  * dpr);
    recordCanvas.height = Math.round(recCss.height * dpr);
    recordCtx.scale(dpr, dpr);

    // Wood canvas
    const pw = plinth.getBoundingClientRect();
    woodCanvas.width  = Math.round(pw.width  * dpr);
    woodCanvas.height = Math.round(pw.height * dpr);
    woodCtx.scale(dpr, dpr);
    _drawWoodGrain();
  }

  function _drawWoodGrain() {
    const c = woodCanvas;
    const ctx = woodCtx;
    const W = c.width / (window.devicePixelRatio || 1);
    const H = c.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, W, H);

    // Draw horizontal wood grain lines with varying opacity and width
    const grainCount = 80;
    for (let i = 0; i < grainCount; i++) {
      const y = (H / grainCount) * i + Math.sin(i * 3.7) * 3;
      const width = 0.5 + Math.random() * 1.2;
      const opacity = 0.06 + Math.random() * 0.14;
      const curve = Math.sin(i * 0.4) * 8;

      ctx.beginPath();
      ctx.moveTo(0, y + curve * 0.5);
      ctx.bezierCurveTo(
        W * 0.3, y + curve,
        W * 0.7, y - curve * 0.8,
        W, y + curve * 0.3
      );
      ctx.strokeStyle = `rgba(255,180,80,${opacity})`;
      ctx.lineWidth = width;
      ctx.stroke();
    }

    // Occasional darker knot suggestion
    for (let k = 0; k < 3; k++) {
      const kx = W * (0.1 + Math.random() * 0.8);
      const ky = H * (0.1 + Math.random() * 0.8);
      const grad = ctx.createRadialGradient(kx, ky, 0, kx, ky, 30);
      grad.addColorStop(0, 'rgba(0,0,0,0.15)');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.fillRect(kx - 30, ky - 30, 60, 60);
    }
  }

  /** Draw the static record appearance + grooves. angle in degrees. */
  function _drawRecord(angleDeg) {
    const canvas = recordCanvas;
    const ctx = recordCtx;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(W, H) / 2 - 2;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angleDeg * Math.PI / 180);
    ctx.translate(-cx, -cy);

    // ── Outer vinyl disc ──────────────────────────────
    const vinylGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    vinylGrad.addColorStop(0.00, '#1a1a1e');
    vinylGrad.addColorStop(0.08, '#0e0e12');
    vinylGrad.addColorStop(0.15, '#0d0d0f');
    vinylGrad.addColorStop(0.85, '#111114');
    vinylGrad.addColorStop(0.96, '#0a0a0c');
    vinylGrad.addColorStop(1.00, '#050508');

    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = vinylGrad;
    ctx.fill();

    // ── Groove rings ─────────────────────────────────
    // Draw many concentric rings with slight variation to simulate grooves
    const grooveStart = R * 0.165;  // inner groove radius
    const grooveEnd   = R * 0.93;   // outer edge
    const grooveCount = 55;
    const step = (grooveEnd - grooveStart) / grooveCount;

    for (let i = 0; i < grooveCount; i++) {
      const r = grooveStart + i * step;
      // Alternate very slightly darker / lighter for groove illusion
      const isEven = i % 2 === 0;
      const alpha = isEven ? 0.12 : 0.07;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = isEven ? 0.5 : 0.3;
      ctx.stroke();
    }

    // ── Groove reflection arc – rotates with disc ────
    const shimR = grooveStart + (grooveEnd - grooveStart) * 0.5;
    const shimLen = Math.PI * 0.35;
    const shimStart = Math.PI * 0.1 + (angleDeg * Math.PI / 180) * 0.4;

    const shimGrad = ctx.createConicalGradient
      ? null  // only available in some environments
      : null;

    // Fallback: arc-based reflection
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, shimR, shimStart, shimStart + shimLen);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = shimR * 0.55;
    ctx.stroke();
    ctx.restore();

    // Second smaller highlight
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, shimR * 0.6, shimStart + Math.PI * 0.8, shimStart + Math.PI * 0.8 + shimLen * 0.6);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = shimR * 0.3;
    ctx.stroke();
    ctx.restore();

    // ── Label area (inner ring only – actual label is HTML overlay) ──
    const labelR = R * 0.155;
    const labelGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, labelR);
    labelGrad.addColorStop(0, '#c4a060');
    labelGrad.addColorStop(0.4, '#e8d4a0');
    labelGrad.addColorStop(0.8, '#d4b070');
    labelGrad.addColorStop(1, '#a88040');

    ctx.beginPath();
    ctx.arc(cx, cy, labelR, 0, Math.PI * 2);
    ctx.fillStyle = labelGrad;
    ctx.fill();

    // Label concentric detail lines
    for (let li = 1; li < 6; li++) {
      ctx.beginPath();
      ctx.arc(cx, cy, labelR * (li / 6), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.1)';
      ctx.lineWidth = 0.4;
      ctx.stroke();
    }

    // ── Outer edge bevel ─────────────────────────────
    const edgeGrad = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R);
    edgeGrad.addColorStop(0, 'transparent');
    edgeGrad.addColorStop(0.7, 'rgba(255,255,255,0.04)');
    edgeGrad.addColorStop(1, 'rgba(0,0,0,0.4)');

    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = edgeGrad;
    ctx.fill();

    ctx.restore();
  }

  /** Start spinning animation. Called when needle drops. */
  function startSpin() {
    spinning = true;
    if (!rafId) _loop(performance.now());
  }

  /** Stop spinning (immediate or with deceleration). */
  function stopSpin(immediate = false) {
    spinning = false;
    if (immediate && rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
      lastTimestamp = null;
    }
    // If not immediate, let the loop decelerate naturally
  }

  function _loop(ts) {
    if (lastTimestamp === null) lastTimestamp = ts;
    const dt = Math.min((ts - lastTimestamp) / 1000, 0.05); // seconds, capped
    lastTimestamp = ts;

    if (spinning) {
      // Ease speed toward target
      spinSpeed += (TARGET_SPEED - spinSpeed) * Math.min(dt * 4, 1);
    } else {
      // Decelerate
      spinSpeed *= Math.max(0, 1 - dt * 5);
    }

    if (spinSpeed > 0.5) {
      spinAngle = (spinAngle + spinSpeed * dt) % 360;
      _drawRecord(spinAngle);
      rafId = requestAnimationFrame(_loop);
    } else {
      spinSpeed = 0;
      rafId = null;
      lastTimestamp = null;
      _drawRecord(spinAngle);
    }
  }

  function getSpinAngle() { return spinAngle; }

  return { init, startSpin, stopSpin, getSpinAngle };
})();
