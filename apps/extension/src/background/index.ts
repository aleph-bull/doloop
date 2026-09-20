import {
  advance,
  viewTimer,
  type AdvanceOptions,
  type TimerEvent,
  type UserSettings,
} from '@doloop/core';
import { api, ApiError, type ActiveSession } from '../lib/api';
import { get, getAll, remove, set, type Connection, type Snapshot } from '../lib/storage';

/**
 * Background service worker (Manifest V3).
 *  - Polls the active session, node list, and settings.
 *  - Keeps the badge showing remaining/elapsed minutes.
 *  - Reports idleness via chrome.idle and asks "Still studying?" through a notification.
 *  - Applies declarativeNetRequest rules during work intervals when blocking is enabled.
 */

const ALARM_POLL = 'poll';
const ALARM_TICK = 'tick';
const POLL_MINUTES = 1;
const NOTIF_IDLE = 'doloop-idle';
const BLOCK_RULE_BASE = 1000;

/* ---------- Lifecycle ---------- */

chrome.runtime.onInstalled.addListener(() => {
  void ensureAlarms();
  void poll();
});
chrome.runtime.onStartup.addListener(() => {
  void ensureAlarms();
  void poll();
});

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
      nodeId: string;
      mode: 'pomodoro' | 'unlimited' | 'scheduled';
      plannedEndAt?: string | null;
    }
  | { type: 'event'; sessionId: string; event: TimerEvent }
  | { type: 'end'; sessionId: string; review: Record<string, unknown> | null }
  | { type: 'quote' };

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
    case 'connect':
      await set({ connection: msg.connection, lastError: null });
      await ensureAlarms();
      await poll();
      return true;
    case 'disconnect':
      await remove('connection', 'snapshot', 'idlePrompt');
      await clearBlocking();
      await chrome.action.setBadgeText({ text: '' });
      return true;
    case 'poll':
      return poll();
    case 'start': {
      const res = await api.start({
        nodeId: msg.nodeId,
        mode: msg.mode,
        plannedEndAt: msg.plannedEndAt ?? null,
      });
      await applyActive(res.active, res.now);
      return res.active;
    }
    case 'event': {
      const res = await api.event(msg.sessionId, msg.event);
      if (msg.event.type === 'idle-answer') await set({ idlePrompt: null });
      await applyActive(res.active.timer.phase === 'ended' ? null : res.active, res.now);
      if (res.active.timer.phase === 'ended') await poll();
      return res.active;
    }
    case 'end': {
      const res = await api.end(msg.sessionId, { review: msg.review });
      await applyActive(null, new Date().toISOString());
      await poll();
      return res.summary;
    }
    case 'quote':
      return api.quote();
  }
}

/* ---------- Polling ---------- */

async function poll(): Promise<Snapshot | null> {
  const conn = await get('connection');
  if (!conn) return null;
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
        .filter((n) => n.kind !== 'course' && !n.completedAt)
        .map((n) => ({ id: n.id, title: n.title, kind: n.kind, completedAt: n.completedAt })),
      updatedAt: active.now,
    };
    await set({ snapshot, lastError: null });
    // Uploaded background: download once per change, drop when no longer in use.
    const wantsUpload =
      me.user.settings.theme.customBackgroundUrl === 'upload' && me.backgroundUpdatedAt;
    const cached = await get('customBackground');
    if (!wantsUpload) {
      if (cached) await set({ customBackground: null });
    } else if (!cached || cached.updatedAt !== me.backgroundUpdatedAt) {
      try {
        const bg = await api.background();
        await set({ customBackground: { dataUrl: bg.dataUrl, updatedAt: bg.updatedAt } });
      } catch {
        /* keep whatever we had */
      }
    }
    if (!snapshot.active) await set({ idlePrompt: null });
    await syncIdleDetection(snapshot.settings);
    await tick();
    return snapshot;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await set({ lastError: message });
    if (err instanceof ApiError && err.status === 401) {
      await chrome.action.setBadgeText({ text: '!' });
      await chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    }
    return null;
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
  const p = settings?.pomodoro ?? {
    workMin: 25,
    shortBreakMin: 5,
    longBreakMin: 15,
    cyclesBeforeLong: 4,
    autoStartBreaks: true,
    autoStartWork: false,
    showTimerByDefault: true,
  };
  return {
    pomodoro: snapshot?.session.pomodoroConfigSnapshot ?? p,
    autoStartBreaks: p.autoStartBreaks,
    autoStartWork: p.autoStartWork,
  };
}

