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

export const PHRASES: Phrase[] = [
  ...P('assessment-ready', [
    "You're almost ready.",
    'This is what prepared looks like.',
    'The work is mostly done. Keep it warm.',
    "You'd be fine if it were tomorrow.",
    'Light review from here. Nothing heavy.',
    'On pace and well prepared. Rare combination.',
  ]),
  ...P('prepared-rising', [
    "That's three sessions in a row trending up.",
    'Each session, a little more sure.',
    'Confidence is climbing. So is the evidence.',
    'You rated yourself higher than last time. Earned.',
    'The curve is pointing the right way.',
    'Steady gains. That is how this works.',
  ]),
  ...P('behind-but-studied', [
    'Just a few more reps.',
    'Behind, but moving. That is the part that matters.',
    'You showed up on a hard day. Keep going.',
    'The gap is smaller than it was this morning.',
    'One session closer. Do another tomorrow.',
    'Still catching up, and still catching up counts.',
  ]),
  ...P('first-session', [
    "Good start. Now it's real.",
    'First one done. The second is easier.',
    'You opened the book. Most people never do.',
    'A baseline exists now. Everything builds on it.',
    'Session one is on the record.',
    'Started. That was the hard part.',
  ]),
  ...P('node-completed', [
    "That's done. Cross it off.",
    'Finished. Take the win.',
    'Off the list. On to the next.',
    'One fewer thing to carry.',
    'Complete. You called it and you delivered.',
    'Closed out. Nice.',
  ]),
  ...P('distracted-a-lot', [
    'Rough one. Showing up still counts.',
    'Not every session is clean. This one is still logged.',
    'Distracted, but present. Try a shorter block next time.',
    'The minutes still happened. Tomorrow is a fresh block.',
    'Hard to focus today. That is information, not a verdict.',
    'You stayed in the chair. That is the habit.',
  ]),
  ...P('streak-milestone', [
    'Seven days. This is a habit now.',
    'A streak like this does not happen by accident.',
    'Consistency is the whole game. You are playing it.',
    'Another milestone. Keep the chain going.',
    'This many days in a row changes what you expect of yourself.',
    'Milestone reached. The streak is yours.',
  ]),
  ...P('late-night', [
    'Late one. Get some sleep after this.',
    'Past eleven. Consolidation happens while you sleep.',
    'Night session logged. Rest is part of the plan.',
    'Late, but done. Close the laptop now.',
    'The work is saved. Sleep saves the rest.',
    'Good effort for this hour. Wind down.',
  ]),
  ...P('default', [
    'Logged. Keep going.',
    'Another session in the bank.',
    'Progress is quiet. This was progress.',
    'Done for now.',
    'Time well spent.',
    'That counts.',
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
