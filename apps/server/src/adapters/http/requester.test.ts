import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { requesterReader } from "./requester";

function app(behindProxy: boolean) {
  const read = requesterReader(behindProxy);
  return new Hono().get("/", (c) => c.text(read(c)));
}

describe("whom a request comes from", () => {
  it("behind the proxy, is the address the proxy appended last", async () => {
    const res = await app(true).request("/", { headers: { "x-forwarded-for": "6.6.6.6, 1.2.3.4" } });
    expect(await res.text()).toBe("1.2.3.4");
  });

  it("behind the proxy, a single forwarded address is the client", async () => {
    const res = await app(true).request("/", { headers: { "x-forwarded-for": " 1.2.3.4 " } });
    expect(await res.text()).toBe("1.2.3.4");
  });

  it("without a proxy, a forwarded address the client wrote is ignored", async () => {
    const env = { incoming: { socket: { remoteAddress: "9.9.9.9", remotePort: 1, remoteFamily: "IPv4" } } };
    const res = await app(false).request("/", { headers: { "x-forwarded-for": "1.2.3.4" } }, env);
    expect(await res.text()).toBe("9.9.9.9");
  });
});