/* ---------- Badge + blocking tick ---------- */

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
  const colors: Record<string, string> = {
    work: '#6366f1',
    'short-break': '#22c55e',
    'long-break': '#22c55e',
    paused: '#94a3b8',
    idle: '#f59e0b',
  };
  await chrome.action.setBadgeBackgroundColor({ color: colors[timer.phase] ?? '#6366f1' });
  await chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
  await chrome.action.setBadgeText({
    text: timer.phase === 'paused' ? '||' : String(Math.max(0, minutes)),
  });

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

async function applyBlocking(domains: string[], until: string | null) {
  const blocked = chrome.runtime.getURL('src/blocked/index.html');
  const rules: chrome.declarativeNetRequest.Rule[] = domains.slice(0, 200).map((domain, i) => ({
    id: BLOCK_RULE_BASE + i,
    priority: 1,
    action: {
      type: 'redirect' as chrome.declarativeNetRequest.RuleActionType,
      redirect: {
        url: `${blocked}?until=${encodeURIComponent(until ?? '')}&site=${encodeURIComponent(domain)}`,
      },
    },
    condition: {
      urlFilter: `||${domain}`,
      resourceTypes: ['main_frame' as chrome.declarativeNetRequest.ResourceType],
    },
  }));
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: rules,
  });
}

async function clearBlocking() {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  if (existing.length === 0) return;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
  });
}

/* ---------- Idle detection (chrome.idle) ---------- */

let idleIntervalSeconds = 0;

async function syncIdleDetection(settings: UserSettings | null) {
  const wanted = settings?.idle.enabled ? Math.max(15, settings.idle.thresholdMin * 60) : 0;
  if (wanted === idleIntervalSeconds) return;
  idleIntervalSeconds = wanted;
  if (wanted > 0) chrome.idle.setDetectionInterval(wanted);
}

chrome.idle.onStateChanged.addListener((state) => {
  void onIdleState(state);
});

async function onIdleState(state: 'active' | 'idle' | 'locked') {
  const { snapshot, idlePrompt } = await getAll();
  const active = snapshot?.active;
  if (!active || !snapshot?.settings?.idle.enabled) return;
  if (state === 'idle' || state === 'locked') {
    if (active.timer.phase !== 'work' || idlePrompt) return;
    // chrome.idle fires once the interval has elapsed, so idleness began that long ago.
    const idleSince = new Date(Date.now() - idleIntervalSeconds * 1000).toISOString();
    try {
      const res = await api.event(active.session.id, { type: 'idle-start', idleSince });
      await applyActive(res.active, res.now);
      await set({ idlePrompt: { sessionId: active.session.id, since: idleSince } });
    } catch {
      /* next poll will reconcile */
    }
  } else if (state === 'active') {
    if (!idlePrompt) return;
    chrome.notifications.create(NOTIF_IDLE, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Still studying?',
      message: `The work clock paused while you were away. Time since then is idle, not work.`,
      buttons: [{ title: 'Yes, continue' }, { title: 'No, end session' }],
      requireInteraction: true,
    });
  }
}

chrome.notifications.onButtonClicked.addListener((id, buttonIndex) => {
  if (id !== NOTIF_IDLE) return;
  void answerIdle(buttonIndex === 0);
});
chrome.notifications.onClicked.addListener((id) => {
  if (id === NOTIF_IDLE) void answerIdle(true);
});

async function answerIdle(stillStudying: boolean) {
  const prompt = await get('idlePrompt');
  chrome.notifications.clear(NOTIF_IDLE);
  if (!prompt) return;
  try {
    const res = await api.event(prompt.sessionId, { type: 'idle-answer', stillStudying });
    await set({ idlePrompt: null });
    await applyActive(res.active.timer.phase === 'ended' ? null : res.active, res.now);
    if (res.active.timer.phase === 'ended') await poll();
  } catch {
    await set({ idlePrompt: null });
    await poll();
  }
}
