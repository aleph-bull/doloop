export interface TimerDisplayProps {
  /** The countdown or elapsed clock, already formatted. */
  digits: string;
  /** What the digits mean, for assistive tech. */
  meaning: 'remaining' | 'elapsed';
}

/**
 * The clock: the one thing on the screen that is allowed to be large. When the user hides
 * the screen's elements it is not rendered at all, rather than drawn faint.
 */
export function TimerDisplay({ digits, meaning }: TimerDisplayProps) {
  return (
    <div className="focus-time tabular" aria-live="off" aria-label={`${digits} ${meaning}`}>
      {digits}
    </div>
  );
}
