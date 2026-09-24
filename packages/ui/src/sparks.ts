/**
 * A small burst of sparks from one point, for ticking something off. Much smaller than
 * `fireConfetti`: a tick is a small win and is over in well under a second. Same rules —
 * no dependencies, and silent under reduced motion.
 */
export interface SparksOptions {
  /** Viewport pixels, usually the centre of the control that was ticked. */
  origin: { x: number; y: number };
  count?: number;
  durationMs?: number;
}

/** Half the canvas: the sparks settle well inside this. */
const REACH = 60;

export function fireSparks({ origin, count = 14, durationMs = 650 }: SparksOptions): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const root = document.documentElement;
  const motionOff = root.dataset.motion === 'off';
  const prefersReduced =
    root.dataset.motion !== 'on' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (motionOff || prefersReduced) return;

  const accent = getComputedStyle(root).getPropertyValue('--accent').trim() || '#6366f1';
  const colors = [accent, accent, '#fbbf24', '#34d399'];

  // Only as big as the burst rather than the whole viewport: ticks can come quickly.
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `position:fixed;left:${origin.x - REACH}px;top:${origin.y - REACH}px;width:${REACH * 2}px;height:${REACH * 2}px;pointer-events:none;z-index:101`;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = (canvas.width = canvas.height = REACH * 2 * dpr);
  const c = size / 2;

  const parts = Array.from({ length: count }, (_, i) => {
    // A jittered ring, so it reads as a pop rather than a spray.
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const speed = (2.2 + Math.random() * 2.6) * dpr;
    return {
      x: c,
      y: c,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: colors[i % colors.length]!,
    };
  });

  const start = performance.now();
  ctx.lineCap = 'round';
  const frame = (t: number) => {
    const life = Math.min(1, (t - start) / durationMs);
    ctx.clearRect(0, 0, size, size);
    ctx.globalAlpha = 1 - life * life;
    ctx.lineWidth = 2.2 * dpr * (1 - life * 0.5);
    for (const p of parts) {
      p.vx *= 0.88;
      p.vy = p.vy * 0.88 + 0.05 * dpr;
      p.x += p.vx;
      p.y += p.vy;
      // A streak along the velocity, so each spark shortens to a dot as it slows.
      ctx.strokeStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(p.x - p.vx * 2.4, p.y - p.vy * 2.4);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    if (life < 1) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
