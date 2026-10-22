import { describe, expect, it } from 'vitest';
import {
  appLink,
  POST_PLATFORM_INFO,
  POST_PLATFORMS,
  postElsewhereNote,
  sessionLine,
  studyTimeText,
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

  it('opens the app, not the site, on a phone', () => {
    for (const p of POST_PLATFORMS) {
      expect(appLink(p, 'ios')).not.toMatch(/^https?:/);
      expect(appLink(p, 'android')).toMatch(/^intent:\/\/.+#Intent;scheme=https;package=.+;end$/);
    }
    expect(appLink('instagram', 'ios')).toBe('instagram://app');
    expect(appLink('instagram', 'android')).toBe(
      'intent://www.instagram.com/#Intent;scheme=https;package=com.instagram.android;end',
    );
  });
});

describe('the session line on a post', () => {
  it('says study time plainly', () => {
    expect(studyTimeText(45)).toBe('45 min');
    expect(studyTimeText(120)).toBe('2 h');
    expect(studyTimeText(90.4)).toBe('1 h 30 min');
    expect(studyTimeText(0)).toBe('1 min');
    expect(sessionLine(90, 'Calculus')).toBe('1 h 30 min of focus on Calculus');
    expect(sessionLine(25, null)).toBe('25 min of focus');
  });
});
