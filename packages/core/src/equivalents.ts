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
  /** 'world': what happens around the world meanwhile, two a hand at most. 'climb': one. */
  kind?: 'world' | 'climb';
}

const n1 = (x: number) => (x % 1 === 0 ? String(x) : x.toFixed(1));
const whole = (x: number) => String(Math.max(1, Math.round(x)));
const plural = (x: number, one: string, many: string) => (Math.round(x) === 1 ? one : many);

/** A count for a sentence, two significant figures: "~16,000", "~5.9 million", "~1.2 billion". */
export function fmtCount(x: number): string {
  const n = Math.max(1, x);
  const sig = (v: number) => Number(v.toPrecision(2));
  if (n >= 1e9) return `${sig(n / 1e9)} billion`;
  if (n >= 1e6) return `${sig(n / 1e6)} million`;
  if (n < 10) return String(Math.round(n));
  return sig(n).toLocaleString('en-US');
}

/**
 * Things the world gets on with at a steady rate, per minute, for "in that time…" cards.
 * Rates are widely quoted round figures, so every one is shown with a ~.
 */
const WORLD_RATES: ReadonlyArray<{
  id: string;
  icon: string;
  perMinute: number;
  /** Reads after "That's enough time to"; `n` is already formatted. */
  text: (n: string, units: number) => string;
  /** Shortest total, in minutes, where the count says something. */
  from?: number;
}> = [
  // ~385,000 births a day.
  {
    id: 'births',
    icon: '👶',
    perMinute: 267,
    text: (n) => `see ~${n} babies born around the world`,
  },
  // ~40 million weddings a year.
  {
    id: 'weddings',
    icon: '💍',
    perMinute: 76,
    text: (n) => `see ~${n} couples get married around the world`,
  },
  // ~100,000 commercial flights a day.
  {
    id: 'takeoffs',
    icon: '🛫',
    perMinute: 69,
    text: (n) => `watch ~${n} planes take off around the world`,
  },
  // ~500 hours of video uploaded every minute.
  {
    id: 'youtube',
    icon: '📹',
    perMinute: 500,
    text: (n) => `see ~${n} hours of video uploaded to YouTube`,
  },
  // ~160 billion parcels a year.
  {
    id: 'parcels',
    icon: '📦',
    perMinute: 306_000,
    text: (n) => `see ~${n} parcels delivered around the world`,
  },
  // ~44 flashes a second.
  {
    id: 'lightning',
    icon: '⚡',
    perMinute: 2_640,
    text: (n) => `see ~${n} lightning flashes around the world`,
  },
  // ~230 million a year.
  { id: 'iphones', icon: '📱', perMinute: 437, text: (n) => `see ~${n} iPhones sold` },
  // ~8.5 billion a day.
  {
    id: 'searches',
    icon: '🔎',
    perMinute: 5_900_000,
    text: (n) => `see ~${n} Google searches made`,
  },
  // ~2.25 billion cups a day.
  {
    id: 'coffee',
    icon: '☕',
    perMinute: 1_560_000,
    text: (n) => `see ~${n} cups of coffee poured around the world`,
  },
  // ~100,000 new tracks a day.
  {
    id: 'new-songs',
    icon: '🎶',
    perMinute: 69,
    text: (n) => `see ~${n} new songs land on Spotify`,
  },
  // ~350 slices a second in the US.
  {
    id: 'pizza-slices',
    icon: '🍕',
    perMinute: 21_000,
    text: (n) => `see ~${n} slices of pizza eaten in the US`,
  },
  // ~5 billion snaps a day.
  { id: 'snaps', icon: '👻', perMinute: 3_500_000, text: (n) => `see ~${n} Snapchats sent` },
  // A resting heart, ~70 beats a minute.
  { id: 'heartbeats', icon: '❤️', perMinute: 70, text: (n) => `feel your heart beat ~${n} times` },
  // A hummingbird's ~50 wingbeats a second.
  {
    id: 'hummingbird',
    icon: '🐦',
    perMinute: 3_000,
    text: (n) => `watch a hummingbird beat its wings ~${n} times`,
  },
  // Earth moves ~30 km a second around the Sun.
  {
    id: 'orbit',
    icon: '🌍',
    perMinute: 1_800,
    text: (n) => `ride ~${n} km around the Sun with Earth`,
  },
  // One orbit every ~93 minutes.
  {
    id: 'iss',
    icon: '🛰️',
    perMinute: 1 / 93,
    from: 90,
    text: (n, u) =>
      Math.round(u) === 1
        ? 'watch the space station circle Earth once'
        : `watch the space station circle Earth ~${n} times`,
  },
  // Old Faithful erupts about every 94 minutes.
  {
    id: 'old-faithful',
    icon: '♨️',
    perMinute: 1 / 94,
    from: 90,
    text: (n, u) =>
      Math.round(u) === 1 ? 'see Old Faithful erupt once' : `see Old Faithful erupt ~${n} times`,
  },
  // The fastest bamboo grows up to ~90 cm a day.
  {
    id: 'bamboo',
    icon: '🎋',
    perMinute: 90 / 1440,
    from: 30,
    text: (n) => `watch the fastest bamboo grow ~${n} cm`,
  },
];

