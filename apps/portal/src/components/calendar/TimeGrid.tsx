import { layoutLanes, type RestReason } from '@komogon/core';
import { Check, Flag, Play, X } from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  DAY_MIN,
  hourLabel,
  isoAt,
  minutesOf,
  restLabel,
  snap,
  timeRange,
  type CalItem,
  type Deadline,
} from '../../lib/calendar';
import { fmtTime } from '../../lib/format';

const LONG_PRESS_MS = 380;
const EDGE_PX = 40;

export interface GridHit {
  day: string;
  minutes: number;
}

export interface TimeGridHandle {
  /** The day and time under a point on screen, or null when it is outside the grid. */
  hit: (x: number, y: number) => GridHit | null;
}

/** Something drawn while it is dragged in from outside the grid (the To plan list). */
export interface GridPreview {
  day: string;
  start: number;
  end: number;
  title: string;
  color: string | null;
}

export interface TimeGridProps {
  days: string[];
  today: string;
  now: number;
  hourPx: number;
  items: Map<string, CalItem[]>;
  busy: Map<string, Array<{ start: number; end: number }>>;
  deadlines: Map<string, Deadline[]>;
  rest: Map<string, RestReason>;
  /** Hides the day names row, when the page shows its own day picker (phones). */
  hideHead?: boolean;
  preview: GridPreview | null;
  /** Changes when the view moves to other days, so the grid scrolls to a useful hour again. */
  scrollKey: string;
  canPlay: (item: CalItem) => boolean;
  onCreate: (day: string, start: number, end: number) => void;
  onOpen: (item: CalItem) => void;
  onMove: (item: CalItem, day: string, start: number, end: number) => void;
  onAccept: (key: string) => void;
  onDiscard: (key: string) => void;
  onPlay: (item: CalItem) => void;
  onOpenDeadline: (d: Deadline) => void;
}

type Drag =
  | { kind: 'create'; dayIndex: number; anchor: number; start: number; end: number }
  | { kind: 'move'; item: CalItem; dayIndex: number; start: number; dur: number; grab: number }
  | { kind: 'resize'; item: CalItem; dayIndex: number; start: number; end: number };

interface Pending {
  kind: 'create' | 'item' | 'resize';
  pointerId: number;
  touch: boolean;
  x: number;
  y: number;
  item: CalItem | null;
  timer: number | null;
}

/** Planned blocks and suggestions move; history, imported events and the live session don't. */
const movable = (item: CalItem) => item.kind === 'planned' || item.kind === 'proposal';

function fmtSpan(day: string, start: number, end: number) {
  return timeRange(isoAt(day, start), isoAt(day, end));
}

