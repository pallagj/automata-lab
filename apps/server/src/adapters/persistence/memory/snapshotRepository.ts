import type { SnapshotRepository } from "../../../application/ports";
import type { Snapshot } from "../../../domain/snapshot";

/** Snapshots in a map: for tests and for running the server without a database. */
export function memorySnapshotRepository(): SnapshotRepository & { all(): Snapshot[] } {
  const byId = new Map<string, Snapshot>();
  return {
    async insert(snapshot) {
      if (byId.has(snapshot.id)) return false;
      byId.set(snapshot.id, structuredClone(snapshot));
      return true;
    },
    async find(id) {
      const s = byId.get(id);
      return s ? structuredClone(s) : null;
    },
    async storedBytes() {
      let bytes = 0;
      for (const s of byId.values()) bytes += Buffer.byteLength(JSON.stringify(s.worksheet));
      return bytes;
    },
    all: () => [...byId.values()]
  };
}
