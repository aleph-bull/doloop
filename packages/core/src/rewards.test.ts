import { describe, expect, it } from 'vitest';
import {
  cooldownUntil,
  redeemReward,
  REWARDS,
  toRewardView,
  validateRewardDraft,
  type CustomReward,
} from './rewards';

const TZ = 'America/Toronto';

const reward = (over: Partial<CustomReward> = {}): CustomReward => ({
  id: 'r1',
  userId: 'u1',
  name: 'Doomscroll for an hour',
  note: null,
  emoji: '📱',
  costXp: 200,
  cooldownDays: 0,
  archived: false,
  createdAt: '2026-09-01T12:00:00.000Z',
  lastRedeemedAt: null,
  redeemedCount: 0,
  ...over,
});

describe('validateRewardDraft', () => {
  it('normalises a good draft', () => {
    const r = validateRewardDraft({
      name: '  Buy the hoodie  ',
      note: '  the grey one  ',
      emoji: '🧥extra',
      costXp: 500,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      name: 'Buy the hoodie',
      note: 'the grey one',
      emoji: '🧥',
      costXp: 500,
      cooldownDays: 0,
    });
  });

  it('turns an empty note into null', () => {
    const r = validateRewardDraft({ name: 'x', note: '   ', costXp: REWARDS.MIN_COST_XP });
    expect(r.ok && r.value.note).toBeNull();
    expect(r.ok && r.value.emoji).toBeNull();
  });

  it('refuses a blank name', () => {
    expect(validateRewardDraft({ name: '   ', costXp: 500 })).toMatchObject({ ok: false });
  });

  it('enforces the price floor', () => {
    const r = validateRewardDraft({ name: 'Cheap', costXp: REWARDS.MIN_COST_XP - 1 });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain(String(REWARDS.MIN_COST_XP));
  });

  it('accepts exactly the floor', () => {
    expect(validateRewardDraft({ name: 'Floor', costXp: REWARDS.MIN_COST_XP }).ok).toBe(true);
  });

  it('refuses fractional prices and silly cooldowns', () => {
    expect(validateRewardDraft({ name: 'x', costXp: 200.5 }).ok).toBe(false);
    expect(
      validateRewardDraft({ name: 'x', costXp: 200, cooldownDays: REWARDS.MAX_COOLDOWN_DAYS + 1 })
        .ok,
    ).toBe(false);
    expect(validateRewardDraft({ name: 'x', costXp: 200, cooldownDays: -1 }).ok).toBe(false);
  });
});

describe('cooldownUntil', () => {
  it('is null without a cooldown or without a redemption', () => {
    const now = '2026-09-21T15:00:00.000Z';
    expect(cooldownUntil(reward(), now, TZ)).toBeNull();
    expect(cooldownUntil(reward({ cooldownDays: 7 }), now, TZ)).toBeNull();
  });

  it('counts whole local days from the last redemption', () => {
    const r = reward({ cooldownDays: 7, lastRedeemedAt: '2026-09-18T15:00:00.000Z' });
    expect(cooldownUntil(r, '2026-09-21T15:00:00.000Z', TZ)).toBe('2026-09-25');
    // On the day the cooldown lifts it is available again.
    expect(cooldownUntil(r, '2026-09-25T15:00:00.000Z', TZ)).toBeNull();
    expect(cooldownUntil(r, '2026-09-24T15:00:00.000Z', TZ)).toBe('2026-09-25');
  });
});

describe('redeemReward', () => {
  const now = '2026-09-21T15:00:00.000Z';

  it('spends the XP and records the redemption', () => {
    const r = redeemReward(500, reward({ costXp: 200 }), now, TZ);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.xp).toBe(300);
    expect(r.value.reward.redeemedCount).toBe(1);
    expect(r.value.reward.lastRedeemedAt).toBe(now);
  });

  it('refuses when short, naming the gap', () => {
    const r = redeemReward(150, reward({ costXp: 200 }), now, TZ);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain('50 XP short');
  });

  it('refuses while cooling down, and again once archived', () => {
    const cooling = reward({ cooldownDays: 7, lastRedeemedAt: '2026-09-20T15:00:00.000Z' });
    expect(redeemReward(9999, cooling, now, TZ)).toMatchObject({ ok: false });
    expect(redeemReward(9999, reward({ archived: true }), now, TZ)).toMatchObject({ ok: false });
  });

  it('allows redeeming exactly at the price', () => {
    const r = redeemReward(200, reward({ costXp: 200 }), now, TZ);
    expect(r.ok && r.value.xp).toBe(0);
  });
});

describe('toRewardView', () => {
  const now = '2026-09-21T15:00:00.000Z';

  it('resolves affordability and cooldown into one verdict', () => {
    expect(toRewardView(reward({ costXp: 200 }), 100, now, TZ)).toMatchObject({
      affordable: false,
      redeemable: false,
      availableOn: null,
    });
    expect(toRewardView(reward({ costXp: 200 }), 250, now, TZ)).toMatchObject({
      affordable: true,
      redeemable: true,
    });
    expect(
      toRewardView(
        reward({ costXp: 200, cooldownDays: 3, lastRedeemedAt: '2026-09-21T01:00:00.000Z' }),
        250,
        now,
        TZ,
      ),
    ).toMatchObject({ affordable: true, redeemable: false, availableOn: '2026-09-23' });
  });

  it('never calls an archived reward redeemable', () => {
    expect(toRewardView(reward({ archived: true }), 9999, now, TZ).redeemable).toBe(false);
  });
});
