/**
 * renderer.js
 * Canvas rendering for the vinyl record and wood grain.
 * Spin loop is the single source of rotation truth — no CSS animation.
 */

const Renderer = (() => {
  let recordCanvas = null;
  let recordCtx    = null;
  let woodCanvas   = null;
  let woodCtx      = null;

  let spinAngle     = 0;      // current rotation in degrees
  let spinSpeed     = 0;      // degrees per second
  let spinning      = false;  // true = accelerate, false = decelerate
  let lastTimestamp = null;
  let rafId         = null;

  const TARGET_SPEED = 360 / 1.8; // 33⅓ RPM ≈ 200 deg/s

  // ── Init ─────────────────────────────────────────────────────────
  function init() {
    recordCanvas = document.getElementById('record-canvas');
    recordCtx    = recordCanvas.getContext('2d');
    woodCanvas   = document.getElementById('wood-grain');
    woodCtx      = woodCanvas.getContext('2d');

    _sizeCanvases();
    _drawWoodGrain();
    _drawRecord(0);

    window.addEventListener('resize', () => {
      _sizeCanvases();
      _drawWoodGrain();
      _drawRecord(spinAngle);
    });
  }

  // ── Canvas sizing ─────────────────────────────────────────────────
  function _sizeCanvases() {
    const dpr    = window.devicePixelRatio || 1;
    const recCss = document.getElementById('record-canvas').getBoundingClientRect();
    const plCss  = document.getElementById('turntable').getBoundingClientRect();

    recordCanvas.width  = Math.round(recCss.width  * dpr);
    recordCanvas.height = Math.round(recCss.height * dpr);
    recordCtx.scale(dpr, dpr);

    woodCanvas.width  = Math.round(plCss.width  * dpr);
    woodCanvas.height = Math.round(plCss.height * dpr);
    woodCtx.scale(dpr, dpr);
  }

  // ── Wood grain ────────────────────────────────────────────────────
  function _drawWoodGrain() {
    const dpr = window.devicePixelRatio || 1;
    const W = woodCanvas.width / dpr;
    const H = woodCanvas.height / dpr;
    woodCtx.clearRect(0, 0, W, H);

    for (let i = 0; i < 80; i++) {
      const y     = (H / 80) * i + Math.sin(i * 3.7) * 3;
      const curve = Math.sin(i * 0.4) * 8;
      woodCtx.beginPath();
      woodCtx.moveTo(0, y + curve * 0.5);
      woodCtx.bezierCurveTo(W * 0.3, y + curve, W * 0.7, y - curve * 0.8, W, y + curve * 0.3);
      woodCtx.strokeStyle = `rgba(255,180,80,${0.06 + Math.random() * 0.14})`;
      woodCtx.lineWidth   = 0.5 + Math.random() * 1.2;
      woodCtx.stroke();
    }
    for (let k = 0; k < 3; k++) {
      const kx   = W * (0.1 + Math.random() * 0.8);
      const ky   = H * (0.1 + Math.random() * 0.8);
      const grad = woodCtx.createRadialGradient(kx, ky, 0, kx, ky, 30);
      grad.addColorStop(0, 'rgba(0,0,0,0.15)');
      grad.addColorStop(1, 'transparent');
      woodCtx.fillStyle = grad;
      woodCtx.fillRect(kx - 30, ky - 30, 60, 60);
    }
  }

  // ── Record drawing ────────────────────────────────────────────────
  function _drawRecord(angleDeg) {
    const dpr = window.devicePixelRatio || 1;
    const W   = recordCanvas.width  / dpr;
    const H   = recordCanvas.height / dpr;
    const cx  = W / 2;
    const cy  = H / 2;
    const R   = Math.min(W, H) / 2 - 2;
    const ctx = recordCtx;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angleDeg * Math.PI / 180);
    ctx.translate(-cx, -cy);

    // Vinyl body
    const vg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    vg.addColorStop(0.00, '#1a1a1e');
    vg.addColorStop(0.08, '#0e0e12');
    vg.addColorStop(0.15, '#0d0d0f');
    vg.addColorStop(0.85, '#111114');
    vg.addColorStop(0.96, '#0a0a0c');
    vg.addColorStop(1.00, '#050508');
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = vg;
    ctx.fill();

    // Groove rings
    const gs = R * 0.165;
    const ge = R * 0.93;
    const gn = 55;
    for (let i = 0; i < gn; i++) {
      const r  = gs + (ge - gs) * (i / gn);
      const ev = i % 2 === 0;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${ev ? 0.12 : 0.07})`;
      ctx.lineWidth   = ev ? 0.5 : 0.3;
      ctx.stroke();
    }

    // Rotating vinyl sheen
    const shimR  = gs + (ge - gs) * 0.5;
    const sStart = Math.PI * 0.1;
    const sLen   = Math.PI * 0.35;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, shimR, sStart, sStart + sLen);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth   = shimR * 0.55;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, shimR * 0.6, sStart + Math.PI * 0.8, sStart + Math.PI * 0.8 + sLen * 0.6);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth   = shimR * 0.3;
    ctx.stroke();
    ctx.restore();

    // Label area
    const lr = R * 0.155;
    const lg = ctx.createRadialGradient(cx, cy, 0, cx, cy, lr);
    lg.addColorStop(0, '#c4a060');
    lg.addColorStop(0.4, '#e8d4a0');
    lg.addColorStop(0.8, '#d4b070');
    lg.addColorStop(1, '#a88040');
    ctx.beginPath();
    ctx.arc(cx, cy, lr, 0, Math.PI * 2);
    ctx.fillStyle = lg;
    ctx.fill();

    for (let li = 1; li < 6; li++) {
      ctx.beginPath();
      ctx.arc(cx, cy, lr * (li / 6), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.1)';
      ctx.lineWidth   = 0.4;
      ctx.stroke();
    }

    // Edge bevel
    const eg = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R);
    eg.addColorStop(0, 'transparent');
    eg.addColorStop(0.7, 'rgba(255,255,255,0.04)');
    eg.addColorStop(1,   'rgba(0,0,0,0.4)');
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = eg;
    ctx.fill();

    ctx.restore();
  }

  // ── Spin loop ─────────────────────────────────────────────────────
  //
  // Root cause of "disc not spinning" bug:
  //   On the very first frame, lastTimestamp was set to `ts` THEN dt = ts-ts = 0.
  //   With dt=0, spinSpeed never incremented, and the spinSpeed > 0.5 guard
  //   immediately killed the loop before any spin occurred.
  //
  // Fix: seed lastTimestamp to ts-16 so the first frame has dt ≈ 16ms.
  // Also: continue while `spinning` is true regardless of current spinSpeed
  // so we never accidentally kill the loop during early acceleration.
  //
  function _loop(ts) {
    if (lastTimestamp === null) lastTimestamp = ts - 16; // ← key fix: non-zero first dt
    const dt = Math.min((ts - lastTimestamp) / 1000, 0.05);
    lastTimestamp = ts;

    if (spinning) {
      spinSpeed += (TARGET_SPEED - spinSpeed) * Math.min(dt * 3, 1);
      if (spinSpeed > TARGET_SPEED) spinSpeed = TARGET_SPEED;
    } else {
      spinSpeed *= Math.max(0, 1 - dt * 4);
      if (spinSpeed < 0.3) spinSpeed = 0;
    }

    spinAngle = (spinAngle + spinSpeed * dt) % 360;
    _drawRecord(spinAngle);

    // Continue while spinning OR while decelerating (spinSpeed still above threshold)
    if (spinning || spinSpeed > 0) {
      rafId = requestAnimationFrame(_loop);
    } else {
      rafId         = null;
      lastTimestamp = null;
    }
  }

  // ── Public API ────────────────────────────────────────────────────
  function startSpin() {
    spinning = true;
    if (!rafId) rafId = requestAnimationFrame(_loop);
  }

  function stopSpin(immediate = false) {
    spinning = false;
    if (immediate) {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      spinSpeed     = 0;
      lastTimestamp = null;
      _drawRecord(spinAngle);
    }
    // If not immediate: loop decelerates naturally via spinSpeed *= (1 - dt*4)
  }

  return { init, startSpin, stopSpin };
})();
