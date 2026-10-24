import { timelapseClock, videoSize, type TimelapsePlan } from '@komogon/core';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@komogon/ui';
import {
  knownScreenRatio,
  lookRatio,
  stillTexts,
  type Still,
  type TimelapseLook,
} from '../../lib/timelapse';
import { composeFrame } from '../../lib/timelapse-compose';

/** How many stills a phone's strip shows, spread over the whole recording. */
const THUMBS = 9;
/** On a computer's wider card, as many as fit at the stills' own shape, within these. */
const WIDE_THUMBS_MIN = 5;
const WIDE_THUMBS_MAX = 14;
/** Decoded stills kept for the viewer at once. */
const CACHE = 12;

/** One still's pictures, decoded for the viewer. */
type Pictures = { camera: ImageBitmap | null; screen: ImageBitmap | null };

const decode = (blob: Blob | null | undefined) =>
  blob ? createImageBitmap(blob).catch(() => null) : Promise.resolve(null);
const shapeOf = (b: ImageBitmap | null) => (b && b.height > 0 ? b.width / b.height : null);

export interface TimelapseTrimProps {
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
  /** A computer's card: the strip fits its stills at their own shape, the viewer is sharper. */
  wide?: boolean;
  onChange: (from: number, to: number) => void;
}

/**
 * The trim, like the Photos app's: a strip of stills with a handle at each end, a playhead,
 * and a viewer above that shows the frame under a handle while it is dragged and plays the
 * kept part with its clocks, screen and mark. The play-through skips the blending, so it is
 * quick; the made video is smoother. A phone and a computer share it; the computer's is wide.
 */
