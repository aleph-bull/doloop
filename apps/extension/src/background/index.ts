import {
  advance,
  DEFAULT_SETTINGS,
  toLocalDate,
  viewTimer,
  type AdvanceOptions,
  type TimerEvent,
  type UserSettings,
} from '@komogon/core';
// The theme helpers alone: the package's index brings in React components and their CSS,
// which have no place in a service worker.
import { accentHexFor } from '../../../../packages/ui/src/theme';
import { api, ApiError, type ActiveSession } from '../lib/api';
import { blockOrigins } from '../lib/blocking';
import { get, getAll, remove, set, type Connection, type Snapshot } from '../lib/storage';

/**
 * Background service worker (Manifest V3).
 *  - Polls the active session, node list, and settings.
 *  - Keeps the badge showing remaining/elapsed minutes.
 *  - Applies declarativeNetRequest rules during work intervals when blocking is enabled.
 */

const ALARM_POLL = 'poll';
const ALARM_TICK = 'tick';
const POLL_MINUTES = 1;
const BLOCK_RULE_BASE = 1000;
/** The homepage, built in (`VITE_SITE_URL`): its /downloaded/ page greets a new install. */
const SITE_URL = import.meta.env.VITE_SITE_URL ?? 'http://localhost:5190';

/* ---------- Lifecycle ---------- */

chrome.runtime.onInstalled.addListener((details) => {
  void ensureAlarms();
  void poll();
  // Once, when it is first added: not on an update or a browser update.
  if (details.reason === 'install')
    void chrome.tabs.create({ url: new URL('/downloaded/', SITE_URL).href });
});
chrome.runtime.onStartup.addListener(() => {
  void ensureAlarms();
  void poll();
});

// Allowing the focus page on blocked sites changes their rules from Chrome's page to ours.
chrome.permissions.onAdded.addListener(() => void tick());
chrome.permissions.onRemoved.addListener(() => void tick());

async function ensureAlarms() {
  const existing = await chrome.alarms.getAll();
  if (!existing.some((a) => a.name === ALARM_POLL))
    chrome.alarms.create(ALARM_POLL, { periodInMinutes: POLL_MINUTES });
  if (!existing.some((a) => a.name === ALARM_TICK))
    chrome.alarms.create(ALARM_TICK, { periodInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_POLL) void poll();
  if (alarm.name === ALARM_TICK) void tick();
});

/* ---------- Messages from popup / content script ---------- */

type Msg =
  | { type: 'connect'; connection: Connection }
  | { type: 'disconnect' }
  | { type: 'poll' }
  | {
      type: 'start';
      /** A task, one occurrence of a routine, or neither (just the timer). */
      nodeId?: string;
      routineId?: string;
      routineDate?: string;
      mode: 'pomodoro' | 'unlimited' | 'scheduled';
      plannedEndAt?: string | null;
      showTimer?: boolean;
    }
  | { type: 'event'; sessionId: string; event: TimerEvent }
  | {
      type: 'end';
      sessionId: string;
      review: Record<string, unknown> | null;
      /** Completes the task, or ticks off a routine session's occurrence. */
      markComplete?: boolean;
    }
  | { type: 'count'; sessionId: string; counted: boolean }
  | { type: 'postable' }
  | { type: 'quote' }
  | { type: 'tick-routine'; routineId: string; date: string }
  | { type: 'untick-routine'; routineId: string; date: string }
  | { type: 'redeem'; rewardId: string };

chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
  handle(msg)
    .then((r) => sendResponse({ ok: true, result: r }))
    .catch((err: unknown) =>
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
  return true; // async
});

