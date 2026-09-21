/**
 * A short emoji burst, used when a custom reward is redeemed. Deliberately different from
 * `fireConfetti`: buying something you chose for yourself should not look like finishing a
 * session. Same rules — no dependencies, under two seconds, and silent under reduced motion.
 */
export interface BurstOptions {
  /** Glyphs to throw. The reward's own emoji first, then a little variety. */
  glyphs?: string[];
  durationMs?: number;
  count?: number;
  /** Origin in viewport pixels; defaults to the middle of the screen. */
  origin?: { x: number; y: number };
}

const DEFAULT_GLYPHS = ['🎉', '✨', '🎁', '⭐'];

export function fireRewardBurst(opts: BurstOptions = {}): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const root = document.documentElement;
  const motionOff = root.dataset.motion === 'off';
  const prefersReduced =
    root.dataset.motion !== 'on' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (motionOff || prefersReduced) return;

  const duration = Math.min(opts.durationMs ?? 1700, 1900);
  const count = opts.count ?? 28;
  const glyphs = opts.glyphs?.length ? opts.glyphs : DEFAULT_GLYPHS;

  const canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:101';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = (canvas.width = window.innerWidth * dpr);
  const H = (canvas.height = window.innerHeight * dpr);
  const ox = (opts.origin?.x ?? window.innerWidth / 2) * dpr;
  const oy = (opts.origin?.y ?? window.innerHeight / 2) * dpr;

  const parts = Array.from({ length: count }, (_, i) => {
    // Spread evenly around the circle, jittered, so the burst reads as a ring not a spray.
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const speed = (6 + Math.random() * 7) * dpr;
    return {
      x: ox,
      y: oy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 4 * dpr,
      size: (20 + Math.random() * 18) * dpr,
      rot: (Math.random() - 0.5) * 0.8,
      vr: (Math.random() - 0.5) * 0.12,
      glyph: glyphs[i % glyphs.length]!,
    };
  });

  const start = performance.now();
  const g = 0.28 * dpr;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const frame = (t: number) => {
    const elapsed = t - start;
    ctx.clearRect(0, 0, W, H);
    const fade = elapsed > duration - 500 ? Math.max(0, (duration - elapsed) / 500) : 1;
    for (const p of parts) {
      p.vy += g;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.font = `${p.size}px serif`;
      ctx.fillText(p.glyph, 0, 0);
      ctx.restore();
    }
    if (elapsed < duration) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
