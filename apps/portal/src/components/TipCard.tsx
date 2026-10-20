import { Glass } from '@komogon/ui';
import { Lightbulb, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useTip } from '../lib/use-tip';

/** How long the pop and the close take; in step with `.tip-card` in index.css. */
const POP_MS = 240;
const CLOSE_MS = 320;

/**
 * A tip about the app, on the dashboard between the start panel and the stats, in the
 * periods it takes the quote's place. Closing it pops the card, then folds its space away
 * so the stats slide up, and only then lets the quote come back.
 */
export function TipCard() {
  const { tip, dismiss } = useTip();
  const [phase, setPhase] = useState<'shown' | 'pop' | 'close'>('shown');
  if (!tip) return null;

  const close = () => {
    if (phase !== 'shown') return;
    const still =
      document.documentElement.dataset.motion === 'off' ||
      (document.documentElement.dataset.motion !== 'on' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (still) return dismiss();
    setPhase('pop');
    window.setTimeout(() => setPhase('close'), POP_MS);
    window.setTimeout(dismiss, POP_MS + CLOSE_MS);
  };

  return (
    <div className={`tip-fold${phase === 'close' ? ' is-closing' : ''}`}>
      <div className="tip-fold-inner">
        <Glass
          as="section"
          className={`tip-card${phase !== 'shown' ? ' is-popping' : ''}`}
          aria-label="Tip"
        >
          <span className="tip-icon" aria-hidden>
            <Lightbulb size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p>{tip.text}</p>
            <Link to={tip.to} className="section-link text-sm">
              {tip.link}
            </Link>
          </div>
          <button
            type="button"
            className="tip-close"
            aria-label="Close this tip"
            title="Close"
            onClick={close}
          >
            <X size={16} aria-hidden />
          </button>
        </Glass>
      </div>
    </div>
  );
}
