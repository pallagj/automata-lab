import type { Log, RateDecision, RateLimiter } from "../../application/ports";

export interface Window {
  limit: number;
  ms: number;
}

/** A window's count; `logged` once its first refusal is in the log. */
interface Count {
  start: number;
  count: number;
  logged: boolean;
}

const minutes = (w: Window) => `${w.ms / 60_000} min`;

/**
 * Fixed windows, counted in memory: at most `perKey.limit` requests of one key and
 * `total.limit` of all keys together in each window. A server restart forgets the counts.
 * The first refusal of a window goes to the log; the rest of the window's would only flood it.
 */
export function windowRateLimiter(opts: { perKey: Window; total: Window; log: Log; now?: () => number }): RateLimiter {
  const now = opts.now ?? Date.now;
  const keys = new Map<string, Count>();
  let total: Count = { start: -Infinity, count: 0, logged: false };

  const retryAfter = (start: number, w: Window, t: number) => Math.max(1, Math.ceil((start + w.ms - t) / 1000));

  return {
    take(key): RateDecision {
      const t = now();
      if (t - total.start >= opts.total.ms) {
        total = { start: t, count: 0, logged: false };
        // a new total window: the keys whose windows have ended are forgotten
        for (const [k, w] of keys) if (t - w.start >= opts.perKey.ms) keys.delete(k);
      }
      let mine = keys.get(key);
      if (!mine || t - mine.start >= opts.perKey.ms) mine = { start: t, count: 0, logged: false };
      if (mine.count >= opts.perKey.limit) {
        const retryAfterSeconds = retryAfter(mine.start, opts.perKey, t);
        if (!mine.logged)
          opts.log.warn(
            `rate limit: ${key} made ${opts.perKey.limit} requests in ${minutes(opts.perKey)}; refused for ${retryAfterSeconds} s`
          );
        mine.logged = true;
        return { ok: false, retryAfterSeconds };
      }
      if (total.count >= opts.total.limit) {
        const retryAfterSeconds = retryAfter(total.start, opts.total, t);
        if (!total.logged)
          opts.log.warn(
            `rate limit: ${opts.total.limit} requests from everyone together in ${minutes(opts.total)}; all refused for ${retryAfterSeconds} s`
          );
        total.logged = true;
        return { ok: false, retryAfterSeconds };
      }
      mine.count++;
      total.count++;
      keys.set(key, mine);
      return { ok: true };
    }
  };
}

/** A limiter that allows everything: for tests and local runs. */
export const unlimited: RateLimiter = { take: () => ({ ok: true }) };
