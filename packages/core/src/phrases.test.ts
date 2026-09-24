import { describe, expect, it } from 'vitest';
import {
  bucketForSession,
  PHRASES,
  phrasesFor,
  pickPhrase,
  type PhraseBucket,
  type PhraseSignals,
} from './phrases';

const BUCKETS: PhraseBucket[] = [
  'assessment-ready',
  'prepared-rising',
  'behind-but-studied',
  'first-session',
  'node-completed',
  'distracted-a-lot',
  'streak-milestone',
  'late-night',
  'default',
];

describe('phrase data', () => {
  it('has at least 6 phrases per bucket, no exclamation marks, no emoji', () => {
    for (const b of BUCKETS) {
      const list = phrasesFor(b);
      expect(list.length, b).toBeGreaterThanOrEqual(6);
      for (const p of list) {
        expect(p.text).not.toMatch(/!/);
        expect(p.text).not.toMatch(/\p{Extended_Pictographic}/u);
      }
    }
    const ids = new Set(PHRASES.map((p) => p.id));
    expect(ids.size).toBe(PHRASES.length);
  });

  it('never nags: no bedtime, no homework for tomorrow, no pep talks', () => {
    const nag =
      /\b(sleep|bed|laptop|rest|wind down|keep going|do another|next time|most people|you should|need to|hard day)\b/i;
    for (const p of PHRASES) expect(p.text, p.id).not.toMatch(nag);
  });
});

describe('pickPhrase', () => {
  it('is deterministic for the same seed', () => {
    const a = pickPhrase({ bucket: 'default', seed: 's1' });
    const b = pickPhrase({ bucket: 'default', seed: 's1' });
    expect(a).toEqual(b);
  });

  it('varies with the seed', () => {
    const picks = new Set(
      Array.from({ length: 40 }, (_, i) => pickPhrase({ bucket: 'default', seed: `s${i}` }).id),
    );
    expect(picks.size).toBeGreaterThan(1);
  });

  it('never repeats the previous phrase for the same context', () => {
    const first = pickPhrase({ bucket: 'late-night', seed: 'x' });
    const second = pickPhrase({ bucket: 'late-night', seed: 'x', lastPhraseId: first.id });
    expect(second.id).not.toBe(first.id);
    expect(second.bucket).toBe('late-night');
  });

  it('falls back to default for an unknown bucket', () => {
    const p = pickPhrase({ bucket: 'nope' as PhraseBucket, seed: 'x' });
    expect(p.bucket).toBe('default');
  });
});

const sig = (over: Partial<PhraseSignals> = {}): PhraseSignals => ({
  isAssessment: false,
  preparedRating: null,
  preparedPrev: [],
  status: 'on-track',
  isFirstSessionOnNode: false,
  nodeJustCompleted: false,
  distracted: 'no',
  streakAfter: 2,
  localHour: 14,
  ...over,
});

describe('bucketForSession', () => {
  it('prioritises completion, then milestones, then rough sessions, then late night', () => {
    expect(bucketForSession(sig({ nodeJustCompleted: true, streakAfter: 7 }))).toBe(
      'node-completed',
    );
    expect(bucketForSession(sig({ streakAfter: 7, distracted: 'a-lot' }))).toBe('streak-milestone');
    expect(bucketForSession(sig({ distracted: 'a-lot', localHour: 23 }))).toBe('distracted-a-lot');
    expect(bucketForSession(sig({ localHour: 23 }))).toBe('late-night');
    expect(bucketForSession(sig({ localHour: 1 }))).toBe('late-night');
  });

  it('handles assessment signals', () => {
    expect(
      bucketForSession(sig({ isAssessment: true, preparedRating: 4, status: 'on-track' })),
    ).toBe('assessment-ready');
    expect(
      bucketForSession(
        sig({ isAssessment: true, preparedRating: 3, preparedPrev: [1, 2], status: 'behind' }),
      ),
    ).toBe('prepared-rising');
    expect(
      bucketForSession(
        sig({ isAssessment: true, preparedRating: 3, preparedPrev: [2, 2], status: 'behind' }),
      ),
    ).toBe('behind-but-studied');
    expect(
      bucketForSession(sig({ isAssessment: true, preparedRating: 3, preparedPrev: [1] })),
    ).toBe('default');
  });

  it('falls through to behind, first session, default', () => {
    expect(bucketForSession(sig({ status: 'critical' }))).toBe('behind-but-studied');
    expect(bucketForSession(sig({ isFirstSessionOnNode: true }))).toBe('first-session');
    expect(bucketForSession(sig())).toBe('default');
  });
});
