import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { WorksheetDocument } from "@automatalab/core/worksheet/document";

/** The database's tables; `npm run gen -w @automatalab/server` writes the migrations from this file. */

export const snapshots = sqliteTable("snapshots", {
  id: text("id").primaryKey(),
  worksheet: text("worksheet", { mode: "json" }).$type<WorksheetDocument>().notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull()
});
