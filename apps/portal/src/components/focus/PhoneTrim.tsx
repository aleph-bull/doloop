import { aspectRatio, timelapseClock, videoSize, type TimelapsePlan } from '@komogon/core';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@komogon/ui';
import {
  clockText,
  knownScreenRatio,
  timeOfDayText,
  type Still,
  type TimelapseLook,
} from '../../lib/timelapse';
import { composeFrame } from '../../lib/timelapse-compose';

/** How many stills the strip shows, spread over the whole recording. */
const THUMBS = 9;
/** Decoded stills kept for the viewer at once. */
const CACHE = 12;

export interface PhoneTrimProps {
  stills: Still[];
  /** Each still's place in the session, in seconds, in order. */
  times: number[];
  /** The first and last still's time. */
  first: number;
  last: number;
  /** Where the trim stands, in the same seconds. */
  from: number;
  to: number;
  /** The stills it keeps, [first, end). */
  startAt: number;
  endAt: number;
  /** The video as it would come out of the kept stills. */
  plan: TimelapsePlan;
  look: TimelapseLook;
  onChange: (from: number, to: number) => void;
}

/**
 * The trim on a phone, like the Photos app's: a strip of stills with a handle at each end,
 * a playhead, and a viewer above that shows the frame under a handle while it is dragged
 * and plays the kept part with its clocks and mark. The play-through skips the blending, so
 * it is quick; the made video is smoother.
 */
