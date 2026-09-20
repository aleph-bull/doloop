import { describe, expect, it } from 'vitest';
import {
  addVacation,
  countedEditsInMonth,
  editsInLast7Days,
  editsRemaining,
  materializePendingRestDays,
  removeVacation,
  REST_LIMITS,
  setWeeklyRestDays,
} from './rest-day-changes';
import { emptyRestDayPolicy } from './rest-days';
import type { RestDayPolicy } from './types';

const TZ = 'America/Toronto';
const NOW = '2026-09-20T18:00:00.000Z'; // Sunday 14:00 local

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};

describe('setWeeklyRestDays', () => {
  it('schedules the change for the following Monday and logs it', () => {
    const p = unwrap(setWeeklyRestDays(emptyRestDayPolicy('u'), [6, 0], NOW, TZ));
    expect(p.weeklyRestDays).toEqual([]);
    expect(p.pendingWeeklyRestDays).toEqual({ days: [0, 6], effectiveFrom: '2026-09-21' });
    expect(p.changeLog).toHaveLength(1);
    expect(p.changeLog[0]!.what).toBe('weekly:0,6@2026-09-21');
  });

  it('uses the Monday strictly after today when today is Monday', () => {
    const mondayNoon = '2026-09-21T16:00:00.000Z';
    const p = unwrap(setWeeklyRestDays(emptyRestDayPolicy('u'), [3], mondayNoon, TZ));
    expect(p.pendingWeeklyRestDays?.effectiveFrom).toBe('2026-09-28');
  });

  it('validates the days', () => {
    expect(setWeeklyRestDays(emptyRestDayPolicy('u'), [7], NOW, TZ).ok).toBe(false);
    expect(setWeeklyRestDays(emptyRestDayPolicy('u'), [1.5], NOW, TZ).ok).toBe(false);
    expect(setWeeklyRestDays(emptyRestDayPolicy('u'), [0, 1, 2, 3, 4, 5, 6], NOW, TZ).ok).toBe(
      false,
    );
  });

  it('is a no-op (no log) when nothing changes', () => {
    const base = { ...emptyRestDayPolicy('u'), weeklyRestDays: [0, 6] };
    const p = unwrap(setWeeklyRestDays(base, [6, 0, 0], NOW, TZ));
    expect(p).toBe(base);
  });

  it('materializes a pending pattern on or after its effective date', () => {
    const p = unwrap(setWeeklyRestDays(emptyRestDayPolicy('u'), [2], NOW, TZ));
    expect(materializePendingRestDays(p, '2026-09-20')).toBe(p);
    const m = materializePendingRestDays(p, '2026-09-21');
    expect(m.weeklyRestDays).toEqual([2]);
    expect(m.pendingWeeklyRestDays).toBeNull();
    expect(
      materializePendingRestDays(emptyRestDayPolicy('u'), '2026-09-21').pendingWeeklyRestDays,
    ).toBeNull();
  });
});

