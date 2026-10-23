import { upToDate, WorksheetDocument } from "@automatalab/core/worksheet/document";
import { isShareId } from "@automatalab/core/worksheet/shareLink";
import { newSnapshotId, shareUrl } from "../domain/snapshot";
import type { Clock, RandomBytes, RateLimiter, SnapshotRepository } from "./ports";

export interface SharingDeps {
  snapshots: SnapshotRepository;
  rateLimiter: RateLimiter;
  clock: Clock;
  randomBytes: RandomBytes;
  /** the app's address, the start of every link */
  publicUrl: string;
}

export type ShareResult =
  | { ok: true; id: string; url: string }
  | { ok: false; error: "newer_version" }
  | { ok: false; error: "rate_limited"; retryAfterSeconds: number };

export interface SharedWorksheet {
  id: string;
  url: string;
  createdAt: Date;
  /** brought up to the current save version */
  worksheet: WorksheetDocument;
}

export type OpenResult = { ok: true; shared: SharedWorksheet } | { ok: false; error: "not_found" | "newer_version" };

/** How many fresh ids are tried before giving up: with 36¹⁰ ids, even one clash is never expected. */
const ID_ATTEMPTS = 5;

/** Sharing a worksheet by a short link, and opening one. */
export function sharingUseCases(deps: SharingDeps) {
  return {
    /** stores the worksheet as it is now; `requester` is whom the rate limit counts (an address) */
    async share(worksheet: WorksheetDocument, requester: string): Promise<ShareResult> {
      if (upToDate(worksheet) === null) return { ok: false, error: "newer_version" };
      const allowed = deps.rateLimiter.take(requester);
      if (!allowed.ok) return { ok: false, error: "rate_limited", retryAfterSeconds: allowed.retryAfterSeconds };
      for (let attempt = 0; attempt < ID_ATTEMPTS; attempt++) {
        const id = newSnapshotId(deps.randomBytes);
        if (await deps.snapshots.insert({ id, worksheet, createdAt: deps.clock.now() }))
          return { ok: true, id, url: shareUrl(deps.publicUrl, id) };
      }
      throw new Error(`no free snapshot id in ${ID_ATTEMPTS} attempts`);
    },

    async open(id: string): Promise<OpenResult> {
      const snapshot = isShareId(id) ? await deps.snapshots.find(id) : null;
      if (!snapshot) return { ok: false, error: "not_found" };
      // stored by a newer server that was then rolled back: it can not be read correctly
      const worksheet = upToDate(snapshot.worksheet);
      if (!worksheet) return { ok: false, error: "newer_version" };
      return { ok: true, shared: { id, url: shareUrl(deps.publicUrl, id), createdAt: snapshot.createdAt, worksheet } };
    }
  };
}

export type SharingUseCases = ReturnType<typeof sharingUseCases>;
