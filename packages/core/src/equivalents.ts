/**
 * "That's enough time to…": study minutes turned into things people can picture. Every
 * conversion constant lives here, marked approximate, so a figure can be argued with in
 * one place. Adding one is adding an object to the list.
 *
 * Screen titles (films and TV seasons) are listed with the id the TMDB API knows them by
 * and a fallback runtime for when the API is not configured or cannot be reached; the API,
 * when it answers, is what the runtime and poster come from.
 */

export interface Equivalent {
  id: string;
  /** Minutes one unit takes. Approximate, and said so. */
  minutesPerUnit: number;
  icon: string;
  /** The sentence, given the number of units and the minutes it stands for. */
  phrase: (units: number, minutes: number) => string;
  /**
   * Totals this reads well for, in minutes. A small total wants songs, a large one
   * marathons; "0.02 marathons" and "1,400 songs" both say nothing.
   */
  fits: readonly [number, number];
}

const n1 = (x: number) => (x % 1 === 0 ? String(x) : x.toFixed(1));
const whole = (x: number) => String(Math.max(1, Math.round(x)));
const plural = (x: number, one: string, many: string) => (Math.round(x) === 1 ? one : many);

/** Walking distances people know, in km, so "62 km" can become a place. */
export const WALK_LANDMARKS: ReadonlyArray<{ km: number; name: string }> = [
  { km: 5, name: 'the length of a city park run' },
  { km: 21, name: 'a half marathon' },
  { km: 42, name: 'a full marathon course' },
  { km: 130, name: 'Toronto to Niagara Falls' },
  { km: 230, name: 'Toronto to Kingston' },
  { km: 450, name: 'Toronto to Ottawa' },
  { km: 550, name: 'Toronto to Montreal' },
  { km: 830, name: 'Toronto to Chicago' },
  { km: 1500, name: 'Toronto to Halifax' },
  { km: 3400, name: 'Toronto to Vancouver' },
];

/** The nearest landmark not longer than the distance, or null under the first. */
export function walkLandmark(km: number): { km: number; name: string } | null {
  let best: { km: number; name: string } | null = null;
  for (const l of WALK_LANDMARKS) if (l.km <= km) best = l;
  return best;
}

export const WALK_MINUTES_PER_KM = 12; // 5 km/h
export const FLIGHT_TORONTO_TOKYO_MINUTES = 13 * 60;

export const EQUIVALENTS: readonly Equivalent[] = [
  {
    id: 'songs',
    minutesPerUnit: 3.5,
    icon: '🎵',
    phrase: (u) => `listen to ~${whole(u)} ${plural(u, 'song', 'songs')}`,
    fits: [7, 600],
  },
  {
    id: 'albums',
    minutesPerUnit: 45,
    icon: '💿',
    phrase: (u) =>
      `play ~${n1(Math.round(u * 10) / 10)} ${plural(u, 'album', 'albums')} front to back`,
    fits: [40, 2400],
  },
  {
    id: 'podcasts',
    minutesPerUnit: 45,
    icon: '🎧',
    phrase: (u) => `get through ~${whole(u)} podcast ${plural(u, 'episode', 'episodes')}`,
    fits: [40, 4000],
  },
  {
    id: 'pizzas',
    minutesPerUnit: 90,
    icon: '🍕',
    phrase: (u) => `make ~${whole(u)} ${plural(u, 'pizza', 'pizzas')} from scratch, dough and all`,
    fits: [90, 3000],
  },
  {
    id: 'bread',
    minutesPerUnit: 240,
    icon: '🍞',
    phrase: (u) => `bake ~${whole(u)} ${plural(u, 'loaf', 'loaves')} of bread, rises included`,
    fits: [240, 9000],
  },
  {
    id: 'novels',
    minutesPerUnit: 7 * 60,
    icon: '📚',
    phrase: (u) => `read ~${n1(Math.round(u * 10) / 10)} average ${plural(u, 'novel', 'novels')}`,
    fits: [200, Infinity],
  },
  {
    id: 'sleep',
    minutesPerUnit: 8 * 60,
    icon: '😴',
    phrase: (u) => `sleep ~${n1(Math.round(u * 10) / 10)} full ${plural(u, 'night', 'nights')}`,
    fits: [240, Infinity],
  },
  {
    id: 'marathons',
    minutesPerUnit: 270,
    icon: '🏃',
    phrase: (u) => `run ~${n1(Math.round(u * 10) / 10)} ${plural(u, 'marathon', 'marathons')}`,
    fits: [135, Infinity],
  },
  {
    id: 'walk',
    minutesPerUnit: WALK_MINUTES_PER_KM,
    icon: '🚶',
    phrase: (u) => {
      const km = Math.round(u);
      const mark = walkLandmark(km);
      return mark ? `walk ~${km} km at a stroll, about ${mark.name}` : `walk ~${km} km at a stroll`;
    },
    fits: [60, Infinity],
  },
  {
    id: 'flight',
    minutesPerUnit: FLIGHT_TORONTO_TOKYO_MINUTES,
    icon: '✈️',
    phrase: (u, minutes) =>
      u < 1
        ? `fly ~${Math.round((minutes / FLIGHT_TORONTO_TOKYO_MINUTES) * 100)}% of the way from Toronto to Tokyo`
        : `fly Toronto to Tokyo ~${n1(Math.round(u * 10) / 10)} ${plural(u, 'time', 'times')}`,
    fits: [60, Infinity],
  },
];