export function TimelapseTrim({
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
  wide = false,
  onChange,
}: TimelapseTrimProps) {
  const span = Math.max(1, last - first);
  // At least a few seconds of session between the two ends, so something is always kept.
  const gap = Math.max(1, Math.min(10, span / 20));
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - first) / span) * 100));
  const trimmed = from > first || to < last;

  /* ----- decoded stills ----- */
  // Kept by still rather than by place: while recording, thinning moves every still along.
  const cache = useRef(new Map<Still, Promise<Pictures>>());
  useEffect(
    () => () => {
      for (const p of cache.current.values())
        void p.then(({ camera, screen }) => {
          camera?.close();
          screen?.close();
        });
      cache.current.clear();
    },
    [],
  );
  const pictures = useCallback((still: Still) => {
    const c = cache.current;
    let p = c.get(still);
    if (p) {
      // The most recently used goes last, so the oldest is the one let go.
      c.delete(still);
    } else {
      p = Promise.all([decode(still.blob), decode(still.screen)]).then(([camera, screen]) => ({
        camera,
        screen,
      }));
    }
    c.set(still, p);
    while (c.size > CACHE) {
      const [oldest, gone] = c.entries().next().value!;
      c.delete(oldest);
      void gone.then(({ camera, screen }) => {
        camera?.close();
        screen?.close();
      });
    }
    return p;
  }, []);

  // The video's shape follows the first kept still, as the made video does.
  const [shapes, setShapes] = useState<{ camera: number | null; screen: number | null }>({
    camera: null,
    screen: null,
  });
  const firstKept = stills[startAt];
  useEffect(() => {
    if (!firstKept) return;
    let live = true;
    void pictures(firstKept).then((p) => {
      if (!live) return;
      const camera = shapeOf(p.camera);
      const screen = shapeOf(p.screen);
      setShapes((s) => (s.camera === camera && s.screen === screen ? s : { camera, screen }));
    });
    return () => {
      live = false;
    };
  }, [pictures, firstKept]);

  /* ----- the strip's pictures ----- */
  const stripRef = useRef<HTMLDivElement>(null);
  const [strip, setStrip] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!wide || !el) return;
    const measure = () => setStrip({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [wide]);
  const thumbShape = shapes.camera ?? shapes.screen ?? 16 / 9;
  const thumbCount = Math.min(
    stills.length,
    wide && strip && strip.h > 0
      ? Math.max(
          WIDE_THUMBS_MIN,
          Math.min(WIDE_THUMBS_MAX, Math.round(strip.w / (strip.h * thumbShape))),
        )
      : THUMBS,
  );
  const thumbs = useMemo(
    () =>
      Array.from({ length: thumbCount }, (_, k) => {
        // Spread by time, so a live clip's many frames take no more of the strip than its seconds.
        const t = first + (k * span) / Math.max(1, thumbCount - 1);
        let i = 0;
        while (i < stills.length - 1 && times[i]! < t) i++;
        const s = stills[i];
        return s?.blob ?? s?.screen ?? null;
      }),
    // The times only change with the stills.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stills, thumbCount],
  );
  // A picture keeps its address while it stays in the strip, so a growing recording only
  // loads the stills that are new to it.
  const thumbUrls = useRef(new Map<Blob, string>());
  const [urls, setUrls] = useState<Array<string | null>>([]);
  useEffect(() => {
    const made = thumbUrls.current;
    const next = thumbs.map((b) => {
      if (!b) return null;
      let u = made.get(b);
      if (!u) {
        u = URL.createObjectURL(b);
        made.set(b, u);
      }
      return u;
    });
    const shown = new Set(thumbs);
    for (const [b, u] of made)
      if (!shown.has(b)) {
        URL.revokeObjectURL(u);
        made.delete(b);
      }
    setUrls(next);
  }, [thumbs]);
  useEffect(
    () => () => {
      for (const u of thumbUrls.current.values()) URL.revokeObjectURL(u);
      thumbUrls.current.clear();
    },
    [],
  );

  /* ----- the viewer ----- */
  const ratio = lookRatio(look, shapes.camera, shapes.screen ?? knownScreenRatio());
  const { w: vw, h: vh } = videoSize(ratio, wide ? 960 : 640);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef(-1);
  const [viewAt, setViewAt] = useState(startAt);
  const [playing, setPlaying] = useState(false);

  const keptFrom = times[startAt] ?? 0;
  const keptSpan = (times[Math.max(startAt, endAt - 1)] ?? keptFrom) - keptFrom;
  const drawAt = useCallback(
    async (i: number) => {
      latest.current = i;
      const still = stills[i];
      if (!still) return;
      const p = await pictures(still);
      const ctx = canvasRef.current?.getContext('2d');
      // A newer frame was asked for while this one decoded: let that one draw.
      if (!ctx || latest.current !== i) return;
      composeFrame(
        ctx,
        vw,
        vh,
        look.layout,
        {
          camera: p.camera,
          screen: look.layout.screen.visible ? p.screen : null,
          ...stillTexts(still, look),
          // By time, so the bar holds through a live clip as it does in the video.
          progress: keptSpan > 0 ? ((times[i] ?? keptFrom) - keptFrom) / keptSpan : 1,
        },
        { mark: '#ffffff' },
      );
    },
    [stills, times, pictures, vw, vh, look, keptFrom, keptSpan],
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

  // Playing: through the kept part at the video's speed, a frame of the plan at a time. The
  // plan grows while a recording goes on; playing carries on through it rather than restart.
  const playFrom = useRef({ plan, startAt });
  useEffect(() => {
    playFrom.current = { plan, startAt };
  }, [plan, startAt]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      const { plan: p, startAt: s } = playFrom.current;
      const j = Math.floor(((performance.now() - t0) / 1000) * p.fps);
      if (j >= p.frames.length) {
        setPlaying(false);
        setViewAt(s);
        return;
      }
      setViewAt(s + p.frames[j]![1] - 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  /* ----- dragging ----- */
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

  // A press on the strip between the handles moves the playhead there.
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
      className={`tl-trim-handle is-${which}`}
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
    <div className="field tl-trim">
      <span className="field-label">Trim</span>
      <canvas
        ref={canvasRef}
        width={vw}
        height={vh}
        className="tl-trim-view"
        style={{ aspectRatio: `${vw} / ${vh}`, width: `min(100%, ${(46 * vw) / vh}vh)` }}
        aria-label="The trimmed timelapse"
      />
      <div className="tl-trim-bar">
        <button
          type="button"
          className="tl-trim-play"
          aria-label={playing ? 'Pause' : 'Play the trimmed part'}
          onClick={() => {
            if (!playing && viewAt >= endAt - 1) setViewAt(startAt);
            setPlaying((p) => !p);
          }}
        >
          {playing ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
        </button>
        <div
          ref={stripRef}
          className="tl-trim-strip"
          onPointerDown={scrub}
          onPointerMove={scrubMove}
        >
          <div className="tl-trim-thumbs" aria-hidden>
            {urls.map((u, k) =>
              u ? <img key={k} src={u} alt="" draggable={false} /> : <span key={k} />,
            )}
          </div>
          <span className="tl-trim-shade is-left" style={{ left: 0, width: `${pct(from)}%` }} />
          <span className="tl-trim-shade is-right" style={{ left: `${pct(to)}%`, right: 0 }} />
          <div
            className={`tl-trim-frame${trimmed ? ' is-trimmed' : ''}`}
            style={{ left: `${pct(from)}%`, width: `${pct(to) - pct(from)}%` }}
          >
            {handle('start')}
            {handle('end')}
          </div>
          <span className="tl-trim-head" style={{ left: `${head}%` }} aria-hidden />
        </div>
      </div>
      <div className="tl-trim-times field-hint tabular">
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
