/** The server's settings, from the environment; the defaults run it locally next to `npm run dev`. */
export interface Config {
  host: string;
  port: number;
  databaseFile: string;
  /** the app's address, the start of every share link */
  publicUrl: string;
  /** behind a reverse proxy (Caddy): the client's address is in X-Forwarded-For */
  behindProxy: boolean;
}

export function readConfig(env: Record<string, string | undefined>): Config {
  return {
    host: env.HOST ?? "127.0.0.1",
    port: Number(env.PORT ?? 8787),
    databaseFile: env.DATABASE_FILE ?? "automatalab.db",
    publicUrl: env.PUBLIC_URL ?? "http://localhost:5173",
    behindProxy: env.BEHIND_PROXY === "1"
  };
}
