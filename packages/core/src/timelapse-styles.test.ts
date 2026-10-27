import { describe, expect, it } from 'vitest';
import { withDefaults } from './defaults';
import {
  defaultTimelapseLayout,
  normalizeTimelapseLayout,
  pieceStyle,
  restyleBox,
} from './timelapse-layout';
import { defaultStoryLayout, STORY_ASPECT, STORY_RATIO, timelapseLook } from './timelapse-presets';
import {
  applyTimelapseStyle,
  cleanNoteText,
  matchTimelapseStyle,
  TIMELAPSE_NOTE_MAX,
  TIMELAPSE_STYLES,
} from './timelapse-styles';

const SHAPES = [16 / 9, 4 / 3, 1, 4 / 5, 9 / 16];

describe('timelapse looks', () => {
  it('starts out in Classic, the default layout, in every shape', () => {
    for (const r of SHAPES)
      expect(matchTimelapseStyle(defaultTimelapseLayout(r), r)).toBe('classic');
  });

  it('reads each look back as itself, and as no other', () => {
    for (const r of SHAPES)
      for (const s of TIMELAPSE_STYLES) {
        const layout = applyTimelapseStyle(s.id, r, defaultTimelapseLayout(r));
        expect(matchTimelapseStyle(layout, r)).toBe(s.id);
      }
  });

  it('keeps every piece inside the frame, and survives being saved and read back', () => {
    for (const r of SHAPES)
      for (const s of TIMELAPSE_STYLES) {
        const layout = applyTimelapseStyle(s.id, r, defaultTimelapseLayout(r));
        for (const b of Object.values(layout)) {
          expect(b.x).toBeGreaterThanOrEqual(0);
          expect(b.y).toBeGreaterThanOrEqual(0);
          expect(b.x + b.w).toBeLessThanOrEqual(1 + 1e-9);
          expect(b.y + b.h).toBeLessThanOrEqual(1 + 1e-9);
        }
        expect(matchTimelapseStyle(normalizeTimelapseLayout(layout), r)).toBe(s.id);
      }
  });

  it('leaves the screen where it was, shown or not', () => {
    const current = defaultTimelapseLayout(16 / 9);
    current.screen = { x: 0.1, y: 0.2, w: 0.3, h: 0.3, visible: true };
    const big = applyTimelapseStyle('big-timer', 16 / 9, current);
    expect(big.screen).toEqual(current.screen);
    expect(big.camera).toEqual(current.camera);
  });

  it('always keeps the mark', () => {
    for (const s of TIMELAPSE_STYLES)
      expect(applyTimelapseStyle(s.id, 1, defaultTimelapseLayout(1)).watermark.visible).toBe(true);
  });

  it('still knows a look once a text piece is stored where it was drawn', () => {
    const r = 16 / 9;
    const layout = applyTimelapseStyle('big-timer', r, defaultTimelapseLayout(r));
    // Saved: the centred timer's box shrinks to its pill, around the same middle.
    const e = layout.elapsed;
    const mid = e.x + e.w / 2;
    layout.elapsed = { ...e, x: mid - 0.1, w: 0.2 };
    expect(matchTimelapseStyle(layout, r)).toBe('big-timer');
  });

  it('calls a layout arranged by hand no look at all', () => {
    const layout = defaultTimelapseLayout(16 / 9);
    layout.clock = { ...layout.clock, y: layout.clock.y + 0.1 };
    expect(matchTimelapseStyle(layout, 16 / 9)).toBeNull();
  });
});

describe('your text on the video', () => {
  it('is one line, trimmed and cut to length', () => {
    expect(cleanNoteText('  studying for 222\n  am i   cooked ')).toBe(
      'studying for 222 am i cooked',
    );
    expect(cleanNoteText('x'.repeat(400))).toHaveLength(TIMELAPSE_NOTE_MAX);
    expect(cleanNoteText(42)).toBe('');
    expect(cleanNoteText(undefined)).toBe('');
  });

  it('has a place in every look, and stays in the layout until taken out', () => {
    for (const s of TIMELAPSE_STYLES)
      expect(applyTimelapseStyle(s.id, 16 / 9, defaultTimelapseLayout(16 / 9)).note.visible).toBe(
        true,
      );
    // A layout saved before the text existed gets the default place for it.
    const { note: _drop, ...old } = defaultTimelapseLayout(16 / 9);
    expect(normalizeTimelapseLayout(old).note).toEqual(defaultTimelapseLayout(16 / 9).note);
  });

  it('starts empty on both presets and comes back clean', () => {
    const fresh = withDefaults({});
    expect(fresh.timelapse.noteText).toBe('');
    expect(fresh.timelapsePhone.noteText).toBe('');
    const saved = withDefaults({
      timelapse: { noteText: '  Week 3 ' },
      timelapsePhone: { noteText: 7 as unknown as string },
    });
    expect(saved.timelapse.noteText).toBe('Week 3');
    expect(saved.timelapsePhone.noteText).toBe('');
  });

  it('takes over the words saved for the end card, which is gone', () => {
    type Old = { endText?: string; noteText?: string };
    const s = withDefaults({
      timelapse: { endText: 'Am i cooked for 222' } as Old,
      timelapsePhone: { endText: 'Up early' } as Old,
    });
    expect(s.timelapse.noteText).toBe('Am i cooked for 222');
    expect(s.timelapsePhone.noteText).toBe('Up early');
    expect('endText' in s.timelapse).toBe(false);
    expect('endText' in s.timelapsePhone).toBe(false);
    // Text of its own wins, even emptied.
    const own = withDefaults({ timelapse: { endText: 'old', noteText: '' } as Old });
    expect(own.timelapse.noteText).toBe('');
  });
});

