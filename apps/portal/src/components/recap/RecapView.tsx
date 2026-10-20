import { dayOfWeek, type ClockProfile, type RangeRecap } from '@komogon/core';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Download,
  Flame as FlameIcon,
  Sparkles,
} from 'lucide-react';
import { cloneElement, useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  accentHexFor,
  Button,
  Climb,
  Columns,
  CountUp,
  Donut,
  Gauge,
  Glass,
  Heatmap,
  Panel,
  ProgressBar,
  RadialClock,
  Ring,
  SkeletonBlock,
  StackedDays,
  useToast,
  WeekBars,
} from '@komogon/ui';
import type { RecapRangeParam, RecapResponse } from '../../lib/api';
import { fmtDate, fmtHours } from '../../lib/format';
import { useMe, useRecap } from '../../lib/queries';
import { ErrorPanel } from '../ErrorState';
import { EquivalentsStrip } from './EquivalentsStrip';
import { saveShareCard } from './share-card';
import { TrophyShelf } from './TrophyShelf';

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const noon = (date: string) => `${date}T12:00:00`;

/** "2.8 hours", "45 minutes": the hero's words, never "0.8 hours". */
function heroParts(minutes: number): { value: number; unit: string; fmt: (v: number) => string } {
  if (minutes < 60)
    return {
      value: Math.round(minutes),
      unit: Math.round(minutes) === 1 ? 'minute' : 'minutes',
      fmt: (v) => String(Math.round(v)),
    };
  const h = minutes / 60;
  return {
    value: h,
    unit: Math.round(h * 10) / 10 === 1 ? 'hour' : 'hours',
    fmt: (v) => (h >= 100 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toFixed(1)),
  };
}

/** "Sep 21 to 27", or across a month boundary "Sep 28 to Oct 4". */
function rangeLabel(p: RangeRecap): string {
  const a = fmtDate(noon(p.from));
  const sameMonth = p.from.slice(0, 7) === p.to.slice(0, 7);
  return `${a} to ${sameMonth ? Number(p.to.slice(8)) : fmtDate(noon(p.to))}`;
}

/** What the clock says about when someone studies, in a word or two and an animal. */
function clockLabel(c: ClockProfile): string | null {
  if (c.peakHour === null || c.totalMinutes < 30) return null;
  const h = c.peakHour;
  if (h >= 21 || h < 4) return "You're a night owl 🦉";
  if (h < 9) return 'Early bird 🐦';
  if (h < 12) return 'Morning mind ☕';
  if (h < 17) return 'Afternoon focus 🌤️';
  return 'Evening engine 🌆';
}

/** "this week", "last week", "that week": how the page refers to the range showing. */
function scopeWord(range: RecapRangeParam, ago: number): string {
  if (range === 'all') return 'in total';
  if (ago === 0) return `this ${range}`;
  if (ago === 1) return `last ${range}`;
  return `that ${range}`;
}

function ChangeChip({ p, ago }: { p: RangeRecap; ago: number }) {
  // A finished month is held against the whole month before it, not "this point".
  const word =
    p.range === 'week'
      ? ago === 0
        ? 'last week'
        : 'the week before'
      : ago === 0
        ? 'this point last month'
        : 'the month before';
  if (p.minutes <= 0) return null;
  if (p.firstTime)
    return (
      <span className="rc-chip is-new">
        <Sparkles size={14} aria-hidden /> First {p.range}
      </span>
    );
  if (p.change === null) return null;
  const pct = Math.round(Math.abs(p.change) * 100);
  if (p.change >= 0.05)
    return (
      <span className="rc-chip is-up">
        <ArrowUpRight size={14} aria-hidden /> {pct}% on {word}
      </span>
    );
  if (p.change > -0.05)
    return (
      <span className="rc-chip">
        <ArrowRight size={14} aria-hidden /> Level with {word}
      </span>
    );
  // A lower week gets a quiet, neutral note rather than a red arrow.
  return (
    <span className="rc-chip is-quiet">
      <ArrowDownRight size={14} aria-hidden /> {fmtHours(p.previousMinutes)} {word}
    </span>
  );
}

type TileSize = 'md' | 'wide' | 'full';

