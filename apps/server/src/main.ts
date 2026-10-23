import { serve } from "@hono/node-server";
import { sharingUseCases } from "./application/sharing";
import { createHttpApp } from "./adapters/http/app";
import { requesterReader } from "./adapters/http/requester";
import { mcpHandler } from "./adapters/mcp/server";
import { openDatabase } from "./adapters/persistence/sqlite/database";
import { sqliteSnapshotRepository } from "./adapters/persistence/sqlite/snapshotRepository";
import { windowRateLimiter } from "./adapters/system/rateLimiter";
import { consoleLog, cryptoRandomBytes, systemClock } from "./adapters/system/system";
import { readConfig } from "./config";

/* The composition root: the only place that knows every adapter and wires them to the use cases. */

const config = readConfig(process.env);
// the migrations sit next to src/ and dist/ alike
const db = openDatabase(config.databaseFile, new URL("../drizzle", import.meta.url).pathname);

const sharing = sharingUseCases({
  snapshots: sqliteSnapshotRepository(db),
  // a class behind one address shares a lot at once; the total caps what anyone can store
  rateLimiter: windowRateLimiter({
    perKey: { limit: 60, ms: 10 * 60_000 },
    total: { limit: 600, ms: 60 * 60_000 },
    log: consoleLog
  }),
  // the disk is shared with other sites; a term of a class takes about 20 MB
  storageLimitBytes: 1024 ** 3,
  log: consoleLog,
  clock: systemClock,
  randomBytes: cryptoRandomBytes,
  publicUrl: config.publicUrl
});

const app = createHttpApp({
  sharing,
  requester: requesterReader(config.behindProxy),
  mcp: mcpHandler({ sharing })
});

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) =>
  console.log(`AutomataLab API on http://${info.address}:${info.port} (database ${config.databaseFile})`)
);

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    server.close();
    db.close();
    process.exit(0);
  });
