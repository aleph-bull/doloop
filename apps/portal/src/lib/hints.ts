import { useCallback, useMemo } from 'react';
import { useMe, useUpdateSettings } from './queries';

/**
 * One-off prompts and hints the user has closed for good (spec §13).
 *
 * Dismissals live on the user's settings rather than in localStorage: closing a prompt
 * means "never again", and a new browser, a second device or a cleared cache is not the
 * user asking to be shown it a second time. localStorage is kept only as a mirror, so a
 * dismissal takes effect immediately and survives the moment before /api/me returns.
 */
export type HintKey =
  'rest-days' | 'calendar' | 'xp' | 'freezes' | 'blocking' | 'name' | 'dashboard' | 'grades';

const KEY = 'doloop.hints.dismissed';

function readLocal(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(keys: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(keys));
  } catch {
    /* private mode, blocked storage: the server copy is the one that matters */
  }
}

export function useHints() {
  const me = useMe();
  const update = useUpdateSettings();
  const settings = me.data?.user.settings;
  // Defensive: settings arrive as JSON, and a cached copy written by an older build may
  // still hold a non-list here.
  const server = useMemo(
    () => (Array.isArray(settings?.dismissed) ? settings.dismissed : []),
    [settings],
  );

  const isDismissed = useCallback(
    (key: HintKey) => server.includes(key) || readLocal().includes(key),
    [server],
  );

  const dismiss = useCallback(
    (key: HintKey) => {
      if (isDismissed(key)) return;
      // Mirror locally first so the hint disappears on click even if the request is slow,
      // then persist. Union with what the server already has, never a blind overwrite.
      writeLocal([...new Set([...readLocal(), key])]);
      update.mutate({ dismissed: [...new Set([...server, key])] });
    },
    [isDismissed, server, update],
  );

  return { isDismissed, dismiss };
}