/** A bento tile: a title, an optional note, the content or its empty state. */
function Tile({
  title,
  note,
  size = 'md',
  empty,
  children,
}: {
  title: string;
  note?: ReactNode;
  size?: TileSize;
  empty?: string | null;
  children: ReactNode;
}) {
  return (
    <Panel as="section" className={`rc-tile is-${size}`} aria-label={title}>
      <div className="rc-tile-head">
        <h3 className="rc-tile-title">{title}</h3>
        {note && <p className="rc-tile-note">{note}</p>}
      </div>
      {empty ? <p className="rc-empty">{empty}</p> : children}
    </Panel>
  );
}

/* ---------- the hero ---------- */

/** Back and forward through weeks or months, the dates between the arrows. */
function PeriodStepper({
  p,
  ago,
  firstDate,
  onAgo,
}: {
  p: RangeRecap;
  ago: number;
  firstDate: string | null;
  onAgo: (n: number) => void;
}) {
  const word = p.range === 'week' ? 'week' : 'month';
  // Nothing before the first session to look at.
  const canBack = firstDate !== null && firstDate < p.from;
  return (
    <div className="rc-stepper">
      <button
        type="button"
        className="rc-stepper-btn"
        onClick={() => onAgo(ago + 1)}
        disabled={!canBack}
        aria-label={`Previous ${word}`}
        title={`Previous ${word}`}
      >
        <ChevronLeft size={16} aria-hidden />
      </button>
      <p className="rc-hero-range" aria-live="polite">
        {rangeLabel(p)}
      </p>
      <button
        type="button"
        className="rc-stepper-btn"
        onClick={() => onAgo(ago - 1)}
        disabled={ago === 0}
        aria-label={`Next ${word}`}
        title={`Next ${word}`}
      >
        <ChevronRight size={16} aria-hidden />
      </button>
      {ago > 0 && (
        <button type="button" className="rc-stepper-now" onClick={() => onAgo(0)}>
          Back to this {word}
        </button>
      )}
    </div>
  );
}

