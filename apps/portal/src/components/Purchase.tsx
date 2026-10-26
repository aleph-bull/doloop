import { useEffect, useRef, useState, type Ref } from 'react';
import { useToast } from '@komogon/ui';
import { COUNT_MS, preloadSpend, spendXp } from './slot/spend';
import { easeOutCubic, stillMotion } from './slot/slot-kit';

/** How long a bought item says so ("Added") before it's back to its price. */
const FRESH_MS = 1600;

export interface BuyOptions<R> {
  /** Which item, for `fresh`. */
  key: string;
  cost: number;
  /** The card bought from (a selector), and what in it the coins fly into. */
  card: string;
  goal: string;
  /** Rises from the goal as it lands, e.g. "+1". */
  float?: string;
  /** Read out once it's bought. */
  said?: string;
  call: () => Promise<R>;
  /** Written into the caches as the last coin lands, so what changed shows right then. */
  apply?: (r: R) => void;
}

export type Buy = <R extends { xp: number }>(o: BuyOptions<R>) => Promise<R | null>;

/**
 * Buying on Achievements. The XP shown counts down the moment the coins leave it and holds
 * there until the caches catch up, so it never jumps back; `fresh` names what was just
 * bought for a moment after its coins land. One purchase at a time.
 */
export function usePurchase(xp: number, volume: number) {
  const walletRef = useRef<HTMLSpanElement>(null);
  const [override, setOverride] = useState<number | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const busy = useRef(false);
  const timers = useRef<number[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    preloadSpend();
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const buy: Buy = async (o) => {
    if (busy.current) return null;
    busy.current = true;
    setOverride(xp - o.cost);
    const card = () => document.querySelector<HTMLElement>(o.card);
    const show = spendXp({
      wallet: walletRef.current,
      card,
      goal: () => card()?.querySelector<HTMLElement>(o.goal) ?? null,
      cost: o.cost,
      before: xp,
      volume,
      float: o.float,
    });
    try {
      const r = await o.call();
      await show.land();
      o.apply?.(r);
      setOverride(r.xp);
      setFresh(o.key);
      if (o.said) setSaid(o.said);
      later(1200, () => setOverride((v) => (v === r.xp ? null : v)));
      later(FRESH_MS, () => setFresh((k) => (k === o.key ? null : k)));
      return r;
    } catch (err) {
      show.drop();
      setOverride(null);
      toast(err instanceof Error ? err.message : 'Something went wrong');
      return null;
    } finally {
      busy.current = false;
    }
  };

  return { wallet: override ?? xp, walletRef, fresh, said, buy };
}

/** A number that counts to its new value rather than jumping there. */
export function CountingNumber({
  value,
  className,
  ref,
}: {
  value: number;
  className?: string;
  ref?: Ref<HTMLSpanElement>;
}) {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  useEffect(() => {
    const from = shownRef.current;
    if (from === value) return;
    const start = performance.now();
    const still = stillMotion();
    let frame = 0;
    const tick = (now: number) => {
      const u = still ? 1 : Math.min(1, (now - start) / COUNT_MS);
      const n = Math.round(from + (value - from) * easeOutCubic(u));
      shownRef.current = n;
      setShown(n);
      if (u < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <span ref={ref} className={className}>
      {shown.toLocaleString()}
    </span>
  );
}