async function handle(msg: Msg): Promise<unknown> {
  switch (msg.type) {
    case 'connect': {
      // Another account signing in starts from nothing, not from the last one's snapshot.
      const before = await get('connection');
      if (before && before.email !== msg.connection.email) await remove('snapshot');
      await set({ connection: msg.connection, lastError: null });
      await ensureAlarms();
      await poll();
      return true;
    }
    case 'disconnect':
      await disconnect();
      return true;
    case 'poll':
      return poll();
    case 'start': {
      const res = await api.start({
        ...(msg.routineId
          ? { routineId: msg.routineId, routineDate: msg.routineDate }
          : msg.nodeId
            ? { nodeId: msg.nodeId }
            : {}),
        mode: msg.mode,
        plannedEndAt: msg.plannedEndAt ?? null,
        ...(msg.showTimer === undefined ? {} : { showTimer: msg.showTimer }),
      });
      await applyActive(res.active, res.now);
      return res.active;
    }
    case 'event': {
      const res = await api.event(msg.sessionId, msg.event);
      await applyActive(res.active.timer.phase === 'ended' ? null : res.active, res.now);
      if (res.active.timer.phase === 'ended') await poll();
      return res.active;
    }
    case 'end': {
      const res = await api.end(msg.sessionId, {
        review: msg.review,
        ...(msg.markComplete === undefined ? {} : { markComplete: msg.markComplete }),
      });
      await applyActive(null, new Date().toISOString());
      await poll();
      return res.summary;
    }
    case 'count':
      return api.count(msg.sessionId, msg.counted);
    case 'postable':
      return api.postable();
    case 'quote':
      return api.quote();
    case 'tick-routine': {
      const out = await api.tickRoutine(msg.routineId, msg.date);
      await refreshRoutines();
      await refreshRewards(); // the tick moved XP, so affordability may have changed
      return out;
    }
    case 'untick-routine': {
      const out = await api.untickRoutine(msg.routineId, msg.date);
      await refreshRoutines();
      await refreshRewards();
      return out;
    }
    case 'redeem': {
      const out = await api.redeem(msg.rewardId);
      await patchSnapshot((s) => {
        s.rewards = { items: out.rewards, xp: out.xp };
      });
      return out;
    }
  }
}

/**
 * Forget the account: signed out in the app, a token that stopped working, or Disconnect.
 * Their own background's picture and fonts go with it.
 */
async function disconnect(reason: string | null = null) {
  await remove('connection', 'snapshot', 'ownBackground', 'ownFonts', 'quote');
  await set({ lastError: reason });
  await clearBlocking();
  await chrome.action.setBadgeText({ text: '' });
}

/* ---------- Polling ---------- */

async function poll(): Promise<Snapshot | null> {
  const conn = await get('connection');
  if (!conn) return null;
  const previous = await get('snapshot');
  try {
    const [me, active, pace, nodes] = await Promise.all([
      api.me(),
      api.active(),
      api.pace(),
      api.nodes(),
    ]);
    const snapshot: Snapshot = {
      active: active.active
        ? {
            session: active.active.session,
            timer: active.active.timer,
            nodeTitle: active.active.nodeTitle,
            fetchedAt: active.now,
          }
        : null,
      settings: me.user.settings,
      timezone: me.user.timezone,
      plan: pace.plan.map((p) => ({
        nodeId: p.nodeId,
        title: p.title,
        suggestedMinutes: p.suggestedMinutes,
      })),
      nodes: nodes.nodes
        .filter((n) => !n.archived)
        .map((n) => ({
          id: n.id,
          title: n.title,
          kind: n.kind,
          parentId: n.parentId,
          completedAt: n.completedAt,
        })),
      // Carried over, then refreshed below: neither is allowed to fail the timer's poll.
      routines: previous?.routines ?? null,
      rewards: previous?.rewards ?? null,
      updatedAt: active.now,
    };
    await set({ snapshot, lastError: null });
    await Promise.all([
      refreshRoutines(toLocalDate(active.now, me.user.timezone)),
      refreshRewards(),
    ]);
    await tick();
    return snapshot;
  } catch (err) {
    // Signed out elsewhere, the token ran out, or the account was suspended: the popup goes
    // back to asking to open the app, which hands over a fresh sign-in.
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      await disconnect(err.status === 403 ? 'Account suspended' : 'Signed out');
      return null;
    }
    const message = err instanceof Error ? err.message : String(err);
    await set({ lastError: message });
    return null;
  }
}

/** Read-modify-write one slice of the stored snapshot. No-ops when nothing is stored yet. */
async function patchSnapshot(mutate: (s: Snapshot) => void): Promise<void> {
  const snapshot = await get('snapshot');
  if (!snapshot) return;
  mutate(snapshot);
  await set({ snapshot });
}

/**
 * Routines and rewards are secondary to the timer: a failure here leaves the last known
 * values in place rather than blanking the tabs or failing the poll.
 */
async function refreshRoutines(today?: string): Promise<void> {
  const date = today ?? (await get('snapshot'))?.routines?.today;
  if (!date) return;
  try {
    const r = await api.routines(date);
    await patchSnapshot((s) => {
      s.routines = {
        today: r.today,
        due: r.due,
        xpToday: r.xpToday,
        xpRemainingToday: r.xpRemainingToday,
      };
    });
  } catch {
    /* keep whatever we had */
  }
}

async function refreshRewards(): Promise<void> {
  try {
    const r = await api.rewards();
    await patchSnapshot((s) => {
      s.rewards = { items: r.rewards, xp: r.xp };
    });
  } catch {
    /* keep whatever we had */
  }
}

