import { useEffect, useRef, useState } from 'react';

export interface FocusWakeProps {
  /** The controls have faded after a few still seconds: the screen is resting. */
  asleep: boolean;
  /** How dark the resting screen goes, 0 (not at all) to 0.9. */
  dim: number;
  /** Bring the controls back and lift the dim. */
  onWake: () => void;
}

/** How long the layer keeps catching after waking, for the click that follows the same touch. */
const SETTLE_MS = 450;

/**
 * While the focus screen rests, a layer over it takes the first touch or click and only
 * wakes the screen, so a tap on a dark screen can't land on Stop or Pause by accident. While
 * a timelapse records it also darkens the screen, by the preset's dim, and lifts the moment
 * it is touched. It is a black layer: a web page can't turn the display itself down, and the
 * camera's stills never see it. Keys wake the screen too (the stillness hook listens), so it
 * stays out of the way of the keyboard and of screen readers.
 */
export function FocusWake({ asleep, dim, onWake }: FocusWakeProps) {
  // A tap wakes the screen on touchstart, but its click arrives after: keep catching a moment
  // longer, so that click lands here and not on whatever is under the finger.
  const [settling, setSettling] = useState(false);
  const was = useRef(asleep);
  useEffect(() => {
    const woke = was.current && !asleep;
    was.current = asleep;
    if (!woke) return;
    setSettling(true);
    const id = window.setTimeout(() => setSettling(false), SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [asleep]);
  const catching = asleep || settling;
  return (
    <div
      className={`focus-wake${catching ? ' is-catching' : ''}${asleep && dim > 0 ? ' is-dim' : ''}`}
      style={{ '--focus-dim': dim } as React.CSSProperties}
      aria-hidden
      onPointerDown={onWake}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
