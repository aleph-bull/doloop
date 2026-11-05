import type { EndSummary } from './sessions';

/**
 * The summary each session ended with, kept a little while for the user's other device
 * (owner, 2026-11-04: ended on the phone, the computer "didnt save any of the video"). The
 * device that ends a session gets its summary back from the end; the other one, open on the
 * same session, only sees it stop. With this it fetches the same summary and shows its own
 * ending screen with its own stills, even when the two never linked. Kept in memory like the
 * camera link's notes: after a restart the other device shows its stills without the summary.
 */

/** Long enough for a device that was asleep or offline when the session ended. */
export const ENDING_TTL_MS = 30 * 60_000;
/** Plenty for one API; past this the oldest go. */
const MAX_KEPT = 5000;

export class SessionEndings {
  private kept = new Map<string, { at: number; summary: EndSummary }>();

  constructor(private now: () => number = Date.now) {}

  keep(userId: string, sessionId: string, summary: EndSummary): void {
    this.prune();
    const key = `${userId}:${sessionId}`;
    this.kept.delete(key);
    this.kept.set(key, { at: this.now(), summary });
    while (this.kept.size > MAX_KEPT) {
      const oldest = this.kept.keys().next().value;
      if (oldest === undefined) break;
      this.kept.delete(oldest);
    }
  }

  get(userId: string, sessionId: string): EndSummary | null {
    this.prune();
    return this.kept.get(`${userId}:${sessionId}`)?.summary ?? null;
  }

  private prune() {
    const t = this.now();
    // Oldest first, so the first one still fresh ends the sweep.
    for (const [key, v] of this.kept) {
      if (t - v.at < ENDING_TTL_MS) break;
      this.kept.delete(key);
    }
  }
}