async function applyActive(active: ActiveSession | null, now: string) {
  const snapshot = await get('snapshot');
  if (!snapshot) return;
  snapshot.active = active
    ? { session: active.session, timer: active.timer, nodeTitle: active.nodeTitle, fetchedAt: now }
    : null;
  snapshot.updatedAt = now;
  await set({ snapshot });
  await tick();
}

function advanceOptions(
  settings: UserSettings | null,
  snapshot: Snapshot['active'],
): AdvanceOptions {
  // Core's defaults, never a local copy: a hand-written fallback drifted once already and
  // left the badge paused after every break while the server had looped back into work.
  const p = settings?.pomodoro ?? DEFAULT_SETTINGS.pomodoro;
  return {
    pomodoro: snapshot?.session.pomodoroConfigSnapshot ?? p,
    autoStartBreaks: p.autoStartBreaks,
    autoStartWork: p.autoStartWork,
  };
}

/* ---------- Badge + blocking tick ---------- */

const BREAK_BADGE = '#3f9f6b';
const PAUSED_BADGE = '#7b8494';

async function tick() {
  const { snapshot } = await getAll();
  const active = snapshot?.active ?? null;
  if (!active) {
    await chrome.action.setBadgeText({ text: '' });
    await clearBlocking();
    return;
  }
  const now = new Date().toISOString();
  const timer = advance(active.timer, now, advanceOptions(snapshot?.settings ?? null, active));
  if (timer.phase === 'ended') {
    // Scheduled session auto-ended: let the server finalize it on the next read.
    await poll();
    return;
  }
  const view = viewTimer(timer, now);
  const minutes =
    timer.mode === 'unlimited'
      ? Math.floor(view.workSeconds / 60)
      : view.phaseRemainingSeconds !== null
        ? Math.ceil(view.phaseRemainingSeconds / 60)
        : Math.floor(view.phaseElapsedSeconds / 60);
  const accent = accentHexFor(snapshot?.settings?.theme.accent ?? DEFAULT_SETTINGS.theme.accent);
  const color =
    timer.phase === 'work' ? accent : timer.phase === 'paused' ? PAUSED_BADGE : BREAK_BADGE;
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
  // A hidden timer stays hidden here too.
  const text =
    timer.phase === 'paused' ? '||' : timer.showTimer ? String(Math.max(0, minutes)) : ' ';
  await chrome.action.setBadgeText({ text });

  const settings = snapshot?.settings;
  if (
    settings?.blocking.enabled &&
    timer.phase === 'work' &&
    settings.blocking.domains.length > 0
  ) {
    await applyBlocking(settings.blocking.domains, timer.phaseEndsAt);
  } else {
    await clearBlocking();
  }
}

/* ---------- Site blocking (declarativeNetRequest) ---------- */

/**
 * A site the extension may read goes to the focus page; any other is blocked outright with
 * Chrome's own page, since Chrome ignores a redirect on a site it can't read (found
 * 2026-11-04: blocking had never worked for that reason).
 */
async function applyBlocking(domains: string[], until: string | null) {
  const blocked = chrome.runtime.getURL('src/blocked/index.html');
  const list = domains.slice(0, 200);
  const allowed = await Promise.all(
    list.map((d) => chrome.permissions.contains({ origins: blockOrigins(d) })),
  );
  const rules: chrome.declarativeNetRequest.Rule[] = list.map((domain, i) => ({
    id: BLOCK_RULE_BASE + i,
    priority: 1,
    action: allowed[i]
      ? {
          type: 'redirect' as chrome.declarativeNetRequest.RuleActionType,
          redirect: {
            url: `${blocked}?until=${encodeURIComponent(until ?? '')}&site=${encodeURIComponent(domain)}`,
          },
        }
      : { type: 'block' as chrome.declarativeNetRequest.RuleActionType },
    condition: {
      urlFilter: `||${domain}`,
      resourceTypes: ['main_frame' as chrome.declarativeNetRequest.ResourceType],
    },
  }));
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  // Every minute's tick asks again; only a change is written.
  if (JSON.stringify(sortRules(existing)) === JSON.stringify(sortRules(rules))) return;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: rules,
  });
}

function sortRules(rules: chrome.declarativeNetRequest.Rule[]) {
  return [...rules]
    .sort((a, b) => a.id - b.id)
    .map((r) => ({
      id: r.id,
      action: r.action.type,
      url: r.action.redirect?.url ?? null,
      filter: r.condition.urlFilter,
    }));
}

async function clearBlocking() {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  if (existing.length === 0) return;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
  });
}
