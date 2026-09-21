import { useEffect, useRef } from 'react';
import { advanceLevels, BAND_COUNT, glowReach, isSilent } from '@doloop/core';
import type { AudioLevels } from '../audio-levels';
import { hexToRgb } from '../contrast';

export interface AudioGlowProps {
  /** Reads the current spectrum, or returns null when nothing is being captured. */
  read: () => AudioLevels | null;
  /** Hex accent colour. */
  color: string;
  /** How far the glow rises, 0..1. */
  intensity: number;
  /** Overall transparency, 0..1. */
  opacity: number;
  /** When false nothing is drawn and the animation loop stops. */
  enabled: boolean;
}

/** Blur radius as a fraction of viewport width. Big enough that no band edge survives. */
const BLUR_RATIO = 0.055;

/**
 * A soft glow along the bottom half of the left and right edges, mirrored.
 *
 * The silhouette follows the spectrum — each band pushes its stretch of the edge further
 * in — but it is drawn as one continuous curve through the band amplitudes and then blurred
 * hard, so no bar, rectangle or corner is ever visible. A horizontal gradient mask fades
 * both sides to nothing well before the centre of the screen.
 *
 * With no audio it settles to a low resting level and breathes. Under reduced motion it
 * holds that resting level without animating.
 */
export function AudioGlow({ read, color, intensity, opacity, enabled }: AudioGlowProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Smoothed band levels, persisted across frames so motion is fluid rather than jittery.
  const levelsRef = useRef<Float32Array>(new Float32Array(BAND_COUNT));
  // The animation loop reads these through a ref so changing a colour or slider takes
  // effect on the next frame without tearing down and restarting the loop.
  const propsRef = useRef({ read, color, intensity, opacity });
  useEffect(() => {
    propsRef.current = { read, color, intensity, opacity };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !enabled) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const root = document.documentElement;
    const motionOff = root.dataset.motion === 'off';
    const prefersReduced =
      root.dataset.motion !== 'on' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const still = motionOff || prefersReduced;

    let raf = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };
    resize();
    window.addEventListener('resize', resize);

    /**
     * Fill the area between one vertical edge and a curve through `levels`.
     *
     * The curve is a Catmull-Rom spline evaluated as beziers, so the outline is smooth
     * everywhere including at the band midpoints — a polyline would show facets once the
     * shape is this large.
     */
    const drawSide = (side: 'left' | 'right', levels: Float32Array, reach: number) => {
      const top = height * 0.5; // bottom half only
      const span = height - top;
      const n = levels.length;
      // Sample points bottom-up along the edge, plus a zero at each end so the shape
      // tapers into the corners instead of ending on a flat edge.
      const pts: Array<{ x: number; y: number }> = [];
      const xFor = (amount: number) =>
        side === 'left' ? amount * reach * width : width - amount * reach * width;
      pts.push({ x: xFor(0), y: height + span * 0.15 });
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        pts.push({ x: xFor(levels[i]!), y: height - t * span });
      }
      pts.push({ x: xFor(0), y: top - span * 0.15 });

      ctx.beginPath();
      ctx.moveTo(side === 'left' ? 0 : width, pts[0]!.y);
      ctx.lineTo(pts[0]!.x, pts[0]!.y);
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] ?? pts[i]!;
        const p1 = pts[i]!;
        const p2 = pts[i + 1]!;
        const p3 = pts[i + 2] ?? p2;
        ctx.bezierCurveTo(
          p1.x + (p2.x - p0.x) / 6,
          p1.y + (p2.y - p0.y) / 6,
          p2.x - (p3.x - p1.x) / 6,
          p2.y - (p3.y - p1.y) / 6,
          p2.x,
          p2.y,
        );
      }
      ctx.lineTo(side === 'left' ? 0 : width, pts[pts.length - 1]!.y);
      ctx.closePath();
      ctx.fill();
    };

    const start = performance.now();
    const frame = (time: number) => {
      const { read: readNow, color: hex, intensity: amount, opacity: alpha } = propsRef.current;
      const sample = readNow();
      const quiet = isSilent(sample);
      const levels = advanceLevels(levelsRef.current, sample, (time - start) / 1000, still);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const [r, g, b] = hexToRgb(hex);
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = `blur(${Math.round(width * BLUR_RATIO)}px)`;
      ctx.fillStyle = `rgb(${r} ${g} ${b} / ${alpha})`;
      const reach = glowReach(quiet, amount);
      drawSide('left', levels, reach);
      drawSide('right', levels, reach);
      ctx.filter = 'none';

      // Fade both sides out toward the centre. One symmetric gradient covers both.
      const mask = ctx.createLinearGradient(0, 0, width, 0);
      mask.addColorStop(0, 'rgb(0 0 0 / 1)');
      mask.addColorStop(0.42, 'rgb(0 0 0 / 0)');
      mask.addColorStop(0.58, 'rgb(0 0 0 / 0)');
      mask.addColorStop(1, 'rgb(0 0 0 / 1)');
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = mask;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';

      // Under reduced motion one frame at the resting level is the whole animation.
      if (!still) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}
