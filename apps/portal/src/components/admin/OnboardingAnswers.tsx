import {
  NOT_IN_UNIVERSITY,
  ONBOARDING_APPS,
  ONBOARDING_CALENDARS,
  ONBOARDING_LOOKS,
  ONBOARDING_USES,
  onboardingLabel,
  universityById,
  type OnboardingAnswers as Answers,
} from '@komogon/core';
import { Panel, Spinner } from '@komogon/ui';
import { useQuery } from '@tanstack/react-query';
import { adminFetch, adminKeys } from '../../lib/admin';
import { fmtDate } from '../../lib/format';

interface Row {
  userId: string;
  email: string;
  answers: Answers;
  updatedAt: string;
}

const SKIPPED = 'Skipped';

function lookOf(a: Answers): string | null {
  if (a.look === undefined) return null;
  if (a.look === null) return SKIPPED;
  return `${onboardingLabel(ONBOARDING_LOOKS, a.look.id)}${a.look.dark ? ', dark' : ', light'}`;
}

function universityOf(a: Answers): string | null {
  if (a.university === undefined) return null;
  if (a.university === null) return SKIPPED;
  if (a.university === NOT_IN_UNIVERSITY) return 'Not in university';
  return universityById(a.university)?.name ?? a.university;
}

function listOf(
  list: ReadonlyArray<{ id: string; label: string }>,
  picked: string[] | null | undefined,
): string[] | null {
  if (picked === undefined) return null;
  if (picked === null) return [SKIPPED];
  return picked.map((id) => onboardingLabel(list, id));
}

function calendarOf(a: Answers): string | null {
  const from = a.calendarFrom ? onboardingLabel(ONBOARDING_CALENDARS, a.calendarFrom) : null;
  if (a.calendar === undefined) return from ? `Started (${from})` : null;
  if (a.calendar === null) return from ? `Skipped (${from})` : SKIPPED;
  if (a.calendar === 'no') return 'Not now';
  return from ? `Added (${from})` : 'Added';
}

/** Each answer with how many gave it, most first; unanswered rows aren't counted. */
function tally(values: Array<string | null>): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** What everyone answered in the first-time setup, in totals and then person by person. */
export function OnboardingAnswers() {
  const rows = useQuery({
    queryKey: [...adminKeys.accounts, 'onboarding'],
    queryFn: async () =>
      ((await (await adminFetch('/api/admin/onboarding')).json()) as { answers: Row[] }).answers,
    retry: false,
  });

  const data = rows.data ?? [];
  const sections = (key: 'questions' | 'tour' | 'timelapse') =>
    data.map((r) => {
      const end = r.answers.sections?.[key];
      return end === 'done' ? 'Done' : end === 'skipped' ? SKIPPED : null;
    });
  const totals: Array<[string, Array<[string, number]>]> = [
    ['Look', tally(data.map((r) => lookOf(r.answers)))],
    ['University', tally(data.map((r) => universityOf(r.answers)))],
    ['Using it for', tally(data.flatMap((r) => listOf(ONBOARDING_USES, r.answers.uses) ?? []))],
    ['Other apps', tally(data.flatMap((r) => listOf(ONBOARDING_APPS, r.answers.apps) ?? []))],
    ['Calendar', tally(data.map((r) => calendarOf(r.answers)))],
    ['About you', tally(sections('questions'))],
    ['Look around', tally(sections('tour'))],
    ['Timelapse', tally(sections('timelapse'))],
    [
      'Add tasks',
      tally(
        data.map((r) =>
          r.answers.addTasks === undefined ? null : r.answers.addTasks ? 'Yes' : 'All good',
        ),
      ),
    ],
  ];

  return (
    <Panel className="p-5 flex flex-col gap-4">
      <h2 className="section-title">Onboarding answers</h2>
      {rows.isPending ? (
        <Spinner />
      ) : rows.isError ? (
        <p className="muted text-sm">Could not load them.</p>
      ) : data.length === 0 ? (
        <p className="muted text-sm">Nothing yet.</p>
      ) : (
        <>
          <dl className="admin-answers">
            {totals.map(([name, counts]) => (
              <div key={name} className="admin-answer">
                <dt>{name}</dt>
                <dd>
                  {counts.length === 0
                    ? '–'
                    : counts.map(([label, n]) => (
                        <span key={label} className="admin-answer-count">
                          {label} <span className="tabular muted">{n}</span>
                        </span>
                      ))}
                </dd>
              </div>
            ))}
          </dl>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Look</th>
                  <th>University</th>
                  <th>Using it for</th>
                  <th>Other apps</th>
                  <th>Calendar</th>
                  <th>Sections</th>
                  <th>Add tasks</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => {
                  const a = r.answers;
                  const ends = (['questions', 'tour', 'timelapse'] as const).map((k) =>
                    a.sections?.[k] === 'done'
                      ? 'Done'
                      : a.sections?.[k] === 'skipped'
                        ? 'Skip'
                        : '–',
                  );
                  return (
                    <tr key={r.userId}>
                      <td>{r.email}</td>
                      <td>{lookOf(a) ?? '–'}</td>
                      <td>{universityOf(a) ?? '–'}</td>
                      <td>{listOf(ONBOARDING_USES, a.uses)?.join(', ') ?? '–'}</td>
                      <td>{listOf(ONBOARDING_APPS, a.apps)?.join(', ') ?? '–'}</td>
                      <td>{calendarOf(a) ?? '–'}</td>
                      <td className="tabular" title="About you, Look around, Timelapse">
                        {ends.join(' · ')}
                      </td>
                      <td>{a.addTasks === undefined ? '–' : a.addTasks ? 'Yes' : 'All good'}</td>
                      <td className="tabular">{fmtDate(r.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}
