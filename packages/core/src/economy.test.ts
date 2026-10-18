import { describe, expect, it } from 'vitest';
import {
  ACCENT_PRESETS,
  applyBreakDay,
  BACKGROUNDS,
  BACKGROUND_CATEGORY_LABELS,
  backgroundsInCategory,
  DEFAULT_BACKGROUND_ID,
  breakDayCost,
  isAccentUnlocked,
  isBackgroundAvailable,
  purchaseBackground,
  purchaseBreakDay,
  purchaseFreeze,
  resolveBackgroundId,
  SHOP,
  unlockedAccents,
} from './economy';
import { emptyRestDayPolicy } from './rest-days';
import { emptyStreak } from './streak';

const TZ = 'America/Toronto';
const NOW = '2026-09-20T18:00:00.000Z';

describe('freezes', () => {
  it('buys a freeze and deducts XP', () => {
    const r = purchaseFreeze({ xp: 200, streak: emptyStreak() });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.xp).toBe(50);
      expect(r.value.streak.freezesHeld).toBe(1);
    }
  });

  it('refuses when broke or at the cap', () => {
    expect(purchaseFreeze({ xp: 100, streak: emptyStreak() }).ok).toBe(false);
    expect(purchaseFreeze({ xp: 1000, streak: { ...emptyStreak(), freezesHeld: 2 } }).ok).toBe(
      false,
    );
  });
});

describe('break days', () => {
  it('escalates cost within a month', () => {
    expect(breakDayCost(0)).toBe(300);
    expect(breakDayCost(1)).toBe(450);
    expect(breakDayCost(2)).toBe(675);
    expect(breakDayCost(-3)).toBe(300);
  });

  it('buys a break day at the escalated price and enforces the cap', () => {
    const r = purchaseBreakDay({ xp: 500, streak: emptyStreak() }, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.xp).toBe(50);
      expect(r.value.streak.breakDaysHeld).toBe(1);
    }
    expect(purchaseBreakDay({ xp: 400, streak: emptyStreak() }, 1).ok).toBe(false);
    expect(
      purchaseBreakDay(
        { xp: 4000, streak: { ...emptyStreak(), breakDaysHeld: SHOP.MAX_BREAK_DAYS } },
        0,
      ).ok,
    ).toBe(false);
  });

  it('applies a held break day at least 24 h ahead, never retroactively', () => {
    const policy = emptyRestDayPolicy('u');
    const streak = { ...emptyStreak(), breakDaysHeld: 1 };
    // Sep 21 local midnight = 04:00Z, only 10 h from NOW -> refused
    expect(applyBreakDay({ policy, streak, date: '2026-09-21', now: NOW, timezone: TZ }).ok).toBe(
      false,
    );
    expect(applyBreakDay({ policy, streak, date: '2026-09-19', now: NOW, timezone: TZ }).ok).toBe(
      false,
    );
    const r = applyBreakDay({ policy, streak, date: '2026-09-22', now: NOW, timezone: TZ });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.policy.breakDays).toEqual(['2026-09-22']);
      expect(r.value.streak.breakDaysHeld).toBe(0);
      expect(r.value.policy.changeLog.at(-1)?.what).toBe('break-day:2026-09-22');
      // Cannot apply twice to the same day
      expect(
        applyBreakDay({
          policy: r.value.policy,
          streak,
          date: '2026-09-22',
          now: NOW,
          timezone: TZ,
        }).ok,
      ).toBe(false);
    }
  });

  it('refuses invalid dates and empty inventory', () => {
    const policy = emptyRestDayPolicy('u');
    expect(
      applyBreakDay({ policy, streak: emptyStreak(), date: '2026-09-25', now: NOW, timezone: TZ })
        .ok,
    ).toBe(false);
    expect(
      applyBreakDay({
        policy,
        streak: { ...emptyStreak(), breakDaysHeld: 1 },
        date: 'bad',
        now: NOW,
        timezone: TZ,
      }).ok,
    ).toBe(false);
  });
});

describe('cosmetics', () => {
  it('makes every accent free', () => {
    expect(ACCENT_PRESETS).toHaveLength(6);
    expect(unlockedAccents(0).map((a) => a.id)).toEqual(ACCENT_PRESETS.map((a) => a.id));
    expect(isAccentUnlocked('violet', 0)).toBe(true);
    expect(isAccentUnlocked('nope', 99)).toBe(false);
  });

  it('gates and sells backgrounds', () => {
    expect(BACKGROUNDS.length).toBeGreaterThanOrEqual(8);
    // Every gradient is free, so the quiet set is always usable.
    expect(isBackgroundAvailable('graphite', 0, [])).toBe(true);
    expect(isBackgroundAvailable('onyx', 0, [])).toBe(true);
    // Level gates.
    expect(isBackgroundAvailable('ice-canyon', 7, [])).toBe(false);
    expect(isBackgroundAvailable('ice-canyon', 8, [])).toBe(true);
    // A purchasable background is never unlocked by levelling.
    expect(isBackgroundAvailable('kirkjufell', 50, [])).toBe(false);
    expect(isBackgroundAvailable('kirkjufell', 0, ['kirkjufell'])).toBe(true);
    expect(isBackgroundAvailable('nope', 0, [])).toBe(false);

    expect(purchaseBackground(100, 'graphite', []).ok).toBe(false);
    expect(purchaseBackground(100, 'kirkjufell', []).ok).toBe(false);
    expect(purchaseBackground(500, 'kirkjufell', ['kirkjufell']).ok).toBe(false);
    const r = purchaseBackground(500, 'kirkjufell', []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ xp: 100, purchasedIds: ['kirkjufell'] });
  });

  it('resolves an unknown or dropped background id to the default', () => {
    expect(resolveBackgroundId('graphite')).toBe('graphite');
    // Ids from the old catalogue no longer exist.
    expect(resolveBackgroundId('aurora')).toBe(DEFAULT_BACKGROUND_ID);
    expect(resolveBackgroundId(null)).toBe(DEFAULT_BACKGROUND_ID);
    expect(resolveBackgroundId('')).toBe(DEFAULT_BACKGROUND_ID);
  });

  it('gives every background a category that the pickers can group by', () => {
    const labelled = new Set(BACKGROUND_CATEGORY_LABELS.map((c) => c.id));
    for (const b of BACKGROUNDS) expect(labelled.has(b.category)).toBe(true);
    // No category is advertised with nothing in it.
    for (const c of BACKGROUND_CATEGORY_LABELS)
      expect(backgroundsInCategory(c.id).length).toBeGreaterThan(0);
  });
});

describe('solid colour backgrounds', () => {
  it('stores a colour as a free background id', async () => {
    const { solidBackgroundId, solidColorOf, resolveBackgroundId, isBackgroundAvailable } =
      await import('./economy');
    const id = solidBackgroundId('#1A2B3C');
    expect(id).toBe('solid:#1a2b3c');
    expect(solidColorOf(id)).toBe('#1a2b3c');
    expect(resolveBackgroundId(id)).toBe(id);
    expect(isBackgroundAvailable(id, 1, [])).toBe(true);
    expect(solidColorOf('solid:red')).toBeNull();
    expect(resolveBackgroundId('solid:#12345')).toBe(DEFAULT_BACKGROUND_ID);
  });
});