/** The screen titles the picker draws from, with the id TMDB knows them by. */
export interface ScreenTitle {
  tmdbId: number;
  type: 'movie' | 'tv';
  title: string;
  /** Season shown for a series. */
  season?: number;
  /** Minutes, used when the API has not answered. Approximate. */
  fallbackMinutes: number;
  /** Episodes in that season, for "you could have watched 5 episodes". */
  fallbackEpisodes?: number;
}

export const SCREEN_TITLES: readonly ScreenTitle[] = [
  { tmdbId: 862, type: 'movie', title: 'Toy Story', fallbackMinutes: 81 },
  { tmdbId: 808, type: 'movie', title: 'Shrek', fallbackMinutes: 90 },
  { tmdbId: 129, type: 'movie', title: 'Spirited Away', fallbackMinutes: 125 },
  { tmdbId: 603, type: 'movie', title: 'The Matrix', fallbackMinutes: 136 },
  { tmdbId: 27205, type: 'movie', title: 'Inception', fallbackMinutes: 148 },
  { tmdbId: 155, type: 'movie', title: 'The Dark Knight', fallbackMinutes: 152 },
  { tmdbId: 157336, type: 'movie', title: 'Interstellar', fallbackMinutes: 169 },
  { tmdbId: 872585, type: 'movie', title: 'Oppenheimer', fallbackMinutes: 180 },
  { tmdbId: 299534, type: 'movie', title: 'Avengers: Endgame', fallbackMinutes: 181 },
  { tmdbId: 597, type: 'movie', title: 'Titanic', fallbackMinutes: 194 },
  {
    tmdbId: 122,
    type: 'movie',
    title: 'The Lord of the Rings: The Return of the King',
    fallbackMinutes: 201,
  },
  { tmdbId: 346698, type: 'movie', title: 'Barbie', fallbackMinutes: 114 },
  {
    tmdbId: 545611,
    type: 'movie',
    title: 'Everything Everywhere All at Once',
    fallbackMinutes: 139,
  },
  { tmdbId: 693134, type: 'movie', title: 'Dune: Part Two', fallbackMinutes: 166 },
  {
    tmdbId: 2316,
    type: 'tv',
    title: 'The Office',
    season: 1,
    fallbackMinutes: 132,
    fallbackEpisodes: 6,
  },
  {
    tmdbId: 136315,
    type: 'tv',
    title: 'The Bear',
    season: 1,
    fallbackMinutes: 240,
    fallbackEpisodes: 8,
  },
  {
    tmdbId: 1396,
    type: 'tv',
    title: 'Breaking Bad',
    season: 1,
    fallbackMinutes: 336,
    fallbackEpisodes: 7,
  },
  {
    tmdbId: 66732,
    type: 'tv',
    title: 'Stranger Things',
    season: 1,
    fallbackMinutes: 400,
    fallbackEpisodes: 8,
  },
  {
    tmdbId: 246,
    type: 'tv',
    title: 'Avatar: The Last Airbender',
    season: 1,
    fallbackMinutes: 480,
    fallbackEpisodes: 20,
  },
  {
    tmdbId: 1668,
    type: 'tv',
    title: 'Friends',
    season: 1,
    fallbackMinutes: 528,
    fallbackEpisodes: 24,
  },
  {
    tmdbId: 1399,
    type: 'tv',
    title: 'Game of Thrones',
    season: 1,
    fallbackMinutes: 560,
    fallbackEpisodes: 10,
  },
];

/** What the API (or the fallback) says about a title: how long, how many parts, the poster. */
export interface ScreenFacts {
  tmdbId: number;
  type: 'movie' | 'tv';
  title: string;
  season?: number;
  minutes: number;
  episodes?: number;
  posterUrl: string | null;
  /** True when the runtime is the listed fallback rather than the API's answer. */
  approximate: boolean;
}

