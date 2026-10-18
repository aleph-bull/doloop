import { describe, expect, it } from 'vitest';
import {
  EQUIVALENTS,
  equivalentCard,
  fallbackFacts,
  pickEquivalents,
  fmtCount,
  SCREEN_TITLES,
  screenCard,
  walkLandmark,
  type ScreenFacts,
} from './equivalents';

const film: ScreenFacts = {
  tmdbId: 27205,
  type: 'movie',
  title: 'Inception',
  minutes: 148,
  posterUrl: 'https://image.tmdb.org/t/p/w342/x.jpg',
  approximate: false,
};
const show: ScreenFacts = {
  tmdbId: 1396,
  type: 'tv',
  title: 'Breaking Bad',
  season: 1,
  minutes: 336,
  episodes: 7,
  posterUrl: null,
  approximate: true,
};

describe('screen cards', () => {
  it('counts times through a film, and marks a fallback runtime as approximate', () => {
    expect(screenCard(film, 340)!.text).toBe('watch Inception 2.3 times');
    expect(screenCard(film, 340)!.imageUrl).toBe(film.posterUrl);
    expect(screenCard({ ...film, approximate: true }, 148)!.text).toBe('watch Inception ~1 time');
  });

  it('speaks in seasons and episodes for a series', () => {
    expect(screenCard(show, 340)!.text).toBe('watch the entire season 1 of Breaking Bad');
    expect(screenCard(show, 700)!.text).toBe(
      'watch the entire season 1 of Breaking Bad ~2.1 times',
    );
    expect(screenCard(show, 150)!.text).toBe('watch ~3 episodes of Breaking Bad');
    expect(screenCard(show, 20)).toBeNull();
  });

  it('says how far through a film a short total gets, or nothing when that is too little', () => {
    expect(screenCard(film, 74)!.text).toBe('get 50% of the way through Inception');
    expect(screenCard(film, 10)).toBeNull();
    expect(screenCard(film, 0)).toBeNull();
  });
});

describe('equivalents', () => {
  it('only offers one where the total reads well in its unit', () => {
    const songs = EQUIVALENTS.find((e) => e.id === 'songs')!;
    const marathons = EQUIVALENTS.find((e) => e.id === 'marathons')!;
    expect(equivalentCard(songs, 35)!.text).toBe('listen to ~10 songs');
    expect(equivalentCard(songs, 5000)).toBeNull();
    expect(equivalentCard(marathons, 30)).toBeNull();
    expect(equivalentCard(marathons, 540)!.text).toBe('run ~2 marathons');
  });

  it('names a place for a walking distance', () => {
    expect(walkLandmark(0.5)).toBeNull();
    expect(walkLandmark(9)!.name).toBe('a lap around Central Park in New York');
    expect(walkLandmark(42)!.name).toBe('a full marathon');
    expect(walkLandmark(120)!.name).toBe("the length of Hadrian's Wall");
    // Nothing within 30%: no "about" rather than a stretch.
    expect(walkLandmark(100_000)).toBeNull();
    const walk = EQUIVALENTS.find((e) => e.id === 'walk')!;
    expect(equivalentCard(walk, 9 * 12)!.text).toBe(
      'walk ~9 km at a stroll, about a lap around Central Park in New York',
    );
  });

  it('counts what the world does meanwhile', () => {
    const births = EQUIVALENTS.find((e) => e.id === 'births')!;
    expect(equivalentCard(births, 60)!.text).toBe('see ~16,000 babies born around the world');
    const searches = EQUIVALENTS.find((e) => e.id === 'searches')!;
    expect(equivalentCard(searches, 60)!.text).toBe('see ~350 million Google searches made');
    const iss = EQUIVALENTS.find((e) => e.id === 'iss')!;
    expect(equivalentCard(iss, 60)).toBeNull();
    expect(equivalentCard(iss, 93)!.text).toBe('watch the space station circle Earth once');
    expect(fmtCount(1_234_000_000)).toBe('1.2 billion');
  });

  it('keeps world facts to two a hand', () => {
    for (let seed = 0; seed < 40; seed++) {
      const hand = pickEquivalents({ minutes: 600, seed, count: 4 });
      const world = hand.filter((c) =>
        EQUIVALENTS.some((e) => e.id === c.id && e.kind === 'world'),
      );
      expect(world.length).toBeLessThanOrEqual(2);
    }
  });

  it('climbs stairs, then mountains', () => {
    const card = (id: string, minutes: number) =>
      equivalentCard(
        EQUIVALENTS.find((e) => e.id === id)!,
        minutes,
      );
    expect(card('climb-cn-tower', 20)).toBeNull();
    expect(card('climb-cn-tower', 35)!.text).toBe("walk up the CN Tower's 1,776 steps once");
    expect(card('climb-cn-tower', 104)!.text).toBe("walk up the CN Tower's 1,776 steps ~3 times");
    expect(card('climb-empire-state', 64)!.text).toBe(
      "walk up the Empire State Building's 1,576 steps twice",
    );
    expect(card('climb-everest', 500)).toBeNull();
    expect(card('climb-everest', 885)!.text).toBe('climb Mount Everest from sea level once');
  });

  it('keeps climbs to one a hand', () => {
    for (let seed = 0; seed < 40; seed++) {
      const hand = pickEquivalents({ minutes: 300, seed, count: 4 });
      expect(hand.filter((c) => c.id.startsWith('climb-')).length).toBeLessThanOrEqual(1);
    }
  });

  it('flies part of the way before it flies there and back', () => {
    const fly = EQUIVALENTS.find((e) => e.id === 'flight')!;
    expect(equivalentCard(fly, 390)!.text).toBe('fly ~50% of the way from Toronto to Tokyo');
    expect(equivalentCard(fly, 1560)!.text).toBe('fly Toronto to Tokyo ~2 times');
  });

  it('every equivalent has a sane range and a sentence', () => {
    for (const e of EQUIVALENTS) {
      expect(e.minutesPerUnit).toBeGreaterThan(0);
      expect(e.fits[0]).toBeLessThan(e.fits[1]);
      expect(e.phrase(2, e.minutesPerUnit * 2).length).toBeGreaterThan(5);
    }
    for (const t of SCREEN_TITLES) expect(fallbackFacts(t).approximate).toBe(true);
  });
});

describe('pickEquivalents', () => {
  it('picks a mix, leads with a screen, and repeats for the same seed', () => {
    const a = pickEquivalents({ minutes: 600, seed: 3 });
    expect(a.length).toBe(4);
    expect(a[0]!.id.startsWith('screen:')).toBe(true);
    expect(a.some((c) => !c.id.startsWith('screen:'))).toBe(true);
    expect(new Set(a.map((c) => c.id)).size).toBe(4);
    expect(pickEquivalents({ minutes: 600, seed: 3 })).toEqual(a);
    const others = new Set<string>();
    for (let seed = 0; seed < 8; seed++)
      for (const c of pickEquivalents({ minutes: 600, seed })) others.add(c.id);
    expect(others.size).toBeGreaterThan(4);
  });

  it('keeps small totals small and returns nothing for nothing', () => {
    const tiny = pickEquivalents({ minutes: 20, seed: 1 });
    expect(tiny.every((c) => !c.text.includes('marathon'))).toBe(true);
    expect(tiny.length).toBeGreaterThan(0);
    expect(pickEquivalents({ minutes: 0, seed: 1 })).toEqual([]);
  });

  it('uses the screen facts it is given', () => {
    const picks = pickEquivalents({ minutes: 300, seed: 1, screens: [film] });
    expect(picks[0]!.imageUrl).toBe(film.posterUrl);
  });
});