describe('how each piece is drawn', () => {
  it('keeps a pill, a font and a colour, and only what differs from the plain look', () => {
    const d = defaultTimelapseLayout(16 / 9);
    const styled = restyleBox('title', d.title, { pill: 'solid', font: 'heading', color: 'gold' });
    expect(styled).toMatchObject({ pill: 'solid', font: 'heading', color: 'gold' });
    expect(pieceStyle('title', styled)).toEqual({ pill: 'solid', font: 'heading', color: 'gold' });
    // Back to the plain look: nothing is stored for it.
    const back = restyleBox('title', styled, { pill: 'dark', font: 'text', color: 'white' });
    expect(back).toEqual(d.title);
  });

  it('draws the clocks in the timer font and the words in the text font, unless told', () => {
    const d = defaultTimelapseLayout(16 / 9);
    for (const id of ['clock', 'elapsed', 'total', 'start', 'end'] as const)
      expect(pieceStyle(id, d[id]).font).toBe('timer');
    for (const id of ['title', 'note'] as const) expect(pieceStyle(id, d[id]).font).toBe('text');
    // A clock's own font is not stored; another of theirs is.
    expect(restyleBox('clock', d.clock, { font: 'timer' })).toEqual(d.clock);
    expect(restyleBox('clock', d.clock, { font: 'text' }).font).toBe('text');
  });

  it('gives the progress bar a colour only, and the mark nothing', () => {
    const d = defaultTimelapseLayout(1);
    const bar = restyleBox('progress', d.progress, { color: 'mint', pill: 'none', font: 'timer' });
    expect(bar).toEqual({ ...d.progress, color: 'mint' });
    const mark = restyleBox('watermark', d.watermark, { color: 'rose', font: 'heading' });
    expect(mark).toEqual(d.watermark);
  });

  it('reads styles back from storage, dropping ones it does not know', () => {
    const d = defaultTimelapseLayout(16 / 9);
    const read = normalizeTimelapseLayout({
      ...d,
      clock: { ...d.clock, pill: 'outline', font: 'heading', color: 'sky' },
      title: { ...d.title, pill: 'glow', font: 'comic', color: '#f0f' },
      // Fonts the looks used to pick go back to the person's own.
      elapsed: { ...d.elapsed, font: 'geometric' },
      note: { ...d.note, font: 'serif' },
    });
    expect(pieceStyle('clock', read.clock)).toEqual({
      pill: 'outline',
      font: 'heading',
      color: 'sky',
    });
    expect(read.title).toEqual(d.title);
    expect(read.elapsed).toEqual(d.elapsed);
    expect(read.note).toEqual(d.note);
  });

  it('draws the pieces a look leaves in place its way too', () => {
    const r = 16 / 9;
    const outline = applyTimelapseStyle('outline', r, defaultTimelapseLayout(r));
    for (const id of ['total', 'start', 'end'] as const)
      expect(pieceStyle(id, outline[id]).pill).toBe('outline');
    // Back to Classic, they are plain again.
    const classic = applyTimelapseStyle('classic', r, outline);
    expect(classic.total).toEqual(defaultTimelapseLayout(r).total);
  });

  it('never picks a font, and keeps the ones the person gave', () => {
    for (const r of SHAPES)
      for (const s of TIMELAPSE_STYLES) {
        const layout = applyTimelapseStyle(s.id, r, defaultTimelapseLayout(r));
        for (const b of Object.values(layout)) expect(b.font).toBeUndefined();
      }
    const r = 16 / 9;
    const mine = defaultTimelapseLayout(r);
    mine.title = restyleBox('title', mine.title, { font: 'heading' });
    mine.start = restyleBox('start', mine.start, { font: 'text' });
    for (const s of TIMELAPSE_STYLES) {
      const layout = applyTimelapseStyle(s.id, r, mine);
      expect(layout.title.font).toBe('heading');
      expect(layout.start.font).toBe('text');
      // Still that look: the font is theirs, not the look's.
      expect(matchTimelapseStyle(layout, r)).toBe(s.id);
    }
  });

  it('no longer reads as its look once a piece is restyled', () => {
    const r = 9 / 16;
    const story = applyTimelapseStyle('story', r, defaultTimelapseLayout(r));
    expect(matchTimelapseStyle(story, r)).toBe('story');
    const gold = { ...story, title: restyleBox('title', story.title, { color: 'gold' }) };
    expect(matchTimelapseStyle(gold, r)).toBeNull();
  });
});

describe('a story or a reel from a computer', () => {
  it('starts in the Story look, 9:16, with the screen waiting to be added', () => {
    const s = withDefaults({});
    expect(s.timelapse.format).toBe('normal');
    expect(matchTimelapseStyle(s.timelapse.storyLayout, STORY_RATIO)).toBe('story');
    expect(s.timelapse.storyLayout.screen.visible).toBe(false);
    expect(s.timelapse.storyLayout).toEqual(defaultStoryLayout());
  });

  it('records with the story layout when asked, and its own otherwise', () => {
    const s = withDefaults({ timelapse: { format: 'story' } });
    const story = timelapseLook(s, 'computer', 'upright', 'story');
    expect(story.aspect).toBe(STORY_ASPECT);
    expect(story.layout).toEqual(s.timelapse.storyLayout);
    const normal = timelapseLook(s, 'computer');
    expect(normal.layout).toEqual(s.timelapse.layout);
    expect(normal.aspect).toBe(s.timelapse.aspect);
  });

  it('reads an unknown format as normal', () => {
    const s = withDefaults({ timelapse: { format: 'square' as 'normal' } });
    expect(s.timelapse.format).toBe('normal');
  });
});
