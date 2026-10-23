import type { RateDecision, RateLimiter } from "../../application/ports";

export interface Window {
  limit: number;
  ms: number;
}

/**
 * Fixed windows, counted in memory: at most `perKey.limit` requests of one key and
 * `total.limit` of all keys together in each window. A server restart forgets the counts.
 */
export function windowRateLimiter(opts: { perKey: Window; total: Window; now?: () => number }): RateLimiter {
  const now = opts.now ?? Date.now;
  const keys = new Map<string, { start: number; count: number }>();
  let total = { start: -Infinity, count: 0 };

  const retryAfter = (start: number, w: Window, t: number) => Math.max(1, Math.ceil((start + w.ms - t) / 1000));

  return {
    take(key): RateDecision {
      const t = now();
      if (t - total.start >= opts.total.ms) {
        total = { start: t, count: 0 };
        // a new total window: the keys whose windows have ended are forgotten
        for (const [k, w] of keys) if (t - w.start >= opts.perKey.ms) keys.delete(k);
      }
      let mine = keys.get(key);
      if (!mine || t - mine.start >= opts.perKey.ms) mine = { start: t, count: 0 };
      if (mine.count >= opts.perKey.limit) return { ok: false, retryAfterSeconds: retryAfter(mine.start, opts.perKey, t) };
      if (total.count >= opts.total.limit) return { ok: false, retryAfterSeconds: retryAfter(total.start, opts.total, t) };
      mine.count++;
      total.count++;
      keys.set(key, mine);
      return { ok: true };
    }
  };
}

/** A limiter that allows everything: for tests and local runs. */
export const unlimited: RateLimiter = { take: () => ({ ok: true }) };
