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

// Same voice as the dashboard greetings: fun, never a coach. No sleep or rest advice, no
// "do another tomorrow", no pep talks about hard days.
export const PHRASES: Phrase[] = [
  ...P('assessment-ready', [
    "You're basically ready. Smug mode unlocked.",
    'This is what prepared looks like.',
    "You'd be fine if it were tomorrow.",
    'Ready-ish, leaning hard on the ready.',
    'On pace and well prepared. Rare combo.',
    'The exam should be nervous, honestly.',
  ]),
  ...P('prepared-rising', [
    "That's three sessions in a row trending up.",
    'Each session, a little more sure.',
    'Confidence is climbing. So is the evidence.',
    'You rated yourself higher than last time. Earned.',
    'The curve is pointing the right way.',
    'Numbers going up. Love that for you.',
  ]),
  ...P('behind-but-studied', [
    'Chipping away. Chip, chip.',
    'Behind, but the gap just shrank.',
    'The gap is smaller than it was this morning.',
    'One session closer to caught up.',
    'Catching up counts. This counted.',
    'Dent made. Visible dent.',
  ]),
  ...P('first-session', [
    "Good start. Now it's real.",
    'First one done. The second is easier.',
    'The book has been opened. Legendary.',
    'A baseline exists now. Everything builds on it.',
    'Session one is on the record.',
    'Started. That was the hard part.',
  ]),
  ...P('node-completed', [
    "That's done. Cross it off.",
    'Finished. Take the win.',
    'Off the list. Bye forever.',
    'One fewer thing to carry.',
    'Complete. You called it and you delivered.',
    'Closed out. Nice.',
  ]),
  ...P('distracted-a-lot', [
    'Brain had other plans. Still logged.',
    'The squirrels won this round. Minutes still count.',
    'Chaotic, but it counts.',
    'Not the tidiest session. The timer does not judge.',
    'Focus went on a little trip. It came back.',
    'Messy minutes are still minutes.',
  ]),
  ...P('streak-milestone', [
    'Milestone streak. Somebody get this person a trophy.',
    'A streak like this does not happen by accident.',
    'That many days in a row. Certified machine.',
    'The chain is long and shiny now.',
    'New streak record for the fridge.',
    'Milestone reached. The streak is yours.',
  ]),
  ...P('late-night', [
    'Night owl session: logged.',
    'Midnight minutes count the same. Maybe more.',
    'Burned some midnight oil. Smells like progress.',
    'The moon saw that. The moon is impressed.',
    'Late night grind, locked in.',
    'Goblin hours, well spent.',
  ]),
  ...P('default', [
    'Logged. Nice.',
    'Another session in the bank.',
    'Progress is quiet. This was progress.',
    'Done and dusted.',
    'Time well spent.',
    'Jello: shaken.',
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
