import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './defaults';
import { FREE_FONTS, fontChoiceOf, isFontChoice, uploadedFontId } from './fonts';

const ID = '3f2b8c1e-6a4d-4b7e-9c2a-1d5e8f0a7b36';

describe('font choices', () => {
  it('takes the default, a free font and one of their own', () => {
    expect(isFontChoice('default')).toBe(true);
    expect(isFontChoice('lora')).toBe(true);
    expect(isFontChoice(`upload:${ID}`)).toBe(true);
  });

  it('refuses anything else', () => {
    for (const bad of ['', 'Lora', 'comic-sans', 'upload:', 'upload:abc', `upload:${ID}x`, 3]) {
      expect(isFontChoice(bad)).toBe(false);
    }
  });

  it('reads their own font id out of a choice', () => {
    expect(uploadedFontId(`upload:${ID}`)).toBe(ID);
    expect(uploadedFontId('lora')).toBeNull();
  });

  it('falls back to the default for a font it does not know', () => {
    expect(fontChoiceOf('gone-font')).toBe('default');
    expect(fontChoiceOf(undefined)).toBe('default');
    expect(fontChoiceOf('fraunces')).toBe('fraunces');
  });

  it('has unique ids and starts everyone on the default', () => {
    expect(new Set(FREE_FONTS.map((f) => f.id)).size).toBe(FREE_FONTS.length);
    expect(FREE_FONTS.some((f) => f.id === 'default')).toBe(false);
    const { fontText, fontHeading, fontTimer } = DEFAULT_SETTINGS.theme;
    expect([fontText, fontHeading, fontTimer]).toEqual(['default', 'default', 'default']);
  });
});
