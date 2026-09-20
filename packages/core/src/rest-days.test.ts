import { describe, expect, it } from 'vitest';
import {
  effectiveWeeklyRestDays,
  emptyRestDayPolicy,
  isBreakDay,
  isRestDay,
  isVacationDay,
  isWeeklyRestDay,
  restReason,
} from './rest-days';

const base = () => ({ ...emptyRestDayPolicy('u1'), weeklyRestDays: [0, 6] }); // weekends

describe('rest days', () => {
  it('detects weekly rest days', () => {
    const p = base();
    expect(isWeeklyRestDay(p, '2026-09-20')).toBe(true); // Sunday
    expect(isWeeklyRestDay(p, '2026-09-21')).toBe(false); // Monday
  });

  it('honours a pending weekly pattern from its effective Monday', () => {
    const p = { ...base(), pendingWeeklyRestDays: { days: [3], effectiveFrom: '2026-09-28' } };
    expect(effectiveWeeklyRestDays(p, '2026-09-27')).toEqual([0, 6]);
    expect(effectiveWeeklyRestDays(p, '2026-09-28')).toEqual([3]);
    expect(isWeeklyRestDay(p, '2026-10-04')).toBe(false); // Sunday after change
    expect(isWeeklyRestDay(p, '2026-09-30')).toBe(true); // Wednesday after change
  });

  it('detects vacations inclusive of both ends', () => {
    const p = { ...base(), vacations: [{ from: '2026-10-01', to: '2026-10-03', label: 'trip' }] };
    expect(isVacationDay(p, '2026-09-30')).toBe(false);
    expect(isVacationDay(p, '2026-10-01')).toBe(true);
    expect(isVacationDay(p, '2026-10-03')).toBe(true);
    expect(isVacationDay(p, '2026-10-04')).toBe(false);
  });

  it('detects break days', () => {
    const p = { ...base(), breakDays: ['2026-09-23'] };
    expect(isBreakDay(p, '2026-09-23')).toBe(true);
    expect(isBreakDay(p, '2026-09-24')).toBe(false);
  });

  it('combines all sources with a reason', () => {
    const p = {
      ...base(),
      vacations: [{ from: '2026-10-01', to: '2026-10-03', label: 'trip' }],
      breakDays: ['2026-09-23'],
    };
    expect(isRestDay(p, '2026-09-20')).toBe(true);
    expect(isRestDay(p, '2026-09-22')).toBe(false);
    expect(restReason(p, '2026-09-20')).toBe('weekly');
    expect(restReason(p, '2026-10-02')).toBe('vacation');
    expect(restReason(p, '2026-09-23')).toBe('break');
    expect(restReason(p, '2026-09-22')).toBeNull();
  });
});
