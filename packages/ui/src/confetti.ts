/**
 * Tiny canvas confetti. Under 2 s, no dependencies, respects reduced motion
 * (the caller passes `enabled`; the function also checks the media query itself).
 */
export interface ConfettiOptions {
  durationMs?: number;
  count?: number;
  colors?: string[];
}

export function fireConfetti(opts: ConfettiOptions = {}): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const root = document.documentElement;
  const motionOff = root.dataset.motion === 'off';
  const prefersReduced =
    root.dataset.motion !== 'on' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (motionOff || prefersReduced) return;

  const duration = Math.min(opts.durationMs ?? 1600, 1900);
  const count = opts.count ?? 120;
  const accent = getComputedStyle(root).getPropertyValue('--accent').trim() || '#6366f1';
  const colors = opts.colors ?? [accent, '#22c55e', '#f59e0b', '#38bdf8', '#f472b6'];

  const canvas = document.createElement('canvas');
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
      color: colors[Math.floor(Math.random() * colors.length)]!,
    };
  });

  const start = performance.now();
  const g = 0.35 * dpr;
  const frame = (t: number) => {
    const elapsed = t - start;
    ctx.clearRect(0, 0, W, H);
    const fade = elapsed > duration - 400 ? Math.max(0, (duration - elapsed) / 400) : 1;
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
    if (elapsed < duration) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