describe('vacations', () => {
  it('requires 48 h lead time', () => {
    const p = emptyRestDayPolicy('u');
    // Sep 22 local midnight = 04:00Z = 34 h from NOW -> refused
    expect(addVacation(p, { from: '2026-09-22', to: '2026-09-23', label: 'x' }, NOW, TZ).ok).toBe(
      false,
    );
    // Sep 23 local midnight = 58 h -> ok
    const v = unwrap(
      addVacation(p, { from: '2026-09-23', to: '2026-09-24', label: ' trip ' }, NOW, TZ),
    );
    expect(v.vacations).toEqual([{ from: '2026-09-23', to: '2026-09-24', label: 'trip' }]);
    expect(v.changeLog[0]!.what).toBe('vacation-add:2026-09-23..2026-09-24');
  });

  it('validates dates and overlap', () => {
    const p = emptyRestDayPolicy('u');
    expect(addVacation(p, { from: 'x', to: '2026-10-01', label: '' }, NOW, TZ).ok).toBe(false);
    expect(addVacation(p, { from: '2026-10-05', to: '2026-10-01', label: '' }, NOW, TZ).ok).toBe(
      false,
    );
    const v = unwrap(addVacation(p, { from: '2026-10-01', to: '2026-10-05', label: 'a' }, NOW, TZ));
    expect(addVacation(v, { from: '2026-10-05', to: '2026-10-07', label: 'b' }, NOW, TZ).ok).toBe(
      false,
    );
    expect(addVacation(v, { from: '2026-09-28', to: '2026-10-01', label: 'b' }, NOW, TZ).ok).toBe(
      false,
    );
    const w = unwrap(addVacation(v, { from: '2026-09-25', to: '2026-09-26', label: 'b' }, NOW, TZ));
    expect(w.vacations.map((x) => x.from)).toEqual(['2026-09-25', '2026-10-01']);
  });

  it('removes anytime without counting toward the limit', () => {
    const p = emptyRestDayPolicy('u');
    const v = unwrap(addVacation(p, { from: '2026-10-01', to: '2026-10-05', label: 'a' }, NOW, TZ));
    expect(removeVacation(v, '2026-10-02', NOW).ok).toBe(false);
    const r = unwrap(removeVacation(v, '2026-10-01', NOW));
    expect(r.vacations).toEqual([]);
    expect(r.changeLog.map((c) => c.what)).toEqual([
      'vacation-add:2026-10-01..2026-10-05',
      'vacation-remove:2026-10-01..2026-10-05',
    ]);
    expect(editsInLast7Days(r, NOW)).toBe(1);
  });
});

describe('edit limits', () => {
  it('allows 3 counted edits per rolling 7 days and shows the remaining count', () => {
    let p: RestDayPolicy = emptyRestDayPolicy('u');
    expect(editsRemaining(p, NOW)).toBe(REST_LIMITS.MAX_EDITS_PER_ROLLING_7_DAYS);
    p = unwrap(setWeeklyRestDays(p, [1], NOW, TZ));
    p = unwrap(setWeeklyRestDays(p, [2], NOW, TZ));
    p = unwrap(addVacation(p, { from: '2026-10-01', to: '2026-10-02', label: 'a' }, NOW, TZ));
    expect(editsRemaining(p, NOW)).toBe(0);
    const fourth = setWeeklyRestDays(p, [3], NOW, TZ);
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) expect(fourth.reason).toMatch(/3 times per 7 days/);
    expect(addVacation(p, { from: '2026-10-10', to: '2026-10-11', label: 'b' }, NOW, TZ).ok).toBe(
      false,
    );
  });

  it('old edits roll out of the window', () => {
    const old = '2026-09-10T00:00:00.000Z';
    let p: RestDayPolicy = emptyRestDayPolicy('u');
    p = unwrap(setWeeklyRestDays(p, [1], old, TZ));
    p = unwrap(setWeeklyRestDays(p, [2], old, TZ));
    p = unwrap(setWeeklyRestDays(p, [3], old, TZ));
    expect(editsInLast7Days(p, NOW)).toBe(0);
    expect(setWeeklyRestDays(p, [4], NOW, TZ).ok).toBe(true);
  });

  it('counts edits per calendar month for the weekly review', () => {
    let p: RestDayPolicy = emptyRestDayPolicy('u');
    p = unwrap(setWeeklyRestDays(p, [1], '2026-08-30T12:00:00.000Z', TZ));
    p = unwrap(setWeeklyRestDays(p, [2], '2026-09-02T12:00:00.000Z', TZ));
    p = unwrap(
      addVacation(
        p,
        { from: '2026-10-01', to: '2026-10-02', label: 'a' },
        '2026-09-05T12:00:00.000Z',
        TZ,
      ),
    );
    p = unwrap(removeVacation(p, '2026-10-01', '2026-09-06T12:00:00.000Z'));
    expect(countedEditsInMonth(p, '2026-09', TZ)).toBe(2);
    expect(countedEditsInMonth(p, '2026-08', TZ)).toBe(1);
  });
});
