export interface TimerDisplayProps {
  /** The countdown or elapsed clock, already formatted. */
  digits: string;
  /** The user hid the numbers for this session. */
  hidden: boolean;
  /** What the digits mean, for assistive tech. */
  meaning: 'remaining' | 'elapsed';
}

/** The clock: the one thing on the screen that is allowed to be large. */
export function TimerDisplay({ digits, hidden, meaning }: TimerDisplayProps) {
  if (hidden) {
    return (
      <div className="focus-time tabular focus-time-hidden" aria-label="Timer hidden">
        <span aria-hidden>· · ·</span>
      </div>
    );
  }
  return (
    <div className="focus-time tabular" aria-live="off" aria-label={`${digits} ${meaning}`}>
      {digits}
    </div>
  );
}
