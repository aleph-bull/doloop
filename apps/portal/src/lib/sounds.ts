import { soundPresetById } from '@komogon/core';

/**
 * Plays the alert sounds.
 *
 * Files are decoded once and cached, so an alert at the end of a work block starts
 * immediately rather than after a fetch. The context is nudged awake on the first user
 * gesture: a browser starts one suspended until the page has been interacted with, and an
 * alert fired by a timer is not a gesture — without this the first sound of a session
 * would be silent.
 */

let ctx: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer>();
/** Per file: the gain that lifts its loudest moment to full scale, so no sound is quieter. */
const levels = new Map<string, number>();
/** Everything plays through one limiter, so the boost never clips. */
let limiter: DynamicsCompressorNode | null = null;

/**
 * Extra loudness on top of the evened-out level, about +9 dB (10^(9/20)). The files are
 * mixed quietly, and a gain can only go down from them, so without this the loudest setting
 * stays soft.
 */
const BOOST = 2.82;
/** Never lift a near-silent file by more than this (+18 dB), or hiss would come up too. */
const MAX_NORMALISE = 8;

/** The gain that brings this buffer's peak to just under full scale. */
function normaliseGain(buffer: AudioBuffer): number {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]!);
      if (v > peak) peak = v;
    }
  }
  return peak > 0 ? Math.min(MAX_NORMALISE, 0.98 / peak) : 1;
}

/** A brick-wall-ish limiter in front of the speakers: loud stays loud, but never crackles. */
function output(ac: AudioContext): AudioNode {
  if (!limiter) {
    limiter = ac.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    limiter.connect(ac.destination);
  }
  return limiter;
}
const pending = new Map<string, Promise<AudioBuffer | null>>();
let listening = false;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** Create and resume the context while a user gesture is still on the stack. */
export function unlockAudio(): void {
  if (listening) return;
  listening = true;
  const wake = () => {
    audio();
    window.removeEventListener('pointerdown', wake);
    window.removeEventListener('keydown', wake);
  };
  window.addEventListener('pointerdown', wake, { once: true });
  window.addEventListener('keydown', wake, { once: true });
}

async function load(file: string): Promise<AudioBuffer | null> {
  const cached = buffers.get(file);
  if (cached) return cached;
  const inFlight = pending.get(file);
  if (inFlight) return inFlight;

  const task = (async () => {
    const ac = audio();
    if (!ac) return null;
    try {
      const res = await fetch(`/${file}`);
      if (!res.ok) return null;
      const decoded = await ac.decodeAudioData(await res.arrayBuffer());
      levels.set(file, normaliseGain(decoded));
      buffers.set(file, decoded);
      return decoded;
    } catch {
      return null;
    } finally {
      pending.delete(file);
    }
  })();
  pending.set(file, task);
  return task;
}

/** Decode the sounds a user has chosen, so the first alert does not wait on a fetch. */
export function preloadSounds(ids: string[]): void {
  for (const id of ids) {
    const preset = soundPresetById(id);
    if (preset.file) void load(preset.file);
  }
}

/**
 * Play a preset at `volume` (0..1). Every file is first evened out to the same peak, then
 * boosted and limited, so the slider runs from a whisper to properly loud. The slider is
 * squared, the way loudness is heard, so its low end stays fine-grained. Never throws, and
 * does nothing for the silent preset, a zero volume, or a browser that will not give us audio.
 */
export function playSound(id: string, volume: number): void {
  const preset = soundPresetById(id);
  if (!preset.file || volume <= 0) return;
  const ac = audio();
  if (!ac) return;

  void load(preset.file).then((buffer) => {
    if (!buffer || !ctx) return;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const v = Math.min(1, Math.max(0, volume));
    gain.gain.value = v * v * (levels.get(preset.file!) ?? 1) * BOOST;
    source.buffer = buffer;
    source.connect(gain).connect(output(ctx));
    source.start();
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
  });
}

/** Decode sound files that aren't presets (Jack mode's coins), so they start on time. */
export function preloadEffects(files: string[]): void {
  for (const file of files) void load(file);
}

/**
 * Play a sound file at `volume` (0..1), like a preset, at `rate` (1 is as recorded; higher
 * is quicker and higher pitched) and scaled by `level`, for sounds that play many at once.
 */
export function playEffect(file: string, volume: number, rate = 1, level = 1): void {
  if (volume <= 0) return;
  const ac = audio();
  if (!ac) return;
  void load(file).then((buffer) => {
    if (!buffer || !ctx) return;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const v = Math.min(1, Math.max(0, volume));
    gain.gain.value = v * v * (levels.get(file) ?? 1) * BOOST * level;
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(gain).connect(output(ctx));
    source.start();
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
  });
}

/** A short click, made on the spot: a slot machine's reel going past a number. */
export function playTick(volume: number, pitch = 1, level = 1): void {
  if (volume <= 0) return;
  const ac = audio();
  if (!ac || ac.state !== 'running') return;
  const t = ac.currentTime;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  const v = Math.min(1, Math.max(0, volume));
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(1500 * pitch, t);
  osc.frequency.exponentialRampToValueAtTime(500 * pitch, t + 0.03);
  gain.gain.setValueAtTime(0.5 * v * v * level, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  osc.connect(gain).connect(output(ac));
  osc.start(t);
  osc.stop(t + 0.05);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}
