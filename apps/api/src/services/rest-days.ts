import {
  addVacation,
  editsRemaining,
  removeVacation,
  setWeeklyRestDays,
  type RestDayPolicy,
  type Vacation,
} from '@komodoit/core';
import type { Db } from '../db/client';
import { badRequest } from '../errors';
import { getPolicy, savePolicy } from './users';

export interface PolicyView {
  policy: RestDayPolicy;
  editsRemaining: number;
}

export async function viewPolicy(db: Db, userId: string, now: string): Promise<PolicyView> {
  const policy = await getPolicy(db, userId);
  return { policy, editsRemaining: editsRemaining(policy, now) };
}

export async function changeWeeklyRestDays(
  db: Db,
  userId: string,
  days: number[],
  now: string,
  timezone: string,
): Promise<PolicyView> {
  const policy = await getPolicy(db, userId);
  const r = setWeeklyRestDays(policy, days, now, timezone);
  if (!r.ok) throw badRequest(r.reason);
  if (r.value !== policy) await savePolicy(db, r.value);
  return { policy: r.value, editsRemaining: editsRemaining(r.value, now) };
}

export async function addVacationFor(
  db: Db,
  userId: string,
  vacation: Vacation,
  now: string,
  timezone: string,
): Promise<PolicyView> {
  const policy = await getPolicy(db, userId);
  const r = addVacation(policy, vacation, now, timezone);
  if (!r.ok) throw badRequest(r.reason);
  await savePolicy(db, r.value);
  return { policy: r.value, editsRemaining: editsRemaining(r.value, now) };
}

export async function removeVacationFor(
  db: Db,
  userId: string,
  from: string,
  now: string,
): Promise<PolicyView> {
  const policy = await getPolicy(db, userId);
  const r = removeVacation(policy, from, now);
  if (!r.ok) throw badRequest(r.reason);
  await savePolicy(db, r.value);
  return { policy: r.value, editsRemaining: editsRemaining(r.value, now) };
}
