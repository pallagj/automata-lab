import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";

/**
 * Whom a request comes from. Behind the reverse proxy the connection is the proxy's own,
 * so the address is the last one the proxy appended to X-Forwarded-For — the one it saw;
 * earlier entries are whatever the client sent and are not trusted.
 */
export function requesterReader(behindProxy: boolean): (c: Context) => string {
  return (c) => {
    if (behindProxy) {
      const forwarded = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
      if (forwarded) return forwarded;
    }
    return getConnInfo(c).remote.address ?? "unknown";
  };
}
