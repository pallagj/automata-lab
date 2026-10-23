import { randomFillSync } from "node:crypto";
import type { Clock, Log, RandomBytes } from "../../application/ports";

export const systemClock: Clock = { now: () => new Date() };

/** Cryptographically strong bytes: share ids must not be guessable. */
export const cryptoRandomBytes: RandomBytes = (n) => randomFillSync(new Uint8Array(n));

/** To standard error: under systemd, into the journal. */
export const consoleLog: Log = { warn: (message) => console.warn(message) };

/** A log that keeps nothing: for tests. */
export const silentLog: Log = { warn: () => {} };
