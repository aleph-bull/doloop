import { describe, expect, it } from 'vitest';
import {
  POST_PLATFORM_INFO,
  POST_PLATFORMS,
  postElsewhereNote,
  X_MAX_SECONDS,
} from './post-elsewhere';

describe('posting a timelapse elsewhere', () => {
  it('says nothing for an MP4 that every site takes', () => {
    expect(postElsewhereNote({ seconds: 30, mime: 'video/mp4' })).toBeNull();
    expect(postElsewhereNote({ seconds: 30, mime: 'video/mp4;codecs=avc1.640028' })).toBeNull();
    expect(postElsewhereNote({ seconds: X_MAX_SECONDS, mime: 'video/mp4' })).toBeNull();
  });

  it('warns about X past 2 min 20 s', () => {
    expect(postElsewhereNote({ seconds: X_MAX_SECONDS + 0.5, mime: 'video/mp4' })).toMatch(
      /X takes videos up to 2 min 20 s/,
    );
  });

  it('warns that Instagram and X take no WebM, whatever its length', () => {
    for (const seconds of [10, 600]) {
      const note = postElsewhereNote({ seconds, mime: 'video/webm;codecs=vp9' });
      expect(note).toMatch(/WebM video, which Instagram and X don’t take/);
      expect(note).not.toMatch(/Premium/);
    }
  });

  it('opens each site over https', () => {
    expect(POST_PLATFORMS).toEqual(['instagram', 'tiktok', 'x']);
    for (const p of POST_PLATFORMS) {
      expect(new URL(POST_PLATFORM_INFO[p].uploadUrl).protocol).toBe('https:');
    }
  });
});
