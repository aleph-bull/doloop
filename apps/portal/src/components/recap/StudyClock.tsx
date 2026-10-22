import type { ClockProfile } from '@komogon/core';
import { RadialClock } from '@komogon/ui';
import { fmtHours } from '../../lib/format';

/**
 * What the clock says about when someone studies, in a word or two and an animal. `you` is
 * false on someone else's profile, where "You're a night owl" would be about the reader.
 */
export function clockLabel(c: ClockProfile, you = true): string | null {
  if (c.peakHour === null || c.totalMinutes < 30) return null;
  const h = c.peakHour;
  if (h >= 21 || h < 4) return you ? "You're a night owl 🦉" : 'Night owl 🦉';
  if (h < 9) return 'Early bird 🐦';
  if (h < 12) return 'Morning mind ☕';
  if (h < 17) return 'Afternoon focus 🌤️';
  return 'Evening engine 🌆';
}

/** The day as a ring of 24 hours, with the busiest one in the middle. */
export function StudyClock({ clock }: { clock: ClockProfile }) {
  const peak = clock.peakHour;
  return (
    <RadialClock hours={clock.hours} fmt={fmtHours} ariaLabel="Study time by hour of the day">
      {peak !== null && (
        <>
          <span className="rc-ring-small">peak</span>
          <span className="rc-ring-big">
            {peak % 12 === 0 ? 12 : peak % 12}
            {peak < 12 ? ' am' : ' pm'}
          </span>
        </>
      )}
    </RadialClock>
  );
}
