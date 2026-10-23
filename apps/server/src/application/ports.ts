import type { Snapshot } from "../domain/snapshot";

/** What the use cases need from the outside world; the adapters provide it. */

export interface SnapshotRepository {
  /** stores a new snapshot; false when its id is taken already */
  insert(snapshot: Snapshot): Promise<boolean>;
  find(id: string): Promise<Snapshot | null>;
}

export type RateDecision = { ok: true } | { ok: false; retryAfterSeconds: number };

export interface RateLimiter {
  /** counts one request of `key`, or refuses it */
  take(key: string): RateDecision;
}

export interface Clock {
  now(): Date;
}

export type RandomBytes = (n: number) => Uint8Array;
