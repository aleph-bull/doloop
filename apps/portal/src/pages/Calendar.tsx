import '../components/calendar/calendar.css';
import {
  addDays,
  isValidDate,
  planWeek,
  startOfWeekMonday,
  toLocalDate,
  type PlannedBlock,
  type StudyNode,
} from '@komogon/core';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { useSearchParams } from 'react-router';
import { Button, Panel, Segmented, Spinner, useToast } from '@komogon/ui';
import { BlockDialog } from '../components/BlockDialog';
import { ErrorPanel } from '../components/ErrorState';
import { NodeDialog } from '../components/NodeDialog';
import { StartSessionDialog } from '../components/StartSessionDialog';
import { MonthGrid } from '../components/calendar/MonthGrid';
import { DueList, PlanTray } from '../components/calendar/SidePanels';
import { TimeGrid, type GridHit, type TimeGridHandle } from '../components/calendar/TimeGrid';
import { api } from '../lib/api';
import {
  buildItems,
  busyByDay,
  dayRange,
  deadlinesByDay,
  isImported,
  isoAt,
  localTz,
  minutesByDay,
  nodeLookup,
  periodLabel,
  PLAN_DAY_END,
  PLAN_DAY_START,
  restByDay,
  snap,
  totals,
  trayItems,
  type CalItem,
  type Deadline,
  type Proposal,
  type TrayItem,
} from '../lib/calendar';
import { fmtMinutes } from '../lib/format';
import {
  useActiveSession,
  useBlocks,
  useBusy,
  useCalendarFeeds,
  useCreateBlock,
  useGoogleStatus,
  useMe,
  useNodes,
  usePace,
  usePlans,
  useRestDays,
  useUpdateBlock,
} from '../lib/queries';

type View = 'week' | 'month';

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** Whole Monday-first weeks covering the month a day is in. */
function monthWeeks(day: string): string[][] {
  const first = `${day.slice(0, 7)}-01`;
  const [y, m] = first.split('-').map(Number);
  const last = toLocalDate(new Date(y!, m!, 0, 12), localTz());
  const weeks: string[][] = [];
  for (let w = startOfWeekMonday(first); w <= last; w = addDays(w, 7))
    weeks.push(dayRange(w, addDays(w, 6)));
  return weeks;
}

function shiftMonth(day: string, by: number): string {
  const [y, m] = day.split('-').map(Number);
  return toLocalDate(new Date(y!, m! - 1 + by, 1, 12), localTz());
}

