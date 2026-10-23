import type { WorksheetDocument } from "@automatalab/core/worksheet/document";
import { SHARE_ID_ALPHABET, SHARE_ID_LENGTH, sharePath } from "@automatalab/core/worksheet/shareLink";

/** A shared worksheet: stored once, never changed, opened by its id. */
export interface Snapshot {
  id: string;
  /** as it was shared, at the version it was written at */
  worksheet: WorksheetDocument;
  createdAt: Date;
}

/** The largest multiple of the alphabet's size that fits in a byte: bytes from here on are dropped. */
const UNBIASED_BYTES = 256 - (256 % SHARE_ID_ALPHABET.length);

/**
 * A new snapshot id from random bytes. A byte maps to a letter by its remainder; the bytes
 * of the last, incomplete round (252…255) are dropped, so every letter is equally likely.
 */
export function newSnapshotId(randomBytes: (n: number) => Uint8Array): string {
  let id = "";
  while (id.length < SHARE_ID_LENGTH) {
    for (const b of randomBytes(SHARE_ID_LENGTH * 2)) {
      if (b >= UNBIASED_BYTES) continue;
      id += SHARE_ID_ALPHABET[b % SHARE_ID_ALPHABET.length];
      if (id.length === SHARE_ID_LENGTH) break;
    }
  }
  return id;
}

/** The link that opens a snapshot in the app at `publicUrl`. */
export function shareUrl(publicUrl: string, id: string): string {
  return publicUrl.replace(/\/+$/, "") + sharePath(id);
}
