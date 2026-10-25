import type { ISODateTime } from './types';

/**
 * Usernames and display names (the owner's rules, 2026-10-22). A username is unique, shown
 * with an @ in front, and made of a to z (no accents), numbers and _ - ! . with no spaces and
 * never two of those symbols side by side. A display name has no symbols at all: letters in
 * any script, numbers and spaces.
 */
export const USERNAME = {
  MIN: 3,
  MAX: 30,
  /** A chosen username stays for this long before it can change again. */
  LOCK_DAYS: 14,
} as const;

export const DISPLAY_NAME_MAX = 60;

/** The only symbols a username may have. */
export const USERNAME_SYMBOLS = '_-!.';

/** A username as stored: no @ in front, lower case. */
export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase();
}

/** Why a username can't be used, or null when it can. Reads it as `normalizeUsername` does. */
export function usernameError(raw: string): string | null {
  const name = normalizeUsername(raw);
  if (name.length < USERNAME.MIN) return `At least ${USERNAME.MIN} characters.`;
  if (name.length > USERNAME.MAX) return `Up to ${USERNAME.MAX} characters.`;
  if (/\s/.test(name)) return 'No spaces.';
  if (!/^[a-z0-9_\-!.]+$/.test(name)) return 'Only a to z, numbers and _ - ! .';
  if (/[_\-!.]{2}/.test(name)) return 'No two symbols in a row.';
  return null;
}

/** A display name as stored: trimmed, with runs of spaces closed up. */
export function normalizeDisplayName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Why a display name can't be used, or null when it can. Empty is allowed (no name yet). */
export function displayNameError(raw: string): string | null {
  const name = normalizeDisplayName(raw);
  if (name.length > DISPLAY_NAME_MAX) return `Up to ${DISPLAY_NAME_MAX} characters.`;
  if (!/^[\p{L}\p{M}\p{N} ]*$/u.test(name)) return 'No symbols.';
  return null;
}

/**
 * What to call someone: their name, else their username without its @ (owner 2026-10-22:
 * shown big in the name's place, "remove the @"), else "Someone".
 */
export function personName(
  name: string | null | undefined,
  username: string | null | undefined,
): string {
  return name?.trim() || username || 'Someone';
}

/**
 * Whether the small @username goes beside a name from `personName`: not when the name is
 * the username itself (no name of their own, or a name spelled the same).
 */
export function showsUsername(person: { name: string; username: string | null }): boolean {
  return !!person.username && person.name !== person.username;
}

/**
 * When a username chosen at `changedAt` may next change, or null if it may change now.
 * One the app picked has no `changedAt`, so the first change of it is free.
 */
export function usernameUnlocksAt(
  changedAt: ISODateTime | null,
  now: ISODateTime,
): ISODateTime | null {
  if (!changedAt) return null;
  const at = Date.parse(changedAt) + USERNAME.LOCK_DAYS * 86_400_000;
  return at > Date.parse(now) ? new Date(at).toISOString() : null;
}

/**
 * The words random usernames are made of: an adjective, then an animal, tree or thing
 * outdoors. Only a to z, so any pair is a valid username. Migration 0033 copied these
 * lists to give every account one; changing them later changes only new picks.
 */
export const USERNAME_WORDS = {
  adjectives: [
    'amber',
    'bold',
    'brave',
    'breezy',
    'bright',
    'brisk',
    'calm',
    'candid',
    'chill',
    'clever',
    'cosy',
    'crisp',
    'curious',
    'dapper',
    'dreamy',
    'eager',
    'early',
    'fancy',
    'fluffy',
    'frosty',
    'gentle',
    'glad',
    'golden',
    'grand',
    'happy',
    'hazy',
    'honest',
    'hopeful',
    'humble',
    'jolly',
    'keen',
    'kind',
    'lively',
    'lucky',
    'mellow',
    'merry',
    'mighty',
    'misty',
    'nimble',
    'noble',
    'patient',
    'peachy',
    'plucky',
    'polite',
    'proud',
    'quick',
    'quiet',
    'rosy',
    'rustic',
    'snowy',
    'spry',
    'steady',
    'sunny',
    'swift',
    'tidy',
    'tiny',
    'velvet',
    'vivid',
    'warm',
    'wild',
    'wise',
    'witty',
    'zany',
    'zesty',
  ],
  nouns: [
    'acorn',
    'badger',
    'beaver',
    'birch',
    'bison',
    'cedar',
    'clover',
    'comet',
    'coral',
    'crane',
    'cricket',
    'dove',
    'eagle',
    'falcon',
    'fern',
    'finch',
    'fox',
    'gecko',
    'hare',
    'hazel',
    'heron',
    'ibis',
    'kiwi',
    'koala',
    'lark',
    'lemur',
    'lily',
    'lynx',
    'maple',
    'meadow',
    'moose',
    'moth',
    'newt',
    'oak',
    'orca',
    'otter',
    'owl',
    'panda',
    'pebble',
    'pine',
    'plum',
    'puffin',
    'quail',
    'quokka',
    'raven',
    'reef',
    'river',
    'robin',
    'seal',
    'sparrow',
    'squirrel',
    'stork',
    'swan',
    'thistle',
    'tiger',
    'toucan',
    'tulip',
    'walrus',
    'willow',
    'wombat',
    'wren',
    'yak',
    'zebra',
    'zinnia',
  ],
} as const;

const pick = <T>(list: readonly T[], rand: () => number): T =>
  list[Math.floor(rand() * list.length) % list.length]!;

/**
 * A username for someone who hasn't chosen one: two random words, like "quiet.otter". With
 * `third`, another noun follows ("quiet.otter.fern"), for the rare time the pairs near it
 * keep being taken.
 */
export function randomUsername(rand: () => number = Math.random, third = false): string {
  const { adjectives, nouns } = USERNAME_WORDS;
  const base = `${pick(adjectives, rand)}.${pick(nouns, rand)}`;
  return third ? `${base}.${pick(nouns, rand)}` : base;
}

/** An @ at the start or after anything but a letter or number, then username letters. */
const MENTION = /(^|[^a-z0-9@])@([a-z0-9_\-!.]+)/gi;

/** The usernames an @word could be, longest first: "quiet.otter." may be "quiet.otter". */
function mentionWords(word: string): string[] {
  const out: string[] = [];
  let w = word.toLowerCase().slice(0, USERNAME.MAX + 1);
  for (;;) {
    if (w.length >= USERNAME.MIN && w.length <= USERNAME.MAX) out.push(w);
    if (!/[_\-!.]$/.test(w)) return out;
    w = w.slice(0, -1);
  }
}

/** Every username `text` might @mention, to look up in one go. */
export function mentionCandidates(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(MENTION)) for (const w of mentionWords(m[2]!)) out.add(w);
  return [...out];
}

/** One @mention in a piece of text: where its @ starts and ends, and the username. */
export interface MentionMatch {
  start: number;
  end: number;
  username: string;
}

/**
 * Where `text` names someone with an @username (2026-10-25, replies to comments), given
 * which usernames are someone. A symbol at the end ("@quiet.otter.") is only part of the
 * name when that longer name is someone's.
 */
export function findMentions(
  text: string,
  isSomeone: (username: string) => boolean,
): MentionMatch[] {
  const out: MentionMatch[] = [];
  for (const m of text.matchAll(MENTION)) {
    const username = mentionWords(m[2]!).find(isSomeone);
    if (!username) continue;
    const start = m.index + m[1]!.length;
    out.push({ start, end: start + 1 + username.length, username });
  }
  return out;
}
