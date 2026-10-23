import { describe, expect, it } from "vitest";
import { windowRateLimiter } from "./rateLimiter";

function limiter(perKey: number, total: number) {
  let t = 0;
  const l = windowRateLimiter({ perKey: { limit: perKey, ms: 60_000 }, total: { limit: total, ms: 3_600_000 }, now: () => t });
  return { take: (k: string) => l.take(k), at: (ms: number) => void (t = ms) };
}

describe("the rate limiter", () => {
  it("lets a key make `limit` requests in its window, then says when to come back", () => {
    const l = limiter(3, 100);
    expect([1, 2, 3].map(() => l.take("a").ok)).toEqual([true, true, true]);
    l.at(20_000);
    expect(l.take("a")).toEqual({ ok: false, retryAfterSeconds: 40 });
    l.at(59_999);
    expect(l.take("a")).toEqual({ ok: false, retryAfterSeconds: 1 });
    l.at(60_000);
    expect(l.take("a")).toEqual({ ok: true });
  });

  it("counts every key on its own", () => {
    const l = limiter(1, 100);
    expect(l.take("a").ok).toBe(true);
    expect(l.take("b").ok).toBe(true);
    expect(l.take("a").ok).toBe(false);
    expect(l.take("b").ok).toBe(false);
  });

  it("caps all keys together, whatever address they come from", () => {
    const l = limiter(10, 3);
    expect(["a", "b", "c"].map((k) => l.take(k).ok)).toEqual([true, true, true]);
    l.at(600_000);
    expect(l.take("d")).toEqual({ ok: false, retryAfterSeconds: 3000 });
    l.at(3_600_000);
    expect(l.take("d").ok).toBe(true);
  });

  it("a refused request does not count", () => {
    const l = limiter(1, 2);
    l.take("a");
    for (let i = 0; i < 5; i++) expect(l.take("a").ok).toBe(false);
    expect(l.take("b").ok).toBe(true);
  });
});
