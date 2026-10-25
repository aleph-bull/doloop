import { ROLL_TIERS, rollOdds } from '@komogon/core';
import { cn } from '@komogon/ui';
import { tierStyle } from '../../lib/rolls';

/**
 * Every rarity, 1/2 to 1/8192, with how many rolls landed on it: the ones hit lit, the
 * rarest marked, and from 1/256 each in its own colour. `titles` writes each one's title
 * under it; otherwise it is on hover. 1/8192 takes the last row to itself, and the columns
 * are ones the other twelve fill evenly (index.css).
 */
export function RollLadder({
  counts,
  best,
  titles = false,
}: {
  counts: number[];
  best: number;
  titles?: boolean;
}) {
  return (
    <div className={cn('roll-ladder-box', titles && 'has-titles')}>
      <ol className="roll-ladder" aria-label="Rolls by rarity">
        {ROLL_TIERS.map((t, i) => {
          const n = counts[i] ?? 0;
          return (
            <li
              key={t.tier}
              className={cn('roll-ladder-step', n > 0 && 'is-hit', t.tier === best && 'is-best')}
              style={n > 0 ? tierStyle(t.tier) : undefined}
              title={titles ? undefined : t.title}
            >
              <span className="roll-ladder-odds tabular">{rollOdds(t.tier)}</span>
              {titles && <span className="roll-ladder-title">{t.title}</span>}
              <span className="roll-ladder-count tabular">{n > 0 ? n.toLocaleString() : '–'}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
