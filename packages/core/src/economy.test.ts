import { describe, expect, it } from 'vitest';
import {
  ACCENT_PRESETS,
  applyBreakDay,
  BACKGROUNDS,
  breakDayCost,
  isAccentUnlocked,
  isBackgroundAvailable,
  purchaseBackground,
  purchaseBreakDay,
  purchaseFreeze,
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
  it('gates accents by level', () => {
    expect(ACCENT_PRESETS).toHaveLength(6);
    expect(unlockedAccents(0).map((a) => a.id)).toEqual(['indigo', 'sky', 'mint']);
    expect(unlockedAccents(10).map((a) => a.id)).toContain('rose');
    expect(isAccentUnlocked('violet', 19)).toBe(false);
    expect(isAccentUnlocked('violet', 20)).toBe(true);
    expect(isAccentUnlocked('nope', 99)).toBe(false);
  });

  it('gates and sells backgrounds', () => {
    expect(BACKGROUNDS.length).toBeGreaterThanOrEqual(8);
    expect(isBackgroundAvailable('aurora', 0, [])).toBe(true);
    expect(isBackgroundAvailable('nebula', 7, [])).toBe(false);
    expect(isBackgroundAvailable('nebula', 8, [])).toBe(true);
    expect(isBackgroundAvailable('prism', 50, [])).toBe(false);
    expect(isBackgroundAvailable('prism', 0, ['prism'])).toBe(true);
    expect(isBackgroundAvailable('nope', 0, [])).toBe(false);

    expect(purchaseBackground(100, 'aurora', []).ok).toBe(false);
    expect(purchaseBackground(100, 'prism', []).ok).toBe(false);
    expect(purchaseBackground(500, 'prism', ['prism']).ok).toBe(false);
    const r = purchaseBackground(500, 'prism', []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ xp: 100, purchasedIds: ['prism'] });
  });
});