const WORLD_EQUIVALENTS: Equivalent[] = WORLD_RATES.map((r) => ({
  id: r.id,
  icon: r.icon,
  kind: 'world' as const,
  minutesPerUnit: 1 / r.perMinute,
  phrase: (units: number) => r.text(fmtCount(units), units),
  fits: [r.from ?? 15, Infinity] as const,
}));

/**
 * Walking distances people know, in km, so "62 km" can become a place. Each name reads after
 * "about"; lengths are the commonly quoted ones, rounded.
 */
export const WALK_LANDMARKS: ReadonlyArray<{ km: number; name: string }> = [
  { km: 2.7, name: 'the length of the Golden Gate Bridge' },
  { km: 3.8, name: "the length of Venice's Grand Canal" },
  { km: 5, name: 'a parkrun' },
  { km: 6.8, name: 'the length of the Las Vegas Strip' },
  { km: 9.7, name: 'a lap around Central Park in New York' },
  { km: 19, name: "a lap of Rome's ancient Aurelian Walls" },
  { km: 17, name: 'from the Pyramids of Giza to the Step Pyramid of Saqqara' },
  { km: 21.1, name: 'a half marathon' },
  { km: 33, name: 'across the English Channel at its narrowest' },
  { km: 35, name: 'a lap of the Paris ring road' },
  { km: 42.2, name: 'a full marathon' },
  { km: 56, name: 'the Comrades ultramarathon in South Africa' },
  { km: 82, name: 'the length of the Panama Canal' },
  { km: 117, name: "the length of Hadrian's Wall" },
  { km: 130, name: 'Toronto to Niagara Falls' },
  { km: 193, name: 'the length of the Suez Canal' },
  { km: 260, name: 'Toronto to Kingston' },
  { km: 344, name: 'London to Paris as the crow flies' },
  { km: 446, name: 'the length of the Grand Canyon' },
  { km: 450, name: 'Toronto to Ottawa' },
  { km: 540, name: 'Toronto to Montreal' },
  { km: 600, name: 'the length of Italy, Milan to Naples' },
  { km: 830, name: 'Toronto to Chicago' },
  { km: 1000, name: 'the length of Japan, Tokyo to Fukuoka' },
  { km: 1400, name: "Land's End to John o' Groats" },
  { km: 1800, name: 'Toronto to Halifax' },
  { km: 2000, name: 'the length of Great Britain and back' },
  { km: 3500, name: 'the Appalachian Trail' },
  { km: 4400, name: 'Toronto to Vancouver' },
  { km: 4270, name: 'the Pacific Crest Trail' },
  { km: 6650, name: 'the length of the Nile' },
  { km: 8850, name: 'the Great Wall of China' },
  { km: 21196, name: 'every branch of the Great Wall of China' },
  { km: 40075, name: 'once around the Earth' },
];

/** How far off a landmark may be and still be "about" the distance. */
const LANDMARK_TOLERANCE = 1.3;