function Hero({
  data,
  range,
  ago,
  onAgo,
}: {
  data: RecapResponse;
  range: RecapRangeParam;
  ago: number;
  onAgo: (n: number) => void;
}) {
  const me = useMe();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const p = data.period;
  const minutes = p ? p.minutes : data.totals.minutes;
  const parts = heroParts(minutes);
  const scope = scopeWord(range, ago);
  const summary = p
    ? p.summary
    : data.totals.sessions === 0
      ? 'Your first session starts the record.'
      : `${data.totals.sessions} ${data.totals.sessions === 1 ? 'session' : 'sessions'} since you started${
          data.forecast ? `. ${data.forecast.text}` : '.'
        }`;

  const share = async () => {
    if (!p) return;
    setSaving(true);
    try {
      await saveShareCard(
        {
          rangeLabel: rangeLabel(p),
          headline: `${parts.fmt(parts.value)} ${parts.unit}`,
          summary: p.summary,
          days: p.byDay.map((d) => ({
            label: SHORT_DAYS[dayOfWeek(d.date)]!.slice(0, 1),
            minutes: d.minutes,
            best: d.best,
          })),
          stats: [
            { label: 'sessions', value: String(p.sessions) },
            { label: 'days studied', value: String(p.activeDays) },
            { label: 'day streak', value: String(data.streak.current) },
          ],
          personality: data.personality
            ? `${data.personality.emoji} ${data.personality.label}`
            : null,
          accent: accentHexFor(me.data?.user.settings.theme.accent ?? 'sky'),
        },
        `komogon-week-${p.from}.png`,
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not make the card');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Glass as="section" className="rc-hero rc-rise" aria-label="Headline">
      <div className="rc-hero-main">
        {p && <PeriodStepper p={p} ago={ago} firstDate={data.firstDate} onAgo={onAgo} />}
        <p className="rc-hero-figure">
          <CountUp value={parts.value} format={parts.fmt} className="rc-hero-number" />
          <span className="rc-hero-unit">
            {parts.unit} {scope}
          </span>
        </p>
        <div className="rc-hero-row">
          {p && <ChangeChip p={p} ago={ago} />}
          {data.personality && (
            <span className="rc-chip is-persona" title={data.personality.reason}>
              {data.personality.emoji} {data.personality.label}
            </span>
          )}
        </div>
        <p className="rc-hero-summary">{summary}</p>
      </div>
      <div className="rc-hero-side">
        {p?.goalMinutes && (
          <Ring
            value={p.goalRatio ?? 0}
            size={112}
            stroke={10}
            label={`${Math.round((p.goalRatio ?? 0) * 100)}% of your weekly goal of ${fmtHours(p.goalMinutes)}`}
          >
            <span className="rc-ring-big">{Math.round((p.goalRatio ?? 0) * 100)}%</span>
            <span className="rc-ring-small">of {fmtHours(p.goalMinutes)}</span>
          </Ring>
        )}
        <div className="rc-level">
          <div className="rc-level-row">
            <span>Level {data.level.level}</span>
            <span className="muted">
              {data.level.toNext} XP to {data.level.level + 1}
            </span>
          </div>
          <ProgressBar value={data.level.ratio} label="Progress to the next level" />
        </div>
        {range === 'week' && p && p.minutes > 0 && (
          <Button variant="secondary" size="sm" onClick={share} loading={saving}>
            <Download size={14} aria-hidden /> Share my week
          </Button>
        )}
      </div>
    </Glass>
  );
}

/* ---------- streaks ---------- */

function Streaks({ data }: { data: RecapResponse }) {
  const { streak, consistency: c } = data;
  const next = c.nextMilestone;
  return (
    <Glass as="section" className="rc-streaks rc-rise" aria-labelledby="streaks-h">
      <h2 id="streaks-h" className="card-title">
        Streaks and consistency
      </h2>
      <div className="rc-streaks-body">
        <div className="rc-streak-main">
          <span className={`streak-badge${streak.current > 0 ? ' is-lit' : ''}`} aria-hidden>
            <FlameIcon size={28} />
          </span>
          <div>
            <p className="rc-streak-number">
              {streak.current} {streak.current === 1 ? 'day' : 'days'}
            </p>
            <p className="muted text-sm">
              Best: {streak.longest} {streak.longest === 1 ? 'day' : 'days'}
            </p>
          </div>
        </div>
        <div className="rc-week-dots">
          <ol aria-label="This week">
            {c.weekDots.map((d) => (
              <li
                key={d.date}
                className={`rc-dot-day${d.studied ? ' is-on' : ''}${d.today ? ' is-today' : ''}${d.future ? ' is-future' : ''}`}
                title={`${LONG_DAYS[dayOfWeek(d.date)]}: ${d.studied ? 'studied' : d.future ? 'still to come' : 'rest'}`}
              >
                <span className="rc-dot-mark" aria-hidden>
                  {d.studied ? '✓' : ''}
                </span>
                <span className="rc-dot-label">{SHORT_DAYS[dayOfWeek(d.date)]!.slice(0, 1)}</span>
                <span className="sr-only">
                  {LONG_DAYS[dayOfWeek(d.date)]}: {d.studied ? 'studied' : 'not yet'}
                </span>
              </li>
            ))}
          </ol>
          {next && (
            <p className="text-sm">
              {streak.current === 0
                ? 'One session starts a streak.'
                : `${next.remaining} more ${next.remaining === 1 ? 'day' : 'days'} to a ${next.days}-day streak`}
            </p>
          )}
          {streak.freezesHeld > 0 && (
            <p className="subtle text-xs">
              {streak.freezesHeld} streak {streak.freezesHeld === 1 ? 'freeze' : 'freezes'} on hand:
              a missed day uses one instead of resetting the count.
            </p>
          )}
        </div>
        <Ring
          value={c.ratio30}
          size={104}
          stroke={9}
          label={`Studied on ${c.activeDays30} of the last 30 days`}
        >
          <span className="rc-ring-big">{c.activeDays30}</span>
          <span className="rc-ring-small">of 30 days</span>
        </Ring>
      </div>
    </Glass>
  );
}

/* ---------- the charts ---------- */

/**
 * Lays the tiles out in rows of three with no holes, by construction rather than by hoping
 * the grid's dense packing finds a fit. Each wide tile shares a row with one normal tile,
 * alternating sides so the page does not lean one way; the rest go three to a row; a
 * leftover pair becomes a normal tile beside a wide one, a single leftover takes the row.
 */
function packTiles(tiles: Array<ReactElement<{ size?: TileSize }>>): ReactNode[] {
  const as = (t: ReactElement<{ size?: TileSize }>, size: TileSize) => cloneElement(t, { size });
  const wides = tiles.filter((t) => t.props.size === 'wide');
  const normals = tiles.filter((t) => t.props.size !== 'wide');
  const out: ReactNode[] = [];
  let flip = false;
  while (wides.length > 0 && normals.length > 0) {
    const w = wides.shift()!;
    const n = normals.shift()!;
    out.push(...(flip ? [n, w] : [w, n]));
    flip = !flip;
  }
  for (const w of wides) out.push(as(w, 'full'));
  while (normals.length >= 3) out.push(...normals.splice(0, 3));
  if (normals.length === 2) out.push(normals[0]!, as(normals[1]!, 'wide'));
  if (normals.length === 1) out.push(as(normals[0]!, 'full'));
  return out;
}

function Charts({ data, range }: { data: RecapResponse; range: RecapRangeParam }) {
  const p = data.period;
  const subjectsTotal = data.subjects.reduce((a, s) => a + s.minutes, 0);
  const clockNote = clockLabel(data.clock);
  const tiles: ReactNode[] = [];

  if (p) {
    tiles.push(
      <Tile
        key="days"
        size="wide"
        title={range === 'week' ? 'Day by day' : data.ago === 0 ? 'Every day this month' : 'Every day of the month'}
        note={
          p.bestDay
            ? `${LONG_DAYS[dayOfWeek(p.bestDay.date)]} ${range === 'month' ? fmtDate(noon(p.bestDay.date)) : ''} led with ${fmtHours(p.bestDay.minutes)}.`.replace(
                '  ',
                ' ',
              )
            : 'The faint bars are the same days from last time.'
        }
      >
        <WeekBars
          days={p.byDay.map((d) => ({
            label:
              range === 'week' ? SHORT_DAYS[dayOfWeek(d.date)]! : String(Number(d.date.slice(8))),
            full: `${LONG_DAYS[dayOfWeek(d.date)]}, ${fmtDate(noon(d.date))}`,
            minutes: d.minutes,
            previousMinutes: d.previousMinutes,
            best: d.best,
            today: d.today,
            future: d.future,
          }))}
          fmt={fmtHours}
          ghostName={`${data.ago === 0 ? 'last' : 'the'} ${range === 'week' ? 'week' : 'month'}${data.ago === 0 ? '' : ' before'}`}
          ariaLabel={`Study time per day, ${rangeLabel(p)}`}
        />
      </Tile>,
    );
  } else if (data.cumulative.points.length >= 2) {
    tiles.push(
      <Tile
        key="climb"
        size="wide"
        title="The climb"
        note={
          data.cumulative.next
            ? `${fmtHours(data.cumulative.next.remainingMinutes)} to ${data.cumulative.next.hours} hours.`
            : undefined
        }
      >
        <Climb
          points={data.cumulative.points}
          milestones={data.cumulative.reached}
          fmtDate={(d) => fmtDate(noon(d), { year: 'numeric' })}
          ariaLabel="Total hours studied over time"
        />
      </Tile>,
    );
  }

  tiles.push(
    <Tile
      key="subjects"
      title="Where the time went"
      empty={data.subjects.length === 0 ? 'Study something and it shows up here, by course.' : null}
    >
      <Donut
        slices={data.subjects.map((s) => ({
          key: s.key,
          label: s.title,
          minutes: s.minutes,
          colorIndex: s.colorIndex,
        }))}
        fmt={fmtHours}
        centre={
          <>
            <span className="rc-ring-big">{fmtHours(subjectsTotal)}</span>
            <span className="rc-ring-small">total</span>
          </>
        }
        ariaLabel="Time per course"
      />
    </Tile>,
  );

  tiles.push(
    <Tile
      key="clock"
      title="When you study"
      note={clockNote ?? undefined}
      empty={data.clock.totalMinutes === 0 ? 'Your hours of the day fill in as you study.' : null}
    >
      <RadialClock
        hours={data.clock.hours}
        fmt={fmtHours}
        ariaLabel="Study time by hour of the day"
      >
        {data.clock.peakHour !== null && (
          <>
            <span className="rc-ring-small">peak</span>
            <span className="rc-ring-big">
              {data.clock.peakHour % 12 === 0 ? 12 : data.clock.peakHour % 12}
              {data.clock.peakHour < 12 ? ' am' : ' pm'}
            </span>
          </>
        )}
      </RadialClock>
    </Tile>,
  );

  if (range === 'week' && data.dailySubjects && data.subjects.length > 0)
    tiles.push(
      <Tile key="made-of" size="wide" title="What each day was made of">
        <StackedDays
          days={data.dailySubjects.map((d) => ({
            label: SHORT_DAYS[dayOfWeek(d.date)]!,
            full: `${LONG_DAYS[dayOfWeek(d.date)]}, ${fmtDate(noon(d.date))}`,
            segments: d.segments,
          }))}
          series={data.subjects.map((s) => ({
            key: s.key,
            label: s.title,
            colorIndex: s.colorIndex,
          }))}
          fmt={fmtHours}
          ariaLabel="Study time per day, split by course"
        />
      </Tile>,
    );

  if (range === 'all' && data.heatmap)
    tiles.push(
      <Tile
        key="heatmap"
        size="wide"
        title="Days you studied"
        note={`The last six months. ${data.heatmap.activeDays} active ${data.heatmap.activeDays === 1 ? 'day' : 'days'}${data.heatmap.longestRun >= 2 ? `, a longest run of ${data.heatmap.longestRun}` : ''}.`}
      >
        <Heatmap
          weeks={data.heatmap.weeks}
          monthLabels={data.heatmap.monthLabels}
          thresholds={data.heatmap.thresholds}
          ariaLabel={`Study minutes per day from ${data.heatmap.from} to ${data.heatmap.to}`}
        />
      </Tile>,
    );

  if (data.plan && data.plan.planned > 0)
    tiles.push(
      <Tile key="plan" title="Planned blocks kept">
        <Gauge
          value={data.plan.kept}
          max={data.plan.planned}
          label={`Kept ${data.plan.kept} of ${data.plan.planned} planned blocks`}
          caption={
            <>
              <span className="rc-ring-big">
                {data.plan.kept} of {data.plan.planned}
              </span>
              <span className="rc-ring-small">
                {data.plan.kept === data.plan.planned ? 'every one kept 🎯' : 'kept so far'}
              </span>
            </>
          }
        />
      </Tile>,
    );

  if (data.focus.answered > 0 && data.focus.ratio !== null)
    tiles.push(
      <Tile
        key="focus"

        title="Focus quality"
        note={`From the ${data.focus.answered} ${data.focus.answered === 1 ? 'review' : 'reviews'} you answered.`}
      >
        <div className="rc-centre">
          <Ring
            value={data.focus.ratio}
            size={136}
            stroke={10}
            label={`${Math.round(data.focus.ratio * 100)}% of reviewed sessions with no distraction`}
          >
            <span className="rc-ring-big">{Math.round(data.focus.ratio * 100)}%</span>
            <span className="rc-ring-small">distraction-free</span>
          </Ring>
        </div>
      </Tile>,
    );

  tiles.push(
    <Tile
      key="lengths"
      title="Session lengths"
      note={data.histogram.takeaway ?? undefined}
      empty={data.histogram.total === 0 ? 'Fills in as you study.' : null}
    >
      <Columns
        bars={data.histogram.buckets.map((b) => ({
          label: b.label.replace(' min', '').replace('Under ', '<').replace('Over ', '>'),
          value: b.count,
          highlight: b.count === Math.max(...data.histogram.buckets.map((x) => x.count)),
        }))}
        fmt={(v) => `${v} ${v === 1 ? 'session' : 'sessions'}`}
        columnName="Length"
        ariaLabel="Sessions by length"
      />
    </Tile>,
  );

  if (range !== 'week')
    tiles.push(
      <Tile
        key="weekday"
        title="Your strongest days"
        note={data.weekday.peak ? `${data.weekday.peak.label} carries the most.` : undefined}
        empty={data.weekday.totalMinutes === 0 ? 'Nothing to compare yet.' : null}
      >
        <Columns
          bars={data.weekday.buckets.map((b) => ({
            label: b.label.slice(0, 3),
            value: b.minutes,
            highlight: b.label === data.weekday.peak?.label,
          }))}
          fmt={fmtHours}
          columnName="Day"
          ariaLabel="Study time by day of the week"
        />
      </Tile>,
    );

  if (data.studyVsGrades)
    tiles.push(
      <Tile key="grades" size="wide" title="Study and grades" note={data.studyVsGrades.note}>
        <ul className="rc-grades">
          {data.studyVsGrades.courses.map((c) => (
            <li key={c.nodeId}>
              <span className="truncate">{c.title}</span>
              <span className="rc-grades-bar">
                <span
                  style={{
                    width: `${(c.minutes / data.studyVsGrades!.courses[0]!.minutes) * 100}%`,
                  }}
                />
              </span>
              <span className="muted tabular">{fmtHours(c.minutes)}</span>
              <span className="tabular">{Math.round(c.percent)}%</span>
            </li>
          ))}
        </ul>
        <p className="subtle text-xs">
          Hours studied on each course, all time, beside its current mark. Many things shape a
          grade; this is just the two side by side.
        </p>
      </Tile>,
    );

  return (
    <div className="rc-bento">{packTiles(tiles as Array<ReactElement<{ size?: TileSize }>>)}</div>
  );
}

/* ---------- insights ---------- */

function Insights({ data }: { data: RecapResponse }) {
  const lines = [
    ...data.insights.map((h) => ({ key: h.key, headline: h.headline, detail: h.detail })),
    ...(data.forecast && data.period
      ? [
          {
            key: 'forecast',
            headline: data.forecast.text,
            detail: 'Based on your last four weeks.',
          },
        ]
      : []),
  ].slice(0, 4);
  if (lines.length === 0) return null;
  return (
    <section className="rc-rise" aria-labelledby="insights-h">
      <h2 id="insights-h" className="card-title rc-section-title">
        Good to know
      </h2>
      <div className="rc-insights">
        {lines.map((l) => (
          <Glass key={l.key} as="article" className="rc-insight">
            <p className="rc-insight-head">{l.headline}</p>
            <p className="muted text-sm">{l.detail}</p>
          </Glass>
        ))}
      </div>
    </section>
  );
}

/* ---------- loading ---------- */

function RecapSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading your recap">
      <SkeletonBlock style={{ height: 196 }} />
      <div className="rc-bento">
        <SkeletonBlock className="rc-tile is-wide" style={{ height: 280 }} />
        <SkeletonBlock className="rc-tile" style={{ height: 280 }} />
        <SkeletonBlock className="rc-tile" style={{ height: 280 }} />
        <SkeletonBlock className="rc-tile is-wide" style={{ height: 280 }} />
      </div>
    </div>
  );
}

