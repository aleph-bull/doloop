import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './defaults';
import {
  formatSoundLength,
  isSilentSound,
  SILENT_SOUND_ID,
  SOUND_EVENT_LABELS,
  SOUND_PRESETS,
  soundPresetById,
} from './sounds';

describe('the sound catalogue', () => {
  it('has unique, stable ids', () => {
    const ids = SOUND_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points every audible preset at a file under sounds/', () => {
    for (const p of SOUND_PRESETS) {
      if (p.id === SILENT_SOUND_ID) continue;
      expect(p.file).toMatch(/^sounds\/[a-z0-9-]+\.mp3$/);
      expect(p.seconds).toBeGreaterThan(0);
    }
  });

  it('offers exactly one silent option, with no file', () => {
    const silent = SOUND_PRESETS.filter((p) => p.file === '');
    expect(silent).toHaveLength(1);
    expect(silent[0]!.id).toBe(SILENT_SOUND_ID);
    expect(isSilentSound(SILENT_SOUND_ID)).toBe(true);
  });

  it('falls back to silence for an id that no longer exists', () => {
    expect(soundPresetById('removed-in-a-later-version').id).toBe(SILENT_SOUND_ID);
    expect(isSilentSound('nonsense')).toBe(true);
  });

  it('resolves a known id to itself', () => {
    expect(soundPresetById('bell').name).toBe('Bell');
    expect(isSilentSound('bell')).toBe(false);
  });

  it('lists presets shortest first, so the picker reads sensibly', () => {
    const audible = SOUND_PRESETS.filter((p) => p.file !== '');
    for (let i = 1; i < audible.length; i++) {
      expect(audible[i]!.seconds).toBeGreaterThanOrEqual(audible[i - 1]!.seconds);
    }
  });

  it('formats a length for the picker, and nothing for silence', () => {
    expect(formatSoundLength(soundPresetById('bell'))).toBe('2.1 s');
    expect(formatSoundLength(soundPresetById(SILENT_SOUND_ID))).toBe('');
  });
});

describe('sound settings', () => {
  it('gives each of the three moments its own preset', () => {
    const { sounds } = DEFAULT_SETTINGS;
    for (const ev of SOUND_EVENT_LABELS) {
      expect(soundPresetById(sounds[ev.id]).id).toBe(sounds[ev.id]);
    }
  });

  it('defaults work and break to different sounds, which is the point of splitting them', () => {
    const { sounds } = DEFAULT_SETTINGS;
    expect(sounds.workStart).not.toBe(sounds.breakStart);
  });

  it('defaults to audible sounds at a level you can actually hear', () => {
    const { sounds } = DEFAULT_SETTINGS;
    expect(sounds.enabled).toBe(true);
    expect(sounds.volume).toBeGreaterThanOrEqual(0.5);
    for (const ev of SOUND_EVENT_LABELS) expect(isSilentSound(sounds[ev.id])).toBe(false);
  });

  it('labels all three moments', () => {
    expect(SOUND_EVENT_LABELS.map((e) => e.id)).toEqual(['workStart', 'breakStart', 'sessionEnd']);
  });
});
