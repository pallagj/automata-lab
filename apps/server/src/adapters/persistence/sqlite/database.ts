import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

/** Opens (or creates) the database file and brings its tables up to date; ":memory:" for a throwaway one. */
export function openDatabase(file: string, migrationsFolder: string) {
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return Object.assign(db, { close: () => sqlite.close() });
}

export type Db = ReturnType<typeof openDatabase>;
