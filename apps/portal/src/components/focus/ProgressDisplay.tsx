import { formatClock, type FocusProgress } from '@komogon/core';

/**
 * Time studied for the task and, when something says how long it should take, a quiet bar
 * against it. The bar keeps the two parts apart: white for work logged before this
 * session, accent for this session. The figures match: the total ("27:36 of 1:00:00") is
 * the whole fill, and this session's time carries the accent dot. Without an expectation
 * there is no bar; running over says so rather than pretending otherwise.
 */
export function ProgressDisplay({ progress }: { progress: FocusProgress }) {
  const { totalSeconds, sessionSeconds, expectedSeconds, priorFraction, fraction, exceeded } =
    progress;
  const total = formatClock(totalSeconds);
  return (
    <div className={`focus-progress${exceeded ? ' is-over' : ''}`}>
      <div className="focus-progress-row tabular">
        <span>
          {total}
          <small className="focus-progress-of">
            {expectedSeconds === null
              ? ' total'
              : `${exceeded ? ' past ' : ' of '}${formatClock(expectedSeconds)}`}
          </small>
        </span>
        <span>
          <span className="focus-progress-dot" aria-hidden />
          {formatClock(sessionSeconds)}
          <small> this session</small>
        </span>
      </div>
      {fraction !== null && (
        <div
          className="focus-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
          aria-label={
            exceeded
              ? `${total} focus, past the ${formatClock(expectedSeconds!)} expected`
              : `${total} focus of ${formatClock(expectedSeconds!)} expected`
          }
        >
          <div className="focus-bar-fill" style={{ width: `${fraction * 100}%` }} />
          <div className="focus-bar-prior" style={{ width: `${(priorFraction ?? 0) * 100}%` }} />
        </div>
      )}
    </div>
  );
}
