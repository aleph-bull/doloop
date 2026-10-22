import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button, Input, Modal, Toggle, useToast } from '@komogon/ui';
import { api, type CalendarFeed, type CalendarFeedResponse } from '../lib/api';
import { fmtAgo } from '../lib/format';
import { keys, useCalendarFeeds } from '../lib/queries';
import './calendar-feeds.css';

/** What an added calendar's events can change: the week, the To plan list, tasks. */
const TOUCHED = [keys.feeds, ['blocks'], keys.nodes, keys.pace, keys.commitments] as const;

/** Refreshes everything an added or changed calendar can touch. */
export function useRefreshFeeds() {
  const qc = useQueryClient();
  return () => {
    for (const key of TOUCHED) void qc.invalidateQueries({ queryKey: key });
  };
}

/** The toast after a calendar is added. */
export function feedAddedMessage(r: CalendarFeedResponse): string {
  return `Added ${r.feed.name}. ${eventsLabel(r.feed.events)}.`;
}

/**
 * Calendars added by their link (.ics). Works with any calendar app and needs no setup on
 * the server, unlike connecting Google or Outlook.
 */
export function CalendarFeedsSettings() {
  const feeds = useCalendarFeeds();
  const refresh = useRefreshFeeds();
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const list = feeds.data?.feeds ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1">
          <div className="font-medium">Your calendars</div>
          <div className="field-hint">
            {list.length === 0
              ? 'Add your timetable, or any calendar from Google, Outlook, iCloud or Moodle, by its link.'
              : 'Their events show on your week, so plans go around them.'}
          </div>
        </div>
        <Button
          variant={list.length === 0 ? 'primary' : 'secondary'}
          onClick={() => setAdding(true)}
        >
          <Plus size={15} aria-hidden /> Add a calendar
        </Button>
      </div>
      {feeds.isError && (
        <div className="flex items-center gap-2">
          <span className="field-hint">Couldn’t load your calendars.</span>
          <Button size="sm" variant="ghost" onClick={() => void feeds.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {list.length > 0 && (
        <ul className="feed-list">
          {list.map((feed) => (
            <FeedRow key={feed.id} feed={feed} onChanged={refresh} />
          ))}
        </ul>
      )}
      {adding && (
        <AddCalendarDialog
          onClose={() => setAdding(false)}
          onAdded={(r) => {
            setAdding(false);
            refresh();
            toast(feedAddedMessage(r), { tone: 'ok' });
          }}
        />
      )}
    </div>
  );
}

function eventsLabel(n: number): string {
  return n === 0 ? 'No events coming up' : `${n} event${n === 1 ? '' : 's'}`;
}

function FeedRow({ feed, onChanged }: { feed: CalendarFeed; onChanged: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<null | 'sync' | 'tasks' | 'remove' | 'name'>(null);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState<string | null>(null);

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<unknown>) => {
    setBusy(kind);
    try {
      await fn();
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const saveName = () => {
    const next = (name ?? '').trim();
    setName(null);
    if (!next || next === feed.name) return;
    void run('name', () => api.updateCalendarFeed(feed.id, { name: next.slice(0, 60) }));
  };

  return (
    <li className="feed-row">
      <div className="feed-row-head">
        <div className="feed-row-text">
          {name === null ? (
            <div className="feed-row-name">
              <span className="truncate">{feed.name}</span>
              <button
                type="button"
                className="feed-row-rename"
                aria-label={`Rename ${feed.name}`}
                onClick={() => setName(feed.name)}
              >
                <Pencil size={13} aria-hidden />
              </button>
            </div>
          ) : (
            <form
              className="feed-row-name-edit"
              onSubmit={(e) => {
                e.preventDefault();
                saveName();
              }}
            >
              <Input
                autoFocus
                value={name}
                maxLength={60}
                aria-label="Calendar name"
                onChange={(e) => setName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setName(null);
                }}
              />
              <Button size="sm" icon type="submit" aria-label="Save the name">
                <Check size={14} aria-hidden />
              </Button>
            </form>
          )}
          <div className="field-hint">
            {feed.host} · {eventsLabel(feed.events)}
            {feed.lastSyncAt && <> · Updated {fmtAgo(feed.lastSyncAt).toLowerCase()}</>}
          </div>
          {feed.lastError && (
            <div className="feed-row-error" role="status">
              {feed.lastError}
            </div>
          )}
        </div>
        <div className="feed-row-actions">
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={`Refresh ${feed.name}`}
            title="Refresh now"
            loading={busy === 'sync'}
            onClick={() =>
              void run('sync', async () => {
                const r = await api.syncCalendarFeed(feed.id);
                if (r.feed.lastError) toast(r.feed.lastError);
                else toast(`${r.feed.name} is up to date.`, { tone: 'ok' });
              })
            }
          >
            <RefreshCw size={14} aria-hidden />
          </Button>
          {confirming ? (
            <>
              <Button
                variant="danger"
                size="sm"
                loading={busy === 'remove'}
                onClick={() =>
                  void run('remove', async () => {
                    await api.removeCalendarFeed(feed.id);
                    toast(`Removed ${feed.name}. Tasks made from it are kept.`);
                  })
                }
              >
                Remove
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label={`Remove ${feed.name}`}
              title="Remove"
              onClick={() => setConfirming(true)}
            >
              <Trash2 size={14} aria-hidden />
            </Button>
          )}
        </div>
      </div>
      <Toggle
        checked={feed.tasks}
        disabled={busy === 'tasks'}
        onChange={(v) => void run('tasks', () => api.updateCalendarFeed(feed.id, { tasks: v }))}
        label="Turn exams and deadlines into tasks"
      />
    </li>
  );
}

export function AddCalendarDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (r: CalendarFeedResponse) => void;
}) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [tasks, setTasks] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!url.trim()) return setError('Paste the calendar’s link first.');
    setBusy(true);
    setError(null);
    try {
      onAdded(
        await api.addCalendarFeed({
          url: url.trim(),
          name: name.trim() || undefined,
          tasks,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t add that calendar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      phone="full"
      open
      onClose={onClose}
      title="Add a calendar"
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!url.trim()} onClick={add}>
            Add
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Input
          autoFocus
          label="Calendar link"
          placeholder="webcal://… or https://….ics"
          value={url}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Input
          label="Name"
          placeholder="Uses the calendar’s own name if left empty"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />
        <Toggle
          checked={tasks}
          onChange={setTasks}
          label="Turn exams and deadlines into tasks"
          description="Course codes like CSC108 group them under the course."
        />
        <details className="feed-help">
          <summary>Where do I find the link?</summary>
          <ul>
            <li>
              <strong>Google Calendar:</strong> Settings, pick the calendar, then copy “Secret
              address in iCal format”.
            </li>
            <li>
              <strong>Outlook:</strong> Settings › Calendar › Shared calendars › Publish a calendar,
              then copy the ICS link.
            </li>
            <li>
              <strong>iPhone (iCloud):</strong> in Calendars, tap ⓘ next to the calendar, turn on
              Public Calendar and share the link.
            </li>
            <li>
              <strong>Moodle, Canvas, Quercus:</strong> look for Export calendar or Calendar feed on
              the calendar page.
            </li>
          </ul>
          <p>The link is kept private and only used to read the calendar.</p>
        </details>
        {error && (
          <p className="text-sm" style={{ color: 'var(--status-bad)' }} role="alert">
            {error}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