export const TimeGrid = forwardRef<TimeGridHandle, TimeGridProps>(function TimeGrid(props, ref) {
  const { days, today, now, hourPx, items, busy, deadlines, rest, preview } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const pending = useRef<Pending | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const [drag, setDragState] = useState<Drag | null>(null);
  const [scrollbar, setScrollbar] = useState(0);
  // Handlers added once (pointer, touch) read the latest props through this.
  const propsRef = useRef(props);
  useLayoutEffect(() => {
    propsRef.current = props;
  });

  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };

  const hit = useCallback(
    (x: number, y: number): (GridHit & { dayIndex: number }) | null => {
      const cols = colsRef.current;
      const scroller = scrollRef.current;
      if (!cols || !scroller) return null;
      const r = cols.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      if (x < r.left || x > r.right || y < s.top || y > s.bottom) return null;
      const dayIndex = Math.min(
        days.length - 1,
        Math.max(0, Math.floor(((x - r.left) / r.width) * days.length)),
      );
      return { day: days[dayIndex]!, dayIndex, minutes: ((y - r.top) / hourPx) * 60 };
    },
    [days, hourPx],
  );

  useImperativeHandle(ref, () => ({ hit: (x, y) => hit(x, y) }), [hit]);

  // The day names sit outside the scroller; pad them by its scrollbar so the columns line up.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setScrollbar(el.offsetWidth - el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Open on the useful part of the day: from 7:00, or earlier if something starts earlier,
  // or later in the evening so "now" is in view rather than below the fold.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const p = propsRef.current;
    let first = DAY_MIN;
    for (const d of p.days)
      for (const it of p.items.get(d) ?? []) first = Math.min(first, it.start);
    let target = Math.min(7 * 60, first - 30);
    if (p.days.includes(p.today)) {
      const nowMin = minutesOf(new Date(p.now).toISOString(), p.today);
      target = Math.max(target, nowMin - 5 * 60);
    }
    el.scrollTop = Math.max(0, (target / 60) * hourPx);
    // Only when the days change, not on every refetch.
  }, [props.scrollKey, hourPx]);

  /* ---------- gestures ---------- */

  const update = useCallback(
    (x: number, y: number) => {
      const d = dragRef.current;
      if (!d) return;
      const h = hit(x, y);
      if (!h) return;
      if (d.kind === 'create') {
        const m = Math.max(0, Math.min(DAY_MIN, snap(h.minutes)));
        const start = Math.min(d.anchor, m);
        const end = Math.max(d.anchor + 30, m);
        setDrag({ ...d, start, end: Math.min(DAY_MIN, end) });
      } else if (d.kind === 'move') {
        const start = Math.max(0, Math.min(DAY_MIN - d.dur, snap(h.minutes - d.grab)));
        setDrag({ ...d, dayIndex: h.dayIndex, start });
      } else {
        const end = Math.max(d.start + 15, Math.min(DAY_MIN, snap(h.minutes)));
        setDrag({ ...d, end });
      }
    },
    [hit],
  );

  // Scroll while a drag is held near the top or bottom edge.
  useEffect(() => {
    if (!drag) return;
    let raf = 0;
    const tick = () => {
      const el = scrollRef.current;
      const p = lastPoint.current;
      if (el && p) {
        const r = el.getBoundingClientRect();
        const step = p.y < r.top + EDGE_PX ? -10 : p.y > r.bottom - EDGE_PX ? 10 : 0;
        if (step) {
          el.scrollTop += step;
          update(p.x, p.y);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [drag !== null, update]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once a touch drag has started, the finger moves the block, not the page.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => {
      if (dragRef.current) e.preventDefault();
    };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, []);

  const activate = (p: Pending, x: number, y: number) => {
    const h = hit(x, y);
    if (!h) return;
    if (p.kind === 'create') {
      const a = Math.min(DAY_MIN - 15, Math.floor(h.minutes / 15) * 15);
      // A held finger starts with an hour; a mouse drag grows from half an hour.
      const end = Math.min(DAY_MIN, a + (p.touch ? 60 : 30));
      setDrag({ kind: 'create', dayIndex: h.dayIndex, anchor: a, start: a, end });
    } else if (p.kind === 'item' && p.item) {
      const dur = (Date.parse(p.item.endAt) - Date.parse(p.item.startAt)) / 60_000;
      const grab = h.minutes - minutesOf(p.item.startAt, h.day);
      setDrag({
        kind: 'move',
        item: p.item,
        dayIndex: days.indexOf(p.item.day),
        start: snap(minutesOf(p.item.startAt, p.item.day)),
        dur,
        grab,
      });
    } else if (p.kind === 'resize' && p.item) {
      setDrag({
        kind: 'resize',
        item: p.item,
        dayIndex: days.indexOf(p.item.day),
        start: p.item.start,
        end: p.item.end,
      });
    }
    if (p.touch && navigator.vibrate) navigator.vibrate(8);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-action]')) return;
    const itemEl = target.closest<HTMLElement>('[data-item]');
    const key = itemEl?.dataset.item;
    const day = itemEl?.dataset.day;
    const item = key && day ? ((items.get(day) ?? []).find((i) => i.key === key) ?? null) : null;
    if (itemEl && (!item || !movable(item))) return;
    const touch = e.pointerType === 'touch';
    const kind: Pending['kind'] = target.closest('[data-resize]')
      ? 'resize'
      : item
        ? 'item'
        : 'create';
    const p: Pending = {
      kind,
      pointerId: e.pointerId,
      touch,
      x: e.clientX,
      y: e.clientY,
      item,
      timer: null,
    };
    pending.current = p;
    lastPoint.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (kind === 'resize' && !touch) activate(p, e.clientX, e.clientY);
    else if (touch)
      p.timer = window.setTimeout(() => {
        if (pending.current === p) activate(p, p.x, p.y);
      }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pending.current;
    if (!p || p.pointerId !== e.pointerId) return;
    lastPoint.current = { x: e.clientX, y: e.clientY };
    if (dragRef.current) {
      update(e.clientX, e.clientY);
      return;
    }
    const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
    if (p.touch) {
      // Moving before the long press lands is a scroll, not a drag.
      if (moved > 8) cancel();
    } else if (moved > 4) {
      activate(p, p.x, p.y);
      update(e.clientX, e.clientY);
    }
  };

  const cancel = () => {
    const p = pending.current;
    if (p?.timer) clearTimeout(p.timer);
    pending.current = null;
    lastPoint.current = null;
    if (dragRef.current) setDrag(null);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pending.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (p.timer) clearTimeout(p.timer);
    const d = dragRef.current;
    pending.current = null;
    lastPoint.current = null;
    const { onCreate, onMove } = propsRef.current;
    if (!d) {
      // A plain click or tap on empty time plans an hour there.
      if (p.kind === 'create') {
        const h = hit(e.clientX, e.clientY);
        if (h) {
          const start = Math.min(DAY_MIN - 60, Math.floor(h.minutes / 30) * 30);
          onCreate(h.day, start, start + 60);
        }
      }
      return;
    }
    setDrag(null);
    suppressClick.current = true;
    window.setTimeout(() => (suppressClick.current = false), 0);
    const day = days[d.dayIndex]!;
    if (d.kind === 'create') onCreate(day, d.start, d.end);
    else if (d.kind === 'move') {
      const was = snap(minutesOf(d.item.startAt, d.item.day));
      if (day !== d.item.day || d.start !== was) onMove(d.item, day, d.start, d.start + d.dur);
    } else if (d.end !== d.item.end) onMove(d.item, day, d.start, d.end);
  };

  /* ---------- drawing ---------- */

  const nowMin = minutesOf(new Date(now).toISOString(), today);
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const style = {
    '--hour': `${hourPx}px`,
    '--cols': days.length,
    '--sbw': `${scrollbar}px`,
  } as CSSProperties;
  const maxDue = Math.max(0, ...days.map((d) => (deadlines.get(d) ?? []).length));

  const place = (start: number, end: number): CSSProperties => ({
    top: (start / 60) * hourPx,
    height: Math.max(14, ((end - start) / 60) * hourPx - 2),
  });

  const renderItem = (item: CalItem, lane: number, lanes: number, clash: boolean) => {
    const hidden =
      drag && (drag.kind === 'move' || drag.kind === 'resize') && drag.item.key === item.key;
    const short = item.end - item.start < 40;
    const narrow = lanes >= 3;
    const kind = item.kind;
    const label =
      kind === 'commitment'
        ? 'Event'
        : kind === 'session' || kind === 'live'
          ? 'Studied'
          : kind === 'proposal'
            ? 'Suggested'
            : kind === 'missed'
              ? 'Planned earlier'
              : 'Planned';
    const play = props.canPlay(item);
    return (
      <div
        key={item.key}
        className={`cal-ev is-${kind}${clash ? ' is-clash' : ''}${short ? ' is-short' : ''}${lanes > 1 ? ' is-narrow' : ''}${movable(item) ? ' is-movable' : ''}`}
        data-item={item.key}
        data-day={item.day}
        style={{
          ...place(item.start, item.end),
          left: `calc(${lane} * (100% - 6px) / ${lanes} + 3px)`,
          width: `calc((100% - 6px) / ${lanes} - ${lanes > 1 ? 2 : 0}px)`,
          ...(item.color ? ({ '--ev': item.color } as CSSProperties) : {}),
          visibility: hidden ? 'hidden' : undefined,
        }}
      >
        <button
          type="button"
          className="cal-ev-body"
          disabled={kind === 'commitment' || kind === 'live'}
          aria-label={`${label}: ${item.title}, ${timeRange(item.startAt, item.endAt)}${clash ? ', overlapping something else' : ''}`}
          title={`${item.title}${item.sub ? ` · ${item.sub}` : ''}\n${timeRange(item.startAt, item.endAt)}`}
          onClick={() => {
            if (suppressClick.current) return;
            if (kind === 'commitment' || kind === 'live') return;
            propsRef.current.onOpen(item);
          }}
        >
          <span className="cal-ev-title">
            {kind === 'session' && <Check size={11} aria-hidden className="cal-ev-check" />}
            {kind === 'live' && <span className="cal-ev-live" aria-hidden />}
            {item.title}
          </span>
          {!short && !narrow && (
            <span className="cal-ev-time tabular">
              {kind === 'live'
                ? `Since ${fmtTime(item.startAt)}`
                : timeRange(item.startAt, item.endAt)}
            </span>
          )}
          {item.sub && item.end - item.start >= 75 && !narrow && (
            <span className="cal-ev-sub">{item.sub}</span>
          )}
        </button>
        {play && (
          <button
            type="button"
            className="cal-ev-play"
            data-action
            aria-label={`Start ${item.title} now`}
            title="Start a session"
            onClick={() => propsRef.current.onPlay(item)}
          >
            <Play size={11} aria-hidden />
          </button>
        )}
        {kind === 'proposal' && item.proposalKey && (
          <span className="cal-ev-actions">
            <button
              type="button"
              data-action
              className="cal-ev-act"
              aria-label={`Add ${item.title}, ${timeRange(item.startAt, item.endAt)}`}
              title="Add it"
              onClick={() => propsRef.current.onAccept(item.proposalKey!)}
            >
              <Check size={12} aria-hidden />
            </button>
            <button
              type="button"
              data-action
              className="cal-ev-act"
              aria-label={`Drop the suggestion for ${item.title}`}
              title="Drop it"
              onClick={() => propsRef.current.onDiscard(item.proposalKey!)}
            >
              <X size={12} aria-hidden />
            </button>
          </span>
        )}
        {movable(item) && <span className="cal-ev-resize" data-resize aria-hidden />}
      </div>
    );
  };

  return (
    <div className="cal-grid" style={style}>
      {!props.hideHead && (
        <div className="cal-head" aria-hidden>
          <div className="cal-gutter-cell" />
          {days.map((d) => {
            const date = new Date(`${d}T12:00:00`);
            const label = restLabel(rest.get(d) ?? null);
            return (
              <div key={d} className={`cal-day-head${d === today ? ' is-today' : ''}`}>
                <span className="cal-day-name">
                  {new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date)}
                </span>
                <span className="cal-day-num tabular">{date.getDate()}</span>
                {label && <span className="cal-day-rest">{label}</span>}
              </div>
            );
          })}
        </div>
      )}
      {maxDue > 0 && (
        <div className="cal-allday">
          <div className="cal-gutter-cell cal-allday-label">Due</div>
          {days.map((d) => (
            <div key={d} className="cal-allday-cell">
              {(deadlines.get(d) ?? []).slice(0, 3).map((dl) => (
                <DueChip key={dl.node.id} d={dl} onOpen={props.onOpenDeadline} />
              ))}
              {(deadlines.get(d)?.length ?? 0) > 3 && (
                <span
                  className="cal-due-more"
                  title={(deadlines.get(d) ?? [])
                    .slice(3)
                    .map((x) => x.node.title)
                    .join(', ')}
                >
                  {(deadlines.get(d)?.length ?? 0) - 3} more
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="cal-scroll" ref={scrollRef}>
        <div className="cal-body" style={{ height: 24 * hourPx }}>
          <div className="cal-gutter" aria-hidden>
            {hours.slice(1).map((h) => (
              <span key={h} className="cal-hour tabular" style={{ top: h * hourPx }}>
                {hourLabel(h)}
              </span>
            ))}
          </div>
          <div
            className={`cal-cols${drag ? ' is-dragging' : ''}`}
            ref={colsRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={cancel}
            role="presentation"
          >
            {days.map((d, di) => {
              const list = items.get(d) ?? [];
              const kept = list.filter((i) => i.kind === 'kept');
              const laid = layoutLanes(list.filter((i) => i.kind !== 'kept'));
              const restReason = rest.get(d) ?? null;
              return (
                <div
                  key={d}
                  className={`cal-col${d === today ? ' is-today' : ''}${restReason ? ' is-rest' : ''}${d < today ? ' is-past' : ''}`}
                >
                  {(busy.get(d) ?? []).map((b, i) => (
                    <div
                      key={`busy-${i}`}
                      className="cal-busy"
                      style={place(b.start, b.end)}
                      title="Busy"
                    />
                  ))}
                  {kept.map((k) => (
                    <div
                      key={k.key}
                      className="cal-kept"
                      style={{
                        ...place(k.start, k.end),
                        ...(k.color ? ({ '--ev': k.color } as CSSProperties) : {}),
                      }}
                      title={`Planned: ${k.title}, ${timeRange(k.startAt, k.endAt)}`}
                    />
                  ))}
                  {laid.map((it) =>
                    renderItem(it, it.lane, it.lanes, it.overlaps && it.kind !== 'proposal'),
                  )}
                  {drag && drag.dayIndex === di && <DragGhost drag={drag} day={d} place={place} />}
                  {preview && preview.day === d && (
                    <div
                      className="cal-ev is-planned is-ghost"
                      style={{
                        ...place(preview.start, preview.end),
                        left: 3,
                        right: 3,
                        ...(preview.color ? ({ '--ev': preview.color } as CSSProperties) : {}),
                      }}
                    >
                      <span className="cal-ev-body">
                        <span className="cal-ev-title">{preview.title}</span>
                        <span className="cal-ev-time tabular">
                          {fmtSpan(d, preview.start, preview.end)}
                        </span>
                      </span>
                    </div>
                  )}
                  {d === today && (
                    <div className="cal-now" style={{ top: (nowMin / 60) * hourPx }} aria-hidden />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});

function DragGhost({
  drag,
  day,
  place,
}: {
  drag: Drag;
  day: string;
  place: (start: number, end: number) => CSSProperties;
}) {
  const start = drag.start;
  const end = drag.kind === 'move' ? drag.start + drag.dur : drag.end;
  const item = drag.kind === 'create' ? null : drag.item;
  return (
    <div
      className={`cal-ev is-${item?.kind ?? 'planned'} is-ghost`}
      style={{
        ...place(start, Math.min(DAY_MIN, end)),
        left: 3,
        right: 3,
        ...(item?.color ? ({ '--ev': item.color } as CSSProperties) : {}),
      }}
    >
      <span className="cal-ev-body">
        <span className="cal-ev-title">{item?.title ?? 'New block'}</span>
        <span className="cal-ev-time tabular">{fmtSpan(day, start, Math.min(DAY_MIN, end))}</span>
      </span>
    </div>
  );
}

export function DueChip({ d, onOpen }: { d: Deadline; onOpen: (d: Deadline) => void }) {
  return (
    <button
      type="button"
      className={`cal-due${d.done ? ' is-done' : ''}${d.assessment ? ' is-assessment' : ''}`}
      style={d.color ? ({ '--ev': d.color } as CSSProperties) : undefined}
      title={`${d.assessment ? 'Assessment' : 'Due'}: ${d.node.title}${d.course ? ` · ${d.course}` : ''}`}
      onClick={() => onOpen(d)}
    >
      {d.assessment ? (
        <Flag size={10} aria-hidden className="cal-due-icon" />
      ) : (
        <span className="cal-due-dot" aria-hidden />
      )}
      <span className="cal-due-text">{d.node.title}</span>
    </button>
  );
}