/** The landmark closest to the distance, if one is within about 30% of it. */
export function walkLandmark(km: number): { km: number; name: string } | null {
  if (!(km > 0)) return null;
  let best: { km: number; name: string } | null = null;
  let bestOff = Infinity;
  for (const l of WALK_LANDMARKS) {
    // Compared as ratios, so 10 km off matters at 20 km and not at 2,000.
    const off = Math.abs(Math.log(km / l.km));
    if (off < bestOff) {
      best = l;
      bestOff = off;
    }
  }
  return bestOff <= Math.log(LANDMARK_TOLERANCE) ? best : null;
}

export const WALK_MINUTES_PER_KM = 12; // 5 km/h
/** Naismith's rule for hill walking: about 600 m of climb an hour, 10 m a minute. */
export const CLIMB_METRES_PER_MINUTE = 10;

/**
 * Stairs and heights people know, for "climb…" cards. `m` is the height climbed: to the top
 * of the public stair climb for a building, from sea level for a mountain.
 */
const CLIMBS: ReadonlyArray<{
  id: string;
  icon: string;
  m: number;
  text: (times: string) => string;
}> = [
  { id: 'eiffel', icon: '🗼', m: 115, text: (t) => `walk up the Eiffel Tower's 674 steps ${t}` },
  {
    id: 'empire-state',
    icon: '🏙️',
    m: 320,
    text: (t) => `walk up the Empire State Building's 1,576 steps ${t}`,
  },
  { id: 'cn-tower', icon: '🗼', m: 346, text: (t) => `walk up the CN Tower's 1,776 steps ${t}` },
  { id: 'taipei-101', icon: '🏙️', m: 390, text: (t) => `walk up Taipei 101's 2,046 steps ${t}` },
  { id: 'willis', icon: '🏙️', m: 412, text: (t) => `walk up the Willis Tower's 2,109 steps ${t}` },
  {
    id: 'shanghai',
    icon: '🏙️',
    m: 632,
    text: (t) => `climb the height of the Shanghai Tower ${t}`,
  },
  { id: 'burj', icon: '🏙️', m: 828, text: (t) => `climb the height of the Burj Khalifa ${t}` },
  { id: 'fuji', icon: '🗻', m: 3776, text: (t) => `climb Mount Fuji from sea level ${t}` },
  { id: 'kilimanjaro', icon: '⛰️', m: 5895, text: (t) => `climb Kilimanjaro from sea level ${t}` },
  { id: 'everest', icon: '🏔️', m: 8849, text: (t) => `climb Mount Everest from sea level ${t}` },
];

const times = (u: number) => {
  const n = Math.round(u * 10) / 10;
  if (n < 1.15) return 'once';
  if (n >= 1.85 && n < 2.15) return 'twice';
  return `~${n1(n >= 10 ? Math.round(n) : n)} times`;
};

const CLIMB_EQUIVALENTS: Equivalent[] = CLIMBS.map((c) => {
  const perClimb = c.m / CLIMB_METRES_PER_MINUTE;
  return {
    id: `climb-${c.id}`,
    icon: c.icon,
    kind: 'climb' as const,
    minutesPerUnit: perClimb,
    phrase: (u: number) => c.text(times(u)),
    fits: [perClimb * 0.95, perClimb * 20] as const,
  };
});
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
  ...CLIMB_EQUIVALENTS,
  ...WORLD_EQUIVALENTS,
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

/** Most cards of a kind in one hand, so it still has films and marathons in it. */
const MAX_PER_HAND: Record<NonNullable<Equivalent['kind']>, number> = { world: 2, climb: 1 };
const KIND_OF = new Map(EQUIVALENTS.map((e) => [e.id, e.kind]));

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
  const used: Record<string, number> = {};
  const o = shuffle(others, 2).filter((c) => {
    const kind = KIND_OF.get(c.id);
    if (!kind) return true;
    used[kind] = (used[kind] ?? 0) + 1;
    return used[kind] <= MAX_PER_HAND[kind];
  });
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
