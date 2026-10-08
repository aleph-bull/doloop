import { pickEquivalents, type EquivalentCard } from '@komogon/core';
import { Dices } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@komogon/ui';
import { useScreens } from '../../lib/queries';

export interface EquivalentsStripProps {
  minutes: number;
  /** "this week", "this month", "so far": what the minutes are. */
  scope: string;
}

/** A poster when there is one; the icon when there is not, or when the image fails. */
function Art({ card }: { card: EquivalentCard }) {
  const [broken, setBroken] = useState(false);
  if (card.imageUrl && !broken)
    return (
      <img
        className="eq-poster"
        src={card.imageUrl}
        alt={card.title ? `${card.title} poster` : ''}
        loading="lazy"
        onError={() => setBroken(true)}
      />
    );
  return (
    <span className="eq-icon" aria-hidden>
      {card.icon}
    </span>
  );
}

/**
 * "That's enough time to…": the minutes as films, seasons, marathons and loaves of bread.
 * The dice deals a new hand. Posters come from TMDB through the API when it is set up;
 * without it the same titles show with an icon and their listed runtimes.
 */
export function EquivalentsStrip({ minutes, scope }: EquivalentsStripProps) {
  const screens = useScreens();
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1000));
  const cards = useMemo(
    () => pickEquivalents({ minutes, seed, count: 4, screens: screens.data?.facts }),
    [minutes, seed, screens.data],
  );
  if (cards.length === 0) return null;
  return (
    <section className="eq" aria-labelledby="eq-h">
      <div className="eq-head">
        <h2 id="eq-h" className="text-lg">
          That&rsquo;s enough time to&hellip;
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSeed((s) => s + 1)}
          aria-label="Show other comparisons"
          title="Shuffle"
        >
          <Dices size={16} aria-hidden /> Shuffle
        </Button>
      </div>
      <ul className="eq-row" aria-live="polite">
        {cards.map((c, i) => (
          <li key={`${seed}:${c.id}`} className="eq-card" style={{ animationDelay: `${i * 70}ms` }}>
            <Art card={c} />
            <p className="eq-text">{c.text}</p>
          </li>
        ))}
      </ul>
      <p className="subtle text-xs">
        Worked out from your {scope} total. Figures marked ~ are approximate.
        {screens.data?.source === 'tmdb' && (
          <>
            {' '}
            Film and TV data from{' '}
            <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer">
              TMDB
            </a>
            . This product uses the TMDB API but is not endorsed or certified by TMDB.
          </>
        )}
      </p>
    </section>
  );
}
