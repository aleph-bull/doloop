/**
 * The catalogue of alert sounds.
 *
 * These are audio files shipped with the portal, not synthesised tones. Ids are stored in
 * user settings, so they are stable and must not be renamed; `file` is the name under the
 * app's `/sounds/` folder. Durations were measured by decoding each file, and are shown in
 * the picker because the names alone do not tell you how long a sound rings for.
 */

export type SoundEvent = 'workStart' | 'breakStart' | 'sessionEnd';

export interface SoundPreset {
  id: string;
  name: string;
  /** Path relative to the app root. */
  file: string;
  /** Length in seconds, measured from the file. */
  seconds: number;
}

/** Silence. Selectable so one event can be muted without turning every sound off. */
export const SILENT_SOUND_ID = 'none';

/** Ordered roughly shortest and softest first. */
export const SOUND_PRESETS: SoundPreset[] = [
  { id: 'notify-2', name: 'Notify 2', file: 'sounds/notify-2.mp3', seconds: 1.06 },
  { id: 'chime', name: 'Chime', file: 'sounds/chime.mp3', seconds: 1.1 },
  { id: 'soft-notify', name: 'Soft notify', file: 'sounds/soft-notify.mp3', seconds: 1.41 },
  { id: 'soft-alert', name: 'Soft alert', file: 'sounds/soft-alert.mp3', seconds: 1.59 },
  { id: 'notify-3', name: 'Notify 3', file: 'sounds/notify-3.mp3', seconds: 1.78 },
  { id: 'notify-4', name: 'Notify 4', file: 'sounds/notify-4.mp3', seconds: 1.94 },
  { id: 'bell', name: 'Bell', file: 'sounds/bell.mp3', seconds: 2.12 },
  { id: 'notify-1', name: 'Notify 1', file: 'sounds/notify-1.mp3', seconds: 2.3 },
  { id: 'message', name: 'Message', file: 'sounds/message.mp3', seconds: 2.43 },
  { id: 'slow-ding', name: 'Slow ding', file: 'sounds/slow-ding.mp3', seconds: 3.08 },
  { id: 'minimal-ding', name: 'Minimal ding', file: 'sounds/minimal-ding.mp3', seconds: 3.1 },
  { id: 'soft-fade', name: 'Soft fade', file: 'sounds/soft-fade.mp3', seconds: 3.27 },
  { id: 'digital-alert', name: 'Digital alert', file: 'sounds/digital-alert.mp3', seconds: 8.83 },
  { id: SILENT_SOUND_ID, name: 'Silent', file: '', seconds: 0 },
];

export function soundPresetById(id: string): SoundPreset {
  return (
    SOUND_PRESETS.find((p) => p.id === id) ?? SOUND_PRESETS.find((p) => p.id === SILENT_SOUND_ID)!
  );
}

export function isSilentSound(id: string): boolean {
  return soundPresetById(id).file === '';
}

/** "1.1 s", for the picker. */
export function formatSoundLength(preset: SoundPreset): string {
  return preset.seconds > 0 ? `${preset.seconds.toFixed(1)} s` : '';
}

/** Labels for the three moments a sound can play. */
export const SOUND_EVENT_LABELS: Array<{ id: SoundEvent; label: string; hint: string }> = [
  { id: 'workStart', label: 'When work starts', hint: 'A break has ended and focus begins.' },
  { id: 'breakStart', label: 'When a break starts', hint: 'A work block has ended.' },
  { id: 'sessionEnd', label: 'When the session ends', hint: 'The whole session is over.' },
];
