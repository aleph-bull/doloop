import {
  analyseFrame,
  createAnalysisState,
  createBarState,
  DEFAULT_ANALYSIS,
  DEFAULT_BARS,
  updateBars,
  waveformShape,
  type BarsConfig,
  type FrameInput,
  type VisualizerAnalysisConfig,
} from '@komogon/core';
import { useEffect, useRef } from 'react';
import type { AudioCapture } from '../audio-capture';
import {
  ALL_LAYERS,
  buildColors,
  DEFAULT_BARS_LOOK,
  DEFAULT_BURST_LOOK,
  DEFAULT_MIST_LOOK,
  DEFAULT_RINGS_LOOK,
  DEFAULT_WAVEFORM_LOOK,
  DEFAULT_WAVES_LOOK,
  paletteKey,
  renderFrame,
  WAVEFORM_POINTS,
  type BarsLook,
  type BurstLook,
  type MistLook,
  type RingsLook,
  type WavesLook,
  type VisualizerColors,
  type VisualizerLayers,
  type VisualizerPalette,
  type WaveformLook,
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
  layers?: VisualizerLayers;
  /** How the neon bars are laid out and lit. */
  bars?: BarsLook;
  /** Where the mirrored line hangs. */
  waveform?: WaveformLook;
  /** How high the mist reaches and how fast it drifts. */
  mist?: MistLook;
  /** How many waves. */
  waves?: WavesLook;
  /** How many circles. */
  rings?: RingsLook;
  /** The burst's ring, spikes and shapes. */
  burst?: BurstLook;
  /** Speed of the drifting parts, 1 being as designed. */
  speed?: number;
  /** Fade the whole picture to a glimmer while nothing is playing. */
  fadeWhenSilent?: boolean;
  palette: VisualizerPalette;
  /** When false nothing is drawn and the loop stops. */
  enabled: boolean;
  /** How the low end is listened to: the preset's analysis. */
  analysis?: VisualizerAnalysisConfig;
  /** How the bars follow the spectrum: the preset's attack and release. */
  barsAnalysis?: BarsConfig;
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
  bars,
  waveform,
  mist,
  waves,
  rings,
  burst,
  speed = 1,
  fadeWhenSilent = false,
  palette,
  enabled,
  analysis = DEFAULT_ANALYSIS,
  barsAnalysis = DEFAULT_BARS,
  className,
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef({
    getCapture,
    intensity,
    opacity,
    layers,
    bars,
    waveform,
    mist,
    waves,
    rings,
    burst,
    speed,
    fadeWhenSilent,
    palette,
    analysis,
    barsAnalysis,
  });
  useEffect(() => {
    propsRef.current = {
      getCapture,
      intensity,
      opacity,
      layers,
      bars,
      waveform,
      mist,
      waves,
      rings,
      burst,
      speed,
      fadeWhenSilent,
      palette,
      analysis,
      barsAnalysis,
    };
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
    const barState = createBarState();
    const burstState = createBarState();
    // How much of the picture shows: eases toward a glimmer in silence when asked to.
    let quiet = 1;
    const waveShape = new Float32Array(WAVEFORM_POINTS);
    let spectrum = new Uint8Array(new ArrayBuffer(1024));
    let samples = new Uint8Array(new ArrayBuffer(2048));
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
      let input: FrameInput;
      if (capture) {
        if (spectrum.length < capture.frequencyBinCount)
          spectrum = new Uint8Array(new ArrayBuffer(capture.frequencyBinCount));
        capture.read(spectrum);
        input = {
          spectrum,
          sampleRate: capture.sampleRate,
          fftSize: capture.fftSize,
          time: seconds,
        };
      } else {
        input = { spectrum: null, sampleRate: 48_000, fftSize: 2048, time: seconds };
      }
      analyseFrame(state, input, p.analysis);

      const layers = p.layers ?? ALL_LAYERS;
      const barsLook = p.bars ?? DEFAULT_BARS_LOOK;
      if (layers.bars) {
        // A symmetric row only needs half the bands; the renderer mirrors them outward.
        const bands = barsLook.symmetric ? Math.ceil(barsLook.count / 2) : barsLook.count;
        updateBars(barState, input, state.silent, bands, p.barsAnalysis);
      }
      const burstLook = p.burst ?? DEFAULT_BURST_LOOK;
      if (layers.burst) {
        // The two halves mirror, so only the bands from the top round to the bottom are needed.
        const spikes = Math.max(16, Math.min(192, Math.round(burstLook.spikes)));
        updateBars(burstState, input, state.silent, Math.floor(spikes / 2) + 1, p.barsAnalysis);
      }
      quiet += ((p.fadeWhenSilent && state.silent ? 0.3 : 1) - quiet) * 0.04;
      if (layers.waveform) {
        if (capture) {
          // The shape is resampled over the whole buffer, so it has to be exactly one FFT long.
          if (samples.length !== capture.fftSize)
            samples = new Uint8Array(new ArrayBuffer(capture.fftSize));
          capture.readWaveform(samples);
        }
        waveformShape(capture ? samples : null, state.silent, seconds, waveShape);
      }

      if (!colors || colors.key !== paletteKey(p.palette)) colors = buildColors(ctx, p.palette);
      renderFrame(ctx, scene, {
        seconds: seconds * p.speed,
        state,
        intensity: p.intensity,
        opacity: p.opacity * quiet,
        layers,
        colors,
        bars: layers.bars
          ? { levels: barState.levels, count: barsLook.count, look: barsLook }
          : undefined,
        waveform: layers.waveform
          ? { shape: waveShape, look: p.waveform ?? DEFAULT_WAVEFORM_LOOK }
          : undefined,
        mist: layers.mist ? { look: p.mist ?? DEFAULT_MIST_LOOK } : undefined,
        waves: { look: p.waves ?? DEFAULT_WAVES_LOOK },
        rings: { look: p.rings ?? DEFAULT_RINGS_LOOK },
        burst: layers.burst ? { levels: burstState.levels, look: burstLook } : undefined,
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
