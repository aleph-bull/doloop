import { badgeByKey, formatClock, levelProgress, type SessionXpBreakdown } from '@komogon/core';
import { Award, CalendarCheck, Flame, Sparkles, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { CountUp, ProgressBar, useToast } from '@komogon/ui';
import type { CountSummary, EndSummary } from '../lib/api';
import { fmtMinutes } from '../lib/format';
import { useCountSession } from '../lib/queries';
import { TrimSessionDialog } from './TrimSessionDialog';

export interface SessionSummaryProps {
  summary: EndSummary;
  phrasesEnabled: boolean;
  /** After time was deleted from the session: the sheet's figures are then out of date. */
  onTrimmed?: () => void;
}

/** The bonuses in the order they are earned, with the words for each. */
/** How hard it felt, as the save sheet put it. */
const EFFORT_WORD = ['Easy', 'Moderate', 'Hard', 'Very hard', 'All out'];

const BONUS_LINES: Array<{ key: keyof SessionXpBreakdown; label: string }> = [
  { key: 'base', label: 'Focused time' },
  { key: 'reviewSubmitted', label: 'Review filled in' },
  { key: 'focus', label: 'Stayed focused' },
  { key: 'plannedBlock', label: 'Kept to the plan' },
  { key: 'onPace', label: 'On pace' },
  { key: 'estimateBeat', label: 'Beat the estimate' },
  { key: 'streakBonus', label: 'Streak bonus' },
];

/**
 * The end-of-session screen, laid out like the end of a run: the time you put in as the
 * hero, the score it earned and where that came from, then the streak, the level bar and
 * any achievements, revealed in turn.
 * Shared by the dashboard's overlay and the focus screen's ended state.
 */
export function SessionSummary({ summary, phrasesEnabled, onTrimmed }: SessionSummaryProps) {
  const [trimming, setTrimming] = useState(false);
  const countSession = useCountSession();
  const { toast } = useToast();
  /** The figures after "Don't count this session" (or its undo), once either was used. */
  const [recount, setRecount] = useState<CountSummary | null>(null);
  const counted = recount ? recount.session.counted !== false : true;
  const setCounted = async (next: boolean) => {
    try {
      setRecount(await countSession.mutateAsync({ id: summary.session.id, counted: next }));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not change that');
    }
  };
  const streak = recount?.streak ?? summary.streak;
  const lp = levelProgress(recount?.xpTotal ?? summary.xpTotal);
  const { workSeconds, breakSeconds, idleSeconds } = summary.session;
  const xp = summary.xp;
  const effortScore = summary.session.review?.effort ?? null;
  const effort = effortScore ? EFFORT_WORD[effortScore - 1] : null;
  const bonuses = BONUS_LINES.filter((b) => (xp[b.key] as number) > 0);
  const weeks = streak.weeks;
  // Badges this session earned that went when it stopped counting aren't shown.
  const badges = summary.badges
    .filter((k) => !recount || recount.session.badgesAwarded.includes(k))
    .map((k) => badgeByKey(k))
    .filter((b): b is NonNullable<typeof b> => !!b);
  let step = 0;
  const stagger = () => ({ animationDelay: `${(step++ * 110).toString()}ms` }) as const;

  return (
    <div className="summary">
      <div className="summary-reveal" style={stagger()}>
        <h2 className="summary-title">
          {phrasesEnabled && summary.phrase ? summary.phrase.text : 'Nice work.'}
        </h2>
      </div>

      <div className="summary-hero summary-reveal" style={stagger()}>
        <span className="summary-hero-label">Focused time</span>
        <span className="summary-hero-figure tabular">
          <CountUp value={workSeconds} format={(v) => formatClock(v)} duration={900} />
        </span>
        <span className={`summary-xp${xp.withheld || !counted ? ' is-withheld' : ''}`}>
          <Sparkles size={15} aria-hidden />
          {!counted ? (
            'Not counted'
          ) : xp.withheld ? (
            'Ended early, so no XP this time'
          ) : (
            <>
              <strong className="tabular">+{xp.total} XP</strong>
              {summary.leveledUp && <span> · level {summary.levelAfter} reached</span>}
            </>
          )}
        </span>
      </div>

      {bonuses.length > 0 && !xp.withheld && counted && (
        <ul
          className="summary-bonuses summary-reveal"
          style={stagger()}
          aria-label="Where the XP came from"
        >
          {bonuses.map((b) => (
            <li key={b.key}>
              <span>{b.label}</span>
              <span className="tabular">+{xp[b.key] as number}</span>
            </li>
          ))}
        </ul>
      )}

      <dl className="summary-stats summary-reveal" style={stagger()}>
        {effort && (
          <div>
            <dt>Effort</dt>
            <dd>{effort}</dd>
          </div>
        )}
        {breakSeconds > 0 && (
          <div>
            <dt>Breaks</dt>
            <dd className="tabular">{fmtMinutes(breakSeconds / 60)}</dd>
          </div>
        )}
        {breakSeconds > 0 && (
          <div>
            <dt>Elapsed</dt>
            <dd className="tabular">{fmtMinutes((workSeconds + breakSeconds) / 60)}</dd>
          </div>
        )}
        {idleSeconds > 0 && (
          <div>
            <dt>Idle</dt>
            <dd className="tabular">{fmtMinutes(idleSeconds / 60)}</dd>
          </div>
        )}
        <div>
          <dt>
            <Flame size={12} aria-hidden /> Daily streak
          </dt>
          <dd className="tabular">
            {streak.current} day{streak.current === 1 ? '' : 's'}
            {streak.longest > streak.current && (
              <span className="summary-stat-aside">Best {streak.longest}</span>
            )}
          </dd>
        </div>
        {weeks && weeks.current > 0 && (
          <div>
            <dt>
              <CalendarCheck size={12} aria-hidden /> Weekly streak
            </dt>
            <dd className="tabular">
              {weeks.current} week{weeks.current === 1 ? '' : 's'}
              {weeks.longest > weeks.current && (
                <span className="summary-stat-aside">Best {weeks.longest}</span>
              )}
            </dd>
          </div>
        )}
        <div>
          <dt>
            <TrendingUp size={12} aria-hidden /> Level
          </dt>
          <dd className="tabular">
            {lp.level}
            <span className="summary-stat-aside">
              {' '}
              {lp.toNext} XP to {lp.level + 1}
            </span>
          </dd>
        </div>
      </dl>

      <div className="summary-reveal" style={stagger()}>
        <ProgressBar value={lp.ratio} label="Progress to next level" />
        <div className="flex justify-between text-xs muted mt-1 tabular">
          <span>Level {lp.level}</span>
          <span>Level {lp.level + 1}</span>
        </div>
      </div>

      {badges.length > 0 && (
        <div className="summary-badges">
          <div className="summary-section-title summary-reveal" style={stagger()}>
            Achievement{badges.length === 1 ? '' : 's'} unlocked
          </div>
          {badges.map((b) => (
            <div key={b.key} className="summary-badge summary-reveal" style={stagger()}>
              <span className="summary-badge-icon" aria-hidden>
                <Award size={18} />
              </span>
              <div>
                <div className="font-medium">{b.name}</div>
                <div className="muted text-sm">{b.description}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(summary.streak.message ||
        (summary.streak.milestonesReached.length > 0 && counted) ||
        summary.nodeCompleted ||
        summary.routineTicked) && (
        <div className="text-sm muted flex flex-col gap-1 summary-reveal" style={stagger()}>
          {summary.streak.milestonesReached.length > 0 && counted && (
            <span>{Math.max(...summary.streak.milestonesReached)}-day streak. Keep it up!</span>
          )}
          {summary.streak.message && <span>{summary.streak.message}</span>}
          {summary.nodeCompleted && <span>Marked as done.</span>}
          {summary.routineTicked && <span>Ticked off.</span>}
        </div>
      )}

      <div className="text-sm muted flex flex-col gap-1 summary-reveal" style={stagger()}>
        {summary.session.workSeconds > 60 && counted && (
          <p>
            Didn&rsquo;t study all of that?{' '}
            <button type="button" className="link-button" onClick={() => setTrimming(true)}>
              Delete time
            </button>
          </p>
        )}
        <p>
          <button
            type="button"
            className="link-button"
            onClick={() => void setCounted(!counted)}
            disabled={countSession.isPending}
          >
            {counted ? <>Don&rsquo;t count this session</> : 'Count this session'}
          </button>
        </p>
      </div>
      <TrimSessionDialog
        session={trimming ? { ...summary.session, title: 'this session' } : null}
        onClose={() => setTrimming(false)}
        onTrimmed={onTrimmed}
      />
    </div>
  );
}
