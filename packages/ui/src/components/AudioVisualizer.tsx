import {
  analyseFrame,
  createAnalysisState,
  DEFAULT_ANALYSIS,
  type VisualizerAnalysisConfig,
} from '@komodoit/core';
import { useEffect, useRef } from 'react';
import type { AudioCapture } from '../audio-capture';
import {
  buildColors,
  paletteKey,
  renderFrame,
  type VisualizerColors,
  type VisualizerPalette,
} from '../visualizer-render';

export type { VisualizerPalette } from '../visualizer-render';

export interface AudioVisualizerProps {
  /** The live capture, read every frame. Null while nothing is shared: the picture idles. */
  getCapture: () => AudioCapture | null;
  /** Visual amplitude, glow and responsiveness, 0..1. The analysis is not affected. */
  intensity: number;
  /** How strongly the light shows over the background, 0..1. */
  opacity?: number;
  /** Which parts to draw. All on when omitted. */
  layers?: { ribbons: boolean; rings: boolean; border: boolean };
  palette: VisualizerPalette;
  /** When false nothing is drawn and the loop stops. */
  enabled: boolean;
  analysis?: VisualizerAnalysisConfig;
  className?: string;
}

/** Blur is the expensive part; the canvas never renders above this pixel ratio. */
const MAX_DPR = 1.5;
/** Frames slower than this (seconds) for a while drop the resolution. */
const SLOW_FRAME = 0.03;

/**
 * The audio-reactive layer behind the focus timer. The picture itself is
 * `renderFrame` in visualizer-render.ts; this owns the canvas, its size, the analysis
 * and the animation loop.
 *
 * The loop keeps everything in refs and typed arrays. Props are read through a ref each
 * frame, so a slider or a colour change lands on the next frame without restarting
 * anything, and React never re-renders for the animation.
 */
export function AudioVisualizer({
  getCapture,
  intensity,
  opacity = 1,
  layers,
  palette,
  enabled,
  analysis = DEFAULT_ANALYSIS,
  className,
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef({ getCapture, intensity, opacity, layers, palette, analysis });
  useEffect(() => {
    propsRef.current = { getCapture, intensity, opacity, layers, palette, analysis };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !enabled) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const root = document.documentElement;
    const still =
      root.dataset.motion === 'off' ||
      (root.dataset.motion !== 'on' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

    const state = createAnalysisState();
    let spectrum = new Uint8Array(new ArrayBuffer(1024));
    let colors: VisualizerColors | null = null;
    let raf = 0;
    const scene = { width: 0, height: 0, dpr: 1 };
    let dprCap = MAX_DPR;
    let slowFrames = 0;
    let lastFrame = 0;
    let running = false;

    const resize = () => {
      scene.dpr = Math.min(dprCap, window.devicePixelRatio || 1);
      scene.width = window.innerWidth;
      scene.height = window.innerHeight;
      canvas.width = Math.max(1, Math.round(scene.width * scene.dpr));
      canvas.height = Math.max(1, Math.round(scene.height * scene.dpr));
      canvas.style.width = `${scene.width}px`;
      canvas.style.height = `${scene.height}px`;
    };
    resize();
    window.addEventListener('resize', resize);

    const start = performance.now();
    const frame = (now: number) => {
      if (!running) return;
      const seconds = (now - start) / 1000;
      const p = propsRef.current;
      // A tab that mounted while hidden may have measured nothing; catch up here.
      if (scene.width !== window.innerWidth || scene.height !== window.innerHeight) resize();

      // Adaptive resolution: a run of slow frames halves the work rather than stuttering.
      if (lastFrame && !still) {
        const dt = (now - lastFrame) / 1000;
        slowFrames = dt > SLOW_FRAME ? slowFrames + 1 : Math.max(0, slowFrames - 1);
        if (slowFrames > 45 && dprCap > 1) {
          dprCap = 1;
          slowFrames = 0;
          resize();
        }
      }
      lastFrame = now;

      const capture = p.getCapture();
      if (capture) {
        if (spectrum.length < capture.frequencyBinCount)
          spectrum = new Uint8Array(new ArrayBuffer(capture.frequencyBinCount));
        capture.read(spectrum);
        analyseFrame(
          state,
          { spectrum, sampleRate: capture.sampleRate, fftSize: capture.fftSize, time: seconds },
          p.analysis,
        );
      } else {
        analyseFrame(
          state,
          { spectrum: null, sampleRate: 48_000, fftSize: 2048, time: seconds },
          p.analysis,
        );
      }

      if (!colors || colors.key !== paletteKey(p.palette)) colors = buildColors(ctx, p.palette);
      renderFrame(ctx, scene, {
        seconds,
        state,
        intensity: p.intensity,
        opacity: p.opacity,
        layers: p.layers,
        colors,
      });

      // Under reduced motion one frame at rest is the whole animation.
      if (!still) raf = requestAnimationFrame(frame);
    };

    const startLoop = () => {
      if (running) return;
      running = true;
      lastFrame = 0;
      // The first frame is drawn now rather than a frame later, so the light is there the
      // moment the canvas is; under reduced motion it is the whole animation.
      frame(performance.now());
    };
    const stopLoop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    // A hidden tab stops painting anyway; stopping explicitly keeps the analysis from
    // piling up a long gap and restarts cleanly when the tab is shown again.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stopLoop();
      else startLoop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    startLoop();

    return () => {
      stopLoop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', resize);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <canvas
      ref={canvasRef}
      className={className}
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