export function PhoneTrim({
  stills,
  times,
  first,
  last,
  from,
  to,
  startAt,
  endAt,
  plan,
  look,
  onChange,
}: PhoneTrimProps) {
  const span = Math.max(1, last - first);
  // At least a few seconds of session between the two ends, so something is always kept.
  const gap = Math.max(1, Math.min(10, span / 20));
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - first) / span) * 100));
  const trimmed = from > first || to < last;

  /* ----- the strip's pictures ----- */
  const thumbs = useMemo(() => {
    const n = Math.min(THUMBS, stills.length);
    return Array.from({ length: n }, (_, k) => {
      // Spread by time, so a live clip's many frames take no more of the strip than its seconds.
      const t = first + (k * span) / Math.max(1, n - 1);
      let i = 0;
      while (i < stills.length - 1 && times[i]! < t) i++;
      const s = stills[i];
      return s?.blob ?? s?.screen ?? null;
    });
    // The times only change with the stills.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stills]);
  const [urls, setUrls] = useState<Array<string | null>>([]);
  useEffect(() => {
    const made = thumbs.map((b) => (b ? URL.createObjectURL(b) : null));
    setUrls(made);
    return () => made.forEach((u) => u && URL.revokeObjectURL(u));
  }, [thumbs]);

  /* ----- the viewer ----- */
  const [cameraRatio, setCameraRatio] = useState<number | null>(null);
  const ratio = aspectRatio(look.aspect, cameraRatio, knownScreenRatio());
  const { w: vw, h: vh } = videoSize(ratio, 640);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cache = useRef(new Map<number, ImageBitmap | null>());
  const latest = useRef(-1);
  const [viewAt, setViewAt] = useState(startAt);
  const [playing, setPlaying] = useState(false);

  useEffect(
    () => () => {
      for (const b of cache.current.values()) b?.close();
      cache.current.clear();
    },
    [],
  );

  const bitmap = useCallback(
    async (i: number) => {
      const c = cache.current;
      if (!c.has(i)) {
        const blob = stills[i]?.blob;
        c.set(i, blob ? await createImageBitmap(blob).catch(() => null) : null);
        while (c.size > CACHE) {
          const oldest = c.keys().next().value as number;
          c.get(oldest)?.close();
          c.delete(oldest);
        }
      }
      return c.get(i) ?? null;
    },
    [stills],
  );

  // The video's shape follows the first kept still when it matches the camera.
  useEffect(() => {
    let live = true;
    void bitmap(startAt).then((b) => live && b && setCameraRatio(b.width / b.height));
    return () => {
      live = false;
    };
  }, [bitmap, startAt]);

  const keptFrom = times[startAt] ?? 0;
  const keptSpan = (times[Math.max(startAt, endAt - 1)] ?? keptFrom) - keptFrom;
  const drawAt = useCallback(
    async (i: number) => {
      latest.current = i;
      const still = stills[i];
      const b = await bitmap(i);
      const ctx = canvasRef.current?.getContext('2d');
      // A newer frame was asked for while this one decoded: let that one draw.
      if (!ctx || !still || latest.current !== i) return;
      composeFrame(
        ctx,
        vw,
        vh,
        look.layout,
        {
          camera: b,
          screen: null,
          clock: still.takenAt ? timeOfDayText(still.takenAt, look.timeZone) : null,
          elapsed: clockText(still, look.breakClock),
          title: still.title,
          note: look.noteText?.trim() || null,
          // By time, so the bar holds through a live clip as it does in the video.
          progress: keptSpan > 0 ? ((times[i] ?? keptFrom) - keptFrom) / keptSpan : 1,
        },
        { mark: '#ffffff' },
      );
    },
    [stills, times, bitmap, vw, vh, look, keptFrom, keptSpan],
  );

  useEffect(() => {
    void drawAt(viewAt);
  }, [drawAt, viewAt]);

  // The Satoshi wordmark may arrive after the first frame.
  useEffect(() => {
    void document.fonts?.load('600 24px Satoshi').then(
      () => drawAt(latest.current >= 0 ? latest.current : startAt),
      () => undefined,
    );
  }, [drawAt, startAt]);

  // Playing: through the kept part at the video's speed, a frame of the plan at a time.
  useEffect(() => {
    if (!playing || plan.frames.length === 0) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      const j = Math.floor(((performance.now() - t0) / 1000) * plan.fps);
      if (j >= plan.frames.length) {
        setPlaying(false);
        setViewAt(startAt);
        return;
      }
      setViewAt(startAt + plan.frames[j]![1] - 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, plan, startAt]);

  /* ----- dragging ----- */
  const stripRef = useRef<HTMLDivElement>(null);
  const timeAt = (clientX: number) => {
    const r = stripRef.current!.getBoundingClientRect();
    return first + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * span;
  };
  /** The still nearest a time, inside [lo, hi). */
  const indexAt = (t: number, lo = 0, hi = stills.length) => {
    let i = lo;
    while (i < hi - 1 && times[i]! < t) i++;
    return i;
  };

  const moveStart = (t: number) => {
    const next = Math.min(Math.round(t), to - gap);
    onChange(next, to);
    setViewAt(indexAt(next));
  };
  const moveEnd = (t: number) => {
    const next = Math.max(Math.round(t), from + gap);
    onChange(from, next);
    // The last still at or before the new end.
    let i = stills.length - 1;
    while (i > 0 && times[i]! > next) i--;
    setViewAt(i);
  };

  const handleDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPlaying(false);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const handleMove = (e: React.PointerEvent, which: 'start' | 'end') => {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    const t = timeAt(e.clientX);
    if (which === 'start') moveStart(t);
    else moveEnd(t);
  };
  const handleKey = (e: React.KeyboardEvent, which: 'start' | 'end') => {
    const step = Math.max(1, span / 100);
    const d = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    if (!d) return;
    e.preventDefault();
    if (which === 'start') moveStart(from + d);
    else moveEnd(to + d);
  };

  // A touch on the strip between the handles moves the playhead there.
  const scrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setPlaying(false);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setViewAt(indexAt(timeAt(e.clientX), startAt, endAt));
  };
  const scrubMove = (e: React.PointerEvent) => {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    setViewAt(indexAt(timeAt(e.clientX), startAt, endAt));
  };

  const head = pct(times[viewAt] ?? from);
  const handle = (which: 'start' | 'end') => (
    <span
      role="slider"
      tabIndex={0}
      className={`ptrim-handle is-${which}`}
      aria-label={which === 'start' ? 'Where the video starts' : 'Where the video ends'}
      aria-valuemin={Math.round(first)}
      aria-valuemax={Math.round(last)}
      aria-valuenow={Math.round(which === 'start' ? from : to)}
      aria-valuetext={timelapseClock(which === 'start' ? from : to)}
      onPointerDown={handleDown}
      onPointerMove={(e) => handleMove(e, which)}
      onKeyDown={(e) => handleKey(e, which)}
    >
      {which === 'start' ? (
        <ChevronLeft size={14} aria-hidden />
      ) : (
        <ChevronRight size={14} aria-hidden />
      )}
    </span>
  );

  return (
    <div className="field ptrim">
      <span className="field-label">Trim</span>
      <canvas
        ref={canvasRef}
        width={vw}
        height={vh}
        className="ptrim-view"
        style={{ aspectRatio: `${vw} / ${vh}`, width: `min(100%, ${(46 * vw) / vh}vh)` }}
        aria-label="The trimmed timelapse"
      />
      <div className="ptrim-bar">
        <button
          type="button"
          className="ptrim-play"
          aria-label={playing ? 'Pause' : 'Play the trimmed part'}
          onClick={() => {
            if (!playing && viewAt >= endAt - 1) setViewAt(startAt);
            setPlaying((p) => !p);
          }}
        >
          {playing ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
        </button>
        <div ref={stripRef} className="ptrim-strip" onPointerDown={scrub} onPointerMove={scrubMove}>
          <div className="ptrim-thumbs" aria-hidden>
            {urls.map((u, k) =>
              u ? <img key={k} src={u} alt="" draggable={false} /> : <span key={k} />,
            )}
          </div>
          <span className="ptrim-shade is-left" style={{ left: 0, width: `${pct(from)}%` }} />
          <span className="ptrim-shade is-right" style={{ left: `${pct(to)}%`, right: 0 }} />
          <div
            className={`ptrim-frame${trimmed ? ' is-trimmed' : ''}`}
            style={{ left: `${pct(from)}%`, width: `${pct(to) - pct(from)}%` }}
          >
            {handle('start')}
            {handle('end')}
          </div>
          <span className="ptrim-head" style={{ left: `${head}%` }} aria-hidden />
        </div>
      </div>
      <div className="ptrim-times field-hint tabular">
        <span>{timelapseClock(from)}</span>
        <span>
          {trimmed
            ? `Keeps ${timelapseClock(to - from)} of ${timelapseClock(last - first)}`
            : 'Drag either end to trim'}
        </span>
        <span>{timelapseClock(to)}</span>
      </div>
      {trimmed && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(first, last);
              setViewAt(0);
            }}
          >
            Keep it all
          </Button>
        </div>
      )}
    </div>
  );
}
