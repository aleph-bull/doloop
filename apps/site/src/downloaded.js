/*
 * "Thank you for installing Komogon!" (/downloaded/): confetti once, as the page opens
 * (owner, 2026-11-04). The app's own confetti (packages/ui/src/confetti.ts), copied here
 * because the site has no packages: the same pieces, throw and fall, in Dawn Skies' colours.
 * Off for anyone who asks for less motion.
 */
const COLORS = ['#a9c8e6', '#f4b6cf', '#c9b6f2', '#f9cfb0', '#ffffff', '#6d63f2'];

function fireConfetti({ count = 150, durationMs = 1900 } = {}) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:100';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = (canvas.width = window.innerWidth * dpr);
  const H = (canvas.height = window.innerHeight * dpr);

  const parts = Array.from({ length: count }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
    const speed = (8 + Math.random() * 10) * dpr;
    return {
      x: W / 2 + (Math.random() - 0.5) * W * 0.3,
      y: H * 0.65,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: (4 + Math.random() * 5) * dpr,
      h: (6 + Math.random() * 8) * dpr,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    };
  });

  const start = performance.now();
  const g = 0.35 * dpr;
  const frame = (t) => {
    const elapsed = t - start;
    ctx.clearRect(0, 0, W, H);
    const fade = elapsed > durationMs - 400 ? Math.max(0, (durationMs - elapsed) / 400) : 1;
    for (const p of parts) {
      p.vy += g;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (elapsed < durationMs) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

// Once the headline has risen in.
setTimeout(() => fireConfetti(), 350);
