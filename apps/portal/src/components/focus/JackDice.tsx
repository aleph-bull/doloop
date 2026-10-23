import { JACK_FACES, type JackRoll } from '@komogon/core';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fmtMinutes } from '../../lib/format';

/** The tumble, then how long the result stays before the die goes away on its own. */
const TUMBLE_MS = 1500;
const STAY_MS = 4200;

/**
 * Where each face sits on the cube, and the turn that brings it to the front. The faces go
 * front, right, back, left, top, bottom, in `JACK_FACES` order.
 */
const SIDES = [
  { place: 'rotateY(0deg)', x: 0, y: 0 },
  { place: 'rotateY(90deg)', x: 0, y: -90 },
  { place: 'rotateY(180deg)', x: 0, y: -180 },
  { place: 'rotateY(-90deg)', x: 0, y: 90 },
  { place: 'rotateX(90deg)', x: -90, y: 0 },
  { place: 'rotateX(-90deg)', x: 90, y: 0 },
] as const;

/** A slight tilt so the die reads as a cube once it lands. */
const TILT = 'rotateX(-16deg) rotateY(18deg)';

function stillMotion(): boolean {
  const motion = document.documentElement.dataset.motion;
  if (motion === 'off') return true;
  if (motion === 'on') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** "5 min", "2 min 30 s", "1 h". */
function fmtBreak(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const rest = seconds % 60;
  const min = Math.floor(seconds / 60);
  if (rest === 0) return fmtMinutes(min);
  return min === 0 ? `${rest} s` : `${min} min ${rest} s`;
}

function resultLine(roll: JackRoll): string {
  if (roll.breakMs === 0) return 'No break';
  if (roll.breakMs === roll.baseMs) return `Break ${fmtBreak(roll.baseMs)}`;
  return `Break ${fmtBreak(roll.baseMs)} → ${fmtBreak(roll.breakMs)}`;
}

/**
 * Jack mode's die: rolled when a work interval ends, it tumbles and lands on the face the
 * timer already used to set the break. A click or Escape puts it away.
 */
export function JackDice({ roll, onDone }: { roll: JackRoll; onDone: () => void }) {
  const dieRef = useRef<HTMLDivElement>(null);
  const [landed, setLanded] = useState(false);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const die = dieRef.current;
    const side = SIDES[roll.face] ?? SIDES[0];
    const end = `${TILT} rotateX(${side.x + 720}deg) rotateY(${side.y + 1080}deg)`;
    const timers: number[] = [];
    if (!die || stillMotion() || typeof die.animate !== 'function') {
      if (die) die.style.transform = `${TILT} rotateX(${side.x}deg) rotateY(${side.y}deg)`;
      setLanded(true);
    } else {
      die.style.transform = end;
      die.animate(
        [
          { transform: `${TILT} rotateX(0deg) rotateY(0deg)` },
          {
            transform: `${TILT} rotateX(${side.x + 420}deg) rotateY(${side.y + 640}deg)`,
            offset: 0.55,
          },
          { transform: end },
        ],
        { duration: TUMBLE_MS, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
      );
      timers.push(window.setTimeout(() => setLanded(true), TUMBLE_MS));
    }
    timers.push(window.setTimeout(() => doneRef.current(), TUMBLE_MS + STAY_MS));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') doneRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      for (const t of timers) window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [roll.face, roll.cycle]);

  const face = JACK_FACES[roll.face];
  const tone = !face ? '' : face.multiplier > 0 ? ' is-won' : face.multiplier < 0 ? ' is-lost' : '';
  return createPortal(
    <div className="jack-dice-layer" onClick={() => onDone()}>
      <div className="jack-dice-card glass glass-strong" role="status" aria-live="polite">
        <div className="jack-dice-scene" aria-hidden>
          <div ref={dieRef} className="jack-die">
            {JACK_FACES.map((f, i) => (
              <div
                key={f.label}
                className="jack-die-face"
                style={{ transform: `${SIDES[i]!.place} translateZ(var(--jack-half))` }}
              >
                {f.label}
              </div>
            ))}
          </div>
        </div>
        <div className={`jack-dice-result${landed ? ' is-shown' : ''}${tone}`}>
          <span className="jack-dice-roll tabular">{landed ? face?.label : ' '}</span>
          <span className="jack-dice-line tabular">{landed ? resultLine(roll) : 'Rolling…'}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
