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
 * Play a preset at `volume` (0..1). Never throws, and does nothing for the silent preset,
 * a zero volume, or a browser that will not give us audio.
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
    gain.gain.value = Math.min(1, Math.max(0, volume));
    source.buffer = buffer;
    source.connect(gain).connect(ctx.destination);
    source.start();
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
  });
}
