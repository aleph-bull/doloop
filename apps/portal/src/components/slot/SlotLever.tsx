import { useImperativeHandle, useRef, type Ref } from 'react';
import { playTick } from '../../lib/sounds';

/** How far the lever's knob travels when pulled all the way, in px (styles: .jack-lever). */
const LEVER_TRAVEL = 138;
/** Let go past this much of the way down and it pulls; less and it springs back. */
const LEVER_PULLS = 0.45;

export interface SlotLeverHandle {
  /** The pull itself: the knob comes down from `dy` px, swings back up. */
  swing: (dy: number) => void;
}

export interface SlotLeverProps {
  ref?: Ref<SlotLeverHandle>;
  /** It can be pulled. */
  ready: boolean;
  /** 0..1, or 0 for no sound. */
  volume: number;
  /** The lever is being held, or let go. */
  onHolding: (holding: boolean) => void;
  /** Pulled from `dy` px down (0 for a click or a key). */
  onPull: (dy: number) => void;
}

/**
 * The slot machine's lever, a button: dragged down (or clicked) it pulls toward you, so the
 * stick shortens past its base and comes back. Let go before it is far enough down and it
 * springs back up.
 */
export function SlotLever({ ref, ready, volume, onHolding, onPull }: SlotLeverProps) {
  const knobRef = useRef<HTMLSpanElement>(null);
  const stickRef = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ y0: number; dy: number; moved: boolean } | null>(null);

  useImperativeHandle(ref, () => ({
    swing(dy: number) {
      const knob = knobRef.current;
      const stick = stickRef.current;
      if (!knob || !stick || typeof knob.animate !== 'function') return;
      knob.style.transform = '';
      stick.style.transform = '';
      const timing = { duration: 620, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' };
      knob.animate(
        [
          { transform: `translateY(${dy}px)` },
          { transform: `translateY(${LEVER_TRAVEL}px)`, offset: 0.3 },
          { transform: 'none' },
        ],
        timing,
      );
      stick.animate(
        [
          { transform: `scaleY(${1 - (2 * dy) / LEVER_TRAVEL})` },
          { transform: 'scaleY(-1)', offset: 0.3 },
          { transform: 'none' },
        ],
        timing,
      );
    },
  }));

  /** Where the lever's knob is while held, `dy` px down. */
  const placeLever = (dy: number) => {
    if (knobRef.current) knobRef.current.style.transform = dy ? `translateY(${dy}px)` : '';
    if (stickRef.current)
      stickRef.current.style.transform = dy ? `scaleY(${1 - (2 * dy) / LEVER_TRAVEL})` : '';
  };
  const letGo = (cancelled: boolean) => {
    const d = drag.current;
    drag.current = null;
    onHolding(false);
    if (!d) return;
    if (!cancelled && (!d.moved || d.dy > LEVER_TRAVEL * LEVER_PULLS)) {
      onPull(d.dy);
      return;
    }
    // Not far enough: it springs back up.
    placeLever(0);
    const spring = { duration: 380, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' };
    knobRef.current?.animate?.(
      [{ transform: `translateY(${d.dy}px)` }, { transform: 'none' }],
      spring,
    );
    stickRef.current?.animate?.(
      [{ transform: `scaleY(${1 - (2 * d.dy) / LEVER_TRAVEL})` }, { transform: 'none' }],
      spring,
    );
  };

  return (
    <button
      type="button"
      className="jack-lever"
      aria-label="Pull"
      disabled={!ready}
      onPointerDown={(e) => {
        if (!ready || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { y0: e.clientY, dy: 0, moved: false };
        onHolding(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dy = Math.min(LEVER_TRAVEL, Math.max(0, e.clientY - d.y0));
        // A click as it passes the point where letting go pulls it.
        const line = LEVER_TRAVEL * LEVER_PULLS;
        if (d.dy <= line !== dy <= line) playTick(volume, 0.75, 1.2);
        if (Math.abs(e.clientY - d.y0) > 5) d.moved = true;
        d.dy = dy;
        placeLever(dy);
      }}
      onPointerUp={() => letGo(false)}
      onPointerCancel={() => letGo(true)}
      onClick={(e) => {
        e.stopPropagation();
        // A keyboard press (no pointer): pull it.
        if (e.detail === 0) onPull(0);
      }}
    >
      <span ref={stickRef} className="jack-lever-stick" />
      <span className="jack-lever-base" />
      <span ref={knobRef} className="jack-lever-knob" />
    </button>
  );
}
