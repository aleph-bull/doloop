import { addDays, startOfWeekMonday, toLocalDate, type PlannedBlock } from '@doloop/core';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button, Chip, Glass, Panel, Spinner, useToast } from '@doloop/ui';
import { BlockDialog } from '../components/BlockDialog';
import { ErrorPanel } from '../components/ErrorState';
import { api } from '../lib/api';
import { fmtDate, fmtMinutes, fmtTime } from '../lib/format';
import {
  useBlocks,
  useBusy,
  useCreateBlock,
  useMe,
  useNodes,
  usePace,
  useUnlinkedBlocks,
} from '../lib/queries';

const HOUR_START = 6;
const HOUR_END = 24;
const HOUR_PX = 44;
const SNAP_MIN = 15;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function localDayStart(date: string): Date {
  return new Date(`${date}T00:00:00`);
}

/** Minutes since local midnight for an ISO instant, clamped to the visible range. */
function minutesInto(iso: string, date: string): number {
  const ms = Date.parse(iso) - localDayStart(date).getTime();
  return ms / 60_000;
}

export function Calendar() {
  const me = useMe();
  const nodes = useNodes();
  const pace = usePace();
  const create = useCreateBlock();
  const { toast } = useToast();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = toLocalDate(new Date(), tz);
  const [weekStart, setWeekStart] = useState(() => startOfWeekMonday(today));
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const from = localDayStart(days[0]!).toISOString();
  const to = new Date(localDayStart(days[6]!).getTime() + 86_400_000).toISOString();
  const blocks = useBlocks(from, to);
  const busy = useBusy(from, to);
  const unlinked = useUnlinkedBlocks();
  const [dialog, setDialog] = useState<{
    block?: PlannedBlock | null;
    draft?: { startAt: string; endAt: string; nodeId?: string | null } | null;
  } | null>(null);
  const [drag, setDrag] = useState<{ day: string; from: number; to: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const failed = [nodes, blocks, me].find((q) => q.isError);
  if (failed && (!nodes.data || !blocks.data || !me.data))
    return (
      <ErrorPanel
        message={
          failed.error instanceof Error ? failed.error.message : 'Could not load the calendar.'
        }
        onRetry={() => {
          void nodes.refetch();
          void blocks.refetch();
          void me.refetch();
        }}
      />
    );
  if (!nodes.data || !blocks.data || !me.data)
    return (
      <div className="flex justify-center p-12">
        <Spinner />
      </div>
    );

  const list = nodes.data.nodes;
  const byId = new Map(list.map((n) => [n.id, n]));
  const planTop = pace.data?.plan[0];

  const minutesFromEvent = (e: React.MouseEvent, col: HTMLElement) => {
    const rect = col.getBoundingClientRect();
    const raw = HOUR_START * 60 + ((e.clientY - rect.top) / HOUR_PX) * 60;
    return Math.max(
      HOUR_START * 60,
      Math.min(HOUR_END * 60, Math.round(raw / SNAP_MIN) * SNAP_MIN),
    );
  };

  const onMouseDown = (day: string) => (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-block]')) return;
    const m = minutesFromEvent(e, e.currentTarget);
    setDrag({ day, from: m, to: m + 60 });
  };
  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!drag) return;
    const m = minutesFromEvent(e, e.currentTarget);
    setDrag({ ...drag, to: Math.max(drag.from + SNAP_MIN, m) });
  };
  const onMouseUp = () => {
    if (!drag) return;
    const startAt = new Date(localDayStart(drag.day).getTime() + drag.from * 60_000).toISOString();
    const endAt = new Date(localDayStart(drag.day).getTime() + drag.to * 60_000).toISOString();
    setDrag(null);
    setDialog({ draft: { startAt, endAt, nodeId: planTop?.nodeId ?? null } });
  };

  const suggest = async () => {
    if (!planTop) return toast('Nothing to plan yet. Add a task with an estimate and due date.');
    try {
      const r = await api.suggestSlots(planTop.suggestedMinutes, new Date().toISOString(), 7);
      const slot = r.slots[0];
      if (!slot) return toast('No free slot found in the next week.');
      await create.mutateAsync({ nodeId: planTop.nodeId, startAt: slot.start, endAt: slot.end });
      toast(`Planned ${planTop.title} for ${fmtDate(slot.start)} at ${fmtTime(slot.start)}`, {
        tone: 'ok',
      });
      setWeekStart(startOfWeekMonday(toLocalDate(slot.start, tz)));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not suggest');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl">Calendar</h1>
          <p className="muted text-sm mt-1">
            Drag on the grid to plan a block. Blocks fill a task's planned hours.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Button
            size="sm"
            icon
            aria-label="Previous week"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
          >
            <ChevronLeft size={16} aria-hidden />
          </Button>
          <Button size="sm" onClick={() => setWeekStart(startOfWeekMonday(today))}>
            This week
          </Button>
          <Button
            size="sm"
            icon
            aria-label="Next week"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
          >
            <ChevronRight size={16} aria-hidden />
          </Button>
          <Button size="sm" onClick={() => setDialog({ draft: null })}>
            New block
          </Button>
          <Button size="sm" variant="primary" onClick={suggest} loading={create.isPending}>
            <Sparkles size={14} aria-hidden /> Suggest a block
          </Button>
        </div>
      </div>

      {unlinked.data && unlinked.data.blocks.length > 0 && (
        <Glass className="p-4 text-sm flex items-center gap-3 flex-wrap">
          <span className="flex-1">
            {unlinked.data.blocks.length} event{unlinked.data.blocks.length === 1 ? '' : 's'} from
            your Study calendar {unlinked.data.blocks.length === 1 ? 'is' : 'are'} not linked to a
            task yet.
          </span>
          <Button size="sm" onClick={() => setDialog({ block: unlinked.data!.blocks[0] })}>
            Link
          </Button>
        </Glass>
      )}

      <Panel className="p-3 overflow-x-auto">
        <div
          className="grid"
          style={{ gridTemplateColumns: '48px repeat(7, minmax(110px, 1fr))', minWidth: 820 }}
        >
          <div />
          {days.map((d, i) => (
            <div
              key={d}
              className="text-center text-sm pb-2"
              style={{ color: d === today ? 'var(--accent)' : 'var(--fg-muted)' }}
            >
              <div className="font-medium">{DAYS[i]}</div>
              <div className="tabular text-xs">{fmtDate(`${d}T12:00:00`)}</div>
            </div>
          ))}
          <div className="relative" style={{ height: (HOUR_END - HOUR_START) * HOUR_PX }}>
            {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => (
              <div
                key={i}
                className="absolute right-2 text-xs subtle tabular"
                style={{ top: i * HOUR_PX - 7 }}
              >
                {`${HOUR_START + i}:00`}
              </div>
            ))}
          </div>
          {days.map((d) => (
            <div
              key={d}
              ref={gridRef}
              className="relative select-none"
              style={{
                height: (HOUR_END - HOUR_START) * HOUR_PX,
                borderLeft: '1px solid var(--border)',
                cursor: 'crosshair',
              }}
              onMouseDown={onMouseDown(d)}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={() => drag && drag.day === d && onMouseUp()}
              role="presentation"
            >
              {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => (
                <div
                  key={i}
                  className="absolute left-0 right-0"
                  style={{ top: i * HOUR_PX, borderTop: '1px solid var(--border)' }}
                />
              ))}
              {(busy.data?.busy ?? [])
                .filter((b) => toLocalDate(b.start, tz) === d || toLocalDate(b.end, tz) === d)
                .map((b, i) => {
                  const top = Math.max(0, minutesInto(b.start, d) - HOUR_START * 60);
                  const bottom = Math.min(
                    (HOUR_END - HOUR_START) * 60,
                    minutesInto(b.end, d) - HOUR_START * 60,
                  );
                  if (bottom <= top) return null;
                  return (
                    <div
                      key={i}
                      className="absolute left-1 right-1 rounded-md"
                      title="Busy (Google Calendar)"
                      style={{
                        top: (top / 60) * HOUR_PX,
                        height: ((bottom - top) / 60) * HOUR_PX,
                        background:
                          'repeating-linear-gradient(135deg, var(--border) 0 4px, transparent 4px 10px)',
                        pointerEvents: 'none',
                      }}
                    />
                  );
                })}
              {blocks.data.blocks
                .filter((b) => !b.cancelled && toLocalDate(b.startAt, tz) === d)
                .map((b) => {
                  const top = Math.max(0, minutesInto(b.startAt, d) - HOUR_START * 60);
                  const bottom = Math.min(
                    (HOUR_END - HOUR_START) * 60,
                    minutesInto(b.endAt, d) - HOUR_START * 60,
                  );
                  const node = b.nodeId ? byId.get(b.nodeId) : null;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      data-block
                      className="absolute left-1 right-1 rounded-md text-left px-2 py-1 text-xs overflow-hidden"
                      style={{
                        top: (top / 60) * HOUR_PX,
                        height: Math.max(18, ((bottom - top) / 60) * HOUR_PX - 2),
                        background:
                          node?.color ?? (b.nodeId ? 'var(--accent)' : 'var(--fg-subtle)'),
                        color: '#fff',
                        border:
                          b.source === 'google' ? '1px dashed rgb(255 255 255 / 0.7)' : 'none',
                      }}
                      onClick={() => setDialog({ block: b })}
                      aria-label={`${node?.title ?? 'Unlinked block'} ${fmtTime(b.startAt)} to ${fmtTime(b.endAt)}`}
                    >
                      <div className="font-medium truncate">{node?.title ?? 'Link to a task'}</div>
                      <div className="opacity-80 tabular">
                        {fmtTime(b.startAt)}–{fmtTime(b.endAt)}
                      </div>
                    </button>
                  );
                })}
              {drag && drag.day === d && (
                <div
                  className="absolute left-1 right-1 rounded-md"
                  style={{
                    top: ((drag.from - HOUR_START * 60) / 60) * HOUR_PX,
                    height: ((drag.to - drag.from) / 60) * HOUR_PX,
                    background: 'var(--accent-soft)',
                    border: '1px dashed var(--accent)',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </Panel>

      {pace.data && (
        <section className="flex flex-col gap-2" aria-label="Planned vs needed">
          <h2 className="text-lg">Planned vs needed</h2>
          <div className="pill-row">
            {list
              .filter(
                (n) =>
                  n.kind !== 'course' &&
                  !n.completedAt &&
                  pace.data!.pace[n.id]?.remainingMinutes != null,
              )
              .slice(0, 12)
              .map((n) => {
                const p = pace.data!.pace[n.id]!;
                const planned = pace.data!.plannedMinutes[n.id] ?? 0;
                const short = (p.remainingMinutes ?? 0) > planned;
                return (
                  <Chip
                    key={n.id}
                    tone={short ? 'warn' : 'ok'}
                    title={`${n.title}: planned ${fmtMinutes(planned)}, need ${fmtMinutes(p.remainingMinutes)}`}
                  >
                    {n.title}: planned {fmtMinutes(planned)} / need {fmtMinutes(p.remainingMinutes)}
                  </Chip>
                );
              })}
          </div>
          <p className="muted text-sm">
            Connect Google Calendar in <Link to="/settings#calendar">Settings</Link> to see busy
            times here and sync blocks both ways.
          </p>
        </section>
      )}

      <BlockDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        nodes={list}
        block={dialog?.block ?? null}
        draft={dialog?.draft ?? null}
      />
    </div>
  );
}
