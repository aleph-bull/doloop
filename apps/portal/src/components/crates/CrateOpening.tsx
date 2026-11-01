import {
  CRATE_TICKETS,
  crateName,
  openCrate,
  PET_RARITY_NAMES,
  petInfo,
  type CrateWin,
} from '@komogon/core';
import { Button, cn, fireConfetti, Modal } from '@komogon/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { type api, type Inventory as InventoryData } from '../../lib/api';
import { winColour, winLevel, winStyle } from '../../lib/crates';
import { NARROW_QUERY } from '../../lib/media';
import { keys } from '../../lib/queries';
import { tierStyle } from '../../lib/rolls';
import { playEffect, playTick } from '../../lib/sounds';
import {
  COIN_COLLECT,
  easeInOutCubic,
  easeOutCubic,
  easeOutQuart,
  REEL_CLICK,
  ROLL_POP,
  ROLL_SUCCESS,
  stillMotion,
} from '../slot/slot-kit';
import { CrateArt } from './CrateArt';
import { PetSprite } from './PetSprite';

type ShopData = Awaited<ReturnType<typeof api.shop>>;
export type Opened = Awaited<ReturnType<typeof api.openCrate>>;

/** What an opening plays, loaded on the click so the first tick is on time. */
export const CRATE_SOUNDS = [REEL_CLICK, ROLL_POP, ROLL_SUCCESS, COIN_COLLECT];

/** A tile's width with the gap beside it, on a computer and on a phone. */
const PITCH = 118;
const PITCH_NARROW = 94;
/** Tiles drawn each side of the line: the window's half and a few frames' travel more. */
const SPAN = 8;
/** At rest the line points at the middle of tile 0. */
const REST = 0.5;
/** The lid comes off, then the strip starts and gets up to speed. */
const LID_AT = 140;
const START_AT = 360;
const SPEED_UP = 260;
/** The strip at full speed, in tiles per ms, and how long it keeps it before slowing. */
const SPEED = 0.028;
const MIN_SPIN = 520;
/** How long it takes to slow onto the prize: the same whatever it is, so it gives nothing away. */
const SLOW_MS = 4300;
/** The crate rattles harder for the last stretch. */
const TENSE_MS = 1500;
/**
 * It stops wherever on the tile it stops (up to this far from its middle, in tiles), holds,
 * then slides onto the middle.
 */
const JITTER = 0.42;
const HOLD_MS = 260;
const CENTRE_MS = 380;
/** Ticks closer together than this would blur into a buzz. */
const TICK_GAP = 38;

/** A tile on the strip: what the crate could give, drawn at its real odds like an opening. */
function drawDrop(tier: number): CrateWin {
  const ticket = Math.floor(Math.random() * CRATE_TICKETS);
  return openCrate(tier, ticket, Math.floor(Math.random() * 1e6)) ?? { kind: 'xp', xp: 5 };
}

/** How far the strip has gone `ms` after it starts, getting up to speed, in tiles. */
function spunBy(ms: number): number {
  if (ms <= 0) return 0;
  if (ms < SPEED_UP) return (SPEED * ms * ms) / (2 * SPEED_UP);
  return SPEED * (ms - SPEED_UP / 2);
}

/**
 * Opening a crate (owner, 2026-11-01: "similar to csgo's rolling system"): its lid comes off
 * and a strip of what it can give races under the line, ticking at each tile, then slows onto
 * the prize, stops wherever on it, holds, and slides onto its middle. Every tile is drawn at
 * the crate's real odds and only the prize's is put there. What it gave rises out of the
 * crate, with a flash, rings, sparks, rays and confetti the rarer it is. The call was made on
 * the click (`call`), so it never runs twice; the caches take its answer as it shows.
 */
