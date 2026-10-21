import { Glass, useToast } from '@komogon/ui';
import { Check, Lightbulb, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useUpdateSettings } from '../lib/queries';
import { useTip } from '../lib/use-tip';

/** How long the pop and the close take; in step with `.tip-card` in index.css. */
const POP_MS = 240;
const CLOSE_MS = 320;
/** How long "Disable tips?" waits for an answer; no answer keeps them on. */
const ASK_MS = 8000;

/**
 * A tip about the app, on the dashboard between the start panel and the stats, in the
 * periods one is due; the quote stays where it is. Closing it pops the card, then folds
 * its space away so the stats slide up, and a toast asks whether to turn tips off.
 */
export function TipCard() {
  const { tip, dismiss } = useTip();
  const { toast } = useToast();
  const [phase, setPhase] = useState<'shown' | 'pop' | 'close'>('shown');
  if (!tip) return null;

  const close = () => {
    if (phase !== 'shown') return;
    const done = toast(<TipsOffAsk onDone={() => done()} />, { durationMs: ASK_MS });
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

/**
 * The toast's yes and no. It lives in the toast stack, not the card, because the card is
 * gone by the time anyone answers. Yes is the same switch as Settings › Pages › Dashboard.
 */
function TipsOffAsk({ onDone }: { onDone: () => void }) {
  const update = useUpdateSettings();
  const { toast } = useToast();
  const turnOff = () => {
    onDone();
    // A promise rather than onError: this toast is gone before the answer comes back.
    update
      .mutateAsync({ quote: { appTips: false } })
      .catch((err) => toast(err instanceof Error ? err.message : 'Could not turn tips off'));
  };
  return (
    <span className="tips-off-ask">
      Disable tips?
      <button
        type="button"
        className="tips-off-btn is-yes"
        aria-label="Yes, disable tips"
        title="Yes"
        onClick={turnOff}
      >
        <Check size={16} aria-hidden />
      </button>
      <button
        type="button"
        className="tips-off-btn"
        aria-label="No, keep tips"
        title="No"
        onClick={onDone}
      >
        <X size={16} aria-hidden />
      </button>
    </span>
  );
}
