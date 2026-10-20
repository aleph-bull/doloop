import { useSyncExternalStore } from 'react';
import { dismissTip, isTipDismissed, subscribeTips, tipFor, type AppTip } from './app-tips';
import { useMe, useQuote } from './queries';

export interface TipOfTheMoment {
  /** The tip showing now, or null: none is due, tips are off, or it was closed. */
  tip: AppTip | null;
  dismiss: () => void;
}

/**
 * The tip on the dashboard for this period, if any, shown alongside the quote. Seeded by
 * the quote so it holds for that quote's six hours.
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