export function Calendar() {
  const me = useMe();
  const nodes = useNodes();
  const pace = usePace();
  const plans = usePlans();
  const restDays = useRestDays();
  const active = useActiveSession();
  const google = useGoogleStatus();
  const feeds = useCalendarFeeds();
  const outlook = useQuery({
    queryKey: ['calendar', 'outlook'],
    queryFn: api.outlookStatus,
    staleTime: 60_000,
  });
  const create = useCreateBlock();
  const update = useUpdateBlock();
  const { toast } = useToast();
  const phone = useMedia('(max-width: 767px)');
  const tz = localTz();

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const today = toLocalDate(new Date(now), tz);

  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'month' ? 'month' : 'week';
  const dateParam = params.get('date');
  const anchor = dateParam && isValidDate(dateParam) ? dateParam : today;
  const go = (date: string, next: View = view) =>
    setParams(
      (p) => {
        const q = new URLSearchParams(p);
        if (date === today) q.delete('date');
        else q.set('date', date);
        if (next === 'week') q.delete('view');
        else q.set('view', next);
        return q;
      },
      { replace: true },
    );

  const weekStart = startOfWeekMonday(anchor);
  const weekDays = useMemo(() => dayRange(weekStart, addDays(weekStart, 6)), [weekStart]);
  const weeks = useMemo(() => monthWeeks(anchor), [anchor]);
  const monthGrid = useMemo(() => weeks.flat(), [weeks]);
  const phoneDay = useMemo(() => [anchor], [anchor]);
  const gridDays = view === 'month' ? monthGrid : phone ? phoneDay : weekDays;
  const rangeDays = view === 'month' ? monthGrid : weekDays;
  const from = rangeDays[0]!;
  const to = rangeDays[rangeDays.length - 1]!;
  const blocks = useBlocks(isoAt(from, 0), isoAt(addDays(to, 1), 0));
  const busy = useBusy(isoAt(from, 0), isoAt(addDays(to, 1), 0));

  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [moved, setMoved] = useState<Record<string, { startAt: string; endAt: string }>>({});
  const [blockDialog, setBlockDialog] = useState<{
    block?: PlannedBlock | null;
    draft?: { startAt: string; endAt: string; nodeId?: string | null } | null;
  } | null>(null);
  const [startFor, setStartFor] = useState<{ node: StudyNode; minutes: number } | null>(null);
  const [editNode, setEditNode] = useState<StudyNode | null>(null);
  const [trayDrag, setTrayDrag] = useState<{
    item: TrayItem;
    len: number;
    x: number;
    y: number;
    hit: GridHit | null;
  } | null>(null);
  const trayClickBlocked = useRef(false);
  const gridRef = useRef<TimeGridHandle>(null);

  // Suggestions belong to the week they were made for.
  useEffect(() => setProposals(null), [weekStart, view]);

  // A moved block is drawn where it was dropped until the server's copy agrees.
  useEffect(() => {
    if (!blocks.data || Object.keys(moved).length === 0) return;
    const settled = Object.entries(moved).filter(([id, at]) => {
      const b = blocks.data.blocks.find((x) => x.id === id);
      return !b || (b.startAt === at.startAt && b.endAt === at.endAt);
    });
    if (settled.length)
      setMoved((m) => {
        const next = { ...m };
        for (const [id] of settled) delete next[id];
        return next;
      });
  }, [blocks.data, moved]);

  const list = useMemo(() => nodes.data?.nodes ?? [], [nodes.data]);
  const lookup = useMemo(() => nodeLookup(list), [list]);
  const policy = restDays.data?.policy ?? null;
  const allBlocks = useMemo(
    () => (blocks.data?.blocks ?? []).map((b) => (moved[b.id] ? { ...b, ...moved[b.id] } : b)),
    [blocks.data, moved],
  );
  const running = active.data?.active ?? null;

  const items = useMemo(
    () =>
      buildItems(gridDays, {
        blocks: allBlocks,
        proposals: proposals ?? [],
        live: running
          ? {
              nodeId: running.session.nodeId,
              title: running.nodeTitle,
              startAt: running.session.startedAt,
            }
          : null,
        lookup,
        now,
      }),
    [gridDays, allBlocks, proposals, running, lookup, now],
  );
  const deadlines = useMemo(() => deadlinesByDay(list, lookup, from, to), [list, lookup, from, to]);
  const rest = useMemo(() => restByDay(policy, rangeDays), [policy, rangeDays]);
  const busyDays = useMemo(() => busyByDay(gridDays, busy.data?.busy ?? []), [gridDays, busy.data]);
  const tray = useMemo(
    () =>
      pace.data
        ? trayItems({
            nodes: list,
            lookup,
            pace: pace.data,
            plans: plans.data?.plans ?? [],
            blocks: allBlocks,
            policy,
            today,
            from: weekDays[0]!,
            to: weekDays[6]!,
            now,
          })
        : [],
    [pace.data, plans.data, list, lookup, allBlocks, policy, today, weekDays, now],
  );

  /* ---------- keyboard ---------- */

  const step = (dir: 1 | -1) => {
    if (view === 'month') go(shiftMonth(anchor, dir));
    else go(addDays(anchor, phone ? dir : dir * 7));
  };
  // The listener is added once; it reads this render's step, go and anchor through the ref.
  const keys = useRef({ step, go, anchor });
  useEffect(() => {
    keys.current = { step, go, anchor };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('dialog[open]')) return;
      const k = keys.current;
      if (e.key === 'ArrowLeft') k.step(-1);
      else if (e.key === 'ArrowRight') k.step(1);
      else if (e.key === 't') k.go(toLocalDate(new Date(), localTz()));
      else if (e.key === 'w') k.go(k.anchor, 'week');
      else if (e.key === 'm') k.go(k.anchor, 'month');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---------- swipe between days on a phone ---------- */

  const swipe = useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = (e: ReactTouchEvent) => {
    const t = e.touches[0];
    swipe.current =
      t && e.touches.length === 1 ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
  };
  const onTouchEnd = (e: ReactTouchEvent) => {
    const s = swipe.current;
    const t = e.changedTouches[0];
    swipe.current = null;
    if (!s || !t || !phone || view !== 'week') return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    // A quick flick only: a held finger is a drag on the grid, not a swipe.
    if (Date.now() - s.t < 350 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2)
      step(dx < 0 ? 1 : -1);
  };

  /* ---------- loading ---------- */

  const failed = [nodes, me].find((q) => q.isError);
  if (failed && (!nodes.data || !me.data))
    return (
      <ErrorPanel
        message={
          failed.error instanceof Error ? failed.error.message : 'Could not load the calendar.'
        }
        onRetry={() => {
          void nodes.refetch();
          void me.refetch();
          void blocks.refetch();
        }}
      />
    );
  if (!nodes.data || !me.data)
    return (
      <div className="flex justify-center p-12">
        <Spinner />
      </div>
    );

  /* ---------- actions ---------- */

  const byId = new Map(list.map((n) => [n.id, n]));
  const firstNeed = tray.find((t) => t.need > 0)?.nodeId ?? pace.data?.plan[0]?.nodeId ?? null;
  const weekOver = weekDays[6]! < today;

  const openDraft = (day: string, start: number, end: number, nodeId = firstNeed) =>
    setBlockDialog({ draft: { startAt: isoAt(day, start), endAt: isoAt(day, end), nodeId } });

  const moveTo = async (item: CalItem, day: string, start: number, end: number) => {
    const startAt = isoAt(day, start);
    const endAt = isoAt(day, end);
    if (item.kind === 'proposal') {
      setProposals((ps) =>
        (ps ?? []).map((p) => (p.key === item.proposalKey ? { ...p, startAt, endAt } : p)),
      );
      return;
    }
    const block = item.block;
    if (!block) return;
    setMoved((m) => ({ ...m, [block.id]: { startAt, endAt } }));
    try {
      await update.mutateAsync({ id: block.id, patch: { startAt, endAt } });
    } catch (err) {
      setMoved((m) => {
        const next = { ...m };
        delete next[block.id];
        return next;
      });
      toast(err instanceof Error ? err.message : 'Could not move that block.');
    }
  };

  /** Free time for some needs in this week from now on, around everything already there. */
  const fit = (needs: TrayItem[]) => {
    const all = allBlocks.filter((b) => !b.cancelled);
    const startMs = Math.max(now, Date.parse(isoAt(weekDays[0]!, 0)));
    const runningUntil = running
      ? (running.session.plannedEndAt ?? new Date(now + 30 * 60_000).toISOString())
      : null;
    return planWeek({
      from: new Date(startMs).toISOString(),
      to: isoAt(addDays(weekDays[6]!, 1), 0),
      needs: needs.map((n) => ({
        nodeId: n.nodeId,
        minutes: n.need,
        deadline: n.deadline,
        blockMinutes: n.blockMinutes,
      })),
      busy: [
        ...(busy.data?.busy ?? []),
        ...all.filter((b) => isImported(b.source)).map((b) => ({ start: b.startAt, end: b.endAt })),
        ...(runningUntil ? [{ start: new Date(now).toISOString(), end: runningUntil }] : []),
      ],
      planned: all
        .filter((b) => b.source === 'app')
        .map((b) => ({ start: b.startAt, end: b.endAt })),
      timezone: tz,
      policy: policy ?? {
        userId: '',
        weeklyRestDays: [],
        pendingWeeklyRestDays: null,
        vacations: [],
        breakDays: [],
        changeLog: [],
      },
      dayStartHour: PLAN_DAY_START,
      dayEndHour: PLAN_DAY_END,
    });
  };

  const planMyWeek = () => {
    const needs = tray.filter((t) => t.need >= 30);
    if (needs.length === 0) return toast('Nothing needs more time this week.');
    const out = fit(needs);
    if (out.length === 0) return toast('No free time left this week to fit anything in.');
    setProposals(
      out.map((p, i) => ({
        key: `${i}-${p.nodeId}`,
        nodeId: p.nodeId,
        startAt: p.start,
        endAt: p.end,
      })),
    );
    if (phone) go(toLocalDate(out[0]!.start, tz));
  };

  const accept = async (key: string) => {
    const p = proposals?.find((x) => x.key === key);
    if (!p) return;
    setProposals((ps) => {
      const next = (ps ?? []).filter((x) => x.key !== key);
      return next.length ? next : null;
    });
    try {
      await create.mutateAsync({ nodeId: p.nodeId, startAt: p.startAt, endAt: p.endAt });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add that block.');
    }
  };

  const acceptAll = async () => {
    const all = proposals ?? [];
    setProposals(null);
    let added = 0;
    for (const p of all) {
      try {
        await create.mutateAsync({ nodeId: p.nodeId, startAt: p.startAt, endAt: p.endAt });
        added++;
      } catch {
        /* reported below */
      }
    }
    if (added < all.length) toast(`Added ${added} of ${all.length}. The rest could not be saved.`);
    else toast(added === 1 ? 'Added 1 block.' : `Added ${added} blocks.`, { tone: 'ok' });
  };

  const pickTray = (item: TrayItem) => {
    if (trayClickBlocked.current) return;
    const minutes = item.need >= 30 ? Math.min(item.need, item.blockMinutes) : item.blockMinutes;
    const [slot] = fit([{ ...item, need: minutes, blockMinutes: minutes }]);
    if (slot) {
      setBlockDialog({ draft: { startAt: slot.start, endAt: slot.end, nodeId: item.nodeId } });
      if (phone) go(toLocalDate(slot.start, tz));
    } else {
      toast('No free time left this week for that. Pick a time yourself.');
      const start = Math.ceil((new Date(now).getHours() * 60 + 60) / 30) * 30;
      openDraft(today, Math.min(start, 22 * 60), Math.min(start, 22 * 60) + minutes, item.nodeId);
    }
  };

  /** Dragging a To plan item onto the grid makes a block where it lands. Mouse and pen only. */
  const grabTray = (item: TrayItem, e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'touch' || e.button !== 0 || view !== 'week' || weekOver) return;
    const len = item.need >= 30 ? Math.min(item.need, item.blockMinutes) : item.blockMinutes;
    const sx = e.clientX;
    const sy = e.clientY;
    let on = false;
    const move = (ev: PointerEvent) => {
      if (!on && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      on = true;
      const hit = gridRef.current?.hit(ev.clientX, ev.clientY) ?? null;
      setTrayDrag({ item, len, x: ev.clientX, y: ev.clientY, hit });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setTrayDrag(null);
      if (!on) return;
      trayClickBlocked.current = true;
      window.setTimeout(() => (trayClickBlocked.current = false), 0);
      const hit =
        ev.type === 'pointerup' ? (gridRef.current?.hit(ev.clientX, ev.clientY) ?? null) : null;
      if (!hit) return;
      const start = landingMinutes(hit, len);
      create
        .mutateAsync({
          nodeId: item.nodeId,
          startAt: isoAt(hit.day, start),
          endAt: isoAt(hit.day, start + len),
        })
        .catch((err: unknown) =>
          toast(err instanceof Error ? err.message : 'Could not plan that block.'),
        );
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const canPlay = (item: CalItem) =>
    !running &&
    item.kind === 'planned' &&
    Boolean(item.nodeId && byId.has(item.nodeId)) &&
    item.day === today &&
    Date.parse(item.endAt) > now;

  const play = (item: CalItem) => {
    const node = item.nodeId ? byId.get(item.nodeId) : null;
    if (!node) return;
    const minutes = Math.round(
      (Date.parse(item.endAt) - Math.max(now, Date.parse(item.startAt))) / 60_000,
    );
    setStartFor({ node, minutes: Math.max(5, minutes) });
  };

  const openDeadline = (d: Deadline) => setEditNode(byId.get(d.node.id) ?? d.node);

  /* ---------- drawing ---------- */

  // The figures under the title cover what the title names: the month, the week, or the day.
  const monthDays = rangeDays.filter((d) => d.startsWith(anchor.slice(0, 7)));
  const [periodFrom, periodTo] =
    view === 'month'
      ? [monthDays[0]!, monthDays[monthDays.length - 1]!]
      : phone
        ? [anchor, anchor]
        : [weekDays[0]!, weekDays[6]!];
  const sum = totals(allBlocks, periodFrom, periodTo);
  const dueCount = [...deadlines.values()]
    .flat()
    .filter((d) => !d.done && d.day >= today && d.day >= periodFrom && d.day <= periodTo).length;
  const label =
    view === 'month'
      ? periodLabel('month', anchor, anchor)
      : phone
        ? periodLabel('day', anchor, anchor)
        : periodLabel('week', weekDays[0]!, weekDays[6]!);
  const unit = view === 'month' ? 'month' : phone ? 'day' : 'week';
  const connected = Boolean(
    google.data?.connected || outlook.data?.connected || feeds.data?.feeds.length,
  );
  const proposalMinutes = (proposals ?? []).reduce(
    (a, p) => a + (Date.parse(p.endAt) - Date.parse(p.startAt)) / 60_000,
    0,
  );
  const previewStart = trayDrag?.hit ? landingMinutes(trayDrag.hit, trayDrag.len) : 0;
  const preview =
    trayDrag?.hit && view === 'week'
      ? {
          day: trayDrag.hit.day,
          start: previewStart,
          end: previewStart + trayDrag.len,
          title: lookupTitle(trayDrag.item),
          color: trayDrag.item.color,
        }
      : null;

  return (
    <div className="cal-page flex flex-col gap-4">
      <div className="page-head cal-page-head">
        <div className="min-w-0">
          <h1 className="page-title">Calendar</h1>
          <div className="cal-period">
            <span className="cal-period-label">{label}</span>
            {(sum.planned >= 1 || sum.studied >= 1 || dueCount > 0) && (
              <span className="cal-stats">
                {sum.planned >= 1 && (
                  <span className="cal-stat tabular">{fmtMinutes(sum.planned)} planned</span>
                )}
                {sum.studied >= 1 && (
                  <span className="cal-stat tabular">{fmtMinutes(sum.studied)} studied</span>
                )}
                {dueCount > 0 && <span className="cal-stat tabular">{dueCount} due</span>}
              </span>
            )}
          </div>
        </div>
        <div className="cal-controls">
          <Segmented
            ariaLabel="View"
            value={view}
            onChange={(v) => go(anchor, v)}
            options={[
              { value: 'week', label: phone ? 'Day' : 'Week' },
              { value: 'month', label: 'Month' },
            ]}
          />
          <div className="cal-nav">
            <Button
              size="sm"
              variant="ghost"
              icon
              aria-label={`Previous ${unit}`}
              onClick={() => step(-1)}
            >
              <ChevronLeft size={16} aria-hidden />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => go(today)} disabled={anchor === today}>
              Today
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon
              aria-label={`Next ${unit}`}
              onClick={() => step(1)}
            >
              <ChevronRight size={16} aria-hidden />
            </Button>
          </div>
          <Button
            size="sm"
            onClick={() => setBlockDialog({ draft: null })}
            aria-label="New block"
            icon={phone}
          >
            <Plus size={15} aria-hidden />
            {!phone && 'New block'}
          </Button>
          {view === 'week' && (
            <Button
              size="sm"
              variant="primary"
              onClick={planMyWeek}
              disabled={weekOver}
              title={
                weekOver ? 'That week is over' : 'Fit what still needs time into your free time'
              }
            >
              Plan my week
            </Button>
          )}
        </div>
      </div>

      <div className={`cal-layout${view === 'month' ? ' is-month' : ''}`}>
        <Panel className="cal-main" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {proposals && proposals.length > 0 && view === 'week' && (
            <div className="cal-proposals" role="status">
              <span className="cal-proposals-text">
                {proposals.length === 1
                  ? '1 suggested block'
                  : `${proposals.length} suggested blocks`}
                <span className="tabular"> · {fmtMinutes(proposalMinutes)}</span>
              </span>
              <span className="cal-proposals-hint">
                Move them around, then keep the ones you want.
              </span>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" onClick={() => setProposals(null)}>
                Discard
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => void acceptAll()}
                loading={create.isPending}
              >
                Add all
              </Button>
            </div>
          )}
          {view === 'week' && phone && (
            <DayStrip
              days={weekDays}
              selected={anchor}
              today={today}
              deadlines={deadlines}
              blocks={allBlocks}
              onPick={(d) => go(d)}
            />
          )}
          {view === 'week' ? (
            <TimeGrid
              ref={gridRef}
              days={gridDays}
              today={today}
              now={now}
              hourPx={phone ? 52 : 48}
              items={items}
              busy={busyDays}
              deadlines={deadlines}
              rest={rest}
              hideHead={phone}
              preview={preview}
              scrollKey={`${gridDays[0]}-${gridDays.length}`}
              canPlay={canPlay}
              onCreate={(day, start, end) => openDraft(day, start, end)}
              onOpen={(item) => {
                if (item.kind === 'proposal') return;
                if (item.block) setBlockDialog({ block: item.block });
              }}
              onMove={(item, day, start, end) => void moveTo(item, day, start, end)}
              onAccept={(key) => void accept(key)}
              onDiscard={(key) =>
                setProposals((ps) => {
                  const next = (ps ?? []).filter((p) => p.key !== key);
                  return next.length ? next : null;
                })
              }
              onPlay={play}
              onOpenDeadline={openDeadline}
            />
          ) : (
            <MonthGrid
              weeks={weeks}
              month={anchor.slice(0, 7)}
              today={today}
              deadlines={deadlines}
              minutes={minutesByDay(allBlocks, rangeDays)}
              rest={rest}
              onPickDay={(d) => go(d, 'week')}
              onOpenDeadline={openDeadline}
            />
          )}
        </Panel>
        {view === 'week' ? (
          <PlanTray
            items={tray}
            today={today}
            open={!weekOver}
            // Only where this server can connect one; otherwise the link leads nowhere.
            showConnect={!connected && feeds.isSuccess}
            onGrab={grabTray}
            onPick={pickTray}
          />
        ) : (
          <DueList
            deadlines={[...deadlines.entries()]
              .filter(([d]) => d.startsWith(anchor.slice(0, 7)))
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .flatMap(([, l]) => l)}
            today={today}
            onOpen={openDeadline}
          />
        )}
      </div>

      {trayDrag && (
        <div
          className="cal-drag-chip"
          style={
            {
              left: trayDrag.x + 14,
              top: trayDrag.y + 10,
              '--ev': trayDrag.item.color ?? undefined,
            } as CSSProperties
          }
          aria-hidden
        >
          {lookupTitle(trayDrag.item)} · {fmtMinutes(trayDrag.len)}
        </div>
      )}

      <BlockDialog
        open={blockDialog !== null}
        onClose={() => setBlockDialog(null)}
        nodes={list}
        block={blockDialog?.block ?? null}
        draft={blockDialog?.draft ?? null}
      />
      <StartSessionDialog
        open={startFor !== null}
        onClose={() => setStartFor(null)}
        nodes={list}
        node={startFor?.node ?? null}
        suggestedMinutes={startFor?.minutes ?? null}
        lockSubject
      />
      <NodeDialog
        open={editNode !== null}
        onClose={() => setEditNode(null)}
        node={editNode}
        nodes={list.filter((n) => !n.archived)}
      />
    </div>
  );
}

/** Where a block dragged in from the list starts: the pointer sits a little way into it. */
function landingMinutes(hit: GridHit, len: number): number {
  return Math.max(0, Math.min(24 * 60 - len, snap(hit.minutes - 15)));
}

/** A study plan is planned against its next topic; a task against itself. */
function lookupTitle(item: TrayItem): string {
  return item.kind === 'plan' && item.sub ? item.sub.replace(/ next$/, '') : item.title;
}

/** The week as a row of days on a phone, with a dot where something is due or planned. */
function DayStrip({
  days,
  selected,
  today,
  deadlines,
  blocks,
  onPick,
}: {
  days: string[];
  selected: string;
  today: string;
  deadlines: Map<string, Deadline[]>;
  blocks: PlannedBlock[];
  onPick: (day: string) => void;
}) {
  const tz = localTz();
  return (
    <div className="cal-strip" role="group" aria-label="Day">
      {days.map((d) => {
        const date = new Date(`${d}T12:00:00`);
        const due = (deadlines.get(d) ?? []).some((x) => !x.done);
        const planned = blocks.some(
          (b) => !b.cancelled && b.source === 'app' && toLocalDate(b.startAt, tz) === d,
        );
        return (
          <button
            key={d}
            type="button"
            className={`cal-strip-day${d === selected ? ' is-selected' : ''}${d === today ? ' is-today' : ''}`}
            aria-pressed={d === selected}
            aria-label={new Intl.DateTimeFormat(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            }).format(date)}
            onClick={() => onPick(d)}
          >
            <span className="cal-strip-name">
              {new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(date)}
            </span>
            <span className="cal-strip-num tabular">{date.getDate()}</span>
            <span className="cal-strip-dots" aria-hidden>
              {due && <span className="is-due" />}
              {planned && <span className="is-planned" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
