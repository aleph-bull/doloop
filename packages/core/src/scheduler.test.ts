import { describe, expect, it } from 'vitest';
import { emptyRestDayPolicy } from './rest-days';
import { findFreeSlots } from './scheduler';

const TZ = 'America/Toronto';
const base = {
  from: '2026-09-21T13:00:00.000Z', // Mon 09:00 local
  to: '2026-09-23T04:00:00.000Z', // Wed 00:00 local
  timezone: TZ,
  policy: emptyRestDayPolicy('u'),
  minutes: 60,
};

describe('findFreeSlots', () => {
  it('returns the first free hour inside the daily window', () => {
    const slots = findFreeSlots({ ...base, busy: [], limit: 1 });
    expect(slots).toEqual([{ start: '2026-09-21T13:00:00.000Z', end: '2026-09-21T14:00:00.000Z' }]);
  });

  it('skips busy time and merges overlapping busy intervals', () => {
    const busy = [
      { start: '2026-09-21T13:00:00.000Z', end: '2026-09-21T15:00:00.000Z' },
      { start: '2026-09-21T14:30:00.000Z', end: '2026-09-21T16:30:00.000Z' },
    ];
    const [first] = findFreeSlots({ ...base, busy, limit: 1 });
    expect(first).toEqual({ start: '2026-09-21T16:30:00.000Z', end: '2026-09-21T17:30:00.000Z' });
  });

  it('uses a gap between busy blocks when it is big enough', () => {
    const busy = [
      { start: '2026-09-21T13:00:00.000Z', end: '2026-09-21T13:30:00.000Z' },
      { start: '2026-09-21T14:45:00.000Z', end: '2026-09-21T20:00:00.000Z' },
    ];
    const slots = findFreeSlots({ ...base, busy, limit: 2 });
    expect(slots[0]).toEqual({
      start: '2026-09-21T13:30:00.000Z',
      end: '2026-09-21T14:30:00.000Z',
    });
    expect(slots[1]!.start).toBe('2026-09-21T20:00:00.000Z');
  });

  it('respects rest days and the daily window', () => {
    const policy = { ...emptyRestDayPolicy('u'), weeklyRestDays: [1] }; // Monday off
    const slots = findFreeSlots({
      ...base,
      policy,
      busy: [],
      limit: 1,
      dayStartHour: 18,
      dayEndHour: 20,
    });
    // Tuesday 18:00 local = 22:00Z
    expect(slots[0]).toEqual({
      start: '2026-09-22T22:00:00.000Z',
      end: '2026-09-22T23:00:00.000Z',
    });
  });

  it('returns nothing when no window is long enough', () => {
    expect(findFreeSlots({ ...base, busy: [], minutes: 20 * 60 })).toEqual([]);
  });

  it('caps the number of slots and finds one per free day', () => {
    expect(findFreeSlots({ ...base, busy: [], limit: 1 })).toHaveLength(1);
    // Monday and Tuesday each yield one slot; Wednesday is outside the window.
    expect(findFreeSlots({ ...base, busy: [], limit: 5 })).toHaveLength(2);
  });
});
