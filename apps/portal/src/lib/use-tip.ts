import { useSyncExternalStore } from 'react';
import { dismissTip, isTipDismissed, subscribeTips, tipFor, type AppTip } from './app-tips';
import { useMe, useQuote } from './queries';

export interface TipOfTheMoment {
  /** The tip showing now, or null: none is due, tips are off, or it was closed. */
  tip: AppTip | null;
  dismiss: () => void;
}

/**
 * The tip that takes the quote's place for this period, if any. Shared by the quote card,
 * which steps aside while it shows, and the tip card on the dashboard.
 */
export function useTip(): TipOfTheMoment {
  const quote = useQuote();
  const me = useMe();
  const pick = quote.data?.pick;
  const seed = pick ? `${pick.kind}:${pick.item.text}` : null;
  const closed = useSyncExternalStore(
    subscribeTips,
    () => (seed ? isTipDismissed(seed) : true),
    () => true,
  );
  const tip = seed && !closed ? tipFor(seed, me.data?.user.settings) : null;
  return { tip, dismiss: () => seed && dismissTip(seed) };
}