export function CrateOpening({
  tier,
  call,
  volume,
  confetti,
  onError,
  onAgain,
  onClose,
}: {
  tier: number;
  call: Promise<Opened>;
  volume: number;
  confetti: boolean;
  onError: (message: string) => void;
  onAgain: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [stage, setStage] = useState<'ready' | 'spin' | 'tense' | 'shown'>('ready');
  const [opened, setOpened] = useState<Opened | null>(null);
  const [tiles, setTiles] = useState<Array<{ i: number; drop: CrateWin }>>([]);
  /** The tile it stopped on. */
  const [won, setWon] = useState<number | null>(null);
  const [still] = useState(stillMotion);
  const [pitch] = useState(() =>
    window.matchMedia?.(NARROW_QUERY).matches ? PITCH_NARROW : PITCH,
  );
  const blurId = `crate-blur-${useId().replace(/[^\w-]/g, '')}`;
  const drops = useRef(new Map<number, CrateWin>());
  const rootRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const flashRef = useRef<HTMLSpanElement>(null);
  const blurRef = useRef<SVGFEGaussianBlurElement>(null);
  const shownRef = useRef(false);
  const latest = useRef({ onError, volume, confetti });
  useEffect(() => {
    latest.current = { onError, volume, confetti };
  });

  useLayoutEffect(() => {
    let live = true;
    let frame = 0;
    const timers: number[] = [];
    let result: Opened | null = null;
    call.then(
      (r) => {
        result = r;
      },
      (err: unknown) => {
        if (!live) return;
        live = false;
        cancelAnimationFrame(frame);
        latest.current.onError(err instanceof Error ? err.message : 'Could not open it');
      },
    );

    /** Tiles from `f` on, drawing any not drawn yet. */
    const fill = (f: number) => {
      const list: Array<{ i: number; drop: CrateWin }> = [];
      for (let i = f; i <= f + 2 * SPAN; i++) {
        let drop = drops.current.get(i);
        if (!drop) {
          drop = drawDrop(tier);
          drops.current.set(i, drop);
        }
        list.push({ i, drop });
      }
      setTiles(list);
    };
    let p = REST;
    let first = Math.floor(p) - SPAN;
    fill(first);
    /** The strip moves here by hand each frame; React only adds and drops tiles at its ends. */
    const place = (to: number) => {
      p = to;
      const f = Math.floor(p) - SPAN;
      if (f !== first) {
        first = f;
        fill(f);
      }
      if (stripRef.current)
        stripRef.current.style.transform = `translate3d(${(-p * pitch).toFixed(2)}px, 0, 0)`;
    };
    place(REST);

    /** Blurred sideways while it races, crisp again as it slows. */
    let blurred = false;
    const blur = (pxPerMs: number) => {
      const strip = stripRef.current;
      if (!strip) return;
      const sd = Math.min(6, Math.abs(pxPerMs) * 1.8);
      if (sd < 0.6) {
        if (blurred) strip.style.filter = '';
        blurred = false;
        return;
      }
      blurRef.current?.setAttribute('stdDeviation', `${sd.toFixed(2)} 0`);
      if (!blurred) strip.style.filter = `url(#${blurId})`;
      blurred = true;
    };

    /** The pointer above the line flicks as each tile knocks past it. */
    let flick: Animation | null = null;
    const knock = () => {
      const tip = tipRef.current;
      if (!tip || typeof tip.animate !== 'function') return;
      flick?.cancel();
      flick = tip.animate([{ transform: 'rotate(-22deg)' }, { transform: 'none' }], {
        duration: 150,
        easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
      });
    };

    /** On the prize: it lights up, the rest dim, and the show plays, louder the rarer. */
    const land = (r: Opened, at: number) => {
      live = false;
      blur(0);
      setWon(at);
      setOpened(r);
      setStage('shown');
      const { volume: v, confetti: party } = latest.current;
      const level = winLevel(r.win);
      if (level >= 4) playEffect(ROLL_SUCCESS, v);
      else playEffect(ROLL_POP, v, 0.88 + level * 0.08);
      if (still) return;
      const tile = stripRef.current?.querySelector<HTMLElement>(`[data-i="${at}"]`);
      const dialog = rootRef.current?.closest('dialog');
      const colour = tile ? getComputedStyle(tile).getPropertyValue('--roll-colour').trim() : '';
      if (level >= 1 && flashRef.current && typeof flashRef.current.animate === 'function')
        flashRef.current.animate([{ opacity: 0.2 + level * 0.1 }, { opacity: 0 }], {
          duration: 520 + level * 140,
          easing: 'ease-out',
        });
      if (tile && dialog) throwBurst(dialog, tile.getBoundingClientRect(), winColour(r.win), level);
      if (party && level >= 4 && dialog) {
        // In the dialog, or it would fall behind it.
        const colors = colour ? [colour, colour, '#ffffff'] : undefined;
        const waves = level - 3;
        for (let w = 0; w < waves; w++)
          timers.push(
            window.setTimeout(
              () =>
                fireConfetti({ count: 50 + 30 * level, durationMs: 1800, colors, parent: dialog }),
              w * 480,
            ),
          );
      }
    };

    if (still) {
      // No motion: the strip stands on the prize as soon as it's in.
      const wait = () => {
        if (!live) return;
        if (!result) {
          frame = requestAnimationFrame(wait);
          return;
        }
        drops.current.set(0, result.win);
        fill(first);
        land(result, 0);
      };
      frame = requestAnimationFrame(wait);
      return () => {
        live = false;
        cancelAnimationFrame(frame);
      };
    }

    let t = 0;
    let prevNow = performance.now();
    let prevP = p;
    let lid = false;
    let tense = false;
    let thunk = false;
    let lastTile = Math.floor(p);
    let lastTick = -Infinity;
    /** Once the prize is in: from where and when it slows, how far, and the tile it lands on. */
    let plan: { at: number; from: number; distance: number; run: number; tile: number } | null =
      null;
    let stopAt = 0;

    const step = (now: number) => {
      if (!live) return;
      // A hidden tab stops frames; the strip waits for it rather than jumping ahead.
      const dt = Math.min(50, now - prevNow);
      prevNow = now;
      t += dt;
      const sound = latest.current.volume;
      if (!lid && t >= LID_AT) {
        lid = true;
        setStage('spin');
        playTick(sound, 0.6, 1.6);
      }
      const spun = t - START_AT;

      // The prize is in and it has raced long enough: slow onto it from the speed it's going
      // at, stopping somewhere on its tile (the run is stretched or shrunk a little so the
      // speed never jumps).
      if (!plan && result && spun >= MIN_SPIN) {
        const here = REST + spunBy(spun);
        const tile = Math.round(here + (SPEED * SLOW_MS) / 4);
        stopAt = tile + 0.5 + (Math.random() * 2 - 1) * JITTER;
        const distance = stopAt - here;
        plan = { at: t, from: here, distance, run: (4 * distance) / SPEED, tile };
        drops.current.set(tile, result.win);
      }

      let to: number;
      if (plan) {
        const u = t - plan.at;
        if (u < plan.run) to = plan.from + plan.distance * easeOutQuart(u / plan.run);
        else {
          if (!thunk) {
            thunk = true;
            playTick(sound, 0.5, 2);
          }
          const k = Math.min(1, Math.max(0, (u - plan.run - HOLD_MS) / CENTRE_MS));
          to = stopAt + (plan.tile + 0.5 - stopAt) * easeInOutCubic(k);
          if (k >= 1 && result) {
            place(plan.tile + 0.5);
            land(result, plan.tile);
            return;
          }
        }
        if (!tense && u >= plan.run - TENSE_MS) {
          tense = true;
          setStage('tense');
        }
      } else to = REST + spunBy(spun);
      place(to);
      blur(((to - prevP) * pitch) / Math.max(1, dt));
      prevP = to;

      // A card snapping down for each tile that passes the line, a little higher the rarer.
      const under = Math.floor(to);
      if (under !== lastTile) {
        lastTile = under;
        if (t - lastTick > TICK_GAP) {
          lastTick = t;
          const d = drops.current.get(under);
          playEffect(REEL_CLICK, sound, 0.94 + 0.045 * (d ? winLevel(d) : 0), 0.55);
          knock();
        }
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      for (const id of timers) window.clearTimeout(id);
    };
  }, [call, tier, pitch, still, blurId]);

  // What it gave goes into the caches, once.
  useEffect(() => {
    if (!opened || shownRef.current) return;
    shownRef.current = true;
    qc.setQueryData<InventoryData>(keys.inventory, opened.inventory);
    if (opened.win.kind === 'xp')
      qc.setQueryData<ShopData>(keys.shop, (s) => (s ? { ...s, xp: opened.xp } : s));
  }, [opened, qc]);

  const left = opened?.inventory.crates.find((c) => c.tier === tier)?.count ?? 0;
  const level = opened ? winLevel(opened.win) : 0;
  const art: readonly [number, number] = pitch === PITCH ? [84, 62] : [66, 50];
  return (
    <Modal
      open
      strong
      onClose={onClose}
      title={crateName(tier)}
      className="crate-open-modal"
      actions={
        stage === 'shown' ? (
          <>
            {left > 0 && (
              <Button variant="secondary" onClick={onAgain}>
                Open another
              </Button>
            )}
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        ) : undefined
      }
    >
      <div
        ref={rootRef}
        className="crate-open"
        data-stage={stage}
        data-level={level}
        style={tierStyle(tier)}
      >
        <div
          className={cn('crate-reel', won !== null && 'is-done')}
          style={{ '--pitch': `${pitch}px` } as CSSProperties}
          aria-hidden
        >
          <svg className="crate-reel-defs" width="0" height="0">
            <filter id={blurId} x="-20%" y="0" width="140%" height="100%">
              <feGaussianBlur ref={blurRef} stdDeviation="0 0" />
            </filter>
          </svg>
          <div ref={stripRef} className="crate-strip">
            {tiles.map(({ i, drop }) => (
              <ReelTile key={i} i={i} drop={drop} won={i === won} art={art} />
            ))}
          </div>
          <span
            ref={flashRef}
            className="crate-reel-flash"
            style={opened ? winStyle(opened.win) : undefined}
          />
          <span className="crate-marker">
            <span ref={tipRef} className="crate-marker-tip" />
          </span>
        </div>
        <div className="crate-open-stage" role="status">
          {opened ? (
            <Won win={opened.win} isNew={opened.isNew} volume={volume} still={still} />
          ) : (
            <CrateArt tier={tier} className="crate-open-art" />
          )}
        </div>
      </div>
    </Modal>
  );
}

/** One tile of the strip, in its prize's colour with a bar of it along the bottom. */
function ReelTile({
  i,
  drop,
  won,
  art,
}: {
  i: number;
  drop: CrateWin;
  won: boolean;
  art: readonly [number, number];
}) {
  const info = drop.kind === 'pet' ? petInfo(drop.pet) : null;
  return (
    <div
      className={cn('crate-tile', won && 'is-won')}
      data-i={i}
      style={{ ...winStyle(drop), '--i': i } as CSSProperties}
    >
      <span className="crate-tile-art">
        {drop.kind === 'xp' ? (
          <span className="crate-tile-xp tabular">{drop.xp}</span>
        ) : drop.kind === 'crate' ? (
          <CrateArt tier={drop.tier} className="crate-tile-crate" />
        ) : (
          <PetSprite id={drop.pet} box={art} max={3} walking={won} />
        )}
      </span>
      <span className="crate-tile-name">
        {drop.kind === 'xp' ? 'XP' : drop.kind === 'crate' ? crateName(drop.tier) : info?.name}
      </span>
    </div>
  );
}

/**
 * Rings and sparks thrown out of the tile it stopped on, more and further the rarer. They go
 * on the dialog itself, which sits above the page, fixed to the window.
 */
function throwBurst(layer: HTMLElement, from: DOMRect, colour: string, level: number): void {
  const x = from.left + from.width / 2;
  const y = from.top + from.height / 2;
  const add = (el: HTMLElement) => {
    el.style.setProperty('--roll-colour', colour);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    layer.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };
  const rings = level >= 3 ? 2 : level >= 1 ? 1 : 0;
  for (let r = 0; r < rings; r++) {
    const ring = document.createElement('span');
    ring.className = 'crate-ring';
    ring.style.width = ring.style.height = `${from.height}px`;
    ring.style.animationDelay = `${r * 150}ms`;
    add(ring);
  }
  const count = level >= 2 ? 6 + level * 7 : 0;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'crate-spark';
    el.textContent = i % 3 === 0 ? '✧' : '✦';
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const reach = 70 + Math.random() * (60 + level * 34);
    el.style.setProperty('--dx', `${Math.cos(angle) * reach}px`);
    el.style.setProperty('--dy', `${Math.sin(angle) * reach}px`);
    el.style.setProperty('--size', `${0.7 + Math.random() * (0.5 + level * 0.2)}rem`);
    el.style.animationDelay = `${Math.random() * 140}ms`;
    add(el);
  }
}

/** What came out of the crate, rising out of where it sat, with rays behind the rarest. */
function Won({
  win,
  isNew,
  volume,
  still,
}: {
  win: CrateWin;
  isNew: boolean;
  volume: number;
  still: boolean;
}) {
  const level = winLevel(win);
  const rays = level >= 3 && <span className={cn('crate-rays', level >= 5 && 'is-every')} />;
  if (win.kind === 'xp')
    return (
      <div className="crate-won" style={winStyle(win)}>
        {rays}
        <span className="crate-won-xp tabular">
          <CountUp to={win.xp} volume={volume} still={still} />
          <small>XP</small>
        </span>
      </div>
    );
  if (win.kind === 'crate')
    return (
      <div className="crate-won" style={winStyle(win)}>
        {rays}
        <CrateArt tier={win.tier} className="crate-won-crate" />
        <span className="crate-won-name">{crateName(win.tier)}</span>
      </div>
    );
  const info = petInfo(win.pet);
  if (!info) return null;
  return (
    <div className="crate-won" style={winStyle(win)}>
      {rays}
      <PetSprite id={win.pet} box={[200, 130]} max={6} walking />
      <span className="crate-won-name">{info.name}</span>
      <span className="crate-won-meta">
        {PET_RARITY_NAMES[info.rarity]}
        {isNew && <span className="crate-won-new">New</span>}
      </span>
    </div>
  );
}

/** XP counting up from nothing, ticking higher as it goes, with a coin as it lands. */
function CountUp({ to, volume, still }: { to: number; volume: number; still: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || still) return;
    let frame = 0;
    let shown = 0;
    let lastTick = -Infinity;
    const run = 420 + Math.min(520, to * 6);
    const begin = performance.now() + 260;
    const step = (now: number) => {
      const u = Math.min(1, Math.max(0, (now - begin) / run));
      const n = Math.round(to * easeOutCubic(u));
      if (n !== shown) {
        shown = n;
        el.textContent = `+${n}`;
        if (now - lastTick > 45 && u < 1) {
          lastTick = now;
          playTick(volume, 0.9 + 0.7 * u, 0.9);
        }
      }
      if (u >= 1) {
        playEffect(COIN_COLLECT, volume, 1.15, 0.7);
        if (typeof el.animate === 'function')
          el.animate([{ transform: 'scale(1.25)' }, { transform: 'none' }], {
            duration: 420,
            easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
          });
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // Once, as it shows: the volume it started with is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, still]);
  return (
    <span ref={ref} className="crate-won-count">
      +{still ? to : 0}
    </span>
  );
}
