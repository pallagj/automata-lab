import { randomFillSync } from "node:crypto";
import type { Clock, RandomBytes } from "../../application/ports";

export const systemClock: Clock = { now: () => new Date() };

/** Cryptographically strong bytes: share ids must not be guessable. */
export const cryptoRandomBytes: RandomBytes = (n) => randomFillSync(new Uint8Array(n));