/* ---------- the page ---------- */

/** One range of the recap, top to bottom: hero, equivalents, charts, streaks, trophies, insights. */
export function RecapView({
  range,
  ago = 0,
  onAgo,
}: {
  range: RecapRangeParam;
  ago?: number;
  onAgo: (n: number) => void;
}) {
  const q = useRecap(range, ago);
  if (q.isError && !q.data)
    return (
      <ErrorPanel
        message={q.error instanceof Error ? q.error.message : 'Could not load your recap.'}
        onRetry={() => q.refetch()}
      />
    );
  if (!q.data) return <RecapSkeleton />;
  const data = q.data;
  // A range switch keeps the last one up, dimmed, until the new one lands.
  const stale = q.isPlaceholderData;
  const minutes = data.period ? data.period.minutes : data.totals.minutes;

  return (
    <div className={`rc-page${stale ? ' is-stale' : ''}`} key={data.range}>
      <Hero data={data} range={range} ago={ago} onAgo={onAgo} />
      {minutes > 0 && <EquivalentsStrip minutes={minutes} />}
      <Charts data={data} range={range} />
      <Streaks data={data} />
      <section className="rc-rise" aria-labelledby="trophies-h">
        <h2 id="trophies-h" className="card-title rc-section-title">
          Trophy shelf
        </h2>
        <TrophyShelf records={data.records} />
      </section>
      <Insights data={data} />
      <Glass as="section" className="rc-review rc-rise">
        <div>
          <h2 className="card-title">Weekly review</h2>
          <p className="muted text-sm">
            Planned against done, the days that went sideways, and a note to your future self.
          </p>
        </div>
        <Link to="/analytics/review" className="btn btn-primary">
          Open the weekly review <ArrowRight size={16} aria-hidden />
        </Link>
      </Glass>
    </div>
  );
}
