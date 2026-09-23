import { badgeByKey } from '@doloop/core';
import { Award } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { fireConfetti } from '@doloop/ui';
import { ACHIEVEMENT_EVENT } from '../lib/achievements';
import { useMe } from '../lib/queries';

/** How long one banner stays, and the gap before the next in the queue. */
const SHOW_MS = 4600;
const GAP_MS = 350;

interface Shown {
  key: string;
  name: string;
  description: string;
  leaving: boolean;
}

/**
 * The "Achievement unlocked" banner, the way a console does it: it slides in at the top,
 * names the badge, throws confetti and leaves. Several unlocks queue rather than pile up.
 * The Badge toasts setting turns the banner off; the Confetti setting turns the confetti off.
 */
export function AchievementToasts() {
  const me = useMe();
  const effects = me.data?.user.settings.effects;
  const [current, setCurrent] = useState<Shown | null>(null);
  const queue = useRef<string[]>([]);
  const timers = useRef<number[]>([]);
  const effectsRef = useRef(effects);
  useEffect(() => {
    effectsRef.current = effects;
  }, [effects]);

  useEffect(() => {
    const next = () => {
      const key = queue.current.shift();
      if (!key) {
        setCurrent(null);
        return;
      }
      const badge = badgeByKey(key);
      if (!badge) {
        next();
        return;
      }
      setCurrent({ key, name: badge.name, description: badge.description, leaving: false });
      if (effectsRef.current?.confetti !== false) fireConfetti({ count: 90, durationMs: 1700 });
      timers.current.push(
        window.setTimeout(() => setCurrent((c) => (c ? { ...c, leaving: true } : c)), SHOW_MS),
        window.setTimeout(() => next(), SHOW_MS + GAP_MS),
      );
    };
    const onAnnounce = (e: Event) => {
      if (effectsRef.current?.badgeToasts === false) return;
      const keys = (e as CustomEvent<string[]>).detail ?? [];
      const idle = queue.current.length === 0 && current === null;
      queue.current.push(...keys);
      if (idle) next();
    };
    window.addEventListener(ACHIEVEMENT_EVENT, onAnnounce);
    return () => {
      window.removeEventListener(ACHIEVEMENT_EVENT, onAnnounce);
      for (const t of timers.current) window.clearTimeout(t);
      timers.current = [];
    };
    // `current` is read only to know whether the queue is idle at the moment of an announce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!current) return null;
  return (
    <div className="achievement-stack" aria-live="polite">
      <div className={`achievement glass glass-strong${current.leaving ? ' is-leaving' : ''}`}>
        <span className="achievement-icon" aria-hidden>
          <Award size={22} />
        </span>
        <div className="achievement-text">
          <div className="achievement-kicker">Achievement unlocked</div>
          <div className="achievement-name">{current.name}</div>
          <div className="achievement-desc">{current.description}</div>
        </div>
      </div>
    </div>
  );
}
