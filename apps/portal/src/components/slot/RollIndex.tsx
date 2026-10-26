import { ROLL_TIERS, rollOdds } from '@komogon/core';
import { cn } from '@komogon/ui';
import { rollClass, tierStyle } from '../../lib/rolls';

/** The rarities in four bands: the commonest small and quiet, each band larger and louder. */
const BANDS = [
  { key: 'common', from: 1, to: 4 },
  { key: 'rare', from: 5, to: 8 },
  { key: 'epic', from: 9, to: 12 },
  { key: 'mythic', from: 13, to: 15 },
] as const;

/**
 * Every rarity on Achievements with how often it came up, not all alike: the four commonest
 * as small pills, then tiles that grow, and wear more of their colours, the rarer they are.
 * The ones not landed yet stay faint; the rarest landed is ringed.
 */
export function RollIndex({ counts, best }: { counts: number[]; best: number }) {
  return (
    <div className="rng-index">
      {BANDS.map((band) => (
        <ol key={band.key} className={`rng-band is-${band.key}`}>
          {ROLL_TIERS.filter((t) => t.tier >= band.from && t.tier <= band.to).map((t) => {
            const n = counts[t.tier - 1] ?? 0;
            return (
              <li
                key={t.tier}
                className={cn('rng-cell', n > 0 && 'is-hit', t.tier === best && 'is-best')}
                style={tierStyle(t.tier)}
              >
                <span className={cn('rng-cell-title', rollClass(t.tier))}>{t.title}</span>
                <span className="rng-cell-odds tabular">{rollOdds(t.tier)}</span>
                <span className="rng-cell-n tabular">{n > 0 ? `×${n.toLocaleString()}` : '–'}</span>
              </li>
            );
          })}
        </ol>
      ))}
    </div>
  );
}

/** How many of someone's rarest landings a profile lists. */
const PROFILE_HITS = 5;

/** The rarities someone has landed, rarest first, for their profile. */
export function RollHits({ counts }: { counts: number[] }) {
  const hits = ROLL_TIERS.filter((t) => (counts[t.tier - 1] ?? 0) > 0)
    .reverse()
    .slice(0, PROFILE_HITS);
  return (
    <ol className="rng-hits" aria-label="Rarest rolls">
      {hits.map((t) => (
        <li key={t.tier} className="rng-hit" style={tierStyle(t.tier)}>
          <span className={cn('rng-hit-title', rollClass(t.tier))}>{t.title}</span>
          <span className="rng-hit-odds tabular">{rollOdds(t.tier)}</span>
          <span className="rng-hit-n tabular">×{(counts[t.tier - 1] ?? 0).toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}
