import { eq, sql } from "drizzle-orm";
import type { SnapshotRepository } from "../../../application/ports";
import type { Db } from "./database";
import { snapshots } from "./schema";

export function sqliteSnapshotRepository(db: Db): SnapshotRepository {
  return {
    async insert(snapshot) {
      return db.insert(snapshots).values(snapshot).onConflictDoNothing().run().changes === 1;
    },
    async find(id) {
      return db.select().from(snapshots).where(eq(snapshots.id, id)).get() ?? null;
    },
    async storedBytes() {
      // the pages in use, known without a scan; the pages a delete frees are filled again before the file grows
      const row = db.get<{ bytes: number }>(
        sql`select (page_count - freelist_count) * page_size as bytes from pragma_page_count(), pragma_freelist_count(), pragma_page_size()`
      );
      return row.bytes;
    }
  };
}
