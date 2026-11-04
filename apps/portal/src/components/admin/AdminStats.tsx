import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Panel, Spinner } from '@komogon/ui';
import { adminKeys, adminSend, fmtSize, type AdminStats as Stats } from '../../lib/admin';
import { fmtDate, fmtHours } from '../../lib/format';

/** A big figure with its unit small beside it: "9.5 h", "2.1 GB". */
export function Figure({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  const text = typeof value === 'number' ? value.toLocaleString() : value;
  const split = typeof text === 'string' ? /^([\d.,]+)\s(.+)$/.exec(text) : null;
  return (
    <div className="admin-figure">
      <dt>{label}</dt>
      <dd>
        {split ? (
          <>
            {split[1]}
            <span className="admin-figure-unit">{split[2]}</span>
          </>
        ) : (
          text
        )}
      </dd>
      {note && <dd className="admin-figure-note">{note}</dd>}
    </div>
  );
}

/** "Nov 2" for a day's YYYY-MM-DD, read as that calendar day wherever the page is. */
export const dayLabel = (day: string) => fmtDate(`${day}T12:00:00Z`, { timeZone: 'UTC' });

/**
 * Bars in the accent, one a day or a week, with a line above that names the one under the
 * pointer (the latest when nothing is).
 */
export function Bars({
  title,
  points,
  describe,
  first,
  last,
}: {
  title: string;
  points: { key: string; value: number }[];
  describe: (i: number) => string;
  first: string;
  last: string;
}) {
  const [at, setAt] = useState<number | null>(null);
  const max = Math.max(1, ...points.map((p) => p.value));
  const shown = at ?? points.length - 1;
  return (
    <figure className="admin-chart">
      <figcaption className="admin-chart-head">
        <span>{title}</span>
        <span className="muted tabular">{describe(shown)}</span>
      </figcaption>
      <div
        className="admin-bars"
        role="img"
        aria-label={`${title}: ${points.map((_, i) => describe(i)).join(', ')}`}
        onPointerLeave={() => setAt(null)}
      >
        {points.map((p, i) => (
          <span
            key={p.key}
            className={`admin-bar-slot${i === shown ? ' is-shown' : ''}`}
            onPointerEnter={() => setAt(i)}
          >
            {p.value > 0 && (
              <span className="admin-bar" style={{ height: `${(p.value / max) * 100}%` }} />
            )}
          </span>
        ))}
      </div>
      <div className="admin-chart-axis muted">
        <span>{first}</span>
        <span>{last}</span>
      </div>
    </figure>
  );
}

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/** The figures at the top of the admin page: people, study, Social and storage. */
export function AdminStats() {
  const stats = useQuery({
    queryKey: adminKeys.stats,
    queryFn: () => adminSend<Stats>('GET', '/api/admin/stats'),
    refetchInterval: 60_000,
  });
  if (stats.isPending) return <Spinner />;
  if (!stats.data) return null;
  const s = stats.data;
  const cloud = s.storage.cloud;

  return (
    <>
      <Panel className="p-5 admin-people">
        <h2 className="section-title">People</h2>
        <dl className="admin-figures">
          <Figure
            label="Accounts"
            value={s.accounts.total}
            note={`${s.accounts.newThisWeek} new this week`}
          />
          <Figure label="Online now" value={s.active.now} />
          <Figure label="Active 24 h" value={s.active.day} />
          <Figure label="Active 7 days" value={s.active.week} />
          <Figure label="Active 30 days" value={s.active.month} />
        </dl>
        <Bars
          title="Active each day"
          points={s.daily.map((d) => ({ key: d.day, value: d.people }))}
          describe={(i) => `${dayLabel(s.daily[i]!.day)} · ${people(s.daily[i]!.people)}`}
          first={dayLabel(s.daily[0]!.day)}
          last="Today"
        />
      </Panel>

      <div className="admin-grid admin-grid-3">
        <Panel className="p-5 flex flex-col gap-4">
          <h2 className="section-title">Study</h2>
          <dl className="admin-figures">
            <Figure label="Sessions" value={s.study.sessions} />
            <Figure label="Focus" value={fmtHours(s.study.focusMinutes)} />
            <Figure label="Focus 7 days" value={fmtHours(s.study.focusMinutesWeek)} />
          </dl>
        </Panel>
        <Panel className="p-5 flex flex-col gap-4">
          <h2 className="section-title">Social</h2>
          <dl className="admin-figures">
            <Figure label="Posts" value={s.social.posts} />
            <Figure label="Comments" value={s.social.comments} />
            <Figure label="Kudos" value={s.social.kudos} />
            {s.social.postBans > 0 && <Figure label="Can't post" value={s.social.postBans} />}
          </dl>
        </Panel>
        <Panel className="p-5 flex flex-col gap-4">
          <h2 className="section-title">Storage</h2>
          {cloud ? (
            <div className="admin-meter-wrap">
              <div className="admin-meter-head">
                <span>Cloud files</span>
                <span className="muted tabular">
                  {cloud.measured ? '' : 'About '}
                  {fmtSize(cloud.bytes)} of {fmtSize(cloud.maxBytes)}
                </span>
              </div>
              <div
                className="admin-meter"
                role="meter"
                aria-label="Cloud files"
                aria-valuemin={0}
                aria-valuemax={cloud.maxBytes}
                aria-valuenow={cloud.bytes}
              >
                <span
                  style={{ width: `${Math.min(100, (cloud.bytes / cloud.maxBytes) * 100)}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="muted text-sm">No cloud files here.</p>
          )}
          <dl className="admin-figures">
            {s.storage.databaseBytes !== null && (
              <Figure label="Database" value={fmtSize(s.storage.databaseBytes)} />
            )}
            <Figure
              label="Post files in the database"
              value={fmtSize(s.storage.mediaInDatabaseBytes)}
            />
          </dl>
        </Panel>
      </div>
    </>
  );
}
