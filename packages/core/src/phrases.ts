import { fnv1a } from './hash';
import { STREAK_MILESTONES } from './streak';

/** Context buckets for `pickPhrase` (spec §7). */
export type PhraseBucket =
  | 'assessment-ready' // assessment ≥ 80% prepared and on-track
  | 'prepared-rising' // assessment, prepared rising across sessions
  | 'behind-but-studied' // behind but studied today
  | 'first-session' // first session on a node
  | 'node-completed' // completed a node
  | 'distracted-a-lot' // rough one, never scolding
  | 'streak-milestone' // 7, 14, 30, 60, 100
  | 'late-night' // after 23:00 local
  | 'default'; // nothing special happened

export interface Phrase {
  id: string;
  bucket: PhraseBucket;
  text: string;
}

const P = (bucket: PhraseBucket, texts: string[]): Phrase[] =>
  texts.map((text, i) => ({ id: `${bucket}-${i + 1}`, bucket, text }));

// Same voice as the dashboard greetings: calm and sincere, never cheeky, never a coach. No
// sleep or rest advice, no "do another tomorrow", no pep talks about hard days.
export const PHRASES: Phrase[] = [
  ...P('assessment-ready', [
    "You're well prepared for this.",
    'This is what being ready looks like.',
    "You'd be in good shape if it were tomorrow.",
    'Prepared and on pace.',
    'You know this material well.',
    'Ready for it.',
  ]),
  ...P('prepared-rising', [
    "You're feeling more prepared each session.",
    'Your confidence is building.',
    'Rated higher than last time.',
    'Steady improvement across your sessions.',
    'More ready than before.',
    'Your preparation is adding up.',
  ]),
  ...P('behind-but-studied', [
    'Every session closes the gap.',
    "You're catching up.",
    'A little closer to where you want to be.',
    'This one counted.',
    'The gap is smaller now.',
    'One step closer.',
  ]),
  ...P('first-session', [
    'A good start.',
    'First session done.',
    "You've started. That's often the hardest part.",
    'Your first session is on the record.',
    'Off the starting line.',
    'Started.',
  ]),
  ...P('node-completed', [
    'Done. Nice work.',
    'Finished. One less thing on your list.',
    'Complete.',
    "That's off your list.",
    'All done here.',
    'Wrapped up.',
  ]),
  ...P('distracted-a-lot', [
    'Session saved.',
    'Saved to your history.',
    'The time still counts toward your total.',
    'Logged.',
    'Session complete.',
    'Recorded.',
  ]),
  ...P('streak-milestone', [
    'A new streak milestone.',
    'Your streak reached a milestone.',
    'A milestone worth noting.',
    'That streak is a real habit now.',
    'Milestone reached.',
    'A long run of days.',
  ]),
  ...P('late-night', [
    'Late session, logged.',
    'Evening session complete.',
    'A late one, done.',
    'Saved for tonight.',
    'Night session recorded.',
    'Done for this session.',
  ]),
  ...P('default', [
    'Session complete.',
    'Nice work.',
    'Time well spent.',
    'Another session done.',
    'Logged.',
    'Good session.',
  ]),
];

const byBucket = new Map<PhraseBucket, Phrase[]>();
for (const p of PHRASES) {
  const list = byBucket.get(p.bucket) ?? [];
  list.push(p);
  byBucket.set(p.bucket, list);
}

export function phrasesFor(bucket: PhraseBucket): Phrase[] {
  return byBucket.get(bucket) ?? [];
}

export interface PhraseContext {
  bucket: PhraseBucket;
  /** Any string that varies per pick (e.g. session id). Same seed always gives the same phrase. */
  seed: string;
  /** The phrase id shown last time for this bucket, to avoid a consecutive repeat. */
  lastPhraseId?: string | null;
}

/**
 * Deterministic phrase pick. Same (bucket, seed) always yields the same phrase, unless
 * that phrase was the previous pick, in which case the next one in the bucket is used.
 */
export function pickPhrase(ctx: PhraseContext): Phrase {
  const list = phrasesFor(ctx.bucket);
  if (list.length === 0) return phrasesFor('default')[0]!;
  let idx = fnv1a(`${ctx.bucket}|${ctx.seed}`) % list.length;
  if (ctx.lastPhraseId && list[idx]!.id === ctx.lastPhraseId && list.length > 1) {
    idx = (idx + 1) % list.length;
  }
  return list[idx]!;
}

export interface PhraseSignals {
  isAssessment: boolean;
  preparedRating: number | null; // 1-5 from this session's review
  preparedPrev: number[]; // earlier prepared ratings on the node, oldest first
  status: 'done' | 'overdue' | 'critical' | 'behind' | 'on-track' | 'no-estimate';
  isFirstSessionOnNode: boolean;
  nodeJustCompleted: boolean;
  distracted: 'no' | 'a-little' | 'a-lot' | null;
  streakAfter: number;
  localHour: number;
}

/** Choose the most relevant bucket for a finished session. Order is the priority order. */
export function bucketForSession(s: PhraseSignals): PhraseBucket {
  if (s.nodeJustCompleted) return 'node-completed';
  if ((STREAK_MILESTONES as readonly number[]).includes(s.streakAfter)) return 'streak-milestone';
  if (s.distracted === 'a-lot') return 'distracted-a-lot';
  if (s.localHour >= 23 || s.localHour < 4) return 'late-night';
  if (s.isAssessment && s.preparedRating !== null) {
    const prev = s.preparedPrev;
    if (s.preparedRating >= 4 && s.status === 'on-track') return 'assessment-ready';
    if (prev.length >= 2) {
      const a = prev[prev.length - 2]!;
      const b = prev[prev.length - 1]!;
      if (a < b && b < s.preparedRating) return 'prepared-rising';
    }
  }
  if (s.status === 'behind' || s.status === 'critical') return 'behind-but-studied';
  if (s.isFirstSessionOnNode) return 'first-session';
  return 'default';
}
