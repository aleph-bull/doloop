import { badgeByKey, levelProgress, type SessionXpBreakdown } from '@doloop/core';
import { Award, Flame, Star, TrendingUp } from 'lucide-react';
import { ProgressBar } from '@doloop/ui';
import type { EndSummary } from '../lib/api';
import { fmtMinutes } from '../lib/format';

export interface SessionSummaryProps {
  summary: EndSummary;
  phrasesEnabled: boolean;
}

/** The bonuses in the order they are earned, with the words for each. */
const BONUS_LINES: Array<{ key: keyof SessionXpBreakdown; label: string }> = [
  { key: 'base', label: 'Focused time' },
  { key: 'reviewSubmitted', label: 'Review filled in' },
  { key: 'focus', label: 'Stayed focused' },
  { key: 'plannedBlock', label: 'Kept to the plan' },
  { key: 'onPace', label: 'On pace' },
  { key: 'estimateBeat', label: 'Beat the estimate' },
  { key: 'streakBonus', label: 'Streak bonus' },
];

function fmtFocused(seconds: number): string {
  return seconds > 0 && seconds < 30 ? '< 1 m' : fmtMinutes(seconds / 60);
}

/**
 * The end-of-session screen, laid out like the end of a level: the score, where it came
 * from, the numbers that mattered, the level bar, and any achievements, revealed in turn.
 * Shared by the dashboard's overlay and the focus screen's ended state.
 */
export function SessionSummary({ summary, phrasesEnabled }: SessionSummaryProps) {
  const lp = levelProgress(summary.xpTotal);
  const { workSeconds, breakSeconds, idleSeconds } = summary.session;
  const xp = summary.xp;
  const bonuses = BONUS_LINES.filter((b) => (xp[b.key] as number) > 0);
  const badges = summary.badges
    .map((k) => badgeByKey(k))
    .filter((b): b is NonNullable<typeof b> => !!b);
  let step = 0;
  const stagger = () => ({ animationDelay: `${(step++ * 110).toString()}ms` }) as const;

  return (
    <div className="summary">
      <div className="summary-reveal" style={stagger()}>
        <div className="summary-kicker">
          {summary.endedEarly ? 'Session ended early' : 'Session complete'}
        </div>
        <h2 className="summary-title">
          {phrasesEnabled && summary.phrase ? summary.phrase.text : 'Nice work.'}
        </h2>
      </div>

      <div className="summary-score summary-reveal" style={stagger()}>
        <Star size={22} aria-hidden className="summary-score-icon" />
        <div>
          <div className="summary-score-value tabular">
            {xp.withheld ? '0' : `+${xp.total}`}
            <span className="summary-score-unit"> XP</span>
          </div>
          <div className="summary-score-note">
            {xp.withheld
              ? 'Ended before the first block finished, so this one does not count toward your level. The minutes still do.'
              : `Score for this session${summary.leveledUp ? ` · level ${summary.levelAfter} reached` : ''}`}
          </div>
        </div>
      </div>

      {bonuses.length > 0 && !xp.withheld && (
        <ul className="summary-bonuses summary-reveal" style={stagger()}>
          {bonuses.map((b) => (
            <li key={b.key}>
              <span>{b.label}</span>
              <span className="tabular">+{xp[b.key] as number}</span>
            </li>
          ))}
        </ul>
      )}

      <dl className="summary-stats summary-reveal" style={stagger()}>
        <div>
          <dt>Focused</dt>
          <dd className="tabular">{fmtFocused(workSeconds)}</dd>
        </div>
        {breakSeconds > 0 && (
          <div>
            <dt>Breaks</dt>
            <dd className="tabular">{fmtMinutes(breakSeconds / 60)}</dd>
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
            <Flame size={12} aria-hidden /> Streak
          </dt>
          <dd className="tabular">
            {summary.streak.current} day{summary.streak.current === 1 ? '' : 's'}
            {summary.streak.longest > summary.streak.current && (
              <span className="summary-stat-aside"> · best {summary.streak.longest}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>
            <TrendingUp size={12} aria-hidden /> Level
          </dt>
          <dd className="tabular">
            {lp.level}
            <span className="summary-stat-aside">
              {' '}
              · {lp.toNext} XP to {lp.level + 1}
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
        summary.streak.milestonesReached.length > 0 ||
        summary.nodeCompleted ||
        summary.routineTicked) && (
        <div className="text-sm muted flex flex-col gap-1 summary-reveal" style={stagger()}>
          {summary.streak.milestonesReached.length > 0 && <span>Streak milestone reached.</span>}
          {summary.streak.message && <span>{summary.streak.message}</span>}
          {summary.nodeCompleted && <span>Marked as done.</span>}
          {summary.routineTicked && <span>Ticked off.</span>}
        </div>
      )}
    </div>
  );
}
