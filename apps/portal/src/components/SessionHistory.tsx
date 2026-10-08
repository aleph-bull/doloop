import { badgeByKey } from '@komogon/core';
import { Scissors } from 'lucide-react';
import { useState } from 'react';
import { Button, Spinner } from '@komogon/ui';
import type { HistorySession } from '../lib/api';
import { fmtMinutes, fmtTime } from '../lib/format';
import { useSessionHistory } from '../lib/queries';
import { TrimSessionDialog } from './TrimSessionDialog';

function dayWords(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** The end time, with its weekday when the session ran past midnight: "12:13 AM Fri". */
function endWords(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return '';
  const sameDay = new Date(startedAt).toDateString() === new Date(endedAt).toDateString();
  if (sameDay) return fmtTime(endedAt);
  const day = new Date(endedAt).toLocaleDateString(undefined, { weekday: 'short' });
  return `${fmtTime(endedAt)} ${day}`;
}

/**
 * Every finished session, newest first, grouped by day: when, what for, how long, the
 * XP, and a way to delete time from one that ran on without you.
 */
export function SessionHistory() {
  const q = useSessionHistory();
  const [trimming, setTrimming] = useState<HistorySession | null>(null);

  if (q.isLoading)
    return (
      <div className="flex justify-center p-6">
        <Spinner />
      </div>
    );
  if (q.isError)
    return (
      <p className="muted text-sm">
        Could not load your sessions.{' '}
        <button type="button" className="link-button" onClick={() => q.refetch()}>
          Try again
        </button>
      </p>
    );

  const all = q.data?.pages.flatMap((p) => p.sessions) ?? [];
  if (all.length === 0)
    return <p className="muted text-sm">Finished sessions show up here, newest first.</p>;

  const days: Array<{ day: string; sessions: HistorySession[] }> = [];
  for (const s of all) {
    const day = dayWords(s.startedAt);
    const last = days[days.length - 1];
    if (last?.day === day) last.sessions.push(s);
    else days.push({ day, sessions: [s] });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="field-hint">
        Left one running by accident? Delete time takes it off the end, with the XP it earned.
      </p>
      {days.map((d) => (
        <section key={d.day} className="history-day" aria-label={d.day}>
          <h3 className="history-day-title">{d.day}</h3>
          <ul className="history-list">
            {d.sessions.map((s) => {
              const badges = s.badgesAwarded
                .map((k) => badgeByKey(k)?.name)
                .filter((n): n is string => !!n);
              return (
                <li key={s.id} className="history-row">
                  <div className="history-main">
                    <span className="history-title">{s.title}</span>
                    <span className="history-when tabular">
                      {fmtTime(s.startedAt)} to {endWords(s.startedAt, s.endedAt)}
                    </span>
                  </div>
                  <div className="history-figures tabular">
                    <span title="Focused">{fmtMinutes(s.workSeconds / 60)}</span>
                    <span className="muted">{s.xpAwarded} XP</span>
                    {badges.length > 0 && (
                      <span className="history-badges" title={badges.join(', ')}>
                        {badges.length === 1 ? badges[0] : `${badges.length} badges`}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setTrimming(s)}
                    aria-label={`Delete time from ${s.title}, ${dayWords(s.startedAt)} ${fmtTime(s.startedAt)}`}
                    disabled={s.workSeconds <= 60}
                  >
                    <Scissors size={14} aria-hidden /> Delete time
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {q.hasNextPage && (
        <Button
          variant="secondary"
          onClick={() => void q.fetchNextPage()}
          loading={q.isFetchingNextPage}
          className="self-start"
        >
          Show older sessions
        </Button>
      )}
      <TrimSessionDialog session={trimming} onClose={() => setTrimming(null)} />
    </div>
  );
}
