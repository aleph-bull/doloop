let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Soft two-note chime. `volume` 0..1. Never throws. */
export function chime(volume: number, kind: 'interval' | 'block' = 'interval') {
  const ac = audio();
  if (!ac || volume <= 0) return;
  const notes = kind === 'interval' ? [523.25, 659.25] : [659.25, 523.25, 392];
  const t0 = ac.currentTime;
  notes.forEach((freq, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t0 + i * 0.18);
    gain.gain.linearRampToValueAtTime(0.25 * volume, t0 + i * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.18 + 0.5);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0 + i * 0.18);
    osc.stop(t0 + i * 0.18 + 0.55);
  });
}
