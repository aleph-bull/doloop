import { formatClock, type FocusProgress } from '@komodoit/core';

/**
 * Time elapsed this session and, when something says how long the work should take, a
 * quiet bar against it. Without an expectation there is only the elapsed line; running
 * over fills the bar and says so rather than pretending otherwise.
 */
export function ProgressDisplay({ progress }: { progress: FocusProgress }) {
  const { elapsedSeconds, expectedSeconds, fraction, exceeded } = progress;
  return (
    <div className={`focus-progress${exceeded ? ' is-over' : ''}`}>
      <div className="focus-progress-row tabular">
        <span>{formatClock(elapsedSeconds)} elapsed</span>
        {expectedSeconds !== null && (
          <span className="focus-progress-expected">
            {exceeded ? 'past the ' : ''}
            {formatClock(expectedSeconds)} expected
          </span>
        )}
      </div>
      {fraction !== null && (
        <div
          className="focus-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
          aria-label={exceeded ? 'Expected time exceeded' : 'Progress against expected time'}
        >
          <div className="focus-bar-fill" style={{ width: `${fraction * 100}%` }} />
        </div>
      )}
    </div>
  );
}