/** The fallback facts for a title, for when nothing better is known. */
export function fallbackFacts(t: ScreenTitle): ScreenFacts {
  return {
    tmdbId: t.tmdbId,
    type: t.type,
    title: t.title,
    season: t.season,
    minutes: t.fallbackMinutes,
    episodes: t.fallbackEpisodes,
    posterUrl: null,
    approximate: true,
  };
}

export interface EquivalentCard {
  id: string;
  icon: string;
  /** "watch Inception 2.3 times", "run ~1.2 marathons": what follows "That's enough time to…". */
  text: string;
  /** A poster, when the card is a screen title with one. */
  imageUrl: string | null;
  /** The title, for the caption and the alt text. */
  title: string | null;
}

/** Deterministic 0..1 from a seed and an index, so a shuffle is repeatable. */
export function seededRandom(seed: number, index: number): number {
  let h = (Math.imul(seed | 0, 374761393) + Math.imul(index + 1, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A film or a season against the minutes: how many times through, or how far in. */
export function screenCard(facts: ScreenFacts, minutes: number): EquivalentCard | null {
  if (facts.minutes <= 0 || minutes <= 0) return null;
  const tilde = facts.approximate ? '~' : '';
  const times = minutes / facts.minutes;
  const where =
    facts.type === 'tv' && facts.season ? `season ${facts.season} of ${facts.title}` : facts.title;
  let text: string;
  if (times >= 1) {
    text =
      facts.type === 'tv'
        ? times < 1.15
          ? `watch the entire ${where}`
          : `watch the entire ${where} ${tilde}${n1(Math.round(times * 10) / 10)} times`
        : `watch ${where} ${tilde}${n1(Math.round(times * 10) / 10)} ${plural(times, 'time', 'times')}`;
  } else if (facts.type === 'tv' && facts.episodes) {
    const eps = Math.floor(times * facts.episodes);
    if (eps < 1) return null;
    text = `watch ${tilde}${eps} ${plural(eps, 'episode', 'episodes')} of ${facts.title}`;
  } else {
    const pct = Math.round(times * 100);
    if (pct < 20) return null;
    text = `get ${tilde}${pct}% of the way through ${where}`;
  }
  return {
    id: `screen:${facts.type}:${facts.tmdbId}`,
    icon: facts.type === 'tv' ? '📺' : '🎬',
    text,
    imageUrl: facts.posterUrl,
    title: facts.title,
  };
}

/** A non-screen equivalent, or null when the total is outside what it reads well for. */
export function equivalentCard(eq: Equivalent, minutes: number): EquivalentCard | null {
  if (minutes < eq.fits[0] || minutes > eq.fits[1]) return null;
  const units = minutes / eq.minutesPerUnit;
  return { id: eq.id, icon: eq.icon, text: eq.phrase(units, minutes), imageUrl: null, title: null };
}

export interface PickInput {
  minutes: number;
  /** Changes with the shuffle button; the same seed gives the same picks. */
  seed: number;
  count?: number;
  /** Screen facts to draw from; the fallback list when the API is silent. */
  screens?: ScreenFacts[];
}

/**
 * A few cards that fit the total, mixed from screens and everything else, in an order
 * that changes with the seed. A screen title is preferred first when there is one that
 * fits, since a poster is the part people look at.
 */
export function pickEquivalents(input: PickInput): EquivalentCard[] {
  const count = input.count ?? 4;
  if (input.minutes <= 0) return [];
  const screens = (input.screens ?? SCREEN_TITLES.map(fallbackFacts))
    .map((f) => screenCard(f, input.minutes))
    .filter((c): c is EquivalentCard => c !== null);
  const others = EQUIVALENTS.map((e) => equivalentCard(e, input.minutes)).filter(
    (c): c is EquivalentCard => c !== null,
  );
  const shuffle = <T>(xs: T[], salt: number) =>
    xs
      .map((x, i) => ({ x, r: seededRandom(input.seed + salt, i) }))
      .sort((a, b) => a.r - b.r)
      .map((p) => p.x);
  const s = shuffle(screens, 1);
  const o = shuffle(others, 2);
  const out: EquivalentCard[] = [];
  // One screen, then the rest interleaved, so a row is never four films or four foods.
  if (s[0]) out.push(s[0]);
  let si = 1;
  let oi = 0;
  while (out.length < count && (si < s.length || oi < o.length)) {
    if (oi < o.length) out.push(o[oi++]!);
    if (out.length < count && si < s.length && out.length % 2 === 0) out.push(s[si++]!);
  }
  return out.slice(0, count);
}
