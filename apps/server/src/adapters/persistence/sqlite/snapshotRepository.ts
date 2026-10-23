import { eq } from "drizzle-orm";
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
    }
  };
}
